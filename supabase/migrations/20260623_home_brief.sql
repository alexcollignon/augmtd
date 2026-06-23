-- Cache for the Home daily-brief line (mirrors profiles.team_briefing). { text, generated_at }.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS home_brief JSONB;
