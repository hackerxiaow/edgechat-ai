import type { Hono } from 'hono';
import type { AppEnv, SessionUser } from '../types.ts';
import {
  canAccessFile,
  getUploadedFileByClientId,
  recordUploadedFile
} from '../data/uploaded-files.ts';
import { getRuntimeSettings, type RuntimeSettings } from '../data/site-settings.ts';
import { decryptAttachment, encryptAttachment } from '../encryption.ts';
import { normalizeContentType, sanitizeFilename } from '../attachment-metadata.ts';
import { validateSession } from '../session.ts';
import { errorResponse, requestBodyTooLarge } from '../utils.ts';

/** 上传请求体的额外开销（multipart 边界、其它字段），与上限一起用于提前拒绝超大请求。 */
export const UPLOAD_BODY_OVERHEAD_BYTES = 1024 * 1024;
/** D1 单行（含 BLOB）上限 2,000,000 字节；信封加密的头部还要再占用几十字节。 */
const D1_MAX_ROW_BYTES = 2_000_000;
const ATTACHMENT_ENVELOPE_OVERHEAD_BYTES = 1024;
const OVERSIZED_ROW_MESSAGE = '该附件超过 D1 单行上限，请改用更小的文件';
/** 这些校验错误可以原样返回给用户，其余异常都当作服务端故障。 */
const REJECTABLE_UPLOAD_MESSAGES = [
  '文件大小不能超过',
  '该文件类型不允许上传',
  OVERSIZED_ROW_MESSAGE,
  '外部图床连接失败',
  '外部图床上传失败',
  '外部图床返回了无法识别的结果'
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

/** 上传只需要 D1：大小与类型限制来自 site_settings。 */
type UploadEnv = Pick<AppEnv['Bindings'], 'DB'>;

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

function maxFileSizeMessage(maxFileSize: number): string {
  return `文件大小不能超过 ${Math.round(maxFileSize / 1024 / 1024)}MB`;
}

function validateUpload(settings: RuntimeSettings, file: File): void {
  if (file.size > settings.maxFileSize) {
    throw new Error(maxFileSizeMessage(settings.maxFileSize));
  }

  // 只有本地 D1 存储才受单行上限约束；走外部图床时正文不进数据库。
  if (!settings.externalUploadUrl && file.size + ATTACHMENT_ENVELOPE_OVERHEAD_BYTES > D1_MAX_ROW_BYTES) {
    throw new Error(OVERSIZED_ROW_MESSAGE);
  }

  const contentType = normalizeContentType(file.type);
  if (BLOCKED_MIME_TYPES.has(contentType)) {
    throw new Error('该文件类型不允许上传');
  }

  const allowed = settings.allowedFileTypes;
  if (allowed.length && !allowed.some((prefix) => contentType.startsWith(prefix))) {
    throw new Error('该文件类型不允许上传');
  }
}

/** 各家图床返回结构不一，按常见字段宽松地取出直链。 */
async function uploadToExternalHost(uploadUrl: string, file: File): Promise<string> {
  const body = new FormData();
  body.append('file', file, file.name || 'file');

  let response: Response;
  try {
    response = await fetch(uploadUrl, { method: 'POST', body });
  } catch (error) {
    console.error('external_upload_failed', error);
    throw new Error('外部图床连接失败，请稍后重试或联系管理员');
  }

  const text = await response.text();
  if (!response.ok) {
    console.error('external_upload_http_error', response.status, text.slice(0, 200));
    throw new Error('外部图床上传失败，请稍后重试或联系管理员');
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // 图床也可能直接返回纯文本直链。
  }

  // 该图床返回 {"data":"https://..."}，data 是字符串而不是对象；
  // 这里把常见的几种形状都覆盖到，避免因为返回结构差异导致整条上传失败。
  const dataField = (parsed as { data?: unknown } | null)?.data;
  const candidates = [
    (parsed as { url?: unknown } | null)?.url,
    typeof dataField === 'string' ? dataField : null,
    (dataField as { url?: unknown } | undefined)?.url,
    (parsed as { link?: unknown } | null)?.link,
    (parsed as { path?: unknown } | null)?.path,
    parsed === null ? text : null
  ];
  const resolved = candidates
    .map((value) => String(value || '').trim())
    .find((value) => /^https?:\/\//i.test(value));

  if (!resolved) {
    console.error('external_upload_unrecognized_response', text.slice(0, 200));
    throw new Error('外部图床返回了无法识别的结果，请联系管理员核对接口');
  }
  return resolved;
}

export function registerUploadRoutes(app: Hono<AppEnv>) {
  app.post('/api/upload', async (c) => {
    if (!c.env.DB) {
      return errorResponse('存储服务不可用，无法上传附件', 503);
    }

    const session = c.get('session');
    const settings = await getRuntimeSettings(c.env.DB);
    if (requestBodyTooLarge(c.req.raw, settings.maxFileSize + UPLOAD_BODY_OVERHEAD_BYTES)) {
      return errorResponse(maxFileSizeMessage(settings.maxFileSize), 413);
    }
    const formData = await c.req.formData();
    const file = formData.get('file');
    // FormDataEntryValue 含 string，先排除后再收窄为 File。
    if (!file || typeof file === 'string') {
      return errorResponse('请选择文件');
    }

    try {
      const result = await saveUploadedFile(c.env, session, file, { settings });
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
  {
    clientUploadId = null,
    settings
  }: { clientUploadId?: string | null; settings?: RuntimeSettings } = {}
): Promise<SavedUpload> {
  // 调用方已经读过设置时直接复用，避免一次上传打两遍 site_settings。
  const resolved = settings || (await getRuntimeSettings(env.DB));
  validateUpload(resolved, file);
  if (clientUploadId) {
    const existing = await getUploadedFileByClientId(env.DB, session.userId, clientUploadId);
    if (existing) return { file: existing, created: false };
  }

  const filename = sanitizeFilename(file.name);
  const contentType = normalizeContentType(file.type) || 'application/octet-stream';

  // 配置了外部图床时，正文上传到图床、数据库只留一条 metadata；
  // key 直接就是图床直链（见 publicFileUrl / keyBelongsToOwner 的约定）。
  if (resolved.externalUploadUrl) {
    const externalUrl = await uploadToExternalHost(resolved.externalUploadUrl, file);
    // data 留空：正文已在图床，这里只留一条归属 metadata（触发器要求存在该行）。
    await recordUploadedFile(env.DB, {
      key: externalUrl,
      ownerUserId: session.userId,
      filename,
      contentType,
      size: file.size,
      clientUploadId,
      data: null
    });
    return {
      created: true,
      file: { key: externalUrl, name: filename, type: contentType, size: file.size, url: externalUrl }
    };
  }

  const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
  const key = `${session.userId}/${Date.now()}-${crypto.randomUUID()}${extension}`;

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
