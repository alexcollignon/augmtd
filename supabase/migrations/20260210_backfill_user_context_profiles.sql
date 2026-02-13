-- Backfill user_context_profiles for existing users
-- Ensures all users have a context profile with default values

-- Insert default context for users who don't have a profile yet
INSERT INTO user_context_profiles (user_id, context_data, created_at, updated_at)
SELECT
  u.id,
  jsonb_build_object(
    'communicationStyle', jsonb_build_object(
      'avgLength', 0,
      'toneVector', jsonb_build_object(
        'formal', 0.5,
        'casual', 0.5,
        'technical', 0.5,
        'friendly', 0.5,
        'direct', 0.5
      ),
      'formalityScore', 0.5,
      'greetingPatterns', '[]'::jsonb,
      'signatureStyle', null,
      'emojiUsage', 0,
      'commonPhrases', '[]'::jsonb
    ),
    'rolePatterns', jsonb_build_object(
      'respondsWhenInTo', 0.5,
      'respondsWhenInCC', 0.5,
      'mentionSensitivity', 0.5,
      'explicitAssignmentRate', 0.5,
      'positionSensitivity', jsonb_build_object(
        'primary', 0.5,
        'secondary', 0.5,
        'cc', 0.5
      )
    ),
    'urgencySensitivity', jsonb_build_object(
      'thresholdScore', 0.5,
      'avgResponseTime', 0,
      'deadlineAdherence', 0.5,
      'urgencyKeywords', '[]'::jsonb
    ),
    'relationshipGraph', '{}'::jsonb,
    'delegationBehavior', jsonb_build_object(
      'delegationRate', 0,
      'typicalTargets', '[]'::jsonb,
      'delegationTriggers', '[]'::jsonb,
      'neverDelegates', '[]'::jsonb
    ),
    'confidenceMetrics', jsonb_build_object(
      'overallScore', 0,
      'signalCount', 0,
      'lastUpdated', NOW(),
      'dimensionConfidence', jsonb_build_object(
        'communicationStyle', 0,
        'rolePatterns', 0,
        'urgencySensitivity', 0,
        'relationshipGraph', 0,
        'delegationBehavior', 0
      )
    )
  ),
  NOW(),
  NOW()
FROM auth.users u
LEFT JOIN user_context_profiles ucp ON u.id = ucp.user_id
WHERE ucp.user_id IS NULL;

-- Log results
DO $$
DECLARE
  backfilled_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO backfilled_count
  FROM auth.users u
  INNER JOIN user_context_profiles ucp ON u.id = ucp.user_id
  WHERE ucp.created_at = ucp.updated_at;

  RAISE NOTICE 'Backfilled % user context profiles with default values', backfilled_count;
END $$;
