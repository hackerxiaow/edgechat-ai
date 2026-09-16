-- 在线状态：每个用户一行心跳，超过窗口未刷新即视为离线。
-- 行数等于用户数，不需要 GC；过期由读取时判断。
CREATE TABLE IF NOT EXISTS user_presence (
  user_id INTEGER PRIMARY KEY,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_presence_updated
ON user_presence(updated_at);
