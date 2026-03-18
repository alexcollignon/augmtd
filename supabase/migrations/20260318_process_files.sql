-- Add process-level file attachments
ALTER TABLE processes ADD COLUMN IF NOT EXISTS files JSONB NOT NULL DEFAULT '[]'::jsonb;
