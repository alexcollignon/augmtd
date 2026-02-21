-- Add user_attachments to work_threads for user-uploaded input files
-- Each entry: { inputId, filename, mimeType, size, storagePath, extractedText }
ALTER TABLE work_threads ADD COLUMN IF NOT EXISTS user_attachments JSONB DEFAULT '[]'::jsonb;
