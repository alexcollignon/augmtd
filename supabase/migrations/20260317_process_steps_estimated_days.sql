ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS estimated_days INT;
ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS cta_label TEXT;
