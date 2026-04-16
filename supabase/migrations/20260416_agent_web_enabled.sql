-- Add web_enabled flag to custom_agents
-- When true, the agent's chat sessions default to web search enabled
ALTER TABLE custom_agents ADD COLUMN web_enabled boolean NOT NULL DEFAULT false;
