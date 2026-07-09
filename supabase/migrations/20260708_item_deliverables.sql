-- Item deliverables — the per-item DELIVERABLE POOL (task-workflows S1). Every time a step of a Home
-- item's plan RUNS and produces something (an analysis, a fetched brief, a generated doc, a sent
-- record), it lands here as a durable, typed, queryable pool entry scoped to (user, item). Later steps
-- READ the pool as context so they build on prior steps' output instead of each running in isolation.
--
-- This is the substance under the "Identified tasks" panel: `item_plans.tasks` holds the cheap plan
-- (title · owner · state), while `item_deliverables` holds what running those steps actually PRODUCED.
-- A text deliverable lives inline in `content`; a document/file deliverable points at the heavy store
-- via `ref` (an artifact / knowledge_file / storage id) so the pool stays light.
--
-- ⚠️ APPLY MANUALLY in the Supabase dashboard SQL editor. There is no migration runner wired to
-- `npm run dev`. Until this is applied, running a system tool step falls back to the old single-LLM
-- behaviour (non-fatal — the pool write just no-ops and is logged).

CREATE TABLE IF NOT EXISTS item_deliverables (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,              -- item plan kind: email | meeting | commitment | awareness | followup
  entity_id   TEXT NOT NULL,             -- the item this deliverable belongs to (matches item_plans.entity_id)
  task_id     TEXT,                       -- the plan step that produced it (null = user upload); dedup key per item
  type        TEXT NOT NULL,              -- text | document | file | sent_record | draft
  title       TEXT,                       -- short label ("Research brief", "Cost estimate", "Pitch deck")
  content     TEXT,                       -- inline text (analysis / draft / research) — the poolable body
  ref         TEXT,                       -- id where a heavy body lives (artifact / knowledge_file / storage path)
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb, -- e.g. { gist, tool, sent_to, mime, source:'run'|'upload' }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-item lookup (the pool read at run time) + the dedup key (a step re-run replaces its own entry).
CREATE INDEX IF NOT EXISTS item_deliverables_lookup_idx
  ON item_deliverables (user_id, kind, entity_id);

ALTER TABLE item_deliverables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "item_deliverables: owner select" ON item_deliverables;
CREATE POLICY "item_deliverables: owner select"
  ON item_deliverables FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "item_deliverables: owner insert" ON item_deliverables;
CREATE POLICY "item_deliverables: owner insert"
  ON item_deliverables FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "item_deliverables: owner update" ON item_deliverables;
CREATE POLICY "item_deliverables: owner update"
  ON item_deliverables FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "item_deliverables: owner delete" ON item_deliverables;
CREATE POLICY "item_deliverables: owner delete"
  ON item_deliverables FOR DELETE
  USING (user_id = auth.uid());
