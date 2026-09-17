ALTER TABLE messages ADD COLUMN edited_at TEXT;
ALTER TABLE messages ADD COLUMN forward_from_name TEXT;

CREATE TABLE IF NOT EXISTS message_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (message_id, user_id, emoji),
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message
ON message_reactions(message_id);

CREATE INDEX IF NOT EXISTS idx_message_reactions_user
ON message_reactions(user_id, message_id);

CREATE TRIGGER IF NOT EXISTS record_reaction_added_event
AFTER INSERT ON message_reactions
BEGIN
  INSERT INTO message_events (channel_id, message_id, event_type)
  VALUES (NEW.channel_id, NEW.message_id, 'created');
END;

CREATE TRIGGER IF NOT EXISTS record_reaction_removed_event
AFTER DELETE ON message_reactions
BEGIN
  INSERT INTO message_events (channel_id, message_id, event_type)
  VALUES (OLD.channel_id, OLD.message_id, 'created');
END;

CREATE TRIGGER IF NOT EXISTS record_message_edited_event
AFTER UPDATE OF edited_at ON messages
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NULL AND NEW.edited_at IS NOT NULL
BEGIN
  INSERT INTO message_events (channel_id, message_id, event_type)
  VALUES (NEW.channel_id, NEW.id, 'created');
END;
