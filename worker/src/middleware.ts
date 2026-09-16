import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './types.ts';
import { errorResponse, errorCodeForStatus, v1ErrorResponse } from './utils.js';
import { validateSession } from './session.ts';

function extractToken(request: Request): string {
  const authHeader = request.headers.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }

  const url = new URL(request.url);
  return url.searchParams.get('token') || '';
}

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = extractToken(c.req.raw);
  const result = await validateSession(c.env, token);
  if (!result.ok) {
    if (new URL(c.req.url).pathname.startsWith('/api/v1/')) {
      return v1ErrorResponse(errorCodeForStatus(result.status), result.message, result.status);
    }
    return errorResponse(result.message, result.status);
  }

  c.set('session', result.session);
  await next();
};

export const adminMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = c.get('session');
  if (!session?.isAdmin) {
    if (new URL(c.req.url).pathname.startsWith('/api/v1/')) {
      return v1ErrorResponse('forbidden', '需要管理员权限', 403);
    }
    return errorResponse('需要管理员权限', 403);
  }

  await next();
};
