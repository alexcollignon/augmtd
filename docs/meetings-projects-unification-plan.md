# Meetings → Projects Unification

**One concept — a `project` — that behaves identically in Home and Meetings; new meetings/emails flow into it
automatically; it is the AI/coworker context boundary.** Meeting *folders* were a meeting-only, manual subset
of exactly this — they become projects.

## Model
A project = any collection/workstream (a deal, a client, an internal effort). Cross-artifact: emails +
meetings + commitments + coworker deliverables + notes/KB + goals/rules. Per-user. The SAME `projects` row
everywhere (Home Projects lens + Meetings sidebar read `/api/projects`).

Membership tiers (cognitive-cost): **Prepared** (auto-attach on confident initiative match — the *live* magnet)
→ **Suggested** (one-click when medium confidence) → **Awareness** (loose; fully manual). A manual decision is
**sticky** (`project_locked`) — auto never overrides it. We **suggest** projects (from ≥2-item clusters) but
never silently **create** them; creation is always consented (accept a suggestion, or "＋ New project"). Delete
= un-group (`ON DELETE SET NULL`) — never destroys the underlying items.

## Confirmed decisions
- Hard-migrate folders → projects (true one-concept).
- Auto-gather everywhere by name; manual detach is the safety net (even for generic folder names).
- Shared meetings filed per-recipient → add `shared_note_receipts.project_id`.
- Port the folder chat to a project chat.
- No silent auto-create of projects (suggest only).

## Phases
- **P0 — Data:** migration `shared_note_receipts.project_id`; backfill `meeting_folders → projects`,
  `meeting_transcripts.folder_id → project_id` (locked), `shared_note_receipts.folder_id → .project_id`. Dedup
  a folder into an existing same-name project. Keep `folder_id` cols for rollback. Dry-run first, smoke.
- **P1 — Meetings UI speaks projects:** sidebar `FOLDERS`→`PROJECTS` (one source); row project chip; "…" menu
  `Move to folder`→`Add to project` + inline "＋ New project" + one-click suggestion; selecting a project
  filters the list (folder-detail-view → project view) + project chat.
- **P2 — Same object Home⇄Meetings:** one `project-detail` reachable from both; membership changes reflect
  bidirectionally (one row).
- **P3 — New-meeting auto-surface (mostly built):** record → grounded initiative → magnet → shows in its
  project in Meetings AND Home + feeds project KB. Verify end-to-end.
- **P4 — Cleanup:** deprecate `meeting_folders` reads/writes/endpoints; drop cols later.

## Scenarios covered
Live magnet · cross-artifact hub · same-contact-two-deals stay separate · brand-new deal stays loose until
≥2 or manual create · a meeting spans deals → one project (user picks) · shared meetings filed per-person ·
Home⇄Meetings one object · projects = AI/coworker context boundary (project goals/rules reach coworkers;
company Strategy never does) · delete = un-group.
