-- Reply/closure resolution: record WHY + WHEN a commitment was auto-resolved (the user replied on the
-- thread). Additive + idempotent — safe to run anytime. The resolver retries status-only if these are
-- absent, so applying this is optional-but-nice (it makes the resolution auditable in the row itself).
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS resolved_reason TEXT;   -- e.g. 'replied'
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
