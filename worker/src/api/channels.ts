import type { Hono } from 'hono';
import type { AppEnv } from '../types.ts';
import {
  listAdminChannels,
  listChannelMembers,
  listVisibleChannels
} from '../data/channels.ts';
import {
  ensureGeneralChannelMembership,
  isGeneralChannel,
  isReservedGeneralChannelName
} from '../data/general-channel.ts';
import {
  authorizeRoom,
  authorizeChannelManagement,
  getChannelById,
  getChannelMembership
} from '../room-access.ts';
import { ApiError } from '../errors.ts';
import {
  isR2ObjectUnavailableError,
  resolveAvatarKeyUpdate
} from '../avatar-policy.ts';
import { errorResponse, parseJsonRequest, publicFileUrl } from '../utils.ts';
import { activeUserSql } from '../user-status.ts';
import { hardDeleteChannel } from '../data/channel-deletion.ts';

function normalizeMemberIds(payload: Record<string, unknown>): number[] {
  const source = Array.isArray(payload.memberUserIds)
    ? payload.memberUserIds
    : Array.isArray(payload.userIds)
      ? payload.userIds
      : [];

  return [...new Set(source.map((value) => Number(value)).filter((value) => Number.isFinite(value)))];
}

async function ensureValidInvitees(db: D1Database, userIds: number[]): Promise<number[]> {
  if (!userIds.length) {
    return [];
  }

  const placeholders = userIds.map(() => '?').join(', ');
  const { results } = await db
    .prepare(
      `SELECT id
       FROM users
       WHERE deleted_at IS NULL
         AND ${activeUserSql()}
         AND id IN (${placeholders})`
    )
    .bind(...userIds)
    .all<{ id: number }>();

  return results.map((row) => Number(row.id));
}

export function registerChannelRoutes(app: Hono<AppEnv>) {
  app.get('/api/channels', async (c) => {
    const session = c.get('session');
    await ensureGeneralChannelMembership(c.env.DB, session.userId);
    const channels = await listVisibleChannels(c.env.DB, session.userId);
    return c.json({
      channels,
      publicChannels: channels.filter((channel) => channel.kind === 'public'),
      privateChannels: channels.filter((channel) => channel.kind === 'private')
    });
  });

  app.post('/api/channels', async (c) => {
    const session = c.get('session');
    const payload = await parseJsonRequest(c.req.raw);
    const name = String(payload.name || '').trim();
    const description = String(payload.description || '').trim();
    const kind = String(payload.kind || 'public').trim();

    if (!name) {
      return errorResponse('群组名称不能为空');
    }

    if (!['public', 'private'].includes(kind)) {
      return errorResponse('群组类型无效');
    }

    if (isReservedGeneralChannelName(name)) {
      return errorResponse('general 是系统群组名称');
    }

    const inviteUserIds = normalizeMemberIds(payload).filter((userId) => userId !== session.userId);
    const validInvitees = await ensureValidInvitees(c.env.DB, inviteUserIds);
    const result = await c.env.DB.prepare(
      `INSERT INTO channels (name, description, kind, created_by)
       VALUES (?, ?, ?, ?)`
    )
      .bind(name, description, kind, session.userId)
      .run()
      .catch((error: unknown) => {
        if (String((error as { message?: unknown })?.message).includes('UNIQUE')) {
          throw new ApiError('群组名称已存在');
        }
        throw error;
      });

    const channelId = Number(result.meta.last_row_id ?? 0);
    const statements: D1PreparedStatement[] = [
      c.env.DB
        .prepare(
          `INSERT OR IGNORE INTO channel_members (channel_id, user_id, role, invited_by)
           VALUES (?, ?, 'owner', ?)`
        )
        .bind(channelId, session.userId, session.userId)
    ];

    validInvitees.forEach((userId) => {
      statements.push(
        c.env.DB
          .prepare(
            `INSERT OR IGNORE INTO channel_members (channel_id, user_id, role, invited_by)
             VALUES (?, ?, 'member', ?)`
          )
          .bind(channelId, userId, session.userId)
      );
    });
    await c.env.DB.batch(statements);

    return c.json({
      channel: {
        id: channelId,
        name,
        description,
        avatarKey: '',
        avatarUrl: '',
        kind,
        ownerDisplayName: session.displayName,
        isMember: true,
        myRole: 'owner',
        canManage: true,
        memberCount: 1 + validInvitees.length
      }
    });
  });

  app.post('/api/channels/:channelId/join', async (c) => {
    const session = c.get('session');
    const channelId = Number(c.req.param('channelId'));
    if (!Number.isFinite(channelId)) {
      return errorResponse('群组不存在', 404);
    }

    const channel = await getChannelById(c.env.DB, channelId);
    if (!channel || channel.kind !== 'public') {
      return errorResponse('公开群组不存在', 404);
    }

    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO channel_members (channel_id, user_id, role, invited_by)
       VALUES (?, ?, 'member', ?)`
    )
      .bind(channelId, session.userId, session.userId)
      .run();

    return c.json({ ok: true });
  });

  app.get('/api/channels/:channelId/members', async (c) => {
    const session = c.get('session');
    const channelId = Number(c.req.param('channelId'));
    const channel = await getChannelById(c.env.DB, channelId);
    if (!channel || channel.kind === 'dm') {
      return errorResponse('群组不存在', 404);
    }

    const access = await authorizeRoom(c.env.DB, session, channel.kind, channelId);
    if (!access.ok) {
      return errorResponse('无权查看群组成员', 403);
    }

    const membership = await getChannelMembership(c.env.DB, channelId, session.userId);
    const members = await listChannelMembers(c.env.DB, channelId);
    return c.json({
      room: {
        id: Number(channel.id),
        name: channel.name,
        description: channel.description,
        avatarKey: channel.avatar_key || '',
        avatarUrl: channel.avatar_key ? publicFileUrl(channel.avatar_key) : '',
        kind: channel.kind,
        isGeneral: isGeneralChannel(channel),
        myRole: membership?.role || '',
        canManage: session.isAdmin || membership?.role === 'owner',
        createdAt: channel.created_at || ''
      },
      members
    });
  });

  app.patch('/api/channels/:channelId', async (c) => {
    const session = c.get('session');
    const channelId = Number(c.req.param('channelId'));
    if (!Number.isFinite(channelId)) {
      return errorResponse('群组不存在', 404);
    }

    const payload = await parseJsonRequest(c.req.raw);
    const name =
      payload.name === undefined ? undefined : String(payload.name || '').trim();

    if (name !== undefined && !name) {
      return errorResponse('群组名称不能为空');
    }

    const management = await authorizeChannelManagement(c.env.DB, session, channelId);
    if (!management.ok) {
      return errorResponse('只有群主或管理员可以编辑群组', 403);
    }

    if (
      isGeneralChannel(management.channel) &&
      name !== undefined &&
      name !== 'general'
    ) {
      return errorResponse('general 系统群组不能改名');
    }

    const avatarUpdate = await resolveAvatarKeyUpdate(c.env.DB, session.userId, payload);

    const description =
      payload.description === undefined ? undefined : String(payload.description || '').trim();

    const SEND_PERMISSIONS = new Set(['all', 'owner']);
    const HISTORY_VISIBILITY = new Set(['visible', 'hidden']);
    const sendMessagesPermission =
      payload.sendMessagesPermission === undefined
        ? undefined
        : String(payload.sendMessagesPermission || 'all');
    if (sendMessagesPermission !== undefined && !SEND_PERMISSIONS.has(sendMessagesPermission)) {
      return errorResponse('发言权限取值无效');
    }
    const historyVisibility =
      payload.historyVisibility === undefined
        ? undefined
        : String(payload.historyVisibility || 'visible');
    if (historyVisibility !== undefined && !HISTORY_VISIBILITY.has(historyVisibility)) {
      return errorResponse('历史消息可见性取值无效');
    }
    let slowModeDelay: number | undefined;
    if (payload.slowModeDelay !== undefined) {
      const parsed = Number(payload.slowModeDelay);
      // 上限一天；0 表示关闭
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 86400) {
        return errorResponse('慢速模式间隔取值无效');
      }
      slowModeDelay = Math.floor(parsed);
    }

    const updates: string[] = [];
    const binds: (string | number | null)[] = [];
    if (name !== undefined) {
      updates.push('name = ?');
      binds.push(name);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      binds.push(description.slice(0, 500));
    }
    if (avatarUpdate.provided) {
      updates.push('avatar_key = ?');
      binds.push(avatarUpdate.key);
    }
    if (sendMessagesPermission !== undefined) {
      updates.push('send_messages_permission = ?');
      binds.push(sendMessagesPermission);
    }
    if (slowModeDelay !== undefined) {
      updates.push('slow_mode_delay = ?');
      binds.push(slowModeDelay);
    }
    if (historyVisibility !== undefined) {
      updates.push('history_visibility = ?');
      binds.push(historyVisibility);
    }

    if (!updates.length) {
      return c.json({ ok: true });
    }

    try {
      await c.env.DB.prepare(
        `UPDATE channels
         SET ${updates.join(', ')}
         WHERE id = ?
           AND kind IN ('public', 'private')
           AND deleted_at IS NULL`
      )
        .bind(...binds, channelId)
        .run();
    } catch (error) {
      if (isR2ObjectUnavailableError(error)) {
        return errorResponse('头像文件不存在或正在清理，请重新上传');
      }
      if (String((error as { message?: unknown })?.message).includes('UNIQUE')) {
        return errorResponse('群组名称已存在');
      }
      throw error;
    }

    const updated = await getChannelById(c.env.DB, channelId);
    if (!updated) {
      return errorResponse('群组不存在', 404);
    }
    return c.json({
      channel: {
        id: Number(updated.id),
        name: updated.name,
        description: updated.description || '',
        avatarKey: updated.avatar_key || '',
        avatarUrl: updated.avatar_key ? publicFileUrl(updated.avatar_key) : '',
        sendMessagesPermission: updated.send_messages_permission || 'all',
        slowModeDelay: Number(updated.slow_mode_delay) || 0,
        historyVisibility: updated.history_visibility || 'visible'
      }
    });
  });

  app.post('/api/channels/:channelId/invite', async (c) => {
    const session = c.get('session');
    const channelId = Number(c.req.param('channelId'));
    const payload = await parseJsonRequest(c.req.raw);
    const management = await authorizeChannelManagement(c.env.DB, session, channelId);
    if (!management.ok) {
      return errorResponse('只有群主或管理员可以邀请成员', 403);
    }

    const userIds = normalizeMemberIds(payload).filter((userId) => userId !== session.userId);
    const validInvitees = await ensureValidInvitees(c.env.DB, userIds);
    if (!validInvitees.length) {
      return errorResponse('没有可邀请的用户');
    }

    const statements = validInvitees.map((userId) =>
      c.env.DB
        .prepare(
          `INSERT OR IGNORE INTO channel_members (channel_id, user_id, role, invited_by)
           VALUES (?, ?, 'member', ?)`
        )
        .bind(channelId, userId, session.userId)
    );
    await c.env.DB.batch(statements);

    return c.json({
      ok: true,
      members: await listChannelMembers(c.env.DB, channelId)
    });
  });

  app.delete('/api/channels/:channelId/members/:userId', async (c) => {
    const session = c.get('session');
    const channelId = Number(c.req.param('channelId'));
    const userId = Number(c.req.param('userId'));
    const management = await authorizeChannelManagement(c.env.DB, session, channelId);
    if (!management.ok) {
      return errorResponse('只有群主或管理员可以移除成员', 403);
    }

    if (isGeneralChannel(management.channel)) {
      return errorResponse('general 系统群组必须保留所有成员');
    }

    const targetMembership = await getChannelMembership(c.env.DB, channelId, userId);
    if (!targetMembership) {
      return errorResponse('成员不存在', 404);
    }

    if (targetMembership.role === 'owner') {
      return errorResponse('不能移除群主，请直接删除群组');
    }

    await c.env.DB.prepare(
      `DELETE FROM channel_members
       WHERE channel_id = ?
         AND user_id = ?`
    )
      .bind(channelId, userId)
      .run();

    return c.json({
      ok: true,
      members: await listChannelMembers(c.env.DB, channelId)
    });
  });

  app.post('/api/channels/:channelId/leave', async (c) => {
    const session = c.get('session');
    const channelId = Number(c.req.param('channelId'));
    const channel = await getChannelById(c.env.DB, channelId);
    if (!channel || channel.kind === 'dm') {
      return errorResponse('群组不存在', 404);
    }
    if (isGeneralChannel(channel)) {
      return errorResponse('general 系统群组不能退出');
    }

    const membership = await getChannelMembership(c.env.DB, channelId, session.userId);
    if (!membership) {
      return errorResponse('你不是该群组成员', 403);
    }
    // 群主不能直接退出：否则群组会没有负责人，必须先转让或删除群组。
    if (membership.role === 'owner') {
      return errorResponse('群主不能退出群组，请先转让群主或删除群组');
    }

    await c.env.DB.prepare(
      `DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?`
    )
      .bind(channelId, session.userId)
      .run();

    return c.json({ ok: true, left: true });
  });

  app.post('/api/channels/:channelId/transfer', async (c) => {
    const session = c.get('session');
    const channelId = Number(c.req.param('channelId'));
    const payload = await parseJsonRequest(c.req.raw);
    const targetUserId = Number(payload.userId);
    if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
      return errorResponse('请选择要转让的成员');
    }

    const channel = await getChannelById(c.env.DB, channelId);
    if (!channel || channel.kind === 'dm') {
      return errorResponse('群组不存在', 404);
    }
    if (isGeneralChannel(channel)) {
      return errorResponse('general 系统群组不能转让');
    }

    // 必须是群组里真实的 owner：管理员并非成员时按上面的写法会留下两个群主。
    const ownerMembership = await getChannelMembership(c.env.DB, channelId, session.userId);
    if (ownerMembership?.role !== 'owner') {
      return errorResponse('只有群主可以转让群组', 403);
    }
    if (Number(targetUserId) === Number(session.userId)) {
      return errorResponse('不能转让给自己');
    }

    const target = await getChannelMembership(c.env.DB, channelId, targetUserId);
    if (!target) {
      return errorResponse('该用户不是群组成员', 404);
    }

    // 两步必须在同一个事务里，避免中途失败导致群组没有群主。
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE channel_members SET role = 'member' WHERE channel_id = ? AND user_id = ?`
      ).bind(channelId, session.userId),
      c.env.DB.prepare(
        `UPDATE channel_members SET role = 'owner' WHERE channel_id = ? AND user_id = ?`
      ).bind(channelId, targetUserId)
    ]);

    return c.json({ ok: true, members: await listChannelMembers(c.env.DB, channelId) });
  });

  app.delete('/api/channels/:channelId', async (c) => {
    const session = c.get('session');
    const channelId = Number(c.req.param('channelId'));
    const management = await authorizeChannelManagement(c.env.DB, session, channelId);
    if (!management.ok) {
      return errorResponse('只有群主或管理员可以删除群组', 403);
    }

    if (isGeneralChannel(management.channel)) {
      return errorResponse('general 系统群组不能删除');
    }

    await hardDeleteChannel(c.env.DB, channelId);

    return c.json({ ok: true });
  });

  app.get('/api/admin/channels', async (c) => {
    const channels = await listAdminChannels(c.env.DB);
    return c.json({ channels });
  });

  app.delete('/api/admin/channels/:channelId', async (c) => {
    const channelId = Number(c.req.param('channelId'));
    const channel = await getChannelById(c.env.DB, channelId);
    if (!channel) {
      return errorResponse('群组不存在', 404);
    }
    if (isGeneralChannel(channel)) {
      return errorResponse('general 系统群组不能删除');
    }

    await hardDeleteChannel(c.env.DB, channelId);

    return c.json({ ok: true });
  });
}
