-- ONE BRAIN demolition (Blocker A): initiative_state is fully replaced by work_entities (+ entity_links).
-- Every writer and reader was removed from the codebase; the table is frozen legacy. Apply manually in the
-- Supabase SQL editor once the entity-backed Home/Projects/Timeline have been verified in production.
drop table if exists initiative_state;
