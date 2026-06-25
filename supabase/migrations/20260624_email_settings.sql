-- Per-user email handling preferences (Drafting + Todo Capture toggles for the Email tab).
-- { auto_draft, auto_label, cc_bcc_new, todo_auto, todo_internal, todo_others, todo_instructions }
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email_settings JSONB;
