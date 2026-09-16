import type { D1Database } from '@cloudflare/workers-types';
import { ApiError } from '../errors.ts';

export async function createOpenUser(
  db: D1Database,
  user: { username: string; email?: string; displayName: string; passwordHash: string; passwordSalt: string }
): Promise<number> {
  try {
    const result = await db.prepare(
      `INSERT INTO users (username, email, display_name, password_hash, password_salt) VALUES (?, ?, ?, ?, ?)`
    ).bind(user.username, user.email || null, user.displayName, user.passwordHash, user.passwordSalt).run();
    return Number(result.meta.last_row_id ?? 0);
  } catch (error) {
    throw new ApiError('注册失败，用户名或邮箱可能已存在');
  }
}

export async function createPasswordReset(db: D1Database, email: string): Promise<{ token: string; username: string } | null> {
  const user = await db.prepare(`SELECT id, username FROM users WHERE email = ? AND is_disabled = 0`).bind(email).first<{ id: number, username: string }>();
  if (!user) return null;

  const token = crypto.randomUUID();
  // Expires in 1 hour
  const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
  await db.prepare(`INSERT INTO password_resets (token, user_id, expires_at) VALUES (?, ?, ?)`).bind(token, user.id, expiresAt).run();
  
  return { token, username: user.username };
}

export async function getPasswordReset(db: D1Database, token: string): Promise<{ user_id: number } | null> {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z';
  return await db.prepare(`SELECT user_id FROM password_resets WHERE token = ? AND expires_at > ?`).bind(token, now).first<{ user_id: number }>();
}

export async function clearPasswordReset(db: D1Database, token: string) {
  await db.prepare(`DELETE FROM password_resets WHERE token = ?`).bind(token).run();
}

export async function resetUserPassword(db: D1Database, userId: number, passwordHash: string, passwordSalt: string) {
  await db.prepare(`UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?`).bind(passwordHash, passwordSalt, userId).run();
}
