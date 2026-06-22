-- Verified Slack identity for DM-to-me / @me when a user's Slack email differs from their
-- AUGMTD login. The user proves they control the Slack account via a one-time code DM'd by
-- the bot (verify-by-code) — unspoofable, no extra OAuth app. slack_user_id is the verified
-- member id; slack_verify holds the transient { code, target_id, target_name, expires_at }.
--
-- Apply manually in the Supabase SQL editor.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS slack_user_id text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS slack_verify  jsonb;
