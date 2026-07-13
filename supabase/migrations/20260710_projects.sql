-- Projects — an AI-clustered (or manually-created) LENS that groups a user's real work (commitments,
-- inbox items, coworker threads, KB files) by initiative. A project is NOT a manual container you hand-
-- fill: it auto-populates from the unified work-item spine; you confirm/curate. `goals` + `rules` are
-- project-scoped intent + guardrails that COWORKERS respect when working inside the project (opt-in,
-- project-scoped) — distinct from company_goals (which NEVER reach coworkers). Owner-scoped RLS.
--
-- ⚠️ APPLY MANUALLY in the Supabase dashboard SQL editor. No migration runner is wired to `npm run dev`.

CREATE TABLE IF NOT EXISTS projects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id   UUID REFERENCES companies(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  goals        JSONB NOT NULL DEFAULT '[]'::jsonb,   -- array of strings: what the project is trying to achieve
  rules        JSONB NOT NULL DEFAULT '[]'::jsonb,   -- array of strings: how to work on it / what to avoid
  color        TEXT,                                  -- optional UI accent
  auto         BOOLEAN NOT NULL DEFAULT false,        -- AI-suggested cluster vs manually created
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS projects_user_idx ON projects (user_id, status, sort_order);

CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projects: owner all" ON projects;
CREATE POLICY "projects: owner all"
  ON projects FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── project_id on the clusterable atoms — the spine reads these to scope a project's WorkItems.
-- Nullable (unassigned = not in any project); ON DELETE SET NULL so removing a project un-clusters, never
-- deletes the underlying work. Indexed for the per-project filter.
ALTER TABLE commitments     ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE inbox_items     ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE work_threads    ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS commitments_project_idx     ON commitments (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inbox_items_project_idx     ON inbox_items (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS work_threads_project_idx    ON work_threads (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS knowledge_files_project_idx ON knowledge_files (project_id) WHERE project_id IS NOT NULL;
