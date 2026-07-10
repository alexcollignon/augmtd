# Home Timeline + Projects + Status — plan

**North star:** despite everything we add, the user experience must stay **simple and intuitive**. Each
surface answers ONE distinct question; the Home stays the daily driver; new views are "zoom out" lenses,
never chores. Nothing manual that the AI could infer.

## The unifying idea
AUGMTD already stores the atoms (commitments, actionable inbox_items, meeting action items, follow-ups,
coworker deliverables). We add **two axes** (time = timeline, grouping = projects) and **one lens**
(state = board) over ONE unified work-item model. Build one spine + three views, never three silos.

## Coherence contract (design + motion)
- Tokens: `components/ui` kit, indigo accent, radii lg/xl/2xl, font scale, no rings.
- Motion vocabulary (reuse existing): reflow `transition-[width] duration-300 ease-out`; card enter/exit
  fade + 4px translate + `startExit`; expand/collapse via `ExpandableRows`; view switch via
  `SegmentedControl`; undo via sonner toast. Timeline: horizontal scroll with `today` centered, hover-dot
  preview (150ms), click → existing `item-detail` deep-dive, staggered dot appearance.
- CSS/Tailwind transitions only (kit is dependency-free). `framer-motion` only if the timeline needs
  spring physics — default CSS.

## Spine
`lib/work-items/model.ts` `buildWorkItems(userId, supabase)` → read-time normalizer (NO new items table;
existing tables stay source of truth):
```
WorkItem = { id, kind:'commitment'|'reply'|'action'|'followup'|'meeting'|'deliverable',
  title, who, source, href, state:'todo'|'waiting'|'in_progress'|'done'|'dismissed',
  when:{ explicit?:ISO, bucket:'overdue'|'today'|'this_week'|'soon'|'later'|'someday' },
  projectId?, actor:'you'|'team'|'system' }
```
`when.bucket` = deterministic-first (explicit due_date, existing overdue/dueToday, a meeting date pulls its
prep in front) → then a cached `classification`-tier reasoned bucket for undated items (reuse synthesis
staleness/urgency). NEVER fabricate a precise date — undated stays a labeled bucket.

## Phases (by value + dependency)
### Phase 0 — Home revamp + "From your team" differentiation (quick, no new data) ← START HERE
- Condense "For your awareness" to a collapsed digest by default (ExpandableRows) so the least-actionable
  tier stops dominating the rail.
- Three visual tiers: needs-you-now (main, prominent) · ambient/watch (rail, quiet) · team (distinct accent).
- "From your team": pull UP the rail; coworker avatars + indigo accent + first-person DM feel; own
  light-tinted panel (not a gray row twinned with Newsletters). Reuse `/api/workers/home` messages.
- Files: `components/home/home-view.tsx` + a `TeamFeed` sub-component. Presentational + reorder only.

### Phase 1 — Unified spine + inferred timeframe (logic, minimal UI)
`lib/work-items/model.ts` + `lib/work-items/timeframe.ts` (deterministic + cached reasoned bucket).
Populated behind the brief route; de-risks Phase 2.

### Phase 2 — Timeline (centerpiece)
`components/timeline/timeline.tsx` — milestone timeline (NOT a Gantt): horizontal spine, done trailing
left, `today` marker, upcoming dots in soft-bucket lanes; undated items in labeled lanes. Two placements:
compact Home strip (rebalancer) + full timeline view (nav item). Team track = distinct colored lane.
Interactions: hover preview, click → item-detail deep-dive, pan with today centered, expandable lanes,
stagger-in, act → slide to history with startExit + sonner undo.

### Phase 3 — Projects (AI-clustered LENS over existing atoms — not a manual container)
Migration: `projects` + `project_id` on clusterable rows. `lib/projects/cluster.ts` AI pass → SUGGESTED
projects, user confirms/renames/merges. A project also supports manual create.

**Raised standard (informed by a competitor's projects UX — adopt the structure, reject the manual model).**
A competitor models a project as tabs: Overview · Tasks (kanban) · Conversations · Resources · Goals ·
Rules. The structure is good; their MANUAL data-entry model is NOT (contradicts AUGMTD's "it just knows").
AUGMTD's project is a **lens that auto-populates from the spine + existing surfaces**, never a folder you
hand-fill:
- **Overview** — a scoped mini-Home + scoped timeline (the project's slice of the unified spine) + progress.
- **Work** (their "Tasks") — the project's `WorkItem`s as board/timeline (reuse Phase 1 spine + Phase 4 board).
- **Conversations** — coworker `work_threads` scoped to the project (already exist).
- **Resources** — `knowledge_files` scoped to the project (already exist).
- **Goals & Rules** — project intent + guardrails that **coworkers respect when working within the project**
  (ties to skills + the delegate flow). This is the AUGMTD-native power the competitor can't have: a project
  makes your AI team project-aware. NOTE the trust boundary — distinct from company **Strategy** goals
  (which NEVER reach coworkers); project Goals/Rules DO steer coworker work, but only project-scoped + opt-in.
The differentiator, restated: **you don't build the project — AUGMTD clusters your real work into it, and
Goals/Rules make your coworkers project-aware.** Per-project scoped Home + timeline swimlane reuse the
existing components with a `projectId` filter. Clean tabs + empty states + a "Create a project" CTA, kit-styled.

### Phase 4 — Status lens (light, last, optional)
Filter/group the WorkItem spine by state (To do / Waiting / Done). Secondary view via SegmentedControl on
the timeline (Timeline ↔ Board). Auto-populated, no data entry. Restrained so it never becomes a task manager.

## Cross-cutting
Caching on a `sig` (date + counts + freshest ts); realtime via the existing inbox_items/commitments
channel; calm empty/loading states (kit EmptyState, no skeleton flash on background refetch); normalizer is
read-time over already-fetched rows, AI passes cached + lazy.

## Locked decisions
1. Milestone/dots timeline, not a duration-Gantt (point obligations). 2. Timeline = Home strip + full view.
3. Projects AI-suggested, confirm-to-keep. 4. Status board secondary + last. 5. CSS motion, no new dep by default.
