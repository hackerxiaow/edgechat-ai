import type { AppBindings, SessionUser } from './types.ts';

const encoder = new TextEncoder();

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

type SessionEnv = Pick<AppBindings, 'DB'>;

/** createSession 需要的最小用户形状，data/users.ts 的 UserRow 满足它。 */
export interface SessionUserInput {
  id: number | string;
  username: string;
  display_name: string;
  bio?: string | null;
  avatar_key?: string | null;
  is_admin?: unknown;
  session_version?: unknown;
}

function toBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let difference = leftBytes.length ^ rightBytes.length;

  // 密码哈希是固定长度的敏感值；始终遍历完整派生结果，避免普通字符串比较随首个差异提前结束。
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

export interface PasswordHash {
  salt: string;
  hash: string;
}

export async function hashPassword(
  password: string,
  salt: string | null = null,
): Promise<PasswordHash> {
  const passwordSalt = salt || toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: fromBase64Url(passwordSalt),
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );
  return {
    salt: passwordSalt,
    hash: toBase64Url(new Uint8Array(bits))
  };
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
  passwordSalt: string,
): Promise<boolean> {
  const derived = await hashPassword(password, passwordSalt);
  return timingSafeEqual(derived.hash, passwordHash);
}

function toSessionVersion(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseAdminUsernames(env: Pick<AppBindings, 'ADMIN_USERNAMES'>): string[] {
  return String(env.ADMIN_USERNAMES || '')
    .split(',')
    .map((username) => username.trim().toLowerCase())
    .filter(Boolean);
}

// 仅用于注册环节的用户名占用检查，防止有人注册出跟管理员同名(忽略大小写)的账号用于钓鱼/混淆。
// 不再作为权限判定依据。
export function isConfiguredAdminUsername(
  env: Pick<AppBindings, 'ADMIN_USERNAMES'>,
  username: unknown,
): boolean {
  const normalizedUsername = String(username || '').trim().toLowerCase();
  return Boolean(normalizedUsername) && parseAdminUsernames(env).includes(normalizedUsername);
}

// 权限判定唯一依据：数据库中的 is_admin 字段，不再比对用户名。
export function isAdminUser(_env: unknown, user: { is_admin?: unknown } | null | undefined): boolean {
  return Boolean(Number(user?.is_admin));
}

function resolveSessionTtl(session: SessionUser, fallback: number): number {
  const expiresAt = Date.parse(String(session.expiresAt || ''));
  if (!Number.isFinite(expiresAt)) {
    return fallback;
  }
  return Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
}

export async function putSession(
  env: SessionEnv,
  session: SessionUser,
  { ttlSeconds = SESSION_TTL_SECONDS }: { ttlSeconds?: number } = {},
): Promise<void> {
  const ttl = resolveSessionTtl(session, ttlSeconds);
  const expiresAt = Math.floor(Date.now() / 1000) + ttl;
  const data = JSON.stringify(session);
  await env.DB.prepare(
    `INSERT INTO sessions (token, user_id, data, expires_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`
  ).bind(session.token, Number(session.userId), data, expiresAt).run();
}

export async function createSession(env: SessionEnv, user: SessionUserInput): Promise<SessionUser> {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const session: SessionUser = {
    token,
    userId: Number(user.id),
    username: user.username,
    displayName: user.display_name,
    bio: user.bio ?? '',
    avatarUrl: user.avatar_key ? `/files/${encodeURIComponent(user.avatar_key)}` : '',
    isAdmin: isAdminUser(env, user),
    sessionVersion: toSessionVersion(user.session_version)
  };

  await putSession(env, session);

  return session;
}

export async function getSession(env: SessionEnv, token: string): Promise<SessionUser | null> {
  if (!token) {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    'SELECT data, expires_at FROM sessions WHERE token = ? LIMIT 1'
  ).bind(token).first<{ data: string; expires_at: number }>();
  if (!row) return null;
  if (row.expires_at < now) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return null;
  }
  const session = JSON.parse(row.data) as SessionUser;
  session.token = token;
  if (session.sessionVersion === undefined) session.sessionVersion = 0;
  if (session.isAdmin === undefined) session.isAdmin = false;
  return session;
}

export async function deleteSession(env: SessionEnv, token: string): Promise<void> {
  if (!token) {
    return;
  }
  await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}
