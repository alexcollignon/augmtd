-- PREPARED WORK Phase A (docs/prepared-work-plan.md) — the File Spine.
-- Every knowledge file carries its ORIGIN (where it came from: email_attachment | chat | coworker |
-- upload | transcript | generated | gdrive | dropbox + the source ref) and its ENTITY (the One-Brain
-- body of work it belongs to, inherited at ingest). Apply manually in the Supabase SQL editor.

ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS origin JSONB;
ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS entity_id UUID REFERENCES work_entities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_knowledge_files_entity ON knowledge_files(entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_files_origin_kind ON knowledge_files((origin->>'kind'));
