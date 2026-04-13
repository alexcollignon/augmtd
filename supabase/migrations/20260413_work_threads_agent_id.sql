-- Scope work threads to a custom agent when created from an agent conversation.
ALTER TABLE work_threads
  ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES custom_agents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS work_threads_agent_id_idx ON work_threads (agent_id);
