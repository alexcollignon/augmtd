ALTER TABLE connections
  ADD COLUMN IF NOT EXISTS push_subscription_id TEXT,    -- Gmail: Pub/Sub name; Outlook: Graph subscription id
  ADD COLUMN IF NOT EXISTS push_expires_at TIMESTAMPTZ,  -- Gmail: 7-day watch expiry; Outlook: 3-day max
  ADD COLUMN IF NOT EXISTS push_history_id TEXT,         -- Gmail only: last processed historyId
  ADD COLUMN IF NOT EXISTS backfill_status TEXT DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS backfill_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS backfill_emails_total INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS backfill_emails_done INT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_connections_push_expires
  ON connections(push_expires_at) WHERE push_expires_at IS NOT NULL;
