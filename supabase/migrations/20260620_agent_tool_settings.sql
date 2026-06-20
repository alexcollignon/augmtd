-- Per-worker tool settings: enable/disable a connected integration for a specific
-- coworker, plus optional per-worker config (e.g. a default Slack channel).
--
-- Model: connections are shared (company/user scope, in integration_connections);
-- THIS table is an enablement + config layer on top, per worker. No row for a
-- (agent, provider) pair = ENABLED by default (so connecting a tool makes it
-- available to every worker until someone narrows it).

CREATE TABLE IF NOT EXISTS agent_tool_settings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,   -- worker owner
  agent_id    UUID NOT NULL REFERENCES custom_agents(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL,                                  -- 'slack' | …
  enabled     BOOLEAN NOT NULL DEFAULT true,
  config      JSONB   NOT NULL DEFAULT '{}'::jsonb,            -- { default_channel, … }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, provider)
);

CREATE INDEX IF NOT EXISTS agent_tool_settings_agent_idx ON agent_tool_settings (agent_id);

ALTER TABLE agent_tool_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_tool_settings: owner full access" ON agent_tool_settings;
CREATE POLICY "agent_tool_settings: owner full access"
  ON agent_tool_settings
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
