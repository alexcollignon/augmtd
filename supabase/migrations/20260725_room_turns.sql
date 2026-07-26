-- THE ONE ROOM — R1: durable room conversations (docs/one-room-plan.md).
-- The room's chat is the center of the execution surface; turns must survive reload and be
-- writable by the ENGINE (prepare narrations, coworker report-backs, send confirmations) while
-- the user is away. Keyed by room: the ENTITY id for deal rooms, `inbox:<id>` / `commitment:<id>`
-- / `meeting:<id>` for loose anchors (same convention as item_plans.entity_id judgment keys).
-- Apply manually in the Supabase dashboard SQL editor.

CREATE TABLE IF NOT EXISTS room_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room_key TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'system')),
  text TEXT NOT NULL,
  -- Live chips ({label, href}) rendered under the turn.
  refs JSONB,
  -- A turn CAN carry an inline component ({key, refId?, state?}) — resolved against the
  -- work-component registry by the stream renderer (R2). Durable like the words.
  component JSONB,
  -- Attribution for coworker turns ({kind:'coworker', id, name, role}); NULL = the chief of
  -- staff on 'system' turns. The group-channel model needs turns to carry WHO.
  author JSONB,
  -- The keyed-turn idiom: a write with the same dedupe_key REPLACES the prior turn (a re-clicked
  -- CTA re-surfaces its one line instead of stuttering duplicates).
  dedupe_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_room_turns_room
  ON room_turns (user_id, room_key, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_room_turns_dedupe
  ON room_turns (user_id, room_key, dedupe_key) WHERE dedupe_key IS NOT NULL;

ALTER TABLE room_turns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS room_turns_owner ON room_turns;
CREATE POLICY room_turns_owner ON room_turns
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
