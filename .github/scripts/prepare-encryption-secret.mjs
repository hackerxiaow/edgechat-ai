#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEncryptionKeyring } from '../../worker/src/encryption.ts';

const API_BASE_URL = 'https://api.cloudflare.com/client/v4';
const KEYRING_SECRET_NAME = 'EDGECHAT_ENCRYPTION_KEYRING';
const ACTIVE_KEY_SECRET_NAME = 'EDGECHAT_ENCRYPTION_ACTIVE_KEY_ID';
const AUTO_KEY_SECRET_PATTERN = /^EDGECHAT_ENCRYPTION_KEY_(\d+)$/;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${String(value)}\n`);
  }
}

function apiError(payload, fallback) {
  if (!Array.isArray(payload?.errors) || payload.errors.length === 0) return fallback;
  return payload.errors.map((error) => `${error.code}: ${error.message}`).join('; ');
}

async function listWorkerSecrets({ accountId, apiToken, workerName }) {
  const response = await fetch(
    `${API_BASE_URL}/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(workerName)}/secrets`,
    { headers: { Authorization: `Bearer ${apiToken}` } }
  );
  const payload = await response.json().catch(() => null);
  if (response.status === 404) return [];
  if (!response.ok || payload?.success === false) {
    throw new Error(apiError(payload, `Cloudflare API returned ${response.status}`));
  }
  return Array.isArray(payload?.result) ? payload.result : [];
}

/**
 * Pages 的密钥挂在项目上，通过项目详情的 deployment_configs.production.env_vars 读取；
 * secret_text 才是密钥，plain_text 是普通变量。
 */
async function listPagesSecrets({ accountId, apiToken, projectName }) {
  const response = await fetch(
    `${API_BASE_URL}/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}`,
    { headers: { Authorization: `Bearer ${apiToken}` } }
  );
  const payload = await response.json().catch(() => null);
  if (response.status === 404) return [];
  if (!response.ok || payload?.success === false) {
    throw new Error(apiError(payload, `Cloudflare API returned ${response.status}`));
  }
  const envVars = payload?.result?.deployment_configs?.production?.env_vars || {};
  return Object.entries(envVars)
    .filter(([, config]) => config?.type === 'secret_text')
    .map(([name]) => ({ name }));
}

function listSecrets({ target, accountId, apiToken, targetName }) {
  if (target === 'pages') {
    return listPagesSecrets({ accountId, apiToken, projectName: targetName });
  }
  if (target === 'worker') {
    return listWorkerSecrets({ accountId, apiToken, workerName: targetName });
  }
  throw new Error(`Unsupported deployment target: ${target}`);
}

export function createKeyring() {
  return JSON.stringify({
    activeKeyId: 'v1',
    keys: { v1: randomBytes(32).toString('base64') }
  });
}

function createAutomaticKey(version) {
  return {
    keyId: `auto-v${version}`,
    bindingName: `EDGECHAT_ENCRYPTION_KEY_${version}`,
    encodedKey: randomBytes(32).toString('base64')
  };
}

function writeSecretsFile(secretsFile, secrets) {
  for (const value of Object.values(secrets)) {
    console.log(`::add-mask::${value}`);
  }
  mkdirSync(dirname(secretsFile), { recursive: true });
  writeFileSync(secretsFile, JSON.stringify(secrets), { mode: 0o600 });
}

export async function prepareEncryptionSecret({
  target = 'worker',
  targetName,
  accountId,
  apiToken,
  workerName = 'cfchat',
  projectName = 'edgechat',
  secretsFile = '.tmp/encryption-secrets.json',
  suppliedKeyring = '',
  applySuppliedKeyring = false,
  rotateEncryptionKey = false
} = {}) {
  const name = targetName || (target === 'pages' ? projectName : workerName);
  const secrets = await listSecrets({ target, accountId, apiToken, targetName: name });
  const secretNames = new Set(secrets.map((secret) => secret?.name).filter(Boolean));
  const automaticKeyVersions = [...secretNames]
    .map((name) => AUTO_KEY_SECRET_PATTERN.exec(name))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  const encryptionConfigured =
    secretNames.has(KEYRING_SECRET_NAME) ||
    secretNames.has(ACTIVE_KEY_SECRET_NAME) ||
    automaticKeyVersions.length > 0;

  if (applySuppliedKeyring && rotateEncryptionKey) {
    throw new Error('Choose either manual keyring update or automatic key rotation, not both');
  }

  if (!applySuppliedKeyring && !rotateEncryptionKey && encryptionConfigured) {
    setOutput('action', 'preserved');
    console.log(`Encryption secrets already exist on ${name} (${target}); preserving them.`);
    return { action: 'preserved' };
  }

  if (applySuppliedKeyring && !suppliedKeyring) {
    throw new Error(
      'EDGECHAT_ENCRYPTION_KEYRING repository secret is required when applying a manual keyring'
    );
  }

  if (applySuppliedKeyring || (!encryptionConfigured && suppliedKeyring)) {
    // 手动更新必须提交完整密钥环；旧 key ID 留在 keys 中，历史密文才能继续解密。
    const keyring = loadEncryptionKeyring(suppliedKeyring);
    writeSecretsFile(secretsFile, {
      [KEYRING_SECRET_NAME]: suppliedKeyring,
      [ACTIVE_KEY_SECRET_NAME]: keyring.activeKeyId
    });
    const action = encryptionConfigured ? 'updated' : 'created';
    setOutput('action', action);
    setOutput('active_key_id', keyring.activeKeyId);
    console.log(`Manual encryption keyring will be ${action} with this deployment.`);
    return { action, activeKeyId: keyring.activeKeyId, secretsFile };
  }

  const nextVersion = automaticKeyVersions.length > 0 ? Math.max(...automaticKeyVersions) + 1 : 1;
  const automaticKey = createAutomaticKey(nextVersion);
  writeSecretsFile(secretsFile, {
    [ACTIVE_KEY_SECRET_NAME]: automaticKey.keyId,
    [automaticKey.bindingName]: automaticKey.encodedKey
  });

  const action = encryptionConfigured ? 'rotated' : 'created';
  setOutput('action', action);
  setOutput('active_key_id', automaticKey.keyId);
  console.log(`Automatic encryption key ${automaticKey.keyId} will be ${action} with this deployment.`);
  return { action, activeKeyId: automaticKey.keyId, secretsFile };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  prepareEncryptionSecret({
    target: process.env.EDGECHAT_DEPLOY_TARGET || 'worker',
    accountId: requireEnv('CLOUDFLARE_ACCOUNT_ID'),
    apiToken: requireEnv('CLOUDFLARE_API_TOKEN'),
    workerName: process.env.EDGECHAT_WORKER_NAME || 'cfchat',
    projectName: process.env.EDGECHAT_PAGES_PROJECT_NAME || 'edgechat',
    secretsFile: process.env.EDGECHAT_SECRETS_FILE || '.tmp/encryption-secrets.json',
    suppliedKeyring: process.env.EDGECHAT_ENCRYPTION_KEYRING || '',
    applySuppliedKeyring: process.env.EDGECHAT_APPLY_ENCRYPTION_KEYRING === 'true',
    rotateEncryptionKey: process.env.EDGECHAT_ROTATE_ENCRYPTION_KEY === 'true'
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
