-- Add desk signal types to learning_signals CHECK constraint

ALTER TABLE learning_signals DROP CONSTRAINT valid_signal_type;

ALTER TABLE learning_signals ADD CONSTRAINT valid_signal_type CHECK (signal_type IN (
  'suggestion_confirmed',
  'suggestion_rejected',
  'reply_sent',
  'item_completed',
  'item_dismissed',
  'draft_modified',
  'action_taken',
  'email_sent',
  'email_archived',
  'desk_item_moved',
  'desk_item_dismissed',
  'desk_item_done'
));
