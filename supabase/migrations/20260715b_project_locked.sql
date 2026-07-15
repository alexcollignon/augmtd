-- Human-in-the-loop for project membership: a `project_locked` flag meaning "the USER set this membership
-- (attached or detached) — the magnet must not auto-touch it." Auto-assign fills the blanks; a human
-- decision outranks the machine, permanently. Needed because the magnet re-attaches anything with
-- project_id IS NULL whose initiative matches — so a manual DETACH would otherwise bounce right back.
--
-- Applies to every clusterable atom the magnet touches (lib/projects/associate.ts). Default false = today's
-- behavior (fully auto). Set true only on an explicit manual attach/detach.
ALTER TABLE inbox_items         ADD COLUMN IF NOT EXISTS project_locked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE commitments         ADD COLUMN IF NOT EXISTS project_locked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE meeting_transcripts ADD COLUMN IF NOT EXISTS project_locked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE calendar_events     ADD COLUMN IF NOT EXISTS project_locked BOOLEAN NOT NULL DEFAULT false;
