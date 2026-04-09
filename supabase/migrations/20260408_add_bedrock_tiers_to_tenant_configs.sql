-- Fix tenant_configs tier CHECK constraint.
-- The original constraint was created before bedrock_private and bedrock_optimised existed.
-- Both tiers were added to TypeScript types but never to the DB constraint, meaning
-- upserts for these tiers were silently rejected and users fell back to 'standard'.

ALTER TABLE tenant_configs DROP CONSTRAINT IF EXISTS tenant_configs_tier_check;

ALTER TABLE tenant_configs
  ADD CONSTRAINT tenant_configs_tier_check
  CHECK (tier IN (
    'standard',
    'professional',
    'private_shared',
    'private_client',
    'on_prem',
    'bedrock_private',
    'bedrock_optimised'
  ));
