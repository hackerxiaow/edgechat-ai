import type { D1Database } from '@cloudflare/workers-types';
import { publicFileUrl } from '../utils.ts';

/** 人类用户的存活窗口：客户端每 2.5 秒刷新一次，超过这个时间未刷新即视为已停止输入。 */
export const TYPING_TTL_SECONDS = 5;

/**
 * 外部发送者（AI 机器人）的存活窗口。
 * 机器人只在开始生成时上报一次、生成结束才清除，而生成可能远超 5 秒；
 * 用人类那样的短窗口会让指示器在中途提前消失，造成「闪完了消息却还不来」的空档。
 * 机器人是显式清除的，所以窗口给得宽一些也不会残留。
 */
export const EXTERNAL_TYPING_TTL_SECONDS = 90;

export interface TypingUser {
  /** 'user:<id>' 或 'external:<id>'，用于前端去重。 */
  key: string;
  userId: number | null;
  displayName: string;
  avatarUrl: string;
}

function localTyperKey(userId: number | string): string {
  return `user:${Number(userId)}`;
}

async function upsertTyper(
  db: D1Database,
  {
    channelId,
    typerKey,
    displayName,
    avatarUrl
  }: { channelId: number | string; typerKey: string; displayName: string; avatarUrl: string }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO room_typing (channel_id, typer_key, display_name, avatar_url, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(channel_id, typer_key) DO UPDATE SET
         display_name = excluded.display_name,
         avatar_url = excluded.avatar_url,
         updated_at = CURRENT_TIMESTAMP`
    )
    .bind(Number(channelId), typerKey, displayName, avatarUrl)
    .run();
}

/** 本地用户标记/清除「正在输入」。 */
export async function setRoomTyping(
  db: D1Database,
  { channelId, userId, typing }: { channelId: number | string; userId: number | string; typing: boolean }
): Promise<void> {
  const typerKey = localTyperKey(userId);
  if (!typing) {
    await db
      .prepare('DELETE FROM room_typing WHERE channel_id = ? AND typer_key = ?')
      .bind(Number(channelId), typerKey)
      .run();
    return;
  }

  const profile = await db
    .prepare('SELECT display_name, avatar_key FROM users WHERE id = ? LIMIT 1')
    .bind(Number(userId))
    .first<{ display_name: string | null; avatar_key: string | null }>();

  await upsertTyper(db, {
    channelId,
    typerKey,
    displayName: profile?.display_name ?? '',
    avatarUrl: profile?.avatar_key ? publicFileUrl(profile.avatar_key) : ''
  });
}

/** 外部发送者（如 AI 机器人）标记/清除「正在输入」。 */
export async function setExternalRoomTyping(
  db: D1Database,
  {
    channelId,
    externalId,
    displayName,
    avatarUrl = '',
    typing
  }: {
    channelId: number | string;
    externalId: string;
    displayName: string;
    avatarUrl?: string;
    typing: boolean;
  }
): Promise<void> {
  const typerKey = `external:${externalId}`;
  if (!typing) {
    await db
      .prepare('DELETE FROM room_typing WHERE channel_id = ? AND typer_key = ?')
      .bind(Number(channelId), typerKey)
      .run();
    return;
  }
  await upsertTyper(db, { channelId, typerKey, displayName, avatarUrl });
}

/** 读取当前仍在输入的人（排除自己），供同步接口顺带回传。 */
export async function listRoomTypingUsers(
  db: D1Database,
  { channelId, excludeUserId }: { channelId: number | string; excludeUserId?: number | string | null }
): Promise<TypingUser[]> {
  const { results } = await db
    .prepare(
      `SELECT typer_key, display_name, avatar_url
       FROM room_typing
       WHERE channel_id = ?
         AND (
           (typer_key LIKE 'user:%' AND updated_at > datetime('now', ?))
           OR (typer_key LIKE 'external:%' AND updated_at > datetime('now', ?))
         )
         AND typer_key != ?
       ORDER BY updated_at DESC
       LIMIT 8`
    )
    .bind(
      Number(channelId),
      `-${TYPING_TTL_SECONDS} seconds`,
      `-${EXTERNAL_TYPING_TTL_SECONDS} seconds`,
      excludeUserId ? localTyperKey(excludeUserId) : ''
    )
    .all<{ typer_key: string; display_name: string | null; avatar_url: string | null }>();

  return results.map((row) => {
    const key = String(row.typer_key);
    const numericId = key.startsWith('user:') ? Number(key.slice(5)) : NaN;
    return {
      key,
      userId: Number.isFinite(numericId) ? numericId : null,
      displayName: row.display_name ?? '',
      avatarUrl: row.avatar_url ?? ''
    };
  });
}
