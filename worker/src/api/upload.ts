import type { Hono } from 'hono';
import type { AppEnv, SessionUser } from '../types.ts';
import {
  canAccessFile,
  getUploadedFileByClientId,
  recordUploadedFile
} from '../data/uploaded-files.ts';
import { decryptAttachment, encryptAttachment } from '../encryption.ts';
import { normalizeContentType, sanitizeFilename } from '../attachment-metadata.ts';
import { validateSession } from '../session.ts';
import { errorResponse, requestBodyTooLarge } from '../utils.ts';

const UPLOAD_BODY_OVERHEAD_BYTES = 1024 * 1024;
/** D1 单行（含 BLOB）上限 2,000,000 字节；信封加密的头部还要再占用几十字节。 */
const D1_MAX_ROW_BYTES = 2_000_000;
const ATTACHMENT_ENVELOPE_OVERHEAD_BYTES = 1024;
const OVERSIZED_ROW_MESSAGE = '该附件超过 D1 单行上限，请改用更小的文件';
/** 这些校验错误可以原样返回给用户，其余异常都当作服务端故障。 */
const REJECTABLE_UPLOAD_MESSAGES = [
  '文件大小不能超过',
  '该文件类型不允许上传',
  OVERSIZED_ROW_MESSAGE
];
const BLOCKED_MIME_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/javascript',
  'application/javascript',
  'text/xml',
  'application/xml'
]);

type UploadEnv = Pick<AppEnv['Bindings'], 'DB' | 'MAX_FILE_SIZE' | 'ALLOWED_FILE_TYPES'>;

interface StoredFileRow {
  filename: string | null;
  content_type: string | null;
  data: ArrayBuffer | Uint8Array | null;
}

function isInlineContentType(contentType: string | null | undefined): boolean {
  if (!contentType) {
    return false;
  }
  if (contentType === 'application/pdf') {
    return true;
  }
  if (contentType.startsWith('image/')) {
    return contentType !== 'image/svg+xml';
  }
	if (contentType.startsWith('video/')) {
		return true;
	}
	if (contentType.startsWith('audio/')) {
		return true;
	}
	return false;
}

function contentDispositionValue(kind: string, filename: string): string {
  const safeUtf8 = sanitizeFilename(filename);
  const safeAscii = safeUtf8
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/"/g, '')
    .trim()
    .slice(0, 150) || 'file';
  return `${kind}; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(safeUtf8)}`;
}

function validateUpload(env: UploadEnv, file: File): void {
  const maxFileSize = Number(env.MAX_FILE_SIZE || 20971520);
  if (file.size > maxFileSize) {
    throw new Error(`文件大小不能超过 ${Math.round(maxFileSize / 1024 / 1024)}MB`);
  }

  // 正文直接落进 uploaded_files.data，超行会被 D1 拒绝；这里先给出可读的业务错误。
  if (file.size + ATTACHMENT_ENVELOPE_OVERHEAD_BYTES > D1_MAX_ROW_BYTES) {
    throw new Error(OVERSIZED_ROW_MESSAGE);
  }

  const contentType = normalizeContentType(file.type);
  if (BLOCKED_MIME_TYPES.has(contentType)) {
    throw new Error('该文件类型不允许上传');
  }

  const allowed = String(env.ALLOWED_FILE_TYPES || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (allowed.length && !allowed.some((prefix) => contentType.startsWith(prefix))) {
    throw new Error('该文件类型不允许上传');
  }
}

export function registerUploadRoutes(app: Hono<AppEnv>) {
  app.post('/api/upload', async (c) => {
    if (!c.env.DB) {
      return errorResponse('存储服务不可用，无法上传附件', 503);
    }

    const session = c.get('session');
    const maxFileSize = Number(c.env.MAX_FILE_SIZE || 20971520);
    if (requestBodyTooLarge(c.req.raw, maxFileSize + UPLOAD_BODY_OVERHEAD_BYTES)) {
      return errorResponse(`文件大小不能超过 ${Math.round(maxFileSize / 1024 / 1024)}MB`, 413);
    }
    const formData = await c.req.formData();
    const file = formData.get('file');
    // FormDataEntryValue 含 string，先排除后再收窄为 File。
    if (!file || typeof file === 'string') {
      return errorResponse('请选择文件');
    }

    try {
      const result = await saveUploadedFile(c.env, session, file);
      return c.json({ file: result.file });
    } catch (error) {
      const message = String((error as { message?: unknown })?.message || '');
      if (REJECTABLE_UPLOAD_MESSAGES.some((prefix) => message.startsWith(prefix))) {
        return errorResponse(message);
      }
      throw error;
    }
  });

  app.get('/files/:key{.+}', async (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    const authorization = c.req.header('authorization') || '';
    const token = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : new URL(c.req.url).searchParams.get('token') || '';
    const auth = token ? await validateSession(c.env, token) : null;
    const canRead = await canAccessFile(c.env.DB, key, auth?.ok ? auth.session.userId : null);
    if (!canRead) {
      return new Response('Forbidden', { status: 403 });
    }
    // 附件正文存在 D1 的 uploaded_files.data，没有外部对象存储。
    const stored = await c.env.DB.prepare(
      'SELECT filename, content_type, data FROM uploaded_files WHERE object_key = ? LIMIT 1'
    ).bind(key).first<StoredFileRow>();
    if (!stored?.data) {
      return new Response('Not Found', { status: 404 });
    }

    const raw = stored.data instanceof Uint8Array ? stored.data : new Uint8Array(stored.data);
    // 与 R2 时期一致：正文以绑定对象键的信封加密存储；历史明文行按原样返回。
    const { bytes } = await decryptAttachment(c.env, raw, key);

    const headers = new Headers();
    const contentType = normalizeContentType(stored.content_type) || 'application/octet-stream';
    headers.set('content-type', contentType);
    // 受 canAccessFile 保护，只允许浏览器私有缓存，避免共享缓存把附件发给未授权用户。
    headers.set('cache-control', 'private, max-age=31536000, immutable');
    headers.set('x-content-type-options', 'nosniff');
    headers.set('referrer-policy', 'no-referrer');
    headers.set(
      'content-security-policy',
      "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'"
    );
    const inlineAllowed = isInlineContentType(contentType);
    const dispositionKind = inlineAllowed && !contentType.startsWith('text/') ? 'inline' : 'attachment';
    headers.set('content-disposition', contentDispositionValue(dispositionKind, stored.filename || 'file'));

    return new Response(bytes, { headers });
  });
}

export interface SavedUpload {
  created: boolean;
  file: {
    key: string;
    name: string;
    type: string;
    size: number;
    url: string;
  };
}

export async function saveUploadedFile(
  env: UploadEnv,
  session: SessionUser,
  file: File,
  { clientUploadId = null }: { clientUploadId?: string | null } = {}
): Promise<SavedUpload> {
  validateUpload(env, file);
  if (clientUploadId) {
    const existing = await getUploadedFileByClientId(env.DB, session.userId, clientUploadId);
    if (existing) return { file: existing, created: false };
  }

  const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
  const key = `${session.userId}/${Date.now()}-${crypto.randomUUID()}${extension}`;
  const filename = sanitizeFilename(file.name);
  const contentType = normalizeContentType(file.type) || 'application/octet-stream';

  const fileBytes = await file.arrayBuffer();
  const encryptedBytes = await encryptAttachment(env, fileBytes, key);

  try {
    await recordUploadedFile(env.DB, {
      key,
      ownerUserId: session.userId,
      filename,
      contentType,
      size: file.size,
      clientUploadId,
      data: encryptedBytes
    });
  } catch (error) {
    if (clientUploadId && String((error as { message?: unknown })?.message || error).includes('UNIQUE')) {
      const existing = await getUploadedFileByClientId(env.DB, session.userId, clientUploadId);
      if (existing) return { file: existing, created: false };
    }
    throw error;
  }

  return {
    created: true,
    file: {
      key,
      name: filename,
      type: contentType,
      size: file.size,
      url: `/files/${encodeURIComponent(key)}`
    }
  };
}
