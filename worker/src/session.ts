import type { AppBindings, SessionUser } from './types.ts';
import { deleteSession, getSession, isAdminUser, putSession } from './auth.ts';
import { isUserDisabled } from './user-status.ts';

type SessionEnv = Pick<AppBindings, 'DB'>;

export type SessionValidationResult =
  | { ok: false; status: number; message: string }
  | { ok: true; session: SessionUser };

interface SessionUserRow {
  username: string;
  is_disabled: number;
  disabled_until: string | null;
  deleted_at: string | null;
  session_version: number;
  is_admin: number;
}

function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export async function validateSession(
  env: SessionEnv,
  token: string,
): Promise<SessionValidationResult> {
  const session = await getSession(env, token);
  if (!session) {
    return { ok: false, status: 401, message: '请先登录' };
  }

  const { results } = await env.DB.prepare(
    `SELECT username, is_disabled, disabled_until, deleted_at, session_version, is_admin
     FROM users
     WHERE id = ?
     LIMIT 1`
  )
    .bind(session.userId)
    .all<SessionUserRow>();

  const user = results[0];
  if (!user || user.deleted_at || isUserDisabled(user)) {
    await deleteSession(env, token);
    return { ok: false, status: 401, message: '账号已不可用' };
  }

  if (session.deviceSessionId) {
    const device = await env.DB.prepare(
      `SELECT session_version
       FROM device_sessions
       WHERE id = ?
         AND user_id = ?
         AND revoked_at IS NULL
         AND expires_at > CURRENT_TIMESTAMP
       LIMIT 1`
    )
      .bind(String(session.deviceSessionId), session.userId)
      .all<{ session_version: number }>();
    const deviceSession = device.results[0];
    if (!deviceSession || toNumber(deviceSession.session_version) !== toNumber(user.session_version)) {
      await deleteSession(env, token);
      return { ok: false, status: 401, message: '设备登录已失效，请重新登录' };
    }
  }

  const dbVersion = toNumber(user.session_version);
  const sessionVersion = toNumber(session.sessionVersion);
  if (sessionVersion !== dbVersion) {
    await deleteSession(env, token);
    return { ok: false, status: 401, message: '登录已过期，请重新登录' };
  }

  const refreshed: SessionUser = {
    ...session,
    isAdmin: isAdminUser(env, user),
    sessionVersion: dbVersion
  };

  if (refreshed.isAdmin !== session.isAdmin || refreshed.sessionVersion !== session.sessionVersion) {
    await putSession(env, refreshed);
  }

  return { ok: true, session: refreshed };
}
