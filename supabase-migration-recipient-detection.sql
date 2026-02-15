-- ==========================================
-- AUGMTD Recipient Detection Migration
-- Run this in: Supabase Dashboard → SQL Editor
-- ==========================================
-- Adds recipient detection, work signals, and probabilistic confidence tracking

-- ==========================================
-- 1. ADD RECIPIENT CONTEXT TO INBOX ITEMS
-- ==========================================

-- Add recipient_context column for storing recipient analysis
ALTER TABLE inbox_items
ADD COLUMN IF NOT EXISTS recipient_context JSONB DEFAULT '{}';

-- Add user_action column for tracking what user did with the item
ALTER TABLE inbox_items
ADD COLUMN IF NOT EXISTS user_action JSONB;

COMMENT ON COLUMN inbox_items.recipient_context IS
'Recipient analysis data: detected role, position, work signals, confidence breakdown, etc.';

COMMENT ON COLUMN inbox_items.user_action IS
'User action data: action taken, timestamp, modifications, reassignments, etc.';

-- ==========================================
-- 2. CREATE INDEXES FOR RECIPIENT QUERIES
-- ==========================================

-- Index for querying by recipient role
CREATE INDEX IF NOT EXISTS idx_inbox_recipient_role
ON inbox_items((recipient_context->>'detectedRole'))
WHERE recipient_context IS NOT NULL;

-- Index for querying by user action type
CREATE INDEX IF NOT EXISTS idx_inbox_user_action
ON inbox_items((user_action->>'action'))
WHERE user_action IS NOT NULL;

-- Index for confidence-based queries
CREATE INDEX IF NOT EXISTS idx_inbox_confidence
ON inbox_items(confidence_score DESC)
WHERE confidence_score IS NOT NULL;

-- ==========================================
-- 3. ADD ORGANIZATION CONTEXT PROFILES
-- ==========================================

-- Organization context profile (shared learning across users)
CREATE TABLE IF NOT EXISTS organization_context_profiles (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,

  -- Industry & domain knowledge
  industry TEXT,
  domain_knowledge JSONB DEFAULT '{}',

  -- Company-level patterns (learned from all users)
  company_patterns JSONB DEFAULT '{}',

  -- Aggregate metrics
  total_users INTEGER DEFAULT 0,
  total_interactions INTEGER DEFAULT 0,
  confidence_score INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_updated TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT org_confidence_range CHECK (confidence_score >= 0 AND confidence_score <= 100)
);

COMMENT ON TABLE organization_context_profiles IS
'Organization-level context: shared knowledge, patterns, vocabulary learned from all users';

COMMENT ON COLUMN organization_context_profiles.domain_knowledge IS
'Industry knowledge: vocabulary, workflows, client types, project patterns';

COMMENT ON COLUMN organization_context_profiles.company_patterns IS
'Company patterns: communication norms, document patterns, approval workflows';

-- ==========================================
-- 4. ENHANCE USER CONTEXT PROFILES
-- ==========================================

-- Add signal-based response patterns
ALTER TABLE user_context_profiles
ADD COLUMN IF NOT EXISTS signal_responses JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS position_behavior JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS role_frequency JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS relationship_behavior JSONB DEFAULT '{}';

COMMENT ON COLUMN user_context_profiles.signal_responses IS
'Probabilistic patterns: P(user acts | signal pattern), organized by signal combinations';

COMMENT ON COLUMN user_context_profiles.position_behavior IS
'Behavior by email position: to/cc/bcc action rates, response times, sample sizes';

COMMENT ON COLUMN user_context_profiles.role_frequency IS
'Role frequency and behavior: how often user has each role, action rates per role';

COMMENT ON COLUMN user_context_profiles.relationship_behavior IS
'Sender-specific behavior patterns: action rates, response times per sender';

-- ==========================================
-- 5. ENHANCE LEARNING EVENTS
-- ==========================================

-- Add learning level and pattern extracted
ALTER TABLE context_learning_events
ADD COLUMN IF NOT EXISTS learning_level TEXT CHECK (learning_level IN ('user', 'organization')),
ADD COLUMN IF NOT EXISTS pattern_extracted TEXT,
ADD COLUMN IF NOT EXISTS signal_pattern TEXT;

COMMENT ON COLUMN context_learning_events.learning_level IS
'Whether learning applies to user or organization level';

COMMENT ON COLUMN context_learning_events.pattern_extracted IS
'Human-readable pattern extracted from this event';

COMMENT ON COLUMN context_learning_events.signal_pattern IS
'Encoded signal pattern key for probabilistic matching';

-- Index for pattern queries
CREATE INDEX IF NOT EXISTS idx_learning_signal_pattern
ON context_learning_events(signal_pattern)
WHERE signal_pattern IS NOT NULL;

-- ==========================================
-- 6. ADD RECIPIENT DETECTION METADATA TABLE
-- ==========================================

-- Store recipient detection accuracy metrics
CREATE TABLE IF NOT EXISTS recipient_detection_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,

  -- Detection accuracy
  total_detections INTEGER DEFAULT 0,
  correct_detections INTEGER DEFAULT 0,
  user_corrections INTEGER DEFAULT 0,

  -- Role accuracy by type
  role_accuracy JSONB DEFAULT '{}',

  -- Signal detection accuracy
  signal_accuracy JSONB DEFAULT '{}',

  -- Confidence calibration
  confidence_calibration JSONB DEFAULT '{}',

  -- Time range
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, week_start)
);

COMMENT ON TABLE recipient_detection_metrics IS
'Weekly metrics for recipient detection accuracy and confidence calibration';

CREATE INDEX idx_detection_metrics_user_week
ON recipient_detection_metrics(user_id, week_start DESC);

-- ==========================================
-- 7. ADD HELPER FUNCTIONS
-- ==========================================

-- Function to calculate statistical confidence based on sample size
CREATE OR REPLACE FUNCTION calculate_statistical_confidence(sample_size INTEGER)
RETURNS NUMERIC AS $$
BEGIN
  -- Confidence increases with sample size (law of large numbers)
  -- Uses sigmoid function: approaches 1 as n → ∞
  -- 20 samples ≈ 63% confidence, 50 samples ≈ 92% confidence
  RETURN 1 - EXP(-sample_size / 20.0);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION calculate_statistical_confidence IS
'Calculate statistical confidence score (0-1) based on sample size using sigmoid function';

-- Function to encode signal pattern as string key
CREATE OR REPLACE FUNCTION encode_signal_pattern(work_signals JSONB)
RETURNS TEXT AS $$
DECLARE
  pattern TEXT := '';
BEGIN
  -- Build pattern key from boolean signals
  IF (work_signals->>'hasObligation')::BOOLEAN THEN pattern := pattern || 'O'; END IF;
  IF (work_signals->>'requiresJudgment')::BOOLEAN THEN pattern := pattern || 'J'; END IF;
  IF (work_signals->>'requiresDecision')::BOOLEAN THEN pattern := pattern || 'D'; END IF;
  IF (work_signals->>'hasDeadline')::BOOLEAN THEN pattern := pattern || 'T'; END IF;
  IF (work_signals->>'isTaskAssignment')::BOOLEAN THEN pattern := pattern || 'A'; END IF;
  IF (work_signals->>'isNegotiation')::BOOLEAN THEN pattern := pattern || 'N'; END IF;
  IF (work_signals->>'requiresApproval')::BOOLEAN THEN pattern := pattern || 'P'; END IF;
  IF (work_signals->>'isDelegation')::BOOLEAN THEN pattern := pattern || 'L'; END IF;
  IF (work_signals->>'informationalOnly')::BOOLEAN THEN pattern := pattern || 'I'; END IF;

  RETURN CASE WHEN pattern = '' THEN 'NONE' ELSE pattern END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION encode_signal_pattern IS
'Encode work signals into compact pattern key (e.g., "OJT" = obligation + judgment + deadline)';

-- Function to get user's action rate for a signal pattern
CREATE OR REPLACE FUNCTION get_user_action_rate(
  p_user_id UUID,
  p_signal_pattern TEXT,
  p_default NUMERIC DEFAULT 0.5
)
RETURNS NUMERIC AS $$
DECLARE
  pattern_data JSONB;
  action_rate NUMERIC;
BEGIN
  -- Get user's signal responses
  SELECT context_data->'signalResponses'->p_signal_pattern
  INTO pattern_data
  FROM user_context_profiles
  WHERE user_id = p_user_id;

  -- Extract action rate, return default if not found
  IF pattern_data IS NOT NULL THEN
    action_rate := (pattern_data->>'actionRate')::NUMERIC;
    RETURN COALESCE(action_rate, p_default);
  ELSE
    RETURN p_default;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_user_action_rate IS
'Get user''s learned action rate for a specific signal pattern, returns default if no data';

-- ==========================================
-- 8. UPDATE RLS POLICIES
-- ==========================================

-- Enable RLS on new tables
ALTER TABLE organization_context_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipient_detection_metrics ENABLE ROW LEVEL SECURITY;

-- Organization context: users can read their org's context
CREATE POLICY "Users can read own org context"
  ON organization_context_profiles FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Organization context: only admins can update
CREATE POLICY "Admins can update org context"
  ON organization_context_profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND organization_id = organization_context_profiles.organization_id
        AND role IN ('company_admin', 'super_admin')
    )
  );

-- Detection metrics: users can read their own metrics
CREATE POLICY "Users can read own metrics"
  ON recipient_detection_metrics FOR SELECT
  USING (auth.uid() = user_id);

-- Detection metrics: system can insert
CREATE POLICY "System can insert metrics"
  ON recipient_detection_metrics FOR INSERT
  WITH CHECK (true);

-- ==========================================
-- 9. SAMPLE DATA STRUCTURE COMMENTS
-- ==========================================

COMMENT ON COLUMN inbox_items.recipient_context IS
'JSONB structure:
{
  "detectedRole": "primary_owner" | "secondary_owner" | "reviewer" | "approver" | "informed" | "irrelevant",
  "position": "to" | "cc" | "bcc",
  "wasExplicitlyMentioned": boolean,
  "workSignals": {
    "hasObligation": boolean,
    "obligationStrength": 0-100,
    "requiresJudgment": boolean,
    "judgmentComplexity": 0-100,
    "requiresDecision": boolean,
    "hasDeadline": boolean,
    "deadlineUrgency": 0-100,
    "isTaskAssignment": boolean,
    "isNegotiation": boolean,
    "requiresApproval": boolean,
    "isDelegation": boolean,
    "informationalOnly": boolean,
    "isFollowUp": boolean,
    "mentionsOthers": boolean
  },
  "inferredWorkState": "work_prepared" | "action_required" | "decision_required" | "waiting" | "noted" | "noise",
  "responsibilityConfidence": 0.0-1.0,
  "confidenceBreakdown": {
    "baseAI": 0.0-1.0,
    "userBehavior": 0.0-1.0,
    "position": 0.0-1.0,
    "mentioned": 0.0-1.0,
    "relationship": 0.0-1.0,
    "final": 0.0-1.0
  },
  "reasoning": "string explanation",
  "otherRecipients": ["email1", "email2"],
  "senderRelationship": "client" | "internal" | "vendor" | "unknown"
}';

COMMENT ON COLUMN inbox_items.user_action IS
'JSONB structure:
{
  "action": "approved" | "modified" | "rejected" | "reassigned" | "ignored",
  "timestamp": "ISO 8601 timestamp",
  "timeToAction": seconds,
  "correctedRole": "string (if user disagreed with detection)",
  "reassignedTo": "email (if user reassigned)",
  "modifications": {
    "editType": "tone_change" | "added_context" | "added_deadline" | etc,
    "originalLength": integer,
    "modifiedLength": integer
  }
}';

-- ==========================================
-- MIGRATION COMPLETE
-- ==========================================

-- Summary of changes:
-- ✓ Added recipient_context and user_action to inbox_items
-- ✓ Created organization_context_profiles table
-- ✓ Enhanced user_context_profiles with signal patterns
-- ✓ Enhanced context_learning_events with pattern tracking
-- ✓ Created recipient_detection_metrics table
-- ✓ Added helper functions for confidence and pattern encoding
-- ✓ Set up RLS policies for new tables
-- ✓ Created indexes for efficient queries

SELECT 'Recipient detection migration completed successfully!' AS status;
