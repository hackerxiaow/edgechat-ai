-- 群组权限控制
ALTER TABLE channels ADD COLUMN send_messages_permission TEXT NOT NULL DEFAULT 'all' CHECK (send_messages_permission IN ('all', 'owner'));
ALTER TABLE channels ADD COLUMN slow_mode_delay INTEGER NOT NULL DEFAULT 0 CHECK (slow_mode_delay >= 0);
ALTER TABLE channels ADD COLUMN history_visibility TEXT NOT NULL DEFAULT 'visible' CHECK (history_visibility IN ('visible', 'hidden'));
