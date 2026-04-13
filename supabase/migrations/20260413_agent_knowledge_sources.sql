-- Links knowledge files to custom agents (agent-scoped KB).
CREATE TABLE IF NOT EXISTS agent_knowledge_sources (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id            UUID NOT NULL REFERENCES custom_agents(id) ON DELETE CASCADE,
  knowledge_file_id   UUID REFERENCES knowledge_files(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE agent_knowledge_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_knowledge_sources: owner full access" ON agent_knowledge_sources;
CREATE POLICY "agent_knowledge_sources: owner full access"
  ON agent_knowledge_sources
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM custom_agents
      WHERE custom_agents.id = agent_knowledge_sources.agent_id
        AND custom_agents.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM custom_agents
      WHERE custom_agents.id = agent_knowledge_sources.agent_id
        AND custom_agents.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS agent_knowledge_sources_agent_id_idx ON agent_knowledge_sources (agent_id);
