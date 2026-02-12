-- Learning Signals Table
-- Tracks user actions and feedback to improve AI suggestions over time

CREATE TABLE IF NOT EXISTS learning_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  inbox_item_id UUID REFERENCES inbox_items(id) ON DELETE SET NULL,

  -- Signal type: what action did the user take?
  signal_type TEXT NOT NULL,
  -- Options: 'suggestion_confirmed', 'suggestion_rejected', 'reply_sent',
  --          'item_completed', 'item_dismissed', 'draft_modified', etc.

  -- Signal data: contextual information about the action
  signal_data JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Indexes for analytics queries
  CONSTRAINT valid_signal_type CHECK (signal_type IN (
    'suggestion_confirmed',
    'suggestion_rejected',
    'reply_sent',
    'item_completed',
    'item_dismissed',
    'draft_modified',
    'action_taken'
  ))
);

-- Indexes
CREATE INDEX idx_learning_signals_user_id ON learning_signals(user_id);
CREATE INDEX idx_learning_signals_type ON learning_signals(signal_type);
CREATE INDEX idx_learning_signals_created_at ON learning_signals(created_at);
CREATE INDEX idx_learning_signals_inbox_item ON learning_signals(inbox_item_id);

-- RLS Policies
ALTER TABLE learning_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own learning signals"
  ON learning_signals FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own learning signals"
  ON learning_signals FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- View for signal analytics (optional, for future use)
CREATE OR REPLACE VIEW learning_signal_summary AS
SELECT
  user_id,
  signal_type,
  COUNT(*) as signal_count,
  DATE_TRUNC('day', created_at) as signal_date
FROM learning_signals
GROUP BY user_id, signal_type, DATE_TRUNC('day', created_at);

COMMENT ON TABLE learning_signals IS 'Tracks user actions and feedback to improve AI suggestions over time';
COMMENT ON COLUMN learning_signals.signal_type IS 'Type of user action: suggestion_confirmed, reply_sent, etc.';
COMMENT ON COLUMN learning_signals.signal_data IS 'Contextual data about the action (confidence levels, roles, etc.)';
