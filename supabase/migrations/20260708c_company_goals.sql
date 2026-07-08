-- Company goals — admin-set strategic intent for the "Strategy" tab (Settings → Company).
--
-- ⚠️ HARD INVARIANT: this table's data (and the alignment synthesis derived from it) must
-- NEVER be threaded into any employee-facing coworker context path (buildWorkerRunContext,
-- dependencies.user_context, the native chat route's prompt assembly, or any Studio workflow
-- step). This is a deliberate trust boundary — coworkers stay each employee's own assistant,
-- never a compliance/steering layer. Goals are read only by admin-facing Strategy code
-- (app/api/company/goals/, app/api/company/alignment/, company-strategy-section.tsx).
--
-- ⚠️ APPLY MANUALLY in the Supabase dashboard SQL editor. There is no migration runner wired
-- to `npm run dev`.

CREATE TABLE IF NOT EXISTS company_goals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'goal' CHECK (kind IN ('north_star', 'goal')),
  title        TEXT NOT NULL,
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by   UUID NOT NULL REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_goals_company_idx ON company_goals (company_id, status);

CREATE TRIGGER trg_company_goals_updated_at
  BEFORE UPDATE ON company_goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE company_goals ENABLE ROW LEVEL SECURITY;

-- Reuses the existing is_company_admin(company_id) helper (supabase/migrations/20260317_companies.sql).
DROP POLICY IF EXISTS "company_goals: admin read" ON company_goals;
CREATE POLICY "company_goals: admin read"
  ON company_goals FOR SELECT
  USING (is_company_admin(company_id));

DROP POLICY IF EXISTS "company_goals: admin write" ON company_goals;
CREATE POLICY "company_goals: admin write"
  ON company_goals FOR ALL
  USING (is_company_admin(company_id))
  WITH CHECK (is_company_admin(company_id));
