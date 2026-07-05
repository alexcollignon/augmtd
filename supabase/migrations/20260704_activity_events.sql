-- Activity timeline — a chronological log of every action the user takes across the app
-- (replies sent, items marked done / dismissed, nudges sent, commitments resolved, senders muted).
-- Backs the /activity view. Logging is best-effort / non-fatal: a failed insert never breaks the
-- underlying action.
--
-- ⚠️ APPLY MANUALLY in the Supabase dashboard SQL editor. There is no migration runner wired to
-- `npm run dev` — until this is applied, logActivity() inserts no-op (caught) and the view is empty.

CREATE TABLE IF NOT EXISTS activity_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,              -- reply_sent | marked_done | dismissed | nudge_sent
                                           -- | commitment_done | commitment_dismissed | sender_muted
  title        TEXT NOT NULL,              -- human summary, e.g. "Replied to TECNICLIMA"
  entity_type  TEXT,                       -- 'inbox_item' | 'commitment' | 'sender' | ...
  entity_id    TEXT,                       -- id of the acted-on entity (text: ids may be non-uuid)
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_events_user_created_idx
  ON activity_events (user_id, created_at DESC);

ALTER TABLE activity_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_events: owner select" ON activity_events;
CREATE POLICY "activity_events: owner select"
  ON activity_events FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "activity_events: owner insert" ON activity_events;
CREATE POLICY "activity_events: owner insert"
  ON activity_events FOR INSERT
  WITH CHECK (user_id = auth.uid());
