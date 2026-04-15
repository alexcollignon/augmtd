-- Phase 124: Studio — proactive agent workflows.
--
-- Drops the Processes system entirely and replaces it with Workflows:
-- trigger + ordered steps (tool / AI / agent) + output destination.
-- Each run creates a work_thread that becomes the workflow's timeline.

-- ─── 1. Drop Processes system ─────────────────────────────────────────────────

-- Drop FK columns on work_threads first so dropping processes doesn't cascade.
ALTER TABLE work_threads
  DROP COLUMN IF EXISTS process_id,
  DROP COLUMN IF EXISTS process_step_index;

DROP INDEX IF EXISTS idx_work_threads_process_id;

-- Drop all processes-related tables. Order matters: children first.
DROP TABLE IF EXISTS process_comments CASCADE;
DROP TABLE IF EXISTS process_steps    CASCADE;
DROP TABLE IF EXISTS process_notifications CASCADE;
DROP TABLE IF EXISTS processes CASCADE;

DROP TYPE IF EXISTS process_status;
DROP TYPE IF EXISTS process_step_status;

-- ─── 2. Workflows ─────────────────────────────────────────────────────────────

CREATE TABLE workflows (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  icon           TEXT NOT NULL DEFAULT 'sparkles',
  color          TEXT NOT NULL DEFAULT 'indigo',
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'active', 'paused')),
  -- trigger: { type: 'schedule'|'manual', cron?, timezone?, label? }
  trigger        JSONB NOT NULL DEFAULT '{"type":"manual"}'::jsonb,
  -- steps: ordered array of { type: 'tool'|'ai'|'agent', ... }
  steps          JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- output_config: { destination, artifact_type?, title_template?, notification_mode }
  output_config  JSONB NOT NULL DEFAULT '{"destination":"thread_message","notification_mode":"inbox_card"}'::jsonb,
  last_run_at    TIMESTAMPTZ,
  next_run_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflows_user_id      ON workflows(user_id);
CREATE INDEX idx_workflows_next_run_at  ON workflows(next_run_at)
  WHERE status = 'active' AND next_run_at IS NOT NULL;

CREATE TRIGGER update_workflows_updated_at BEFORE UPDATE ON workflows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── 3. Workflow runs ─────────────────────────────────────────────────────────

CREATE TABLE workflow_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id    UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  triggered_by   TEXT NOT NULL DEFAULT 'manual'
                 CHECK (triggered_by IN ('schedule', 'event', 'manual')),
  thread_id      UUID REFERENCES work_threads(id) ON DELETE SET NULL,
  step_outputs   JSONB NOT NULL DEFAULT '[]'::jsonb,
  error          TEXT,
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflow_runs_workflow_id ON workflow_runs(workflow_id, created_at DESC);
CREATE INDEX idx_workflow_runs_user_id     ON workflow_runs(user_id, created_at DESC);
CREATE INDEX idx_workflow_runs_status      ON workflow_runs(status) WHERE status IN ('queued', 'running');

-- ─── 4. Workflow notifications ────────────────────────────────────────────────

CREATE TABLE workflow_notifications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id  UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  workflow_id      UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  summary          TEXT,
  seen             BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflow_notifications_user_unseen
  ON workflow_notifications(user_id, created_at DESC)
  WHERE seen = FALSE;

-- ─── 5. work_threads.workflow_id ──────────────────────────────────────────────

ALTER TABLE work_threads
  ADD COLUMN IF NOT EXISTS workflow_id UUID REFERENCES workflows(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_work_threads_workflow_id
  ON work_threads(workflow_id) WHERE workflow_id IS NOT NULL;

-- ─── 6. RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE workflows              ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workflows_owner_all" ON workflows FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "workflow_runs_owner_read" ON workflow_runs FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "workflow_runs_owner_insert" ON workflow_runs FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Updates to workflow_runs happen via service role (executor), so no user update policy needed.

CREATE POLICY "workflow_notifications_owner_read" ON workflow_notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "workflow_notifications_owner_update" ON workflow_notifications FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ─── 7. Update delete_user_account RPC — drop processes reference ─────────────

CREATE OR REPLACE FUNCTION delete_user_account(target_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM agent_knowledge_sources
  WHERE agent_id IN (SELECT id FROM custom_agents WHERE user_id = target_user_id);
  DELETE FROM custom_agents WHERE user_id = target_user_id;

  DELETE FROM knowledge_chunks
  WHERE file_id IN (SELECT id FROM knowledge_files WHERE user_id = target_user_id);
  DELETE FROM knowledge_files   WHERE user_id = target_user_id;
  DELETE FROM knowledge_sources WHERE user_id = target_user_id;
  DELETE FROM drive_folders     WHERE user_id = target_user_id;

  -- Workflows (new in Phase 124, replaces processes)
  DELETE FROM workflow_notifications WHERE user_id = target_user_id;
  DELETE FROM workflow_runs          WHERE user_id = target_user_id;
  DELETE FROM workflows              WHERE user_id = target_user_id;

  DELETE FROM work_threads    WHERE user_id = target_user_id;
  DELETE FROM saved_workflows WHERE user_id = target_user_id;

  DELETE FROM emails       WHERE user_id = target_user_id;
  DELETE FROM inbox_items  WHERE user_id = target_user_id;

  DELETE FROM calendar_events    WHERE user_id = target_user_id;
  DELETE FROM meeting_recordings WHERE user_id = target_user_id;

  DELETE FROM learning_signals          WHERE user_id = target_user_id;
  DELETE FROM context_profiles          WHERE user_id = target_user_id;
  DELETE FROM user_context_profiles     WHERE user_id = target_user_id;
  DELETE FROM relationship_graph        WHERE user_id = target_user_id;
  DELETE FROM communication_embeddings  WHERE user_id = target_user_id;

  DELETE FROM connections     WHERE user_id = target_user_id;
  DELETE FROM mcp_connections WHERE user_id = target_user_id;

  DELETE FROM company_invitations WHERE invited_by = target_user_id;
  DELETE FROM company_members     WHERE user_id    = target_user_id;

  DELETE FROM tenant_configs WHERE user_id = target_user_id;
  DELETE FROM profiles       WHERE id      = target_user_id;

EXCEPTION
  WHEN undefined_table THEN
    RAISE WARNING 'delete_user_account: skipped a missing table for user %', target_user_id;
  WHEN OTHERS THEN
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_user_account(UUID) TO service_role;
