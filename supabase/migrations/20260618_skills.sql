-- ─── Worker skills ────────────────────────────────────────────────────────────
-- A skill is a curated, reusable prompt block describing HOW to produce a kind of
-- output (e.g. "LinkedIn voice", "Brand email tone"). Distinct from:
--   tasks   — what/when to do (workflows)
--   KB      — searchable documents (agent_knowledge_sources → knowledge_files)
--   memory  — passively learned context (custom_agents.memory_text)
-- Skills are user-owned (team-level library) and assigned to specific workers.
-- At runtime, a worker's assigned skills are injected into its prompt; each skill
-- carries a `when_to_use` hint so the worker applies the matching one per output
-- type (smart-auto application — no per-conversation picking).

CREATE TABLE IF NOT EXISTS skills (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id   UUID,                              -- reserved for future team sharing
  name         TEXT NOT NULL,                     -- "LinkedIn voice"
  when_to_use  TEXT,                              -- "When drafting LinkedIn posts"
  content      TEXT NOT NULL,                     -- the actual rules / style block
  source       TEXT NOT NULL DEFAULT 'manual',    -- manual | imported | extracted | chat
  icon         TEXT,
  color        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE skills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "skills: owner full access" ON skills;
CREATE POLICY "skills: owner full access"
  ON skills
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS skills_user_id_idx ON skills (user_id);

-- ── Assignment join (mirrors agent_knowledge_sources) ──────────────────────────
CREATE TABLE IF NOT EXISTS agent_skills (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID NOT NULL REFERENCES custom_agents(id) ON DELETE CASCADE,
  skill_id    UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, skill_id)
);

ALTER TABLE agent_skills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_skills: owner full access" ON agent_skills;
CREATE POLICY "agent_skills: owner full access"
  ON agent_skills
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM custom_agents
      WHERE custom_agents.id = agent_skills.agent_id
        AND custom_agents.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM custom_agents
      WHERE custom_agents.id = agent_skills.agent_id
        AND custom_agents.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS agent_skills_agent_id_idx ON agent_skills (agent_id);
CREATE INDEX IF NOT EXISTS agent_skills_skill_id_idx ON agent_skills (skill_id);
