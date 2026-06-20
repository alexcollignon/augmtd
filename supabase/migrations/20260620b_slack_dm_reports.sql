-- Per-user opt-in: also deliver coworker report-backs as a real Slack DM
-- (from the coworker persona), in addition to the in-app DM card. Default off.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS slack_dm_reports BOOLEAN NOT NULL DEFAULT false;
