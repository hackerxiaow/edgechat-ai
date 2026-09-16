import type { SessionUser } from './types.ts';
import { deleteSession, isAdminUser, putSession, type SessionUserInput } from './auth.ts';
import { ApiError } from './errors.ts';
import { isUserDisabled } from './user-status.ts';
import { randomToken } from './utils.ts';

export const MOBILE_ACCESS_TTL_SECONDS = 60 * 60;
export const MOBILE_REFRESH_TTL_DAYS = 90;

type MobileSessionEnv = { DB: D1Database };

/** 移动端设备会话：在网页会话之上带设备与安装标识。 */
export interface MobileAccessSession extends SessionUser {
	sessionKind: 'mobile';
	deviceSessionId: string;
	installationId: string;
	expiresAt: string;
}

export interface MobileDeviceInput {
	installationId?: unknown;
	name?: unknown;
	appVersion?: unknown;
}

export interface NormalizedDevice {
	installationId: string;
	name: string;
	appVersion: string;
}

export interface MobileSessionResponse {
	accessToken: string;
	accessTokenExpiresAt: string | undefined;
	refreshToken: string;
	refreshTokenExpiresAt: string;
	session: MobileAccessSession;
}

function toSqlTimestamp(date: Date): string {
	return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function refreshExpiry(): string {
	return toSqlTimestamp(new Date(Date.now() + MOBILE_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000));
}

function publicExpiry(value: string): string {
	return `${String(value).replace(' ', 'T')}Z`;
}

function normalizeDevice(device: MobileDeviceInput | null | undefined): NormalizedDevice {
	const installationId = String(device?.installationId || '').trim();
	const name = String(device?.name || '').trim().slice(0, 80);
	const appVersion = String(device?.appVersion || '').trim().slice(0, 32);
	if (!installationId || installationId.length > 128 || !name) {
		throw new ApiError('设备信息无效', 400, 'invalid_device');
	}
	return { installationId, name, appVersion };
}

export async function hashOpaqueToken(token: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(String(token || ''));
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
	const binary = Array.from(digest, (byte) => String.fromCharCode(byte)).join('');
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function createAccessSession(
	env: MobileSessionEnv,
	user: SessionUserInput,
	deviceSessionId: string,
	installationId: string,
): Promise<MobileAccessSession> {
	const token = randomToken(32);
	const expiresAt = new Date(Date.now() + MOBILE_ACCESS_TTL_SECONDS * 1000).toISOString();
	const session: MobileAccessSession = {
		token,
		userId: Number(user.id),
		username: user.username,
		displayName: user.display_name,
		avatarUrl: user.avatar_key ? `/files/${encodeURIComponent(user.avatar_key)}` : '',
		isAdmin: isAdminUser(env, user),
		sessionVersion: Number(user.session_version || 0),
		sessionKind: 'mobile',
		deviceSessionId,
		installationId,
		expiresAt
	};
	await putSession(env, session, { ttlSeconds: MOBILE_ACCESS_TTL_SECONDS });
	return session;
}

function sessionResponse(
	accessSession: MobileAccessSession,
	refreshToken: string,
	refreshExpiresAt: string,
): MobileSessionResponse {
	return {
		accessToken: accessSession.token,
		accessTokenExpiresAt: accessSession.expiresAt,
		refreshToken,
		refreshTokenExpiresAt: publicExpiry(refreshExpiresAt),
		session: accessSession
	};
}

export async function createMobileDeviceSession(
	env: MobileSessionEnv,
	user: SessionUserInput,
	rawDevice: MobileDeviceInput | null | undefined,
): Promise<MobileSessionResponse> {
	const device = normalizeDevice(rawDevice);
	const deviceSessionId = crypto.randomUUID();
	const refreshToken = randomToken(32);
	const refreshTokenHash = await hashOpaqueToken(refreshToken);
	const expiresAt = refreshExpiry();
	const sessionVersion = Number(user.session_version || 0);

	await env.DB.batch([
		env.DB.prepare(
			`UPDATE device_sessions
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE user_id = ?
         AND installation_id = ?
         AND revoked_at IS NULL`
		).bind(Number(user.id), device.installationId),
		env.DB.prepare(
			`INSERT INTO device_sessions (
         id, user_id, installation_id, device_name, app_version,
         refresh_token_hash, session_version, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		).bind(
			deviceSessionId,
			Number(user.id),
			device.installationId,
			device.name,
			device.appVersion,
			refreshTokenHash,
			sessionVersion,
			expiresAt
		)
	]);

	const accessSession = await createAccessSession(
		env,
		user,
		deviceSessionId,
		device.installationId
	);
	return sessionResponse(accessSession, refreshToken, expiresAt);
}

interface RefreshRow {
	device_session_id: string;
	user_id: number;
	installation_id: string;
	refresh_token_hash: string;
	device_session_version: number;
	username: string;
	display_name: string;
	avatar_key: string | null;
	is_admin: number;
	session_version: number;
	is_disabled: number;
	disabled_until: string | null;
	deleted_at: string | null;
}

export async function refreshMobileDeviceSession(
	env: MobileSessionEnv,
	rawRefreshToken: unknown,
	rawInstallationId: unknown,
): Promise<MobileSessionResponse> {
	const refreshToken = String(rawRefreshToken || '').trim();
	const installationId = String(rawInstallationId || '').trim();
	if (!refreshToken || !installationId) {
		throw new ApiError('刷新凭据无效', 401, 'refresh_token_invalid');
	}

	const refreshTokenHash = await hashOpaqueToken(refreshToken);
	const { results } = await env.DB.prepare(
		`SELECT
       ds.id AS device_session_id, ds.user_id, ds.installation_id,
       ds.refresh_token_hash, ds.session_version AS device_session_version,
       u.username, u.display_name, u.avatar_key, u.is_admin,
       u.session_version, u.is_disabled, u.disabled_until, u.deleted_at
     FROM device_sessions ds
     JOIN users u ON u.id = ds.user_id
     WHERE ds.refresh_token_hash = ?
       AND ds.installation_id = ?
       AND ds.revoked_at IS NULL
       AND ds.expires_at > CURRENT_TIMESTAMP
     LIMIT 1`
	)
		.bind(refreshTokenHash, installationId)
		.all<RefreshRow>();
	const row = results[0];
	if (
		!row ||
		row.deleted_at ||
		isUserDisabled(row) ||
		Number(row.device_session_version || 0) !== Number(row.session_version || 0)
	) {
		throw new ApiError('刷新凭据已失效，请重新登录', 401, 'refresh_token_invalid');
	}

	const nextRefreshToken = randomToken(32);
	const nextRefreshTokenHash = await hashOpaqueToken(nextRefreshToken);
	const nextExpiresAt = refreshExpiry();
	const update = await env.DB.prepare(
		`UPDATE device_sessions
     SET refresh_token_hash = ?,
         last_used_at = CURRENT_TIMESTAMP,
         expires_at = ?
     WHERE id = ?
       AND refresh_token_hash = ?
       AND revoked_at IS NULL
       AND expires_at > CURRENT_TIMESTAMP`
	)
		.bind(nextRefreshTokenHash, nextExpiresAt, row.device_session_id, refreshTokenHash)
		.run();
	if (Number(update.meta?.changes || 0) !== 1) {
		throw new ApiError('刷新凭据已被使用，请重新登录', 401, 'refresh_token_reused');
	}

	const user: SessionUserInput = {
		id: row.user_id,
		username: row.username,
		display_name: row.display_name,
		avatar_key: row.avatar_key,
		is_admin: row.is_admin,
		session_version: row.session_version
	};
	const accessSession = await createAccessSession(
		env,
		user,
		row.device_session_id,
		row.installation_id
	);
	return sessionResponse(accessSession, nextRefreshToken, nextExpiresAt);
}

export async function revokeMobileDeviceSession(
	env: MobileSessionEnv,
	session: SessionUser | null | undefined,
): Promise<void> {
	if (session?.deviceSessionId) {
		await env.DB.prepare(
			`UPDATE device_sessions
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL`
		)
			.bind(String(session.deviceSessionId), Number(session.userId))
			.run();
	}
	await deleteSession(env, String(session?.token || ''));
}

export async function updateCurrentDeviceSessionVersion(
	env: MobileSessionEnv,
	session: SessionUser | null | undefined,
	sessionVersion: unknown,
): Promise<void> {
	if (!session?.deviceSessionId) return;
	await env.DB.prepare(
		`UPDATE device_sessions
     SET session_version = ?, last_used_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ? AND revoked_at IS NULL`
	)
		.bind(Number(sessionVersion), String(session.deviceSessionId), Number(session.userId))
		.run();
}
