-- Cache the workers team-home briefing per user so it isn't regenerated on
-- every /workers visit. Invalidated (regenerated) when there's newer team
-- activity than generated_at — same staleness model as custom_agents.home_briefing.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS team_briefing JSONB DEFAULT NULL;
-- Shape: { text: string, generated_at: string (ISO) }
