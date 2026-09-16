import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { registerUploadRoutes } from './api/upload.ts';
import { encryptAttachment } from './encryption.js';

const keyring = JSON.stringify({
  activeKeyId: 'v1',
  keys: {
    v1: Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => 255 - index)).toString('base64')
  }
});

function fileDb({ accessible, metadata = true, data = null }) {
  return {
    prepare(sql) {
      return {
        bind() {
          return {
            async all() {
              if (sql.includes('SELECT filename, content_type, size')) {
                return metadata
                  ? { results: [{ filename: '报告.bin', content_type: 'application/octet-stream', size: 4 }] }
                  : { results: [] };
              }
              return { results: accessible ? [{ found: 1 }] : [] };
            },
            // 纯 D1 部署把附件正文存在 uploaded_files.data，下载走 first()。
            async first() {
              if (!sql.includes('SELECT filename, content_type, data')) return null;
              return data
                ? { filename: '报告.bin', content_type: 'application/octet-stream', data }
                : null;
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

test('authorized attachment download decrypts bytes and disables shared caching', async () => {
  const objectKey = '42/example.bin';
  const plaintext = Uint8Array.from([1, 2, 3, 4]);
  const ciphertext = await encryptAttachment(keyring, plaintext, objectKey);
  const object = {
    uploaded: new Date('2026-08-10T00:00:00Z'),
    customMetadata: {},
    async arrayBuffer() {
      return ciphertext.buffer;
    },
    writeHttpMetadata(headers) {
      headers.set('content-type', 'application/octet-stream');
      headers.set('cache-control', 'public, max-age=31536000');
    }
  };
  const app = new Hono();
  registerUploadRoutes(app);

  const response = await app.request(
    `https://edgechat.test/files/${objectKey}`,
    {},
    {
      DB: fileDb({ accessible: true }),
      FILES: {
        async get() {
          return object;
        }
      },
      EDGECHAT_ENCRYPTION_KEYRING: keyring
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), plaintext);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.match(response.headers.get('content-disposition'), /%E6%8A%A5%E5%91%8A\.bin/);
});

test('unauthorized attachment download is rejected before reading R2', async () => {
  let r2Read = false;
  const app = new Hono();
  registerUploadRoutes(app);

  const response = await app.request(
    'https://edgechat.test/files/42/private.bin',
    {},
    {
      DB: fileDb({ accessible: false }),
      FILES: {
        async get() {
          r2Read = true;
          return null;
        }
      },
      EDGECHAT_ENCRYPTION_KEYRING: keyring
    }
  );

  assert.equal(response.status, 403);
  assert.equal(r2Read, false);
});

test('attachment download falls back to D1 when the deployment has no R2 binding', async () => {
  const app = new Hono();
  registerUploadRoutes(app);

  // 纯 D1 部署：uploaded_files.data 为空说明该文件从未落库，按 404 处理。
  const missing = await app.request(
    'https://edgechat.test/files/42/private.bin',
    {},
    { DB: fileDb({ accessible: true }) }
  );
  assert.equal(missing.status, 404);

  // 正文存在 D1 时直接回吐字节，并按不可变内容缓存。
  const stored = Uint8Array.from([9, 8, 7]);
  const served = await app.request(
    'https://edgechat.test/files/42/private.bin',
    {},
    { DB: fileDb({ accessible: true, data: stored }) }
  );
  assert.equal(served.status, 200);
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), stored);
  assert.equal(served.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
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
      DB: fileDb({ accessible: true, metadata: false }),
      FILES: {
        async get() {
          return {
            customMetadata: { filename: 'telegram-photo.jpg' },
            async arrayBuffer() {
              return ciphertext.buffer;
            },
            writeHttpMetadata(headers) {
              headers.set('content-type', 'image/jpeg');
            }
          };
        }
      },
      EDGECHAT_ENCRYPTION_KEYRING: keyring
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), plaintext);
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.match(response.headers.get('content-disposition'), /telegram-photo\.jpg/);
});
