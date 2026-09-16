const MINUTE_MS = 60 * 1000;

/** 只读取封禁相关字段，避免把整行 users 形状耦合进来。 */
export interface UserBanFields {
  is_disabled?: unknown;
  disabled_until?: unknown;
}

export function activeUserSql(alias = ''): string {
  const prefix = alias ? `${alias}.` : '';
  // 到期时间直接在查询时判断，避免为少量时间偏差引入定时任务与额外写入。
  return `${prefix}is_disabled = 0
    AND (${prefix}disabled_until IS NULL OR datetime(${prefix}disabled_until) <= CURRENT_TIMESTAMP)`;
}

export function isUserDisabled(
  user: UserBanFields | null | undefined,
  now = Date.now(),
): boolean {
  if (Number(user?.is_disabled)) {
    return true;
  }

  const disabledUntil = Date.parse(String(user?.disabled_until || ''));
  return Number.isFinite(disabledUntil) && disabledUntil > now;
}

export function banExpiryFromMinutes(durationMinutes: number, now = Date.now()): string {
  return new Date(now + durationMinutes * MINUTE_MS).toISOString();
}

export interface ProjectedUserBan {
  isDisabled: boolean;
  isPermanentlyDisabled: boolean;
  disabledUntil: string | null;
}

export function projectUserBan(row: UserBanFields, now = Date.now()): ProjectedUserBan {
  const isPermanentlyDisabled = Boolean(Number(row.is_disabled));
  const disabledUntilTimestamp = Date.parse(String(row.disabled_until || ''));
  const disabledUntil = Number.isFinite(disabledUntilTimestamp) && disabledUntilTimestamp > now
    ? String(row.disabled_until)
    : null;

  return {
    isDisabled: isPermanentlyDisabled || Boolean(disabledUntil),
    isPermanentlyDisabled,
    disabledUntil
  };
}
