-- Add connection_id to emails and inbox_items for per-account data scoping
-- Existing rows stay NULL; new rows populated during sync.
-- Allows data deletion scoped to a specific connected account.

ALTER TABLE emails
  ADD COLUMN IF NOT EXISTS connection_id UUID REFERENCES connections(id) ON DELETE SET NULL;

ALTER TABLE inbox_items
  ADD COLUMN IF NOT EXISTS connection_id UUID REFERENCES connections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_emails_connection_id
  ON emails(connection_id) WHERE connection_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inbox_items_connection_id
  ON inbox_items(connection_id) WHERE connection_id IS NOT NULL;
