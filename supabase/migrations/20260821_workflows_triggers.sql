-- THE RELAY CANVAS, W1 — THE WHEN BLOCK (docs/relay-canvas-plan.md, THE SCHEMA)
--
-- The EVENT DOORS. `workflows.trigger` stays authoritative for manual/schedule (and therefore for
-- next_run_at — the dispatcher's clock is untouched). This column carries the any-of list of doors:
--   [{ "type": "reaction", "source": "mail"|"file"|"meeting"|"workflow",
--      "when": "<judged condition>", "label": "<human>", "workflow_id": "<uuid, workflow source>" }]
--
-- Purely additive: every reader goes through normalizeTriggers() in lib/workflows/trigger-sources.ts,
-- which tolerates the column being absent, null, or holding unknown source keys (dropped, never
-- invented). Nothing breaks before this is applied — event doors simply cannot be authored yet.
--
-- Apply manually in the Supabase SQL editor (there is no migration runner wired to npm run dev).

-- NULLABLE, NO DEFAULT — deliberately: the fire doors discover candidates with
-- `or(trigger->>type.eq.reaction, triggers.not.is.null)`, so a null default keeps that read as
-- narrow as the legacy existence query it widens (a `DEFAULT '[]'` would make every workflow match).
ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS triggers JSONB;

CREATE INDEX IF NOT EXISTS workflows_with_doors_idx
  ON workflows (user_id)
  WHERE status = 'active' AND triggers IS NOT NULL;
