-- Phase 52: Team join code for self-onboarding
ALTER TABLE companies ADD COLUMN join_code TEXT UNIQUE;

-- Case-insensitive index for join lookups
CREATE INDEX idx_companies_join_code ON companies(lower(join_code))
  WHERE join_code IS NOT NULL;
