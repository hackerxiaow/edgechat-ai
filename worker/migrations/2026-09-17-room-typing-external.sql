-- 「正在输入」需要同时表达本地用户与外部发送者（如 AI 机器人）。
-- 原表用 (channel_id, user_id) 作主键且外键指向 users，无法表示外部发送者；
-- 该表上线后一直为空，直接重建为通用形态。
DROP TABLE IF EXISTS room_typing;

CREATE TABLE IF NOT EXISTS room_typing (
  channel_id INTEGER NOT NULL,
  -- 本地用户为 'user:<id>'，外部发送者为 'external:<id>'，可同时表示两者。
  typer_key TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (channel_id, typer_key),
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_room_typing_channel_updated
ON room_typing(channel_id, updated_at);
