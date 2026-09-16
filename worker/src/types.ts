// Worker 运行时绑定、Secrets 与 Hono 上下文的共享类型。
// 这里只放类型与常量，不产生运行时副作用，便于 .js 模块按需引入。

export interface AppBindings {
  /** D1 数据库：消息、会话、附件正文与迁移记录的唯一事实来源。 */
  DB: D1Database;
  /** 可选：旧部署的 KV 会话存储，缺省时回退到 D1 的 sessions 表。 */
  SESSIONS?: KVNamespace;
  /** 可选：旧部署的 R2 附件存储，缺省时附件正文直接落进 D1。 */
  FILES?: R2Bucket;
  /** Pages 静态资产绑定。 */
  ASSETS?: Fetcher;

  ADMIN_USERNAMES?: string;
  ALLOWED_FILE_TYPES?: string;
  MAX_FILE_SIZE?: string;
  MESSAGE_RETENTION_DAYS?: string;
  SOFT_DELETE_RETENTION_DAYS?: string;
  ORPHAN_UPLOAD_RETENTION_DAYS?: string;
  SITE_ORIGINS?: string;

  GC_BATCH_SIZE?: string;
  GC_MAX_BATCHES_PER_RUN?: string;
  GC_INTERNAL_OPERATION_BUDGET?: string;
  GC_D1_STATEMENT_BUDGET?: string;
  GC_R2_OPERATION_BUDGET?: string;
  R2_DELETE_MAX_RETRY?: string;

  EDGECHAT_ENCRYPTION_KEYRING?: string;
  EDGECHAT_ENCRYPTION_ACTIVE_KEY_ID?: string;
  /** EDGECHAT_ENCRYPTION_KEY_<n> 形式的增量密钥。 */
  [key: string]: unknown;
}

/** 校验通过后写入上下文、并在各路由间传递的会话快照。 */
export interface SessionUser {
  token: string;
  userId: number;
  username: string;
  displayName: string;
  bio?: string;
  avatarUrl: string;
  isAdmin: boolean;
  sessionVersion: number;
  /** 仅移动端设备会话存在。 */
  deviceSessionId?: string;
}

export interface AppVariables {
  session: SessionUser;
}

export type AppEnv = { Bindings: AppBindings; Variables: AppVariables };
