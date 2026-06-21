-- Remove the per-worker Slack "default channel" setting — it confused users.
-- Strips the default_channel key from any agent_tool_settings.config jsonb; rows whose
-- config becomes empty are left as-is (an empty config still means "tool enabled").
--
-- Apply manually in the Supabase SQL editor.

update agent_tool_settings
set config = config - 'default_channel'
where config ? 'default_channel';
