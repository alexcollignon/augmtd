-- Phase 189: Link workflows to workers (custom_agents with is_worker = true).
-- Adds agent_id FK so a workflow can be "owned" by a worker and surfaced in
-- that worker's Routines tab rather than only in the Studio page.

ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES custom_agents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_workflows_agent_id ON workflows(agent_id)
  WHERE agent_id IS NOT NULL;
