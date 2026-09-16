const MESSAGE_V1_PREFIX = 'edgechat:enc:v1:';
const MESSAGE_V2_PREFIX = 'edgechat:enc:v2:';
const SECRET_PREFIX = 'edgechat:secret:v1:';
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const AES_KEY_BYTES = 32;
const NONCE_BYTES = 12;
const FILE_MAGIC = new Uint8Array([0x45, 0x44, 0x47, 0x45, 0x43, 0x30, 0x31, 0x00]);

const encoder = new TextEncoder();
// workers-types 要求显式声明 ignoreBOM；false 与运行时的默认行为一致。
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

/** 密钥来源：既可以是旧的裸 keyring 字符串，也可以是带 EDGECHAT_ENCRYPTION_* 的 env。 */
export type EncryptionSource = unknown;

export interface MessageContext {
  channelId: number | string;
  senderId: number | string;
  /** 外部消息使用来源+外部 ID 作为 AAD，缺省表示本地消息。 */
  senderContext?: string;
}

export interface DecryptedAttachment {
  bytes: Uint8Array;
  encrypted: boolean;
  keyId: string | null;
}

interface KeyEntry {
  bytes: Uint8Array;
  cryptoKey: Promise<CryptoKey>;
}

export interface EncryptionKeyring {
  activeKeyId: string;
  keys: Map<string, KeyEntry>;
}

interface KeyringSource {
  cacheKey: string;
  legacyRaw: string;
  activeKeyId: string;
  generatedKeys: [string, string][];
}

let cachedRawKeyring: string | null = null;
let cachedKeyring: EncryptionKeyring | null = null;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: unknown, label: string): Uint8Array {
  const input = String(value || '');
  if (!input || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input)) {
    throw new Error(`${label} must be valid padded Base64`);
  }

  let binary: string;
  try {
    binary = atob(input);
  } catch {
    throw new Error(`${label} must be valid padded Base64`);
  }

  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function getKeyringSource(source: EncryptionSource): KeyringSource {
  if (typeof source === 'string') {
    return {
      cacheKey: `legacy:${source}`,
      legacyRaw: source,
      activeKeyId: '',
      generatedKeys: []
    };
  }

  const env = (source || {}) as Record<string, unknown>;
  const legacyRaw = String(env.EDGECHAT_ENCRYPTION_KEYRING || '');
  const activeKeyId = String(env.EDGECHAT_ENCRYPTION_ACTIVE_KEY_ID || '');
  const generatedKeys = Object.entries(env)
    .map(([bindingName, value]): [string, string] | null => {
      const match = /^EDGECHAT_ENCRYPTION_KEY_(\d+)$/.exec(bindingName);
      return match ? [`auto-v${Number(match[1])}`, String(value || '')] : null;
    })
    .filter((entry): entry is [string, string] => entry !== null)
    .sort(([left], [right]) => left.localeCompare(right));

  return {
    cacheKey: JSON.stringify([legacyRaw, activeKeyId, generatedKeys]),
    legacyRaw,
    activeKeyId,
    generatedKeys
  };
}

function parseLegacyKeyring(raw: string): { activeKeyId: string; keys: [string, string][] } {
  if (!raw) {
    return { activeKeyId: '', keys: [] };
  }

  let payload: { activeKeyId?: unknown; keys?: unknown };
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error('EDGECHAT_ENCRYPTION_KEYRING must be valid JSON');
  }

  const activeKeyId = String(payload?.activeKeyId || '');
  if (!KEY_ID_PATTERN.test(activeKeyId)) {
    throw new Error('Encryption activeKeyId is invalid');
  }
  if (!payload?.keys || typeof payload.keys !== 'object' || Array.isArray(payload.keys)) {
    throw new Error('Encryption keys must be an object');
  }

  return {
    activeKeyId,
    keys: Object.entries(payload.keys as Record<string, unknown>).map(
      ([keyId, encodedKey]) => [keyId, String(encodedKey ?? '')] as [string, string],
    )
  };
}

function addKey(keys: Map<string, KeyEntry>, keyId: string, encodedKey: unknown): void {
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new Error(`Encryption key id is invalid: ${keyId}`);
  }
  const bytes = base64ToBytes(encodedKey, `Encryption key ${keyId}`);
  if (bytes.byteLength !== AES_KEY_BYTES) {
    throw new Error(`Encryption key ${keyId} must decode to 32 bytes`);
  }
  keys.set(keyId, {
    bytes,
    cryptoKey: crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt'
    ])
  });
}

export function loadEncryptionKeyring(source: EncryptionSource): EncryptionKeyring {
  const keyringSource = getKeyringSource(source);
  if (!keyringSource.legacyRaw && keyringSource.generatedKeys.length === 0) {
    // 绝不回退到内置密钥：那会让未配置密钥的部署用公开密钥加密，比明文更危险。
    throw new Error('EDGECHAT_ENCRYPTION_KEYRING is required');
  }
  if (keyringSource.cacheKey === cachedRawKeyring && cachedKeyring) {
    return cachedKeyring;
  }

  const legacyKeyring = parseLegacyKeyring(keyringSource.legacyRaw);
  const activeKeyId = keyringSource.activeKeyId || legacyKeyring.activeKeyId;
  if (!KEY_ID_PATTERN.test(activeKeyId)) {
    throw new Error('Encryption activeKeyId is invalid');
  }

  const keys = new Map<string, KeyEntry>();
  for (const [keyId, encodedKey] of legacyKeyring.keys) {
    addKey(keys, keyId, encodedKey);
  }
  for (const [keyId, encodedKey] of keyringSource.generatedKeys) {
    addKey(keys, keyId, encodedKey);
  }

  if (!keys.has(activeKeyId)) {
    throw new Error('Encryption activeKeyId is not present in keys');
  }

  cachedRawKeyring = keyringSource.cacheKey;
  cachedKeyring = { activeKeyId, keys };
  return cachedKeyring;
}

async function getCryptoKey(keyring: EncryptionKeyring, keyId: string): Promise<CryptoKey> {
  const entry = keyring.keys.get(keyId);
  if (!entry) {
    throw new Error(`Encryption key is unavailable: ${keyId}`);
  }
  return entry.cryptoKey;
}

function messageAad(channelId: number | string, senderId: number | string): Uint8Array {
  // 把密文绑定到原会话与发送者，防止数据库中的密文被挪到另一条消息后仍能通过认证。
  return encoder.encode(`edgechat:message:v1:${Number(channelId)}:${Number(senderId)}`);
}

function externalMessageAad(channelId: number | string, senderContext: string): Uint8Array {
  // 外部用户没有本地数值账号，v2 使用来源与外部 ID 绑定密文，同时保留 v1 本地消息兼容性。
  return encoder.encode(`edgechat:message:v2:${Number(channelId)}:${String(senderContext)}`);
}

function attachmentAad(objectKey: string): Uint8Array {
  // R2 对象键参与认证，避免同一份密文被替换到其他下载地址。
  return encoder.encode(`edgechat:attachment:v1:${String(objectKey)}`);
}

function secretAad(context: string): Uint8Array {
  // 配置密文绑定到明确用途，避免数据库中的 Bot Token 与 Webhook Secret 被互换后仍能解密。
  return encoder.encode(`edgechat:secret:v1:${String(context)}`);
}

export function isEncryptedMessageContent(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    (value.startsWith(MESSAGE_V1_PREFIX) || value.startsWith(MESSAGE_V2_PREFIX))
  );
}

export function getMessageEnvelopeKeyId(value: unknown): string | null {
  if (!isEncryptedMessageContent(value)) {
    return null;
  }
  const parts = String(value).split(':');
  return parts.length === 6 && KEY_ID_PATTERN.test(parts[3]) ? parts[3] : null;
}

export async function encryptMessageContent(
  source: EncryptionSource,
  plaintext: unknown,
  { channelId, senderId, senderContext = '' }: MessageContext
): Promise<string> {
  const cleanPlaintext = String(plaintext || '');
  if (!cleanPlaintext) {
    return '';
  }

  const keyring = loadEncryptionKeyring(source);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const cryptoKey = await getCryptoKey(keyring, keyring.activeKeyId);
  const usesExternalContext = Boolean(senderContext);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonce,
        additionalData: usesExternalContext
          ? externalMessageAad(channelId, senderContext)
          : messageAad(channelId, senderId)
      },
      cryptoKey,
      encoder.encode(cleanPlaintext)
    )
  );

  const prefix = usesExternalContext ? MESSAGE_V2_PREFIX : MESSAGE_V1_PREFIX;
  return `${prefix}${keyring.activeKeyId}:${bytesToBase64(nonce)}:${bytesToBase64(ciphertext)}`;
}

export async function decryptMessageContent(
  source: EncryptionSource,
  value: unknown,
  { channelId, senderId, senderContext = '' }: MessageContext
): Promise<string> {
  const content = String(value || '');
  // 历史明文保持原样读取，不做请求内回写，也不触发后台批量迁移。
  if (!isEncryptedMessageContent(content)) {
    return content;
  }

  const parts = content.split(':');
  if (parts.length !== 6 || !KEY_ID_PATTERN.test(parts[3])) {
    throw new Error('Encrypted message envelope is malformed');
  }

  const keyring = loadEncryptionKeyring(source);
  const keyId = parts[3];
  const nonce = base64ToBytes(parts[4], 'Message nonce');
  const ciphertext = base64ToBytes(parts[5], 'Message ciphertext');
  if (nonce.byteLength !== NONCE_BYTES || ciphertext.byteLength < 16) {
    throw new Error('Encrypted message envelope is malformed');
  }

  try {
    const isV2 = content.startsWith(MESSAGE_V2_PREFIX);
    if (isV2 && !senderContext) {
      throw new Error('Encrypted message sender context is unavailable');
    }
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonce,
        additionalData: isV2
          ? externalMessageAad(channelId, senderContext)
          : messageAad(channelId, senderId)
      },
      await getCryptoKey(keyring, keyId),
      ciphertext
    );
    return decoder.decode(plaintext);
  } catch (error) {
    // 认证失败必须上抛：静默降级会把密钥配错与密文篡改都掩盖成「读不出来」。
    // 单条消息的可读性由调用方（消息投影层）逐条降级，不由加密层吞掉。
    if (error instanceof Error && error.message.startsWith('Encryption key is unavailable:')) {
      throw error;
    }
    throw new Error('Encrypted message authentication failed');
  }
}

export async function encryptSecretValue(
  source: EncryptionSource,
  plaintext: unknown,
  context: string
): Promise<string> {
  const cleanPlaintext = String(plaintext || '');
  if (!cleanPlaintext) {
    return '';
  }

  const keyring = loadEncryptionKeyring(source);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: secretAad(context) },
      await getCryptoKey(keyring, keyring.activeKeyId),
      encoder.encode(cleanPlaintext)
    )
  );

  return `${SECRET_PREFIX}${keyring.activeKeyId}:${bytesToBase64(nonce)}:${bytesToBase64(ciphertext)}`;
}

export async function decryptSecretValue(
  source: EncryptionSource,
  value: unknown,
  context: string
): Promise<string> {
  const encrypted = String(value || '');
  if (!encrypted.startsWith(SECRET_PREFIX)) {
    throw new Error('Encrypted secret envelope is malformed');
  }

  const parts = encrypted.split(':');
  if (parts.length !== 6 || !KEY_ID_PATTERN.test(parts[3])) {
    throw new Error('Encrypted secret envelope is malformed');
  }

  const keyring = loadEncryptionKeyring(source);
  const nonce = base64ToBytes(parts[4], 'Secret nonce');
  const ciphertext = base64ToBytes(parts[5], 'Secret ciphertext');
  if (nonce.byteLength !== NONCE_BYTES || ciphertext.byteLength < 16) {
    throw new Error('Encrypted secret envelope is malformed');
  }

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: secretAad(context) },
      await getCryptoKey(keyring, parts[3]),
      ciphertext
    );
    return decoder.decode(plaintext);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Encryption key is unavailable:')) {
      throw error;
    }
    throw new Error('Encrypted secret authentication failed');
  }
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error('Attachment payload must be binary');
}

export function isEncryptedAttachment(value: unknown): boolean {
  const bytes = toBytes(value);
  return (
    bytes.byteLength >= FILE_MAGIC.byteLength &&
    FILE_MAGIC.every((expected, index) => bytes[index] === expected)
  );
}

export function getAttachmentEnvelopeKeyId(value: unknown): string | null {
  const bytes = toBytes(value);
  if (!isEncryptedAttachment(bytes)) {
    return null;
  }
  const keyIdLength = bytes[FILE_MAGIC.byteLength];
  const headerLength = FILE_MAGIC.byteLength + 1 + keyIdLength + NONCE_BYTES;
  if (!keyIdLength || keyIdLength > 64 || bytes.byteLength < headerLength + 16) {
    throw new Error('Encrypted attachment envelope is malformed');
  }
  const keyId = decoder.decode(
    bytes.subarray(FILE_MAGIC.byteLength + 1, FILE_MAGIC.byteLength + 1 + keyIdLength)
  );
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new Error('Encrypted attachment envelope is malformed');
  }
  return keyId;
}

export async function encryptAttachment(
  source: EncryptionSource,
  value: unknown,
  objectKey: string
): Promise<Uint8Array> {
  const plaintext = toBytes(value);
  const keyring = loadEncryptionKeyring(source);
  const keyIdBytes = encoder.encode(keyring.activeKeyId);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: attachmentAad(objectKey) },
      await getCryptoKey(keyring, keyring.activeKeyId),
      plaintext
    )
  );

  const envelope = new Uint8Array(
    FILE_MAGIC.byteLength + 1 + keyIdBytes.byteLength + nonce.byteLength + ciphertext.byteLength
  );
  let offset = 0;
  envelope.set(FILE_MAGIC, offset);
  offset += FILE_MAGIC.byteLength;
  envelope[offset] = keyIdBytes.byteLength;
  offset += 1;
  envelope.set(keyIdBytes, offset);
  offset += keyIdBytes.byteLength;
  envelope.set(nonce, offset);
  offset += nonce.byteLength;
  envelope.set(ciphertext, offset);
  return envelope;
}

export async function decryptAttachment(
  source: EncryptionSource,
  value: unknown,
  objectKey: string
): Promise<DecryptedAttachment> {
  const bytes = toBytes(value);
  // 旧附件仍按原始字节返回，只对部署后新上传的加密信封做解密。
  if (!isEncryptedAttachment(bytes)) {
    return { bytes, encrypted: false, keyId: null };
  }

  const keyId = getAttachmentEnvelopeKeyId(bytes) as string;
  const keyIdLength = bytes[FILE_MAGIC.byteLength];
  const nonceOffset = FILE_MAGIC.byteLength + 1 + keyIdLength;
  const nonce = bytes.subarray(nonceOffset, nonceOffset + NONCE_BYTES);
  const ciphertext = bytes.subarray(nonceOffset + NONCE_BYTES);
  const keyring = loadEncryptionKeyring(source);

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: attachmentAad(objectKey) },
      await getCryptoKey(keyring, keyId),
      ciphertext
    );
    return { bytes: new Uint8Array(plaintext), encrypted: true, keyId };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Encryption key is unavailable:')) {
      throw error;
    }
    throw new Error('Encrypted attachment authentication failed');
  }
}
