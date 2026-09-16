import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  createSession,
  deleteSession,
  hashPassword,
  isConfiguredAdminUsername,
  putSession,
  verifyPassword
} from './auth.ts';
import { listVisibleChannels } from './data/channels.ts';
import { listUserDms } from './data/dm-queries.ts';
import { ensureGeneralChannelMembership } from './data/general-channel.ts';
import {
  createUserWithRegistrationInvite,
  getAvailableRegistrationInvite
} from './data/registration-invites.ts';
import { getSiteSettings } from './data/site-settings.ts';
import { getUserByUsername, listActiveUsers } from './data/users.ts';
import { ApiError } from './errors.ts';
import { adminMiddleware, authMiddleware } from './middleware.ts';
import { registerAdminRoutes } from './api/admin.ts';
import { registerMaintenanceRoutes } from './api/maintenance.ts';
import { registerChannelRoutes } from './api/channels.ts';
import { registerContactRoutes } from './api/contacts.ts';
import { registerDmRoutes } from './api/dm.ts';
import { registerMessageRoutes } from './api/messages.ts';
import { registerUploadRoutes } from './api/upload.ts';
import { registerUserBlockRoutes } from './api/user-blocks.ts';
import { registerUserProfileRoutes } from './api/user-profile.ts';
import { registerV1Routes } from './api/v1.ts';
import {
  registerTelegramAdminRoutes,
  registerTelegramPublicRoutes
} from './api/telegram.ts';
import { runLazyScheduledGc, runScheduledGc, shouldProbeScheduledGc } from './gc.ts';
import { isUserDisabled } from './user-status.ts';
import type { AppEnv, SessionUser } from './types.ts';
import { updateCurrentDeviceSessionVersion } from './mobile-session.ts';
import {
  errorCodeForStatus,
  errorResponse,
  parseJsonRequest,
  requestBodyTooLarge,
  v1ErrorResponse
} from './utils.ts';

const app = new Hono<AppEnv>();

app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  const uploadLimit = Number(c.env.MAX_FILE_SIZE || 20971520) + 1024 * 1024;
  const maxBytes = ['/api/upload', '/api/v1/uploads'].includes(path) ? uploadLimit : undefined;
  if (requestBodyTooLarge(c.req.raw, maxBytes)) {
    // 提前拒绝超大请求体，避免 Worker 在 JSON 解析前消耗过多内存。
    return errorResponse('请求体过大', 413);
  }

  await next();
});

app.use('/api/*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
}));

app.get('/api/health', (c) => c.json({ ok: true }));

app.get('/api/site', async (c) => {
  const site = await getSiteSettings(c.env.DB);
  return c.json({ site });
});

registerTelegramPublicRoutes(app);

app.get('/api/register-links/:token', async (c) => {
  const token = String(c.req.param('token') || '').trim();
  if (!token) {
    return errorResponse('注册链接不存在', 404);
  }

  const site = await getSiteSettings(c.env.DB);
  const invite = await getAvailableRegistrationInvite(c.env.DB, token);
  if (!invite) {
    return errorResponse('注册链接已失效', 404);
  }

  return c.json({
    site,
    invite: {
      note: invite.note,
      createdAt: invite.createdAt,
      remainingUses: invite.remainingUses
    }
  });
});

app.post('/api/register-links/:token/register', async (c) => {
  const token = String(c.req.param('token') || '').trim();
  const payload = await parseJsonRequest(c.req.raw);
  const username = String(payload.username || '').trim();
  const password = String(payload.password || '');
  const displayName = String(payload.displayName || username).trim();

  if (!token) {
    return errorResponse('注册链接不存在', 404);
  }
  if (!username || !password) {
    return errorResponse('用户名和密码不能为空');
  }
  if (isConfiguredAdminUsername(c.env, username)) {
    return errorResponse('该用户名不可用于邀请注册');
  }

  const invite = await getAvailableRegistrationInvite(c.env.DB, token);
  if (!invite) {
    return errorResponse('注册链接已失效', 400);
  }

  const hashed = await hashPassword(password);
  const userId = await createUserWithRegistrationInvite(c.env.DB, {
    inviteId: invite.id,
    username,
    displayName,
    passwordHash: hashed.hash,
    passwordSalt: hashed.salt
  });

  await ensureGeneralChannelMembership(c.env.DB, userId);

  return c.json({ ok: true });
});

app.post('/api/auth/login', async (c) => {
  const payload = await parseJsonRequest(c.req.raw);
  const username = String(payload.username || '').trim();
  const password = String(payload.password || '');
  if (!username || !password) {
    return errorResponse('请输入用户名和密码');
  }

  const user = await getUserByUsername(c.env.DB, username);
  if (!user || isUserDisabled(user)) {
    return errorResponse('账号或密码错误', 401);
  }

  const valid = await verifyPassword(password, user.password_hash, user.password_salt);
  if (!valid) {
    return errorResponse('账号或密码错误', 401);
  }

  const session = await createSession(c.env, user);
  return c.json({
    token: session.token,
    session
  });
});

registerV1Routes(app);

app.use('/api/*', authMiddleware);

app.get('/api/auth/session', async (c) => {
  const session = c.get('session');
  const user = await c.env.DB.prepare(
    `SELECT display_name, avatar_key, bio, is_disabled, disabled_until
     FROM users
     WHERE id = ?
       AND deleted_at IS NULL
     LIMIT 1`
  )
    .bind(session.userId)
    .all<{
      display_name: string;
      avatar_key: string | null;
      bio: string | null;
      is_disabled: number;
      disabled_until: string | null;
    }>();

  const row = user.results[0];
  if (!row || isUserDisabled(row)) {
    await deleteSession(c.env, session.token);
    return errorResponse('账号已不可用', 401);
  }

  const freshSession: SessionUser = {
    ...session,
    displayName: row.display_name,
    bio: row.bio ?? '',
    avatarUrl: row.avatar_key ? `/files/${encodeURIComponent(row.avatar_key)}` : ''
  };
  await putSession(c.env, freshSession);

  return c.json({ session: freshSession });
});

app.post('/api/auth/logout', async (c) => {
  const session = c.get('session');
  await deleteSession(c.env, session.token);
  return c.json({ ok: true });
});

app.post('/api/auth/change-password', async (c) => {
  const session = c.get('session');
  const payload = await parseJsonRequest(c.req.raw);
  const currentPassword = String(payload.currentPassword || '');
  const newPassword = String(payload.newPassword || '');
  if (!currentPassword || !newPassword) {
    return errorResponse('请填写完整密码');
  }

  const user = await c.env.DB.prepare(
    `SELECT password_hash, password_salt
     FROM users
     WHERE id = ?
       AND deleted_at IS NULL
     LIMIT 1`
  )
    .bind(session.userId)
    .all<{ password_hash: string; password_salt: string }>();

  const credentials = user.results[0];
  if (!credentials) {
    return errorResponse('用户不存在', 404);
  }

  const valid = await verifyPassword(
    currentPassword,
    credentials.password_hash,
    credentials.password_salt
  );
  if (!valid) {
    return errorResponse('当前密码不正确', 400);
  }

  const hashed = await hashPassword(newPassword);
  await c.env.DB.prepare(
    `UPDATE users
     SET password_hash = ?,
          password_salt = ?,
          session_version = session_version + 1,
          updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND deleted_at IS NULL`
  )
    .bind(hashed.hash, hashed.salt, session.userId)
    .run();

  const nextSession: SessionUser = {
    ...session,
    sessionVersion: Number(session.sessionVersion || 0) + 1
  };
  await updateCurrentDeviceSessionVersion(c.env, session, nextSession.sessionVersion);
  await putSession(c.env, nextSession);

  return c.json({ ok: true });
});

app.get('/api/users', async (c) => {
  const session = c.get('session');
  const users = await listActiveUsers(c.env.DB, session.userId);
  return c.json({ users });
});

app.get('/api/bootstrap', async (c) => {
  const session = c.get('session');
  await ensureGeneralChannelMembership(c.env.DB, session.userId);
  const [users, channels, dms] = await Promise.all([
    listActiveUsers(c.env.DB, session.userId),
    listVisibleChannels(c.env.DB, session.userId),
    listUserDms(c.env.DB, session.userId)
  ]);

  return c.json({ users, channels, dms });
});

app.use('/api/admin/*', adminMiddleware);

registerMessageRoutes(app);
registerContactRoutes(app);
registerDmRoutes(app);
registerUserBlockRoutes(app);
registerUserProfileRoutes(app);
registerUploadRoutes(app);
registerChannelRoutes(app);
registerAdminRoutes(app);
registerMaintenanceRoutes(app);
registerTelegramAdminRoutes(app);

// 纯 D1 部署不提供 WebSocket 长连接：实时性由客户端轮询同步游标提供。
app.get('/api/ws/:kind/:id', () =>
  errorResponse('当前部署不支持 WebSocket，请改用轮询同步', 501)
);

app.get('/api/inbox/ws', () =>
  errorResponse('当前部署不支持 WebSocket，请改用轮询同步', 501)
);

app.notFound(async (c) => {
  const pathname = new URL(c.req.url).pathname;
  if (pathname.startsWith('/api/')) {
    return errorResponse('接口不存在', 404);
  }
  // Cloudflare Pages ASSETS 静态资产与 SPA 404 回退到 index.html
  if (c.env.ASSETS) {
    const res = await c.env.ASSETS.fetch(c.req.raw);
    if (res.status === 404 && !pathname.startsWith('/files/')) {
      const indexReq = new Request(new URL('/index.html', c.req.url), c.req.raw);
      return c.env.ASSETS.fetch(indexReq);
    }
    return res;
  }
  return new Response('Not Found', { status: 404 });
});

app.onError((error, c) => {
  console.error(error);
  const isV1 = new URL(c.req.url).pathname.startsWith('/api/v1/');
  if (error instanceof ApiError) {
    if (isV1) {
      return v1ErrorResponse(error.code, error.message, error.status);
    }
    return errorResponse(error.message, error.status);
  }
  if (isV1) {
    return v1ErrorResponse(errorCodeForStatus(500), '服务器开小差了', 500);
  }
  return errorResponse('服务器开小差了', 500);
});

// Cloudflare Pages Functions 只暴露 fetch，没有 Cron Triggers：
// 定时 GC 挂在 API 请求上惰性触发，由 gc_state 的原子抢锁保证跨请求的最小间隔。
export default {
  async fetch(request: Request, env: AppEnv['Bindings'], ctx: ExecutionContext) {
    const response = await app.fetch(request, env, ctx);
    if (ctx && typeof ctx.waitUntil === 'function' && shouldProbeScheduledGc(request)) {
      ctx.waitUntil(
        runLazyScheduledGc(env).catch((error) => {
          console.error('lazy_scheduled_gc_failed', error);
        })
      );
    }
    return response;
  },
  // 保留 scheduled 入口：本地 wrangler 可以用 /cdn-cgi/handler/scheduled 手动跑一次，
  // 未来若重新启用定时触发器也应复用同一条 GC，而不是另写一份清理逻辑。
  async scheduled(
    _controller: ScheduledController,
    env: AppEnv['Bindings'],
    ctx: ExecutionContext
  ) {
    ctx.waitUntil(runScheduledGc(env));
  }
};
