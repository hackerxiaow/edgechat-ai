import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { registerUploadRoutes } from './api/upload.ts';
import { encryptAttachment } from './encryption.ts';

const keyring = JSON.stringify({
  activeKeyId: 'v1',
  keys: {
    v1: Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => 255 - index)).toString('base64')
  }
});

function fileDb({
  accessible,
  metadata = true,
  data = null,
  filename = '报告.bin',
  contentType = 'application/octet-stream',
  onDataRead = null
}) {
  return {
    prepare(sql) {
      return {
        bind() {
          return {
            async all() {
              if (sql.includes('SELECT filename, content_type, size')) {
                return metadata
                  ? { results: [{ filename, content_type: contentType, size: 4 }] }
                  : { results: [] };
              }
              return { results: accessible ? [{ found: 1 }] : [] };
            },
            // D1 单存储：附件正文存在 uploaded_files.data，下载走 first()。
            async first() {
              if (!sql.includes('SELECT filename, content_type, data')) return null;
              onDataRead?.();
              return data ? { filename, content_type: contentType, data } : null;
            }
          };
        }
      };
    }
  };
}

test('attachment upload reports when the deployment has no storage binding', async () => {
  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    c.set('session', { userId: 42 });
    return next();
  });
  registerUploadRoutes(app);

  const formData = new FormData();
  formData.set('file', new File(['hello'], 'hello.txt', { type: 'text/plain' }));
  const response = await app.request(
    'https://edgechat.test/api/upload',
    {
      method: 'POST',
      body: formData
    },
    {}
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: '存储服务不可用，无法上传附件'
  });
});

test('authorized attachment download decrypts bytes and caches privately', async () => {
  const objectKey = '42/example.bin';
  const plaintext = Uint8Array.from([1, 2, 3, 4]);
  const ciphertext = await encryptAttachment(keyring, plaintext, objectKey);
  const app = new Hono();
  registerUploadRoutes(app);

  const response = await app.request(
    `https://edgechat.test/files/${objectKey}`,
    {},
    {
      DB: fileDb({ accessible: true, data: ciphertext }),
      EDGECHAT_ENCRYPTION_KEYRING: keyring
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), plaintext);
  // 受权限保护的附件只允许浏览器私有缓存。
  assert.equal(response.headers.get('cache-control'), 'private, max-age=31536000, immutable');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-disposition'), /%E6%8A%A5%E5%91%8A\.bin/);
});

test('unauthorized attachment download is rejected before reading stored bytes', async () => {
  let dataRead = false;
  const app = new Hono();
  registerUploadRoutes(app);

  const response = await app.request(
    'https://edgechat.test/files/42/private.bin',
    {},
    {
      DB: fileDb({
        accessible: false,
        data: Uint8Array.from([1]),
        onDataRead() {
          dataRead = true;
        }
      }),
      EDGECHAT_ENCRYPTION_KEYRING: keyring
    }
  );

  assert.equal(response.status, 403);
  assert.equal(dataRead, false);
});

test('attachment download reads bytes from D1 and 404s when no body was stored', async () => {
  const app = new Hono();
  registerUploadRoutes(app);

  // data 为空说明该文件从未落库（例如 Telegram 入站附件不再导入）。
  const missing = await app.request(
    'https://edgechat.test/files/42/private.bin',
    {},
    { DB: fileDb({ accessible: true }) }
  );
  assert.equal(missing.status, 404);

  // 历史明文行（非加密信封）按原样返回。
  const stored = Uint8Array.from([9, 8, 7]);
  const served = await app.request(
    'https://edgechat.test/files/42/private.bin',
    {},
    { DB: fileDb({ accessible: true, data: stored }) }
  );
  assert.equal(served.status, 200);
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), stored);
});

test('telegram attachment downloads through message authorization without uploaded file ownership', async () => {
  const objectKey = 'telegram/-1001/9-example.jpg';
  const plaintext = Uint8Array.from([5, 6, 7]);
  const ciphertext = await encryptAttachment(keyring, plaintext, objectKey);
  const app = new Hono();
  registerUploadRoutes(app);

  const response = await app.request(
    `https://edgechat.test/files/${encodeURIComponent(objectKey)}`,
    {},
    {
      DB: fileDb({
        accessible: true,
        metadata: false,
        data: ciphertext,
        filename: 'telegram-photo.jpg',
        contentType: 'image/jpeg'
      }),
      EDGECHAT_ENCRYPTION_KEYRING: keyring
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), plaintext);
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.match(response.headers.get('content-disposition'), /telegram-photo\.jpg/);
});
