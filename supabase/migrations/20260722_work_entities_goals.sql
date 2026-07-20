-- ONE BRAIN (Blocker D): project INTENT moves onto the entity — goals/rules a tracked body of work carries.
-- Apply manually BEFORE running scripts/migrate-projects-to-entities.ts.
alter table work_entities add column if not exists goals jsonb not null default '[]'::jsonb;
alter table work_entities add column if not exists rules jsonb not null default '[]'::jsonb;
