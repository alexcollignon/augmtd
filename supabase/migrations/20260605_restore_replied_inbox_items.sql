-- Restore inbox items that were incorrectly marked 'completed' when a reply was sent.
-- The send-reply route used to set status='completed'; that was removed 2026-06-05.
-- This resets only items whose completion was caused by a reply (identified via
-- learning_signals.signal_type = 'reply_sent'), not items the user explicitly dismissed.
UPDATE inbox_items
SET status = 'pending'
WHERE status = 'completed'
  AND id IN (
    SELECT inbox_item_id
    FROM learning_signals
    WHERE signal_type = 'reply_sent'
      AND inbox_item_id IS NOT NULL
  );
