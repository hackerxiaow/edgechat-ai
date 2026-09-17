import type { Context, Hono } from 'hono';
import type { AppEnv } from '../types.ts';
import { verifyPassword } from '../auth.ts';
import { saveUploadedFile, UPLOAD_BODY_OVERHEAD_BYTES } from './upload.ts';
import {
  getRoomSyncCursor,
  listMessages,
  listRoomMessageEvents,
  updateMessageContent
} from '../data/messages.ts';
import { toggleMessageReaction } from '../data/reactions.ts';
import { searchRoomMessages, searchGlobal } from '../data/search.ts';
import { getRuntimeSettings } from '../data/site-settings.ts';
import { getUserByUsername } from '../data/users.ts';
import { submitClientRoomAction } from '../room-actions.ts';
import { ApiError } from '../errors.ts';
import { authMiddleware } from '../middleware.ts';
import {
  createMobileDeviceSession,
  refreshMobileDeviceSession,
  revokeMobileDeviceSession,
  type MobileDeviceInput
} from '../mobile-session.ts';
import { issueRealtimeTicket } from '../realtime-tickets.ts';
import { authorizeRoom, isRoomKind } from '../room-access.ts';
import { markRoomRead } from '../data/unread.ts';
import { listRoomTypingUsers, setRoomTyping } from '../data/typing.ts';
import { touchPresence } from '../data/presence.ts';
import { isUserDisabled } from '../user-status.ts';
import {
  errorCodeForStatus,
  parseJsonRequest,
  requestBodyTooLarge,
  sanitizeLimit,
  v1ErrorResponse
} from '../utils.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): boolean {
  return UUID_PATTERN.test(String(value || '').trim());
}

function validRoomRequest(kind: unknown, roomId: number): boolean {
  return isRoomKind(kind) && Number.isInteger(roomId) && roomId > 0;
}

async function requireRoom(c: Context<AppEnv>) {
  const kind = String(c.req.param('kind') || '');
  const roomId = Number(c.req.param('id'));
  if (!validRoomRequest(kind, roomId)) {
    throw new ApiError('会话参数无效', 400, 'invalid_room');
  }
  const session = c.get('session');
  const access = await authorizeRoom(c.env.DB, session, kind, roomId);
  if (!access.ok) {
    throw new ApiError('无权访问该会话', 403, 'forbidden');
  }
  return { session, kind, roomId, room: access.room };
}

async function legacyProxyRequest(request: Request, pathname: string): Promise<Request> {
  const url = new URL(request.url);
  url.pathname = pathname;
  const init: RequestInit = { method: request.method, headers: request.headers };
  if (!['GET', 'HEAD'].includes(request.method)) {
    // 内部复用旧路由时固化请求体，避免跨运行时传递 ReadableStream 时需要 Node duplex 扩展。
    init.body = await request.arrayBuffer();
  }
  return new Request(url.toString(), init);
}

async function convertLegacyError(response: Response): Promise<Response> {
  if (response.status < 400) return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return response;
  const payload = await response.clone().json().catch(() => null) as { error?: unknown } | null;
  if (typeof payload?.error !== 'string') return response;
  return v1ErrorResponse(
    errorCodeForStatus(response.status),
    payload.error,
    response.status
  );
}

export function registerV1Routes(app: Hono<AppEnv>) {
  app.get('/api/v1/capabilities', async (c) => {
    const settings = await getRuntimeSettings(c.env.DB);
    return c.json({
      apiVersion: 1,
      site: { siteName: settings.siteName, siteIconUrl: settings.siteIconUrl },
      limits: {
        maxUploadBytes: settings.maxFileSize,
        messageRetentionDays: settings.messageRetentionDays
      },
      features: {
        deviceSessions: true,
        // 纯 D1 部署不提供长连接，客户端应使用 roomSync 轮询。
        realtimeTickets: false,
        idempotentMessages: true,
        // 去重键 client_upload_id 存在 D1，与是否绑定 R2 无关。
        idempotentUploads: true,
        roomSync: true,
        backgroundPush: false
      }
    });
  });

  app.post('/api/v1/auth/login', async (c) => {
    const payload = await parseJsonRequest(c.req.raw);
    const username = String(payload.username || '').trim();
    const password = String(payload.password || '');
    if (!username || !password) {
      return v1ErrorResponse('invalid_credentials', '请输入用户名和密码', 400);
    }
    const user = await getUserByUsername(c.env.DB, username);
    if (
      !user ||
      isUserDisabled(user) ||
      !(await verifyPassword(password, user.password_hash, user.password_salt))
    ) {
      return v1ErrorResponse('invalid_credentials', '账号或密码错误', 401);
    }
    const result = await createMobileDeviceSession(
      c.env,
      user,
      payload.device as MobileDeviceInput | null | undefined
    );
    return c.json(result);
  });

  app.post('/api/v1/auth/refresh', async (c) => {
    const payload = await parseJsonRequest(c.req.raw);
    const result = await refreshMobileDeviceSession(
      c.env,
      payload.refreshToken,
      payload.installationId
    );
    return c.json(result);
  });

  app.post('/api/v1/auth/logout', authMiddleware, async (c) => {
    await revokeMobileDeviceSession(c.env, c.get('session'));
    return c.json({ ok: true });
  });

  app.post('/api/v1/realtime/tickets', authMiddleware, async (c) => {
    const session = c.get('session');
    const payload = await parseJsonRequest(c.req.raw);
    const scope = String(payload.scope || '');
    if (scope === 'inbox') {
      return c.json(await issueRealtimeTicket(c.env, session, { scope }));
    }
    const roomKind = String(payload.roomKind || '');
    const roomId = Number(payload.roomId);
    if (scope !== 'room' || !validRoomRequest(roomKind, roomId)) {
      return v1ErrorResponse('invalid_realtime_scope', '实时连接目标无效');
    }
    const access = await authorizeRoom(c.env.DB, session, roomKind, roomId);
    if (!access.ok) {
      return v1ErrorResponse('forbidden', '无权访问该会话', 403);
    }
    return c.json(await issueRealtimeTicket(c.env, session, { scope, roomKind, roomId }));
  });

  app.get('/api/v1/realtime/ws', async (c) => {
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
      return v1ErrorResponse('websocket_required', '需要 WebSocket 连接', 426);
    }
    // 纯 D1 部署不提供长连接；移动端改用 /messages 与 /sync 的游标轮询。
    // 不消费票据，便于客户端在支持 WebSocket 的部署上重试。
    return v1ErrorResponse(
      'realtime_unsupported',
      '当前部署不支持 WebSocket 实时连接，请改用同步游标轮询',
      501
    );
  });

  app.get('/api/v1/rooms/:kind/:id/messages', authMiddleware, async (c) => {
    const access = await authorizeRoom(c.env.DB, c.get('session'), c.req.param('kind'), c.req.param('id'));
    if (!access.ok) return v1ErrorResponse('forbidden', access.reason, 403);
    const { room } = access;
    const roomId = room.id;
    const messages = await listMessages(
      c.env,
      roomId,
      c.req.query('before'),
      sanitizeLimit(c.req.query('limit')),
      room.kind !== 'dm' && room.history_visibility === 'hidden' && !c.get('session').isAdmin ? { mode: 'hidden', joinedAt: access.membership?.joined_at || '' } : undefined
    );
    return c.json({
      room: {
        id: Number(room.id),
        kind: room.kind,
        name: room.name,
        description: room.description
      },
      messages,
      syncCursor: await getRoomSyncCursor(c.env.DB, roomId)
    });
  });

  app.get('/api/v1/rooms/:kind/:id/sync', authMiddleware, async (c) => {
    const access = await authorizeRoom(c.env.DB, c.get('session'), c.req.param('kind'), c.req.param('id'));
    if (!access.ok) return v1ErrorResponse('forbidden', access.reason, 403);
    const { room } = access;
    const roomId = room.id;
    const cursor = Math.max(0, Number(c.req.query('cursor')) || 0);
    const [result, typing] = await Promise.all([
      listRoomMessageEvents(
        c.env,
        roomId,
        cursor,
        sanitizeLimit(c.req.query('limit'), 100, 100),
        room.kind !== 'dm' && room.history_visibility === 'hidden' && !c.get('session').isAdmin ? { mode: 'hidden', joinedAt: access.membership?.joined_at || '' } : undefined
      ).catch((error) => {
        if (error?.code === 'sync_cursor_expired') {
          throw new ApiError('同步游标已过期，请重新加载会话', 409, error.code);
        }
        throw error;
      }),
      listRoomTypingUsers(c.env.DB, {
        channelId: roomId,
        excludeUserId: c.get('session').userId
      })
    ]);
    // typing 是后加的字段：老客户端忽略即可，移动端 v1 契约保持向后兼容。
    return c.json({ ...result, typing });
  });

  app.get('/api/v1/search', authMiddleware, async (c) => {
    const session = c.get('session');
    const query = String(c.req.query('q') || '').trim();
    const limit = sanitizeLimit(c.req.query('limit'), 30, 50);
    const result = await searchGlobal(c.env, {
      userId: session.userId,
      query,
      limit
    });
    return c.json(result);
  });

  app.get('/api/v1/rooms/:kind/:id/search', authMiddleware, async (c) => {
    const { room } = await requireRoom(c);
    const query = String(c.req.query('q') || '').trim();
    const limit = sanitizeLimit(c.req.query('limit'), 50, 100);
    const messages = await searchRoomMessages(c.env, {
      roomId: room.id,
      query,
      limit
    });
    return c.json({ messages });
  });

  app.post('/api/v1/rooms/:kind/:id/messages', authMiddleware, async (c) => {
    const session = c.get('session');
    const access = await authorizeRoom(c.env.DB, session, c.req.param('kind'), c.req.param('id'));
    if (!access.ok) return v1ErrorResponse('forbidden', access.reason, 403);
    const { room } = access;
    
    if (room.kind !== 'dm') {
      if (room.send_messages_permission === 'owner' && access.membership?.role !== 'owner' && !session.isAdmin) {
        return v1ErrorResponse('forbidden', '只有群主和管理员可以发言', 403);
      }
      if (room.slow_mode_delay && room.slow_mode_delay > 0 && !session.isAdmin && access.membership?.role !== 'owner') {
        const lastMsg = await c.env.DB.prepare(
          'SELECT created_at FROM messages WHERE channel_id = ? AND sender_id = ? ORDER BY id DESC LIMIT 1'
        ).bind(room.id, session.userId).first<{ created_at: string }>();
        if (lastMsg && lastMsg.created_at) {
          const lastTime = new Date(`${lastMsg.created_at.replace(' ', 'T')}Z`).getTime();
          const now = Date.now();
          if (now - lastTime < room.slow_mode_delay * 1000) {
            return v1ErrorResponse('slow_mode', `慢速模式已开启，请等待 ${Math.ceil((room.slow_mode_delay * 1000 - (now - lastTime)) / 1000)} 秒后再发言`, 429);
          }
        }
      }
    }

    const payload = await parseJsonRequest<{
	      clientMessageId?: string;
	      content?: string;
	      attachment?: unknown;
	      mentionUserIds?: unknown;
	      replyMessageId?: unknown;
	      forwardFromName?: string;
	    }>(c.req.raw);
	    if (!isUuid(payload.clientMessageId)) {
	      return v1ErrorResponse('client_message_id_invalid', 'clientMessageId 必须是 UUID');
	    }
	    return submitClientRoomAction(c.env, {
	      room,
	      principal: session,
	      action: {
	        type: 'send',
	        clientMessageId: payload.clientMessageId,
				content: String(payload.content ?? ''),
					attachment: payload.attachment || null,
					mentionUserIds: payload.mentionUserIds || [],
					replyMessageId: payload.replyMessageId ?? null,
					forwardFromName: payload.forwardFromName ? String(payload.forwardFromName) : null
				  },
	      ctx: c.executionCtx
	    });
	  });

	  app.patch('/api/v1/rooms/:kind/:id/messages/:messageId', authMiddleware, async (c) => {
	    const { session, room } = await requireRoom(c);
	    const messageId = Number(c.req.param('messageId'));
	    if (!Number.isInteger(messageId) || messageId <= 0) {
	      return v1ErrorResponse('message_id_invalid', '消息 ID 无效');
	    }
	    const payload = await parseJsonRequest<{ content: string }>(c.req.raw);
	    const content = String(payload.content || '').trim();
	    if (!content) {
	      return v1ErrorResponse('content_required', '消息内容不能为空');
	    }
	    try {
	      const updated = await updateMessageContent(c.env, {
	        messageId,
	        channelId: room.id,
	        userId: session.userId,
	        content
	      });
		      return c.json({ ok: true, message: updated });
		    } catch (e: unknown) {
		      const msg = String((e as { message?: string })?.message || '');
	      if (msg.includes('Cannot edit')) {
	        return v1ErrorResponse('forbidden', '只能编辑自己发送的消息', 403);
	      }
	      if (msg.includes('not found')) {
	        return v1ErrorResponse('message_not_found', '消息不存在或已删除', 404);
	      }
	      return v1ErrorResponse('update_failed', msg || '编辑失败');
	    }
	  });

	  app.post('/api/v1/rooms/:kind/:id/messages/:messageId/reactions', authMiddleware, async (c) => {
	    const { session, room } = await requireRoom(c);
	    const messageId = Number(c.req.param('messageId'));
	    if (!Number.isInteger(messageId) || messageId <= 0) {
	      return v1ErrorResponse('message_id_invalid', '消息 ID 无效');
	    }
	    const payload = await parseJsonRequest<{ emoji: string }>(c.req.raw);
	    const emoji = String(payload.emoji || '').trim();
	    if (!emoji || emoji.length > 32) {
	      return v1ErrorResponse('emoji_invalid', '表情参数无效');
	    }
	    try {
	      const result = await toggleMessageReaction(c.env.DB, {
	        channelId: room.id,
	        messageId,
	        userId: session.userId,
	        emoji
	      });
		      return c.json({ ok: true, ...result });
		    } catch (e: unknown) {
		      const msg = String((e as { message?: string })?.message || '');
	      if (msg.includes('not found')) {
	        return v1ErrorResponse('message_not_found', '消息不存在或已删除', 404);
	      }
	      return v1ErrorResponse('reaction_failed', msg || '操作失败');
	    }
	  });

	  app.put('/api/v1/rooms/:kind/:id/pin', authMiddleware, async (c) => {
	    const { session, room } = await requireRoom(c);
	    const payload = await parseJsonRequest<{ messageId: number | string }>(c.req.raw);
	    const messageId = Number(payload.messageId);
	    if (!Number.isInteger(messageId) || messageId <= 0) {
	      return v1ErrorResponse('message_id_invalid', '消息 ID 无效');
	    }
	    return submitClientRoomAction(c.env, {
	      room,
	      principal: session,
	      action: { type: 'pin_message', messageId }
	    });
	  });

	  app.delete('/api/v1/rooms/:kind/:id/pin', authMiddleware, async (c) => {
	    const { session, room } = await requireRoom(c);
	    const payload = await parseJsonRequest<{ messageId: number | string }>(c.req.raw);
	    const messageId = Number(payload.messageId);
	    if (!Number.isInteger(messageId) || messageId <= 0) {
	      return v1ErrorResponse('message_id_invalid', '消息 ID 无效');
	    }
	    return submitClientRoomAction(c.env, {
	      room,
	      principal: session,
	      action: { type: 'unpin_message', messageId }
	    });
	  });

	  app.delete('/api/v1/rooms/:kind/:id/messages/:messageId', authMiddleware, async (c) => {
    const { session, room } = await requireRoom(c);
    return submitClientRoomAction(c.env, {
      room,
      principal: session,
      action: { type: 'delete_message', messageId: Number(c.req.param('messageId')) }
    });
  });

  app.post('/api/v1/rooms/:kind/:id/read', authMiddleware, async (c) => {
    const { session, roomId } = await requireRoom(c);
    const payload = await parseJsonRequest(c.req.raw);
    const messageId = payload.messageId === undefined ? null : Number(payload.messageId);
    if (messageId !== null && (!Number.isInteger(messageId) || messageId <= 0)) {
      return v1ErrorResponse('message_id_invalid', '消息 ID 无效');
    }
    const lastReadMessageId = await markRoomRead(c.env.DB, {
      channelId: roomId,
      userId: session.userId,
      messageId
    });
    return c.json({ ok: true, lastReadMessageId });
  });

  // 在线心跳：客户端约每 60 秒上报一次，服务端还会按半个窗口去重写入。
  app.post('/api/v1/presence', authMiddleware, async (c) => {
    await touchPresence(c.env.DB, c.get('session').userId);
    return c.json({ ok: true });
  });

  app.post('/api/v1/rooms/:kind/:id/typing', authMiddleware, async (c) => {
    const { session, roomId } = await requireRoom(c);
    const payload = await parseJsonRequest(c.req.raw);
    await setRoomTyping(c.env.DB, {
      channelId: roomId,
      userId: session.userId,
      typing: payload.typing !== false
    });
    return c.json({ ok: true });
  });

  app.post('/api/v1/uploads', authMiddleware, async (c) => {
    if (!c.env.DB) {
      return v1ErrorResponse('attachments_unavailable', '存储服务不可用，无法上传附件', 503);
    }
    const settings = await getRuntimeSettings(c.env.DB);
    if (requestBodyTooLarge(c.req.raw, settings.maxFileSize + UPLOAD_BODY_OVERHEAD_BYTES)) {
      return v1ErrorResponse(
        'payload_too_large',
        `文件大小不能超过 ${Math.round(settings.maxFileSize / 1024 / 1024)}MB`,
        413
      );
    }
    const formData = await c.req.formData();
    const file = formData.get('file');
    const clientUploadId = String(formData.get('clientUploadId') || '');
    // FormDataEntryValue 含 string，先排除后再收窄为 File。
    if (!file || typeof file === 'string') {
      return v1ErrorResponse('file_required', '请选择文件');
    }
    if (!isUuid(clientUploadId)) {
      return v1ErrorResponse('client_upload_id_invalid', 'clientUploadId 必须是 UUID');
    }
    try {
      const result = await saveUploadedFile(c.env, c.get('session'), file, {
        clientUploadId,
        settings
      });
      return c.json(result, result.created ? 201 : 200);
    } catch (error) {
      const message = String((error as { message?: unknown })?.message || '上传失败');
      if (message.startsWith('文件大小不能超过') || message === '该文件类型不允许上传') {
        return v1ErrorResponse('upload_rejected', message);
      }
      throw error;
    }
  });

  app.all('/api/v1/*', async (c) => {
    const currentPath = new URL(c.req.url).pathname;
    const suffix = currentPath.slice('/api/v1'.length);
    if (suffix.startsWith('/admin')) {
      return v1ErrorResponse('not_found', '接口不存在', 404);
    }
    const response = await app.fetch(
      await legacyProxyRequest(c.req.raw, `/api${suffix}`),
      c.env
    );
    return convertLegacyError(response);
  });
}
