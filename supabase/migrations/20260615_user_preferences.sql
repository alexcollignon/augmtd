-- Phase 189: Add user_preferences to custom_agents.
-- Separates the system layer (instructions — product-managed, never user-editable)
-- from the user layer (user_preferences — owner-editable personal context injected
-- alongside the system prompt at runtime).

ALTER TABLE custom_agents ADD COLUMN IF NOT EXISTS user_preferences TEXT;
