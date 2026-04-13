ALTER TABLE custom_agents
  ADD COLUMN IF NOT EXISTS conversation_starters text[] DEFAULT NULL;
