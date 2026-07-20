-- ONE BRAIN demolition (Blocker D, FINAL step): the projects table (+ its clustering satellites) is fully
-- replaced by tracked work_entities. Apply manually ONLY after the entity-backed Projects lens has been
-- verified in production AND scripts/migrate-projects-to-entities.ts has run (goals/rules copied).
-- The project_id columns on inbox_items/commitments/meeting_transcripts/work_threads/knowledge_files/
-- calendar_events are ON DELETE SET NULL → dropping the table un-clusters, never destroys work.
drop table if exists muted_initiatives;
drop table if exists projects cascade;
