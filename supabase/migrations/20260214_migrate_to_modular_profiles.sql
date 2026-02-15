-- ==========================================
-- Migration: Modular Context Profiles
-- Date: 2026-02-14
-- Purpose: Split monolithic user_context_profiles into modular context_profiles
-- ==========================================

-- ==========================================
-- STEP 1: Create new context_profiles table
-- ==========================================

CREATE TABLE IF NOT EXISTS context_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Profile type: what kind of context this stores
  profile_type TEXT NOT NULL,
  -- Valid types: 'identity', 'email_communication', 'domain_knowledge'
  -- Future: 'slack_communication', 'meeting_behavior', 'work_patterns'

  -- The actual profile data (structure varies by profile_type)
  profile_data JSONB NOT NULL,

  -- Learning metadata
  confidence_score DECIMAL(5,2) DEFAULT 0.00,
  learned_from_count INTEGER DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_updated TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT valid_profile_type CHECK (profile_type IN (
    'identity',
    'email_communication',
    'domain_knowledge',
    'slack_communication',
    'meeting_behavior',
    'work_patterns'
  )),
  CONSTRAINT valid_confidence CHECK (confidence_score >= 0 AND confidence_score <= 100),
  UNIQUE(user_id, profile_type)
);

-- Indexes for fast lookups
CREATE INDEX idx_context_profiles_user ON context_profiles(user_id);
CREATE INDEX idx_context_profiles_user_type ON context_profiles(user_id, profile_type);
CREATE INDEX idx_context_profiles_type ON context_profiles(profile_type);

-- Comments
COMMENT ON TABLE context_profiles IS 'Modular user context profiles - each profile type stores specific learned behavior';
COMMENT ON COLUMN context_profiles.profile_type IS 'Type of context: identity, email_communication, domain_knowledge, etc.';
COMMENT ON COLUMN context_profiles.profile_data IS 'JSONB data structure (varies by profile_type)';
COMMENT ON COLUMN context_profiles.confidence_score IS 'Learning confidence 0-100 (higher = more learned)';
COMMENT ON COLUMN context_profiles.learned_from_count IS 'Number of learning signals that contributed to this profile';

-- ==========================================
-- STEP 2: Enable RLS on new table
-- ==========================================

ALTER TABLE context_profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own context profiles
CREATE POLICY "Users can read own context profiles"
  ON context_profiles FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own context profiles
CREATE POLICY "Users can insert own context profiles"
  ON context_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own context profiles
CREATE POLICY "Users can update own context profiles"
  ON context_profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own context profiles
CREATE POLICY "Users can delete own context profiles"
  ON context_profiles FOR DELETE
  USING (auth.uid() = user_id);

-- ==========================================
-- STEP 3: Create trigger for updated_at
-- ==========================================

CREATE TRIGGER update_context_profiles_updated_at
  BEFORE UPDATE ON context_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ==========================================
-- STEP 4: Migration helper functions
-- ==========================================

-- Function to extract identity profile from old context
CREATE OR REPLACE FUNCTION extract_identity_profile(old_context JSONB)
RETURNS JSONB AS $$
DECLARE
  identity JSONB;
BEGIN
  identity := jsonb_build_object(
    'fullName', COALESCE(old_context->'rolePatterns'->>'primaryRole', 'Unknown'),
    'role', COALESCE(old_context->'rolePatterns'->>'primaryRole', ''),
    'email', '',  -- Will be filled from profiles table
    'responsibilities', COALESCE(old_context->'rolePatterns'->'responsibilities', '[]'::jsonb),
    'authority', COALESCE(old_context->'rolePatterns'->>'decisionMakingLevel', 'unknown')
  );

  RETURN identity;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to extract email communication profile from old context
CREATE OR REPLACE FUNCTION extract_email_communication_profile(old_context JSONB)
RETURNS JSONB AS $$
DECLARE
  email_comm JSONB;
BEGIN
  email_comm := jsonb_build_object(
    'signature', old_context->'communicationStyle'->>'signatureStyle',
    'greetingPatterns', COALESCE(old_context->'communicationStyle'->'greetingPatterns', '[]'::jsonb),
    'tone', COALESCE((old_context->'communicationStyle'->'toneVector'->>'formal')::decimal, 0.5),
    'formalityScore', COALESCE((old_context->'communicationStyle'->>'formalityScore')::decimal, 0.5),
    'avgLength', COALESCE((old_context->'communicationStyle'->>'avgLength')::integer, 0),
    'emojiUsage', COALESCE((old_context->'communicationStyle'->>'emojiUsage')::decimal, 0),
    'commonPhrases', COALESCE(old_context->'communicationStyle'->'commonPhrases', '[]'::jsonb),
    'responsePatterns', jsonb_build_object(
      'avgResponseTime', COALESCE((old_context->'urgencySensitivity'->>'avgResponseTime')::integer, 0),
      'priorityAdjustments', '{}'::jsonb
    )
  );

  RETURN email_comm;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to extract domain knowledge profile from old context
CREATE OR REPLACE FUNCTION extract_domain_knowledge_profile(old_context JSONB)
RETURNS JSONB AS $$
DECLARE
  domain_knowledge JSONB;
BEGIN
  domain_knowledge := jsonb_build_object(
    'vocabulary', COALESCE(old_context->'domainKnowledge'->'vocabulary', '{}'::jsonb),
    'workflows', COALESCE(old_context->'domainKnowledge'->'workflows', '[]'::jsonb),
    'expertise', COALESCE(old_context->'domainKnowledge'->'expertise', '[]'::jsonb)
  );

  RETURN domain_knowledge;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ==========================================
-- STEP 5: Migrate existing data
-- ==========================================

DO $$
DECLARE
  user_record RECORD;
  identity_data JSONB;
  email_comm_data JSONB;
  domain_data JSONB;
  user_email TEXT;
  email_comm_confidence DECIMAL;
  email_comm_signals INTEGER;
BEGIN
  RAISE NOTICE 'Starting migration of user_context_profiles to context_profiles...';

  -- Loop through all existing user context profiles
  FOR user_record IN
    SELECT
      ucp.user_id,
      ucp.context_data,
      ucp.confidence_score,
      ucp.total_interactions,
      p.email,
      p.full_name
    FROM user_context_profiles ucp
    LEFT JOIN profiles p ON p.id = ucp.user_id
  LOOP
    -- Get user email
    user_email := COALESCE(user_record.email, '');

    -- Calculate email communication confidence and signal count
    email_comm_confidence := COALESCE(
      (user_record.context_data->'confidenceMetrics'->'dimensionConfidence'->>'communicationStyle')::decimal * 100,
      0
    );
    email_comm_signals := COALESCE(
      (user_record.context_data->'confidenceMetrics'->>'signalCount')::integer,
      0
    );

    -- Extract identity profile
    identity_data := extract_identity_profile(user_record.context_data);
    identity_data := jsonb_set(identity_data, '{email}', to_jsonb(user_email));
    identity_data := jsonb_set(identity_data, '{fullName}', to_jsonb(COALESCE(user_record.full_name, 'Unknown')));

    -- Extract email communication profile
    email_comm_data := extract_email_communication_profile(user_record.context_data);

    -- Extract domain knowledge profile
    domain_data := extract_domain_knowledge_profile(user_record.context_data);

    -- Insert identity profile
    INSERT INTO context_profiles (
      user_id,
      profile_type,
      profile_data,
      confidence_score,
      learned_from_count,
      created_at,
      last_updated
    ) VALUES (
      user_record.user_id,
      'identity',
      identity_data,
      95.00,  -- High confidence - explicit from onboarding
      1,
      NOW(),
      NOW()
    )
    ON CONFLICT (user_id, profile_type) DO UPDATE
    SET
      profile_data = EXCLUDED.profile_data,
      last_updated = NOW();

    -- Insert email communication profile
    INSERT INTO context_profiles (
      user_id,
      profile_type,
      profile_data,
      confidence_score,
      learned_from_count,
      created_at,
      last_updated
    ) VALUES (
      user_record.user_id,
      'email_communication',
      email_comm_data,
      email_comm_confidence,
      email_comm_signals,
      NOW(),
      NOW()
    )
    ON CONFLICT (user_id, profile_type) DO UPDATE
    SET
      profile_data = EXCLUDED.profile_data,
      confidence_score = EXCLUDED.confidence_score,
      learned_from_count = EXCLUDED.learned_from_count,
      last_updated = NOW();

    -- Insert domain knowledge profile
    INSERT INTO context_profiles (
      user_id,
      profile_type,
      profile_data,
      confidence_score,
      learned_from_count,
      created_at,
      last_updated
    ) VALUES (
      user_record.user_id,
      'domain_knowledge',
      domain_data,
      0.00,  -- Low confidence - not learned yet
      0,
      NOW(),
      NOW()
    )
    ON CONFLICT (user_id, profile_type) DO UPDATE
    SET
      profile_data = EXCLUDED.profile_data,
      last_updated = NOW();

    RAISE NOTICE 'Migrated user: % (% profiles)', user_record.user_id, 3;
  END LOOP;

  RAISE NOTICE 'Migration complete!';
END $$;

-- ==========================================
-- STEP 6: Validation queries
-- ==========================================

-- Check migration results
DO $$
DECLARE
  old_count INTEGER;
  new_count INTEGER;
  profile_type_counts TEXT;
BEGIN
  -- Count old profiles
  SELECT COUNT(*) INTO old_count FROM user_context_profiles;

  -- Count new profiles (should be 3x old_count)
  SELECT COUNT(*) INTO new_count FROM context_profiles;

  -- Get breakdown by type
  SELECT string_agg(profile_type || ': ' || count::text, ', ')
  INTO profile_type_counts
  FROM (
    SELECT profile_type, COUNT(*) as count
    FROM context_profiles
    GROUP BY profile_type
    ORDER BY profile_type
  ) counts;

  RAISE NOTICE '=== MIGRATION VALIDATION ===';
  RAISE NOTICE 'Old user_context_profiles count: %', old_count;
  RAISE NOTICE 'New context_profiles count: %', new_count;
  RAISE NOTICE 'Profile type breakdown: %', profile_type_counts;
  RAISE NOTICE 'Expected: % profiles (% × 3 types)', old_count * 3, old_count;

  IF new_count = old_count * 3 THEN
    RAISE NOTICE '✓ Migration successful!';
  ELSE
    RAISE WARNING '⚠ Profile count mismatch - please review';
  END IF;
END $$;

-- ==========================================
-- STEP 7: Create helper views
-- ==========================================

-- View to see all profiles for a user (easier debugging)
CREATE OR REPLACE VIEW user_profiles_summary AS
SELECT
  user_id,
  jsonb_object_agg(
    profile_type,
    jsonb_build_object(
      'confidence', confidence_score,
      'signals', learned_from_count,
      'last_updated', last_updated
    )
  ) as profiles_summary
FROM context_profiles
GROUP BY user_id;

COMMENT ON VIEW user_profiles_summary IS 'Summary view of all context profiles per user';

-- ==========================================
-- STEP 8: Cleanup (COMMENTED - Run manually after validation)
-- ==========================================

-- After validating migration is successful, you can:

-- 1. Rename old table (keep as backup)
-- ALTER TABLE user_context_profiles RENAME TO user_context_profiles_backup;

-- 2. Drop old table (after confirming everything works)
-- DROP TABLE user_context_profiles_backup;

-- 3. Remove deprecated context_learning_events table
-- DROP TABLE IF EXISTS context_learning_events;

-- ==========================================
-- ROLLBACK SCRIPT (if needed)
-- ==========================================

-- Uncomment and run this if you need to rollback:

/*
-- Drop new table
DROP TABLE IF EXISTS context_profiles CASCADE;

-- Drop helper functions
DROP FUNCTION IF EXISTS extract_identity_profile(JSONB);
DROP FUNCTION IF EXISTS extract_email_communication_profile(JSONB);
DROP FUNCTION IF EXISTS extract_domain_knowledge_profile(JSONB);

-- Drop view
DROP VIEW IF EXISTS user_profiles_summary;

-- Restore from backup (if renamed)
-- ALTER TABLE user_context_profiles_backup RENAME TO user_context_profiles;
*/

-- ==========================================
-- END OF MIGRATION
-- ==========================================

-- Display final summary
SELECT
  'Migration complete!' as status,
  COUNT(DISTINCT user_id) as users_migrated,
  COUNT(*) as total_profiles_created
FROM context_profiles;
