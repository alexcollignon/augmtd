-- Item plans — the "What this takes" graded task breakdown for a Home deep-dive (stage 2 of the
-- "actions follow intent" north star). One row per (user, item), holding the AI-generated list of
-- sub-tasks, each graded [System] (AUGMTD can do it) or [You] (needs the user). The [You] tasks carry
-- a per-task `done` bool so the user's checklist persists across visits. Generated once (get-or-
-- generate) and cached here; regenerating is cheap but we don't churn it.
--
-- ⚠️ APPLY MANUALLY in the Supabase dashboard SQL editor. There is no migration runner wired to
-- `npm run dev` — until this is applied, POST /api/items/plan will fail and the "What this takes"
-- section stays hidden (non-fatal: the deep-dive still works with just the stage-1 action bar).

CREATE TABLE IF NOT EXISTS item_plans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,              -- email | meeting | commitment | awareness | followup
  entity_id   TEXT NOT NULL,             -- id of the item this plan is for (text: ids may be non-uuid)
  tasks       JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{ id, text, actor, capability, done }]
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, entity_id)
);

CREATE INDEX IF NOT EXISTS item_plans_user_lookup_idx
  ON item_plans (user_id, kind, entity_id);

ALTER TABLE item_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "item_plans: owner select" ON item_plans;
CREATE POLICY "item_plans: owner select"
  ON item_plans FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "item_plans: owner insert" ON item_plans;
CREATE POLICY "item_plans: owner insert"
  ON item_plans FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "item_plans: owner update" ON item_plans;
CREATE POLICY "item_plans: owner update"
  ON item_plans FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
