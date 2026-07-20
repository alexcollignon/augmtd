-- Initiative Brain (S3) — the durable, LIVE per-initiative state. One row per (user, active initiative),
-- keyed by the stable normalized `initiative_key` so it exists BEFORE the user tracks it as a project.
-- Refreshed on ingestion (a new email / meeting / commitment on the initiative marks it stale → recompute).
-- The event ledger stays derived-on-read from the atoms; only the SYNTHESIZED state + next move are stored.

CREATE TABLE IF NOT EXISTS initiative_state (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  initiative_key   text NOT NULL,                       -- normalizeInitiative(label), despaced — stable id
  label            text NOT NULL,                       -- canonical display label
  project_id       uuid REFERENCES projects(id) ON DELETE SET NULL,  -- linked once tracked
  state            jsonb,                               -- { summary, momentum, whoOwes, stage, blocking }
  next_move        jsonb,                               -- { kind, title, owner, irreversible, entityRef, reason }
  people           jsonb,                               -- { external[], internal[] }
  quiet_days       int,
  sig              text,                                -- atom-signature for change-detection (skip unchanged)
  last_activity_at timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, initiative_key)
);

CREATE INDEX IF NOT EXISTS initiative_state_user_idx ON initiative_state (user_id);
CREATE INDEX IF NOT EXISTS initiative_state_project_idx ON initiative_state (project_id) WHERE project_id IS NOT NULL;

ALTER TABLE initiative_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS initiative_state_owner ON initiative_state;
CREATE POLICY initiative_state_owner ON initiative_state
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
