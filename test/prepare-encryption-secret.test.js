import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadEncryptionKeyring } from '../worker/src/encryption.ts';
import {
  createKeyring,
  prepareEncryptionSecret
} from '../.github/scripts/prepare-encryption-secret.mjs';

function key(seed) {
  return Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => seed + index)).toString('base64');
}

function withTempDir(t, prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

test('generated deployment keyrings contain a random 32-byte active key', () => {
  const first = createKeyring();
  const second = createKeyring();
  assert.notEqual(first, second);
  assert.equal(loadEncryptionKeyring(first).keys.get('v1').bytes.byteLength, 32);
});

test('first deployment writes versioned automatic secrets and normal redeployments preserve them', async (t) => {
  const directory = withTempDir(t, 'edgechat-secret-test-');

  globalThis.fetch = async () => Response.json({ success: true, result: [] });
  const secretsFile = join(directory, 'secrets.json');
  const created = await prepareEncryptionSecret({
    accountId: 'account',
    apiToken: 'token',
    workerName: 'cfchat',
    secretsFile
  });
  assert.equal(created.action, 'created');
  const payload = JSON.parse(readFileSync(secretsFile, 'utf8'));
  assert.equal(payload.EDGECHAT_ENCRYPTION_ACTIVE_KEY_ID, 'auto-v1');
  assert.equal(loadEncryptionKeyring(payload).keys.get('auto-v1').bytes.byteLength, 32);

  globalThis.fetch = async () =>
    Response.json({
      success: true,
      result: [
        { name: 'EDGECHAT_ENCRYPTION_ACTIVE_KEY_ID', type: 'secret_text' },
        { name: 'EDGECHAT_ENCRYPTION_KEY_1', type: 'secret_text' }
      ]
    });
  const preserved = await prepareEncryptionSecret({
    accountId: 'account',
    apiToken: 'token',
    workerName: 'cfchat',
    secretsFile: join(directory, 'unused.json')
  });
  assert.deepEqual(preserved, { action: 'preserved' });
});

test('automatic rotation adds only a new key version and advances the active key', async (t) => {
  const directory = withTempDir(t, 'edgechat-auto-rotation-test-');
  globalThis.fetch = async () =>
    Response.json({
      success: true,
      result: [
        { name: 'EDGECHAT_ENCRYPTION_KEYRING', type: 'secret_text' },
        { name: 'EDGECHAT_ENCRYPTION_ACTIVE_KEY_ID', type: 'secret_text' },
        { name: 'EDGECHAT_ENCRYPTION_KEY_1', type: 'secret_text' }
      ]
    });

  const secretsFile = join(directory, 'rotated.json');
  const rotated = await prepareEncryptionSecret({
    accountId: 'account',
    apiToken: 'token',
    rotateEncryptionKey: true,
    secretsFile
  });
  const payload = JSON.parse(readFileSync(secretsFile, 'utf8'));

  assert.equal(rotated.action, 'rotated');
  assert.equal(rotated.activeKeyId, 'auto-v2');
  assert.deepEqual(Object.keys(payload).sort(), [
    'EDGECHAT_ENCRYPTION_ACTIVE_KEY_ID',
    'EDGECHAT_ENCRYPTION_KEY_2'
  ]);
  assert.equal(loadEncryptionKeyring(payload).activeKeyId, 'auto-v2');
});

test('manual updates accept a complete incremental keyring and reject an empty override', async (t) => {
  const directory = withTempDir(t, 'edgechat-rotation-test-');
  globalThis.fetch = async () =>
    Response.json({
      success: true,
      result: [{ name: 'EDGECHAT_ENCRYPTION_KEYRING', type: 'secret_text' }]
    });

  await assert.rejects(
    prepareEncryptionSecret({
      accountId: 'account',
      apiToken: 'token',
      applySuppliedKeyring: true,
      secretsFile: join(directory, 'missing.json')
    }),
    /repository secret is required/
  );

  const suppliedKeyring = JSON.stringify({
    activeKeyId: 'v2',
    keys: { v1: key(1), v2: key(101) }
  });
  const secretsFile = join(directory, 'rotated.json');
  const updated = await prepareEncryptionSecret({
    accountId: 'account',
    apiToken: 'token',
    suppliedKeyring,
    applySuppliedKeyring: true,
    secretsFile
  });
  assert.equal(updated.action, 'updated');
  assert.equal(
    JSON.parse(readFileSync(secretsFile, 'utf8')).EDGECHAT_ENCRYPTION_KEYRING,
    suppliedKeyring
  );
  assert.equal(
    JSON.parse(readFileSync(secretsFile, 'utf8')).EDGECHAT_ENCRYPTION_ACTIVE_KEY_ID,
    'v2'
  );
});

test('pages target reads project secrets and only counts secret_text entries', async (t) => {
  const directory = withTempDir(t, 'edgechat-pages-secret-test-');
  const requests = [];
  const responses = [
    Response.json({
      success: true,
      result: {
        name: 'edgechat',
        deployment_configs: {
          production: {
            env_vars: {
              ADMIN_USERNAMES: { type: 'plain_text', value: 'admin' },
              EDGECHAT_ENCRYPTION_KEYRING: { type: 'secret_text' }
            }
          }
        }
      }
    }),
    Response.json({ success: true, result: { name: 'edgechat' } })
  ];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), method: init.method });
    return responses.shift();
  };

  const secretsFile = join(directory, 'pages.json');
  const preserved = await prepareEncryptionSecret({
    target: 'pages',
    projectName: 'edgechat',
    accountId: 'account',
    apiToken: 'token',
    secretsFile
  });

  assert.deepEqual(preserved, { action: 'preserved' });
  assert.match(requests[0].url, /\/pages\/projects\/edgechat$/);
  assert.equal(requests.length, 1, '已配置密钥时不再写文件');
});

test('pages target treats plain_text variables as unconfigured and writes the keyring', async (t) => {
  const directory = withTempDir(t, 'edgechat-pages-created-test-');
  globalThis.fetch = async () =>
    Response.json({
      success: true,
      result: {
        name: 'edgechat',
        deployment_configs: {
          production: {
            env_vars: {
              ADMIN_USERNAMES: { type: 'plain_text', value: 'admin' }
            }
          }
        }
      }
    });

  const secretsFile = join(directory, 'pages.json');
  const created = await prepareEncryptionSecret({
    target: 'pages',
    projectName: 'edgechat',
    accountId: 'account',
    apiToken: 'token',
    secretsFile
  });

  assert.equal(created.action, 'created');
  const payload = JSON.parse(readFileSync(secretsFile, 'utf8'));
  assert.equal(payload.EDGECHAT_ENCRYPTION_ACTIVE_KEY_ID, 'auto-v1');
  assert.equal(loadEncryptionKeyring(payload).keys.get('auto-v1').bytes.byteLength, 32);
});
