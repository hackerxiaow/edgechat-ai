import { normalizeAudioAttachmentMetadata } from "./attachment-metadata.ts";

export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers || {})
    }
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, { status });
}

export function v1ErrorResponse(code: string, message: string, status = 400): Response {
  return jsonResponse({ error: { code, message } }, { status });
}

export function errorCodeForStatus(status: number): string {
  if (status === 401) return 'authentication_required';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 413) return 'payload_too_large';
  if (status === 503) return 'service_unavailable';
  if (status >= 500) return 'internal_error';
  return 'invalid_request';
}

export const MAX_JSON_BODY_SIZE = 10 * 1024 * 1024;

export function requestBodyTooLarge(request: Request, maxBytes = MAX_JSON_BODY_SIZE): boolean {
  const contentLength = Number(request.headers.get('content-length') || 0);
  return Number.isFinite(contentLength) && contentLength > maxBytes;
}

/**
 * 请求体是不可信输入，默认形状保持宽松；需要具体结构时由调用方传入类型参数。
 */
export function parseJsonRequest<T = Record<string, unknown>>(request: Request): Promise<T> {
  return request.json().catch(() => ({})) as Promise<T>;
}

export function sanitizeLimit(value: unknown, fallback = 30, max = 100): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

/** 外置图床的直链：这类 key 不是本地 `<userId>/...` 形态，也不能再拼成 /files/ 路径。 */
export function isAbsoluteFileUrl(value: unknown): boolean {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function keyBelongsToOwner(key: string, ownerUserId: number | string | null | undefined): boolean {
  if (ownerUserId === undefined || ownerUserId === null) {
    return true;
  }

  // 外置存储的附件其 key 本身就是图床直链，没有本地归属前缀可校验；
  // 归属由 uploaded_files.owner_user_id 保证，不依赖 key 形态。
  if (isAbsoluteFileUrl(key)) {
    return true;
  }

  const ownerPrefix = `${Number(ownerUserId)}/`;
  return Number.isFinite(Number(ownerUserId)) && String(key || '').startsWith(ownerPrefix);
}

/** 客户端提交的附件载荷经校验后的规范形状。 */
export interface PickedAttachment {
  key: string;
  name: string;
  type: string;
  size: number;
  url: string;
  kind?: "voice" | "audio";
  durationMs?: number;
  waveform?: number[];
}

export function pickAttachment(
  payload: unknown,
  options: { ownerUserId?: number | string | null } = {},
): PickedAttachment | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidate = payload as { key?: unknown; name?: unknown; type?: unknown; size?: unknown };
  if (!candidate.key || !candidate.name || !candidate.type) {
    return null;
  }

  const key = String(candidate.key);
  if (!keyBelongsToOwner(key, options.ownerUserId)) {
    return null;
  }

  const type = String(candidate.type);
  return {
    key,
    name: String(candidate.name),
    type,
    size: Number(candidate.size) || 0,
    url: publicFileUrl(key),
    ...normalizeAudioAttachmentMetadata(candidate, type),
  };
}

export function publicFileUrl(key: string | number): string {
  const value = String(key);
  // 外置图床直链原样返回；只有本地 key 才拼 /files/ 前缀。
  return isAbsoluteFileUrl(value) ? value : `/files/${encodeURIComponent(value)}`;
}

export function nextDailyUtcHour(hour: number): Date {
  const target = new Date();
  target.setUTCMinutes(0, 0, 0);
  target.setUTCHours(hour);
  if (target <= new Date()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target;
}

export function randomToken(byteLength = 24): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
