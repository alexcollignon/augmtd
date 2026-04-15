-- Add ai_tier column to companies table.
-- Superadmins set this via Platform Admin to control which AI provider tier
-- all users in a workspace use. NULL means 'standard' (default behaviour).
-- Individual users can no longer switch tiers themselves.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS ai_tier VARCHAR(50) DEFAULT NULL;
