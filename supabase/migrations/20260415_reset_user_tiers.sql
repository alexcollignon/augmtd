-- AI tier is now managed at workspace level by superadmins.
-- Step 1: Backfill companies.ai_tier from existing member tier choices.
--   For each workspace, pick the most common non-standard tier among active members.
--   If all members are on standard (or no tenant_configs row exists), ai_tier stays NULL.
-- Step 2: Reset all individual user tiers to 'standard' — the factory now reads
--   from companies.ai_tier first, so the user-level field is no longer meaningful.

-- Step 1: backfill workspace ai_tier
UPDATE companies c
SET ai_tier = (
  SELECT tc.tier
  FROM company_members cm
  JOIN tenant_configs tc ON tc.user_id = cm.user_id
  WHERE cm.company_id = c.id
    AND cm.status = 'active'
    AND tc.tier != 'standard'
  GROUP BY tc.tier
  ORDER BY COUNT(*) DESC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM company_members cm
  JOIN tenant_configs tc ON tc.user_id = cm.user_id
  WHERE cm.company_id = c.id
    AND cm.status = 'active'
    AND tc.tier != 'standard'
);

-- Step 2: reset all user-level tiers to standard
UPDATE tenant_configs SET tier = 'standard' WHERE tier != 'standard';
