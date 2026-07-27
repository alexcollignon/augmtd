-- THE ONE ROOM — conversation history (Claude-style History dropdown, docs/one-room-plan.md).
-- "Clear" becomes ARCHIVE: a session boundary, not a deletion. Live view = archived_at IS NULL;
-- History lists archived sessions (turns sharing an archived_at batch). Apply manually.
ALTER TABLE room_turns ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_room_turns_archived ON room_turns (user_id, room_key, archived_at);
