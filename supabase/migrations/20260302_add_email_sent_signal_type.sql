-- Add email_sent to the valid_signal_type CHECK constraint on learning_signals

ALTER TABLE learning_signals
  DROP CONSTRAINT valid_signal_type;

ALTER TABLE learning_signals
  ADD CONSTRAINT valid_signal_type CHECK (signal_type IN (
    'suggestion_confirmed',
    'suggestion_rejected',
    'reply_sent',
    'item_completed',
    'item_dismissed',
    'draft_modified',
    'action_taken',
    'email_sent'
  ));
