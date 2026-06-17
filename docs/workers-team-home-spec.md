# Spec: Studio cleanup + Workers team-home / review desk

**Status:** Draft for review · **Scope:** per-user experience only (no cross-user collaboration) · **Date:** 2026-06-17

## Goal

Make the workers experience feel like *a team doing work for you* rather than *a set of chats you pick from* — without yet restructuring the inbox or the `/work` chat (those are deferred, pending more thought). Two moves:

1. **Remove Studio as a destination** — collapse task management onto the coworker who owns it.
2. **Add a team-home / review desk** on the workers page — one place that answers "what has my team done, and what needs me?"

Explicitly **out of scope** (deferred): merging `/work` generalist chat into workers, making coworkers collaborate (AI↔AI), AI↔human-colleague asks.

> **Note — the inbox is unrelated.** The inbox is the user's **email**, with an AI layer on top. Nothing more. The team-home / review desk in this spec is a *separate* surface about AI coworker output; it is not the inbox and does not merge with it.

---

## Part A — Remove Studio as a page

### Why
Workers now create/manage tasks conversationally (`create_task`, `update_task`, `run_task`, …) and each worker's **Tasks tab** (`components/workers/tabs/worker-tasks-tab.tsx`) already lists, runs, pauses, and edits them. The standalone Studio **grid + detail/overview** is a second surface showing the same `workflows` rows — redundant and confusing ("is this different from my worker's tasks?").

### What to remove
- The `/studio` route as a top-level nav destination: `app/(main)/studio/page.tsx`, `app/studio/studio-page-client.tsx`.
- The workflow **grid/overview** and **detail panel**: `components/work/studio-home-grid.tsx`, `studio-detail-panel.tsx` (and the grid/detail branches in `studio-page-client.tsx`).
- Any nav entry pointing to `/studio`.

### What to keep
- **The pipeline builder** (`components/work/studio-builder.tsx`) — but reframed as a *deep-dive*, not a destination. Reachable from a task's **"Advanced settings"** in the worker Tasks tab (the tasks tab already opens the builder for `assignWorkerId` per Phase 192). Most users never open it; power users find it where the task lives.
- All `app/api/workflows/*` routes (still used by the Tasks tab + builder + cron).

### Acceptance
- No `/studio` link in the app; visiting `/studio` redirects to `/workers` (or the worker that owns the task).
- Editing a task's steps is reachable from the Tasks tab → Advanced settings → builder.
- Cron dispatch + task runs unaffected.

---

## Part B — Workers team-home / review desk

### Concept
When a user lands on `/workers` (before selecting a coworker), show a **team home**: a cross-coworker view of what's been done and what needs them. It's the team-level version of the existing *per-worker* home (Phase 193, `worker-home-view.tsx` + `GET /api/workers/[id]/home`) — same aggregation pattern, no `agent_id` filter.

### What it shows (priority order)
1. **Needs you / to review** — deliverables coworkers produced that you haven't acted on; decisions surfaced. *This is the point of the desk.*
2. **Recently done** — activity across the team, coworker-attributed: task runs, documents produced (e.g. "Max → Competitor brief · 2h ago", "Sofia → Acme proposal draft · yesterday").
3. **In progress / upcoming** — scheduled task runs coming up, so it feels alive even when nothing needs action.

Each item links into the owning coworker's thread/document. Selecting a coworker from the roster still works as today.

### Data sources (all exist)
- **Done / activity:** `workflow_runs` (status, completed_at, triggered_by, durationMs) joined to `workflows`→`custom_agents` for attribution.
- **Deliverables:** `work_threads.artifacts` (+ `work_messages.metadata.artifact_meta`) across the user's worker threads.
- **Upcoming:** `workflows` where `status='active'`, `next_run_at` within N days.
- **Pattern to reuse/extend:** `GET /api/workers/[id]/home` — generalize to a new `GET /api/workers/home` (all of the user's `is_worker` agents, last N runs, upcoming, recent deliverables).

### The "needs validation" decision (cheap vs. stateful)
There is currently **no notion of a deliverable awaiting review** — artifacts are just created. Two options:

- **v1 (cheap, ship first):** "Needs you" = *recent deliverables* surfaced as a feed ("here's what your team made — review them"). No new state. Fully buildable on existing data. Risk: it's a feed, not a queue — it never "clears."
- **v2 (stateful, follow-up):** add a lightweight state to deliverables/runs (`needs_review` → `reviewed`/`dismissed`) so the desk is a real queue that clears as you act. Small schema + flow addition. Do this once v1 shows how people engage.

Recommendation: ship v1, learn, then add state.

### Surfaces touched
- `app/(main)/workers/page.tsx` + `app/workers/workers-page-client.tsx` — team home becomes the landing; roster + per-worker views unchanged.
- New `components/workers/team-home-view.tsx` (mirrors `worker-home-view.tsx` structure).
- New `GET /api/workers/home` (team aggregation).

### Acceptance
- Landing on `/workers` shows the team home with: items needing review (v1: recent deliverables), recent team activity (attributed), and upcoming runs.
- Each item deep-links to the relevant thread/document.
- Per-worker home (Phase 193) still shows when a specific coworker is opened.
- No new top-level nav; this lives inside `/workers`.

---

## Sequence
1. Studio removal (isolated, low risk).
2. `GET /api/workers/home` + `team-home-view` (v1 cheap, feed-style review desk).
3. Observe usage → decide on v2 stateful review queue.
4. Revisit (separately): `/work` vs workers chat consolidation.

## Open questions (for later, not blocking)
- Does the team home eventually subsume the per-worker home, or stay complementary?
- What exactly counts as "needs review" once stateful — only artifacts, or also task outputs / flagged decisions from chat?
