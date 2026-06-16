-- Add per-user enable/disable flag for workers
-- Workers start as disabled so users explicitly choose which ones to activate
ALTER TABLE custom_agents
  ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_custom_agents_worker_enabled
  ON custom_agents(user_id, is_enabled)
  WHERE is_worker = true;
