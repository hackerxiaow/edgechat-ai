import type { D1Database } from '@cloudflare/workers-types';

/** 「在线」窗口：超过这个时间未心跳即视为离线。 */
export const PRESENCE_TTL_SECONDS = 90;

/** 记录一次心跳。每个用户一行，只在超过半个窗口后才真正写库。 */
export async function touchPresence(
  db: D1Database,
  userId: number | string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_presence (user_id, updated_at)
       VALUES (?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
       WHERE user_presence.updated_at <= datetime('now', ?)`
    )
    .bind(Number(userId), `-${Math.floor(PRESENCE_TTL_SECONDS / 2)} seconds`)
    .run();
}

/** 在线用户 id 集合；离线用户不会出现在结果里。 */
export async function listOnlineUserIds(db: D1Database): Promise<Set<number>> {
  const { results } = await db
    .prepare(
      `SELECT p.user_id
       FROM user_presence p
       JOIN users u ON u.id = p.user_id
       WHERE p.updated_at > datetime('now', ?)
         AND u.is_disabled = 0
         AND u.deleted_at IS NULL`
    )
    .bind(`-${PRESENCE_TTL_SECONDS} seconds`)
    .all<{ user_id: number }>();
  return new Set(results.map((row) => Number(row.user_id)));
}
