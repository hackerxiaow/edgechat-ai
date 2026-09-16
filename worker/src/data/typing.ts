import type { D1Database } from '@cloudflare/workers-types';
import { publicFileUrl } from '../utils.ts';

/** 「正在输入」的存活窗口：超过这个时间未刷新即视为已停止输入。 */
export const TYPING_TTL_SECONDS = 5;

export interface TypingUser {
  userId: number;
  displayName: string;
  avatarUrl: string;
}

/**
 * 标记/清除「正在输入」。只做单行 upsert 或删除，
 * 行数被房间成员数天然限定，不需要 GC，过期由读取时判断。
 */
export async function setRoomTyping(
  db: D1Database,
  { channelId, userId, typing }: { channelId: number | string; userId: number | string; typing: boolean }
): Promise<void> {
  if (!typing) {
    await db
      .prepare('DELETE FROM room_typing WHERE channel_id = ? AND user_id = ?')
      .bind(Number(channelId), Number(userId))
      .run();
    return;
  }

  await db
    .prepare(
      `INSERT INTO room_typing (channel_id, user_id, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(channel_id, user_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP`
    )
    .bind(Number(channelId), Number(userId))
    .run();
}

/** 读取当前仍在输入的人（排除自己），供同步接口顺带回传。 */
export async function listRoomTypingUsers(
  db: D1Database,
  { channelId, excludeUserId }: { channelId: number | string; excludeUserId?: number | string | null }
): Promise<TypingUser[]> {
  const { results } = await db
    .prepare(
      `SELECT t.user_id, u.display_name, u.avatar_key
       FROM room_typing t
       JOIN users u ON u.id = t.user_id
       WHERE t.channel_id = ?
         AND t.updated_at > datetime('now', ?)
         AND t.user_id != ?
         AND u.is_disabled = 0
       ORDER BY t.updated_at DESC
       LIMIT 8`
    )
    .bind(Number(channelId), `-${TYPING_TTL_SECONDS} seconds`, Number(excludeUserId) || 0)
    .all<{ user_id: number; display_name: string | null; avatar_key: string | null }>();

  return results.map((row) => ({
    userId: Number(row.user_id),
    displayName: row.display_name ?? '',
    avatarUrl: row.avatar_key ? publicFileUrl(row.avatar_key) : ''
  }));
}
