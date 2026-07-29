-- THE COMMIT DOOR's ledger (proactive-team W5, docs/proactive-team-plan.md).
-- One row per approved irreversible act: the idempotency claim (a double-approve or a retried
-- request can never double-send), the approval record (what was fired, by whom, with what payload),
-- and the result. Apply manually in the Supabase SQL editor. Code degrades gracefully pre-migration
-- (lib/work/commit-door.ts returns 'unavailable' and the route proceeds as before).

CREATE TABLE IF NOT EXISTS action_commits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  action_type TEXT NOT NULL,          -- 'calendar_invite' | 'forward' | future irreversible verbs
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,  -- the approved (possibly user-edited) params — the approval record
  result TEXT,                        -- the executor's status line, stamped after the commit
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)   -- the atomic claim: exactly one commit per key
);

ALTER TABLE action_commits ENABLE ROW LEVEL SECURITY;

CREATE POLICY action_commits_owner ON action_commits
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_action_commits_user ON action_commits (user_id, created_at DESC);
