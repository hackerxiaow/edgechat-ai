-- 「正在输入」状态：每个 (房间, 用户) 一行，只做 upsert。
-- 行数被成员数天然限定，不需要 GC；过期由读取时的 updated_at 判断。
CREATE TABLE IF NOT EXISTS room_typing (
  channel_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (channel_id, user_id),
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_room_typing_channel_updated
ON room_typing(channel_id, updated_at);
