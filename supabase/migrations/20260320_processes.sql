-- Process status types
CREATE TYPE process_status AS ENUM ('draft', 'active', 'completed', 'archived');
CREATE TYPE process_step_status AS ENUM ('pending', 'in_progress', 'completed', 'blocked', 'skipped');

-- Main process record
CREATE TABLE processes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  owner_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  description    TEXT,
  status         process_status NOT NULL DEFAULT 'draft',
  plan           JSONB,
  current_step   INT DEFAULT 0,
  due_date       TIMESTAMPTZ,
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-step runtime tracking
CREATE TABLE process_steps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  process_id      UUID NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  step_index      INT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  step_type       TEXT NOT NULL DEFAULT 'human',
  assignee_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  department      TEXT,
  status          process_step_status NOT NULL DEFAULT 'pending',
  input_type      TEXT,
  input_label     TEXT,
  input_data      JSONB,
  artifact        JSONB,
  tool            TEXT,
  tool_parameters JSONB,
  due_date        TIMESTAMPTZ,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  completed_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(process_id, step_index)
);

-- Team discussion
CREATE TABLE process_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  process_id  UUID NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  step_index  INT,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_processes_company_id ON processes(company_id);
CREATE INDEX idx_processes_status ON processes(status);
CREATE INDEX idx_process_steps_process_id ON process_steps(process_id);
CREATE INDEX idx_process_steps_assignee_id ON process_steps(assignee_id);
CREATE INDEX idx_process_comments_process_id ON process_comments(process_id);

-- Auto-update updated_at
CREATE TRIGGER update_processes_updated_at BEFORE UPDATE ON processes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_process_steps_updated_at BEFORE UPDATE ON process_steps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE processes ENABLE ROW LEVEL SECURITY;
ALTER TABLE process_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE process_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_members_read_processes" ON processes FOR SELECT
  USING (company_id IN (
    SELECT company_id FROM company_members WHERE user_id = auth.uid() AND status = 'active'
  ));

CREATE POLICY "company_members_insert_processes" ON processes FOR INSERT
  WITH CHECK (
    owner_id = auth.uid() AND
    company_id IN (SELECT company_id FROM company_members WHERE user_id = auth.uid() AND status = 'active')
  );

CREATE POLICY "process_owners_update" ON processes FOR UPDATE
  USING (owner_id = auth.uid() OR company_id IN (
    SELECT company_id FROM company_members
    WHERE user_id = auth.uid() AND status = 'active' AND role IN ('owner', 'admin')
  ));

CREATE POLICY "process_owners_delete" ON processes FOR DELETE
  USING (owner_id = auth.uid() OR company_id IN (
    SELECT company_id FROM company_members
    WHERE user_id = auth.uid() AND status = 'active' AND role IN ('owner', 'admin')
  ));

CREATE POLICY "company_members_all_steps" ON process_steps FOR ALL
  USING (process_id IN (SELECT id FROM processes));

CREATE POLICY "company_members_read_comments" ON process_comments FOR SELECT
  USING (process_id IN (SELECT id FROM processes));

CREATE POLICY "company_members_insert_comments" ON process_comments FOR INSERT
  WITH CHECK (user_id = auth.uid() AND process_id IN (SELECT id FROM processes));
