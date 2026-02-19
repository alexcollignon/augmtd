-- Add updated_at column to inbox_items and backfill with created_at
ALTER TABLE inbox_items
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill existing rows
UPDATE inbox_items SET updated_at = created_at WHERE updated_at IS NULL;

-- Add trigger to auto-update on row changes
CREATE OR REPLACE FUNCTION update_inbox_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER inbox_items_updated_at
  BEFORE UPDATE ON inbox_items
  FOR EACH ROW EXECUTE FUNCTION update_inbox_items_updated_at();
