-- Add is_read to emails table (Outlook stores it; Gmail derives from labels)
ALTER TABLE emails ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT true;

-- Add is_read to inbox_items (default true = no disruption to existing items)
ALTER TABLE inbox_items ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT true;
