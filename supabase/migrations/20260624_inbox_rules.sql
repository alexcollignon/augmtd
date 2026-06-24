-- Email triage rules (Serif-style). A rule = trigger + conditions + outcome, ordered by
-- priority (first match wins). Conditions are deterministic Filters (conditions jsonb) OR an
-- AI-match description (ai_match text). Labels/types are fixed; rules are user-editable.
-- Defaults are seeded per user on first use; source distinguishes default vs user vs workspace.
CREATE TABLE IF NOT EXISTS inbox_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  priority    INTEGER NOT NULL DEFAULT 100,          -- lower = evaluated first
  trigger     TEXT NOT NULL DEFAULT 'received',       -- 'received' | 'sent'
  match_mode  TEXT NOT NULL DEFAULT 'all',            -- 'all' | 'any' (for filters)
  conditions  JSONB NOT NULL DEFAULT '[]'::jsonb,     -- [{ field, value }] for deterministic rules
  ai_match    TEXT,                                   -- natural-language match (null = deterministic)
  outcome     JSONB NOT NULL DEFAULT '{}'::jsonb,     -- { set_type, auto_draft{enabled,instructions}, mark_read, archive, forward_to, escalate{enabled,instructions}, trash }
  source      TEXT NOT NULL DEFAULT 'user',           -- 'default' | 'user' | 'workspace'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE inbox_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inbox_rules: owner full access" ON inbox_rules;
CREATE POLICY "inbox_rules: owner full access"
  ON inbox_rules FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS inbox_rules_user_priority_idx ON inbox_rules (user_id, enabled, priority);
