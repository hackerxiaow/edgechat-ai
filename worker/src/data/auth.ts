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

export async function generateVerificationCode(db: D1Database, email: string, purpose: 'register' | 'login'): Promise<string> {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
  await db.prepare('INSERT INTO verification_codes (email, code, purpose, expires_at) VALUES (?, ?, ?, ?)')
    .bind(email, code, purpose, expiresAt)
    .run();
  return code;
}

export async function verifyVerificationCode(db: D1Database, email: string, code: string, purpose: 'register' | 'login'): Promise<boolean> {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z';
  const row = await db.prepare('SELECT id FROM verification_codes WHERE email = ? AND code = ? AND purpose = ? AND expires_at > ?')
    .bind(email, code, purpose, now)
    .first<{ id: number }>();
  if (row) {
    await db.prepare('DELETE FROM verification_codes WHERE id = ?').bind(row.id).run();
    return true;
  }
  return false;
}

export async function sendEmail(smtpRelayUrl: string, smtpApiKey: string, to: string, subject: string, text: string) {
  if (!smtpRelayUrl) return false;
  try {
    const res = await fetch(smtpRelayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${smtpApiKey}` },
      body: JSON.stringify({ to, subject, text })
    });
    return res.ok;
  } catch (e) {
    console.error('sendEmail error', e);
    return false;
  }
}
