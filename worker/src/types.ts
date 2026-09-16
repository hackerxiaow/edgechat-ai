// Worker 运行时绑定、Secrets 与 Hono 上下文的共享类型。
// 这里只放类型与常量，不产生运行时副作用，便于 .js 模块按需引入。

export interface AppBindings {
  /** D1 数据库：消息、会话、附件正文与迁移记录的唯一事实来源。 */
  DB: D1Database;
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
  /** 惰性 GC 的最小间隔（分钟）；Pages 部署没有 Cron Triggers，靠请求路径触发。 */
  GC_MIN_INTERVAL_MINUTES?: string;

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
  /** 可选的显式过期时间；缺省时按 SESSION_TTL_SECONDS 计算。 */
  expiresAt?: string;
  /** 移动端设备会话标记为 'mobile'；网页会话不设置。 */
  sessionKind?: string;
}

/** 会话消息操作的统一入参：谁在哪个房间里做什么。 */
export interface RoomMeta {
  principal: SessionUser;
  room: {
    id: number | string;
    kind: string;
    name?: string;
  };
}

export interface AppVariables {
  session: SessionUser;
}

export type AppEnv = { Bindings: AppBindings; Variables: AppVariables };
