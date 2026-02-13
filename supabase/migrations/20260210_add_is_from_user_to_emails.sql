-- Add is_from_user flag to emails table for learning from sent emails

ALTER TABLE emails
ADD COLUMN IF NOT EXISTS is_from_user BOOLEAN DEFAULT false;

-- Create index for faster queries on sent emails
CREATE INDEX IF NOT EXISTS idx_emails_is_from_user
ON emails(user_id, is_from_user, received_at DESC);

-- Comment
COMMENT ON COLUMN emails.is_from_user IS 'Flag indicating if this email was sent by the user (for learning their communication style)';
