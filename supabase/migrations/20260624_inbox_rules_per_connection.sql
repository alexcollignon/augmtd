-- Rules are scoped to a connection (inbox), not just a user — so each inbox gets
-- provider-appropriate defaults on connect, and two inboxes (even same provider) can be tweaked
-- independently. Existing user-level rows (connection_id NULL) are ignored by per-inbox queries.
ALTER TABLE inbox_rules ADD COLUMN IF NOT EXISTS connection_id UUID REFERENCES connections(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS inbox_rules_connection_idx ON inbox_rules (connection_id, priority);
