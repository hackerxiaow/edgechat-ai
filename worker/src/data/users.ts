import type { UserProfile, UserSummary } from "../../../shared/user-profile.ts";
import { publicFileUrl } from "../utils.ts";
import { activeUserSql, projectUserBan } from "../user-status.ts";

/** users 表的完整行；`SELECT *` 的调用方（登录、会话校验）需要全部字段。 */
export interface UserRow {
	id: number;
	username: string;
	display_name: string;
	bio: string;
	password_hash: string;
	password_salt: string;
	avatar_key: string | null;
	registration_invite_id: number | null;
	is_disabled: number;
	disabled_until: string | null;
	is_admin: number;
	session_version: number;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
}

/** 封禁状态由 projectUserBan 推导，避免这里再手写一份字段清单。 */
export type AdminUser = UserSummary &
	ReturnType<typeof projectUserBan> & { createdAt: string };

interface SummaryRow {
	id: number;
	username: string;
	display_name: string;
	avatar_key: string | null;
}

function mapUserSummary(row: SummaryRow): UserSummary {
	return {
		id: Number(row.id),
		username: row.username,
		displayName: row.display_name,
		avatarUrl: row.avatar_key ? publicFileUrl(row.avatar_key) : "",
	};
}

export async function getUserProfile(
	db: D1Database,
	userId: number | string,
): Promise<UserProfile | null> {
	const { results } = await db
		.prepare(
			`SELECT id, username, display_name, avatar_key, bio
			 FROM users WHERE id = ? AND deleted_at IS NULL AND ${activeUserSql()} LIMIT 1`,
		)
		.bind(userId)
		.all<SummaryRow & { bio: string }>();
	const row = results[0];
	return row ? { ...mapUserSummary(row), bio: row.bio } : null;
}

function mapAdminUser(
	row: SummaryRow & {
		is_disabled: number;
		disabled_until: string | null;
		created_at: string;
	},
): AdminUser {
	return {
		...mapUserSummary(row),
		...projectUserBan(row),
		createdAt: row.created_at,
	};
}

export async function getUserByUsername(
	db: D1Database,
	username: string,
): Promise<UserRow | null> {
	const { results } = await db
		.prepare(
			`SELECT *
			 FROM users
			 WHERE username = ?
			   AND deleted_at IS NULL
			 LIMIT 1`,
		)
		.bind(username)
		.all<UserRow>();
	return results[0] || null;
}

export async function isUserActiveById(
	db: D1Database,
	userId: number | string,
): Promise<boolean> {
	const { results } = await db
		.prepare(
			`SELECT id
			 FROM users
			 WHERE id = ?
			   AND deleted_at IS NULL
				   AND ${activeUserSql()}
			 LIMIT 1`,
		)
		.bind(Number(userId))
		.all<{ id: number }>();
	return Boolean(results[0]);
}

export async function listActiveUsers(
	db: D1Database,
	excludeUserId: number | string,
): Promise<UserSummary[]> {
	const { results } = await db
		.prepare(
			`SELECT id, username, display_name, avatar_key
			 FROM users
			 WHERE deleted_at IS NULL
				   AND ${activeUserSql()}
			   AND id != ?
			 ORDER BY display_name ASC`,
		)
		.bind(Number(excludeUserId))
		.all<SummaryRow>();
	return results.map(mapUserSummary);
}

export async function listContacts(db: D1Database): Promise<UserSummary[]> {
	const { results } = await db
		.prepare(
			`SELECT id, username, display_name, avatar_key
			 FROM users
			 WHERE deleted_at IS NULL
			   AND ${activeUserSql()}
			 ORDER BY display_name ASC, username ASC, id ASC`,
		)
		.all<SummaryRow>();
	return results.map(mapUserSummary);
}

export async function listAdminUsers(db: D1Database): Promise<AdminUser[]> {
	const { results } = await db
		.prepare(
			`SELECT id, username, display_name, avatar_key, is_disabled, disabled_until, created_at
			 FROM users
			 WHERE deleted_at IS NULL
			 ORDER BY created_at DESC`,
		)
		.all<SummaryRow & { is_disabled: number; disabled_until: string | null; created_at: string }>();
	return results.map(mapAdminUser);
}

export interface StorageOwner {
	id: number;
	username: string;
	displayName: string;
	isDeleted: boolean;
}

export async function listStorageOwners(db: D1Database): Promise<StorageOwner[]> {
	const { results } = await db
		.prepare(
			`SELECT id, username, display_name, deleted_at
			 FROM users
			 ORDER BY id ASC`,
		)
		.all<{ id: number; username: string; display_name: string; deleted_at: string | null }>();
	return results.map((row) => ({
		id: Number(row.id),
		username: row.username,
		displayName: row.display_name,
		isDeleted: Boolean(row.deleted_at),
	}));
}
