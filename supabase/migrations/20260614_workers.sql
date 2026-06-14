-- Add worker fields to custom_agents
ALTER TABLE custom_agents
  ADD COLUMN is_worker  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN worker_role TEXT;

CREATE INDEX idx_custom_agents_worker ON custom_agents(user_id, is_worker) WHERE is_worker = true;
