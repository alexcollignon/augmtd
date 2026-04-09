-- Add RFC threading headers to emails table for cross-provider thread stitching
ALTER TABLE emails ADD COLUMN IF NOT EXISTS in_reply_to TEXT;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS references_ids TEXT[];

-- Index on message_id for cross-provider reference lookups
CREATE INDEX IF NOT EXISTS idx_emails_message_id_user ON emails(user_id, message_id);

-- GIN index for fast array overlap queries on references_ids
CREATE INDEX IF NOT EXISTS idx_emails_references_ids ON emails USING GIN(references_ids);
