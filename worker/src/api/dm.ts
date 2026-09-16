import type { Hono } from 'hono';
import type { AppEnv } from '../types.ts';
import { ensureDmChannel } from '../data/dm-provisioning.ts';
import { listAdminDms, listUserDms } from '../data/dm-queries.ts';
import { getUserBlockStatus } from '../data/user-blocks.ts';
import { errorResponse, parseJsonRequest } from '../utils.ts';
import { activeUserSql } from '../user-status.ts';

interface DmTargetRow {
  id: number;
  username: string;
  display_name: string;
  avatar_key: string | null;
}

export function registerDmRoutes(app: Hono<AppEnv>) {
  app.get('/api/dm', async (c) => {
    const session = c.get('session');
    const dms = await listUserDms(c.env.DB, session.userId);
    return c.json({ dms });
  });

  app.post('/api/dm/open', async (c) => {
    const session = c.get('session');
    const payload = await parseJsonRequest(c.req.raw);
    const targetUserId = Number(payload.userId);

    if (!Number.isFinite(targetUserId) || targetUserId === session.userId) {
      return errorResponse('请选择有效用户');
    }

    const targetUser = await c.env.DB.prepare(
      `SELECT id, username, display_name, avatar_key
       FROM users
       WHERE id = ?
         AND ${activeUserSql()}
         AND deleted_at IS NULL
       LIMIT 1`
    )
      .bind(targetUserId)
      .all<DmTargetRow>();

    const target = targetUser.results[0];
    if (!target) {
      return errorResponse('目标用户不存在', 404);
    }

    const [channel, blockStatus] = await Promise.all([
      ensureDmChannel(c.env.DB, session.userId, targetUserId),
      getUserBlockStatus(c.env.DB, session.userId, targetUserId)
    ]);
    return c.json({
      dm: {
        id: Number(channel.id),
        kind: 'dm',
        name: channel.dm_key,
        otherUser: {
          id: Number(target.id),
          username: target.username,
          displayName: target.display_name,
          avatarUrl: target.avatar_key
            ? `/files/${encodeURIComponent(target.avatar_key)}`
            : ''
        },
        isBlockedByMe: blockStatus.blockedByMe
      }
    });
  });

  app.get('/api/admin/dms', async (c) => {
    const dms = await listAdminDms(c.env.DB);
    return c.json({ dms });
  });
}
