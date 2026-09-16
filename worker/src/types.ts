// Worker 运行时绑定、Secrets 与 Hono 上下文的共享类型。
// 这里只放类型与常量，不产生运行时副作用，便于 .js 模块按需引入。

export interface AppBindings {
  /** D1 数据库：消息、会话、附件正文与迁移记录的唯一事实来源。 */
  DB: D1Database;
  /** Pages 静态资产绑定。 */
  ASSETS?: Fetcher;

  /**
   * 引导管理员：账号不存在时按这两个变量创建，已存在则跳过。
   * 其余业务配置（上传限制、保留期、站点域名等）都在 site_settings 表里，
   * 由后台设置页维护，不再走环境变量。
   */
  EDGECHAT_ADMIN_USERNAME?: string;
  EDGECHAT_ADMIN_PASSWORD?: string;

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
