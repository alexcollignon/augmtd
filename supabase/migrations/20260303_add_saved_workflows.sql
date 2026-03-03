CREATE TABLE saved_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  deliverable_types TEXT[] NOT NULL DEFAULT '{}',
  created_from_thread_id UUID REFERENCES work_threads(id) ON DELETE SET NULL,
  usage_count INT NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE work_threads
  ADD COLUMN IF NOT EXISTS saved_workflow_id UUID REFERENCES saved_workflows(id) ON DELETE SET NULL;

ALTER TABLE saved_workflows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_saved_workflows" ON saved_workflows
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_saved_workflows_user_id ON saved_workflows(user_id);
