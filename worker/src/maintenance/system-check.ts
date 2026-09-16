import manifest from '../generated/schema-manifest.json' with { type: 'json' };
import { inspectSchema, type SchemaQuery } from './schema-contract.ts';

interface Database {
  prepare(sql: string): { all(): Promise<{ results: Awaited<ReturnType<SchemaQuery>> }> };
}
interface MaintenanceEnv {
  DB?: Database;
  SESSIONS?: { get(key: string): Promise<unknown> };
  FILES?: { list(options: { limit: number }): Promise<unknown> };
  [key: string]: unknown;
}
type CheckStatus = 'ok' | 'error' | 'missing' | 'disabled' | 'blocked';
interface Check {
  id: string;
  status: CheckStatus;
  code: string;
  durationMs: number;
  schema?: Awaited<ReturnType<typeof inspectSchema>>;
}

async function probe(id: string, operation: () => Promise<Partial<Check>>, timeoutMs: number): Promise<Check> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      operation(),
      new Promise<Partial<Check>>((resolve) => {
        timer = setTimeout(() => resolve({ status: 'error', code: 'timeout' }), timeoutMs);
      })
    ]);
    return { id, status: 'ok', code: 'reachable', ...result, durationMs: Date.now() - started };
  } catch {
    // 上游异常可能包含请求地址或凭据；只返回稳定诊断码，不透传 exception。
    return { id, status: 'error', code: 'request_failed', durationMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

function absent(id: string, optional = false): Check {
  return { id, status: optional ? 'disabled' : 'missing', code: optional ? 'not_enabled' : 'binding_missing', durationMs: 0 };
}

export function inspectEnvironment(env: MaintenanceEnv) {
  const present = (name: string) => typeof env[name] === 'string' && (env[name] as string).trim().length > 0;
  const encryptionPresent = present('EDGECHAT_ENCRYPTION_KEYRING') ||
    (present('EDGECHAT_ENCRYPTION_ACTIVE_KEY_ID') && Object.keys(env).some((key) => /^EDGECHAT_ENCRYPTION_KEY_\d+$/.test(key) && present(key)));
  return [
    { name: 'EDGECHAT_ENCRYPTION_KEYRING / EDGECHAT_ENCRYPTION_ACTIVE_KEY_ID + EDGECHAT_ENCRYPTION_KEY_N', required: true, present: encryptionPresent },
    ...['ADMIN_USERNAMES', 'MESSAGE_RETENTION_DAYS', 'SOFT_DELETE_RETENTION_DAYS', 'MAX_FILE_SIZE', 'ALLOWED_FILE_TYPES'].map((name) => ({ name, required: false, present: present(name) }))
  ];
}

export async function runSystemCheck(env: MaintenanceEnv, { timeoutMs = 8000 } = {}) {
  const started = Date.now();
  const database = async (): Promise<Check[]> => {
    if (!env.DB) return [absent('d1'), { id: 'schema', status: 'blocked', code: 'database_unavailable', durationMs: 0 }];
    const db = env.DB;
    const query: SchemaQuery = async (sql) => (await db.prepare(sql).all()).results;
    const connectivity = await probe('d1', async () => { await query('SELECT 1'); return {}; }, timeoutMs);
    if (connectivity.status !== 'ok') return [connectivity, { id: 'schema', status: 'blocked', code: 'database_unavailable', durationMs: 0 }];
    const schema = await probe('schema', async () => {
      const result = await inspectSchema(query, manifest);
      return { status: result.status === 'ok' ? 'ok' : 'error', code: result.status, schema: result };
    }, timeoutMs);
    return [connectivity, schema];
  };
  const [dbChecks, kv, r2] = await Promise.all([
    database(),
    env.SESSIONS ? probe('sessions', async () => { await env.SESSIONS?.get('__edgechat_health__'); return {}; }, timeoutMs) : absent('sessions'),
    env.FILES ? probe('files', async () => { await env.FILES?.list({ limit: 1 }); return {}; }, timeoutMs) : absent('files', true)
  ]);
  const environment = inspectEnvironment(env);
  const checks: Check[] = [...dbChecks, kv, r2, {
    id: 'environment', status: environment.some((item) => item.required && !item.present) ? 'missing' : 'ok',
    code: 'presence_only', durationMs: 0
  }];
  return {
    checkedAt: new Date().toISOString(), durationMs: Date.now() - started,
    status: checks.some((check) => ['error', 'missing', 'blocked'].includes(check.status)) ? 'error' : checks.some((check) => check.status === 'disabled') ? 'warning' : 'ok',
    version: `v${manifest.version}`, expectedMigration: manifest.migrations.at(-1)?.id ?? null,
    checks, environment
  };
}
