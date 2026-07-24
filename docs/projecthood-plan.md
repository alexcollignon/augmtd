# PROJECTHOOD & CURATION — registry ≠ portfolio — ✅ P1–P5 SHIPPED (July 22)

**Shipped + cross-user gated** (`scripts/smoke-projecthood.ts` 17/17; voice 20/20, converse 9/9, room
15/15, portfolio 12/12 re-green; build clean). Live results: Alexandre 75→20 projects (security
alert/vendor issues → errand; AWS/Hetzner → background), Rene 77→49 lanes + the Jun-25 wall dead
(374 candidates → 55 honestly plotted, 316 fold as undated), personal user 7→0 projects (correct).
Dedup sweep dismissed 25 real duplicate commitments (Rene 22). Two safety catches en route: a missing
project name in move_item_to_project must ASK, never default to detach; the fast-path classifier
improvises arg keys → tolerant reads + detach phrasing taught explicitly.

**The feedback that triggered this** (user review + Rene): "this view is great but I have too many
projects (they were accepted automatically which I think is not ideal)" · the expanded project card
is confusing (double arrow-actions, five overlapping dismiss verbs) · the Timeline "groups
everything — not necessarily only tasks… but notifications?" · managing is hard ("not easy to close
or say it's done, separate things, or include items in an existing").

**The diagnosis (one root, four symptoms):** the one-brain arc made every RECOGNIZED entity a
first-class PROJECT. Recognition is correct — a Google security alert, a failed vendor payment, a
one-off intro ARE entities the brain must remember (identity memory is the substrate). The mistake
is the presentation layer rendering the registry 1:1 as the portfolio. The registry holds
everything; the portfolio is the user's mental list of real bodies of work (~5–15). The label era
had this distinction (Prepared → Suggested → Awareness; projects needed accepting); the one-brain
demolition dropped the acceptance tier, and Rene's feedback says it was load-bearing.

**The law this plan adds:** *projecthood is a JUDGMENT the brain makes (and the user can override),
never a side effect of recognition.* Brain remembers everything; portfolio shows judged projects.

---

## P1 — SCOPE: the projecthood verdict, at the source

`lib/entities/state.ts` — the state synthesis (which already judges momentum/priority/category)
additionally outputs **`scope`** into `state`:

- **`project`** — an ongoing body of work: multiple touches over time, a human counterparty/team,
  an objective that outlives any single action (a deal, a program, a hire, an engagement).
- **`errand`** — real but self-contained: one action closes it (a bill, a security alert, a single
  ask, a delivery problem). Deserves an item on the deck, not a slot in the user's head.
- **`background`** — automated/admin hum with no action (newsletters-adjacent, receipts, FYI feeds).

Mechanics:
- One more field from the SAME synthesis call (the `covers` pattern) — no new pass, no new table.
- **Structural priors ride in the prompt as FACTS** (the domain-constraint pattern used for
  category): member counts by kind, distinct active days / span, automated-sender share, category
  (admin ⇒ errand/background-leaning), whether any human counterparty exists. The judge decides;
  the facts constrain.
- `STATE_PROMPT_VERSION` bump → states regenerate through the normal sig gate; one backfill sweep
  script (`scripts/backfill-entity-scope.ts`, dry-run default) for immediate effect cross-user.
- **Human outranks:** `tracked` (the pin) FORCES project. An errand that grows re-judges
  automatically — new members change the ledger sig, the synthesis re-runs, scope flips. No special
  machinery, no acceptance queue to maintain.
- Trust gate: fixtures in the voice smoke — a security-alert-shaped entity must judge errand; a
  multi-thread deal must judge project. Cross-user counts logged (Rene's portfolio target: dozens →
  a short list + folded tail).

## P2 — PORTFOLIO reads scope (+ the card fix)

`/api/entities/portfolio` returns `scope`; `portfolio-view.tsx` renders THREE strata:

1. **Projects** (scope=project OR tracked) — full cards, lead section. Prominence ordering stays.
2. **Becoming a project?** — the SUGGESTED tier reborn: an errand showing growth (≥2 kinds or ≥N
   members across a real span) renders one compact row: name · why · **Track** / **Not a project**.
   Track = pin (forces project). This is the product's own cognitive-cost model applied to
   projecthood — auto only when evidence is strong, suggest when borderline, never silently promote.
3. **Smaller things** (errands) — folded by default; PLAIN rows (title · next action · ✓ Done · ✕),
   NO project chrome (no Stage, no Goals/Rules, no "Open project"). Background hidden entirely
   (still in the brain; still groups its items).

**The card layout fix** (the screenshot's confusion), for project cards:
- ONE primary action: the next-move pill. "Open project →" dies as a separate inline link — opening
  the room is the ROW HEADER click (title + chevron affordance).
- Verbs collapse: inline = **Done** · **Not a project** (one dismissive verb → mute/errand-ify).
  **⋯ menu** = Archive · Rename · Forget. Five undifferentiated text verbs was four ways to say
  "go away".
- The Timeline lens "By project" clusters ONLY scope=project entities; errand items appear in the
  "Everything" view as rows, never as swimlanes.

## P3 — TIMELINE honesty (no arrival-date soup, no notifications)

`lib/work-items/gantt-date.ts` + the Gantt/timeline reads:
- An open item with NO explicit date is **not plotted as a dot at its arrival date** (the wall of
  "Jun 25" dots). New marker `undated`: the item folds into its project row as a count ("N without
  dates") — visible, never falsely dated. Extends the locked law "an undated item can never be
  overdue" to "an undated item can never claim a date".
- **Automated items are excluded from task rows** (the spine's `automated` flag already exists —
  the timeline read filters; a notification is context, not a task).
- Roll-up counts ("N to do · pending · done · overdue") count only what's actually plotted;
  overdue = explicit past deadline only (already true — preserved).
- The room's Timeline artifact inherits automatically (shared `gantt-date.ts` + detail route).

## P4 — MEMBERSHIP management (move · done · split · merge), registry-first

The machinery exists (membership reconcile, locked manual moves, reflection merges) — the
affordances don't. Two wires, per the one-truth law:

1. **Registry capabilities** (`lib/home/capability-map.ts` + executors in `lib/tools/`):
   `move_item_to_project` (wraps the existing `/api/items/entity` PATCH logic — locked, cascading,
   reconciled), `mark_project_done` / `archive_project` (wraps entity lifecycle PATCH),
   `merge_projects` (wraps the reflection merge executor, conservative — same trust bar).
   Exposure: `chief_of_staff`. → "this isn't part of Soboplac", "merge these two", "mark the pilot
   done" work in EVERY chat surface (rail, room, Home) with zero surface code.
2. **Direct affordances** (for the click-first user):
   - The item deep-dive rail header: the current project chip gains **Move to… / Not part of this**
     (generalizes the meetings-only `meeting-project-control` pattern; same sticky PATCH).
   - The room's Work board rows: hover ✕ = detach (locked, undoable).
   All logged (`activity_events`) + undoable via the existing restore path.

## P5 — MEETING commitment granularity (Rene's wall of near-dupes)

The AHK screenshot shows the extractor's "explicit obligations only" rule failing at scale for
meeting-heavy users: 25+ granular items, visible near-duplicates across repeated meetings
("Identify and secure a pilot project" ×2, three pricing variants).
- **Write-time cross-MEETING dedup:** a new commitment is checked (isNearDuplicate ~0.5) against
  the entity's OPEN commitments — not just the same batch — skip/refresh instead of insert.
- Extractor prompt: consolidate sub-tasks; a recurring meeting re-stating an obligation UPDATES it,
  never mints a sibling.
- One-time cleanup: `scripts/dedup-entity-commitments.ts` (dry-run default, `--apply`), Rene's
  data as the test case.

---

**Order: P1 → P2 → P3 → P4 → P5.** P1+P2 land together (the verdict + the surface that reads it);
P3 is independent and cheap; P4 rides the registry; P5 is data hygiene. Cross-user smokes per phase
(Rene = the acceptance test: portfolio shrinks to a believable list; timeline loses the Jun-25
wall). All existing gates stay green; no migration (scope lives in `state` jsonb; `undated` is a
render-path value).

**Open decision (recommendation: as written):** whether "Smaller things" (errands) render in the
portfolio at all vs living ONLY on the Home deck. Recommended: a folded section in the portfolio —
discoverable when the user goes looking ("where did that alert go?"), invisible cost otherwise.


---

# PHASE 2 — ITEMS ↔ PROJECTS, BOTH WAYS, FROM ANYWHERE — ✅ SHIPPED (July 22)

**All slices live + cross-user gated** (`smoke-projecthood.ts` 25/25; converse 9/9, room 15/15, rail
12/12, portfolio 12/12 re-green; build clean). Live proof: create-from-item founds+attaches via chat
("Started X, with this in it"); move-by-description works from the GLOBAL chat (real item resolved by
one distinctive word); fingerprint suggestions surface loose items on 11/24 entities across users.

**The gap audit (user review):** create-from-item missing; the room can eject but not pull in; chat
move only works on the OPEN item; merge has no click path; membership moves aren't one-tap undoable;
a "Smaller thing" can't be promoted in place. UI law for this pass: reuse the EXISTING idioms only —
Chip, the mini-picker list, the row ⋯ menu, the pin star. Nothing new-looking.

## S1 — FOUND a project from an item
- Capability `create_project` (chief_of_staff): executor wraps the SAME create the portfolio button
  uses (found tracked entity; existing-name = re-track) + optionally attaches the scoped item via
  setItemMembership. Chat: "start a project called Acme Pilot from this" works in the deep-dive.
- Click: the rail's item door, when the item has NO deal — the "standalone" line gains a
  **"Start a project from this"** chip → inline name input → create + attach + confirm in-thread.

## S2 — ROOM pulls items in (+ grounded suggestions)
- `GET /api/entities/loose-items?q=` — recent LOOSE atoms (pending inbox / open commitments /
  meetings with no positive link), searchable.
- Room Work tab: **"+ Add"** → the mini-picker over loose items → sticky attach (the ONE write).
- Room Overview: **"Might belong here"** card — loose items whose sender/counterparty matches the
  entity's PEOPLE FINGERPRINT (identity-first, deterministic — the recognition philosophy, zero AI).
  + attach / ✕ session-dismiss. Computed in the detail route.

## S3 — MOVE by description, from anywhere
- `move_item_to_project` gains `item_description`; `resolveItemByDescription` (token overlap over
  recent inbox titles/senders + commitment descriptions; clear-winner rule, ambiguous → ask).
  Global/Home chat: "put the Goldenergy email into Admin" now works. Bulk rides the agent loop
  (multiple calls). SPLIT emerges by composition: create_project + move-by-description.

## S5 — MERGE click path
- Portfolio row ⋯ menu: **"Merge into…"** → the menu morphs into a mini-list of other active
  projects → `PATCH /api/entities/[id] {action:'merge', targetId}` → absorbEntity + force refresh.

## S6 — MEMBERSHIP UNDO
- membership_move activity rows become one-tap undoable: log entityType 'membership',
  entityId `<kind>:<itemId>`; restore route case 'membership' reads the row's metadata.from and
  setItemMembership back. Same Undo affordance as everything else.

## S7 — SMALL-ROW PROMOTE
- "Smaller things" rows gain the hover pin star (→ track) — same star as everywhere.

**Order S1 → S3 → S2 → S5/S6/S7.** Cross-user live smokes per slice (create-from-item roundtrip w/
cleanup; move-by-description from global chat; suggestions grounded in the fingerprint); all prior
gates stay green.


---

# PHASE 3 — THE FRONT DOOR: subtraction + the curated portfolio — ✅ F1–F6 SHIPPED (July 23)

**Shipped + gated** (projecthood 31/31, agenda-coherence 22/22, deck-dedup 7/7, room 15/15,
portfolio 12/12, converse 9/9; build clean). Found en route: PRODUCTION (old committed code) rewrites
entity states in the old shape while this arc is uncommitted — 12 of user A's entities lost `scope`
to live traffic; the smoke now self-heals them through the local v4 path (converges on deploy).

**The tester feedback, distilled to one law:** the ACTING surface (deck) shows only who · verb-ask ·
one signal; all UNDERSTANDING (prose, state, history) lives one level deeper, on demand. The
intelligence is felt in the ordering and labels, never displayed as paragraphs. (Second time this
lesson lands — the pure-prose Home was already tried + reverted in July; the briefing re-introduced
prose because the writing got good. Structure beats sentences at the moment of triage.)

**Hard requirements carried in (user):** every project keeps its OWN brain/context (state, goals/
rules, per-deal chat — untouched); projects stay STATUS-MANAGEABLE (lifecycle verbs, incl. in the
room); the MEETINGS side stays in step; everything is 2-WAY LIVE (a change on either side shows on
the other without reload) — guaranteed by construction: one registry, read-time everywhere, one
portfolio read feeding both the Projects lens AND the meetings picker.

**THE REASONING DOCTRINE (user constraint, governs every slice):** judgment is REASONED with memory
in view; facts are STRUCTURAL; plumbing is MECHANICAL. No heuristic judgment, no keyword rules, no
bandaid patches. A date/draft-exists/shared-person is a fact and may render or shortlist; "what
matters", "what belongs", "what is a project" are judgments and come ONLY from the brain's reasoned
passes. A presentation cutoff (top-N, fold) over a REASONED value is plumbing and allowed; a cutoff
that CREATES a judgment (growth = ≥2 kinds, urgent = overdue-first) is banned.

## F1 — DECK REGISTER FIX (glance ≤8 words; judgment demoted; toggles gone)
- Card line 1 = **who · verb-ask** (the EXISTING reasoned ≤8-word imperatives: understanding.ask /
  next_move.title — no new AI); ONE signal chip max (overdue / due date / "drafted" — FACTS, not
  judgment). The judged summary sentence moves to the EXPANDED state only — three registers: glance
  (≤8 words) → expand (one sentence) → room (full state).
- Bundle hero: entity name · count · the next-move pill; the reasoned "why" only when it fits ONE
  truncated line.
- **DoSortToggle deleted** AND the lens SORT RULES die with it: deck order = the REASONED priority
  (entity `priority.weight` — the judged verdict that already weighs deadlines/stakes/momentum) with
  the briefing's reasoned lead anchoring the top. The 'urgent' date-rule sort (overdue→today→soon)
  was heuristic judgment — it goes; a real deadline influences order because the JUDGE weighs it,
  not because a rule sorts it. Facts (overdue) still RENDER as the signal chip.
- **Dead-row fix**: every visible row (incl. covered-evidence rows) opens its item on click.

## F2 — CHAT BLOCK SUBTRACTION
- The briefing PROSE block is removed from the Home chat panel — pills + composer only. The one-line
  greeting teaser stays (one sentence ≠ a report).
- `composeBriefing` machinery KEPT (daySig-gated, cheap): its judgment anchors deck ordering and the
  daily report; we delete the render, not the brain.

## F3 — CURATED PORTFOLIO (accepted = tracked; the brain never silently places)
- **"Your projects" = tracked entities only** — created (New project / "start a project from this")
  or ACCEPTED. Acceptance IS the existing `tracked` flag: no migration, no new state.
- **"Suggested"** = judged scope='project' NOT yet tracked — one-tap **Accept** (track) /
  **Not a project** (mute). **"Accept all N"** when the user has 0 tracked (the first-run moment).
  **The growth-errand heuristic (≥2 kinds / ≥4 items → "Becoming a project?") is DELETED** — it was
  heuristic judgment. An errand enters Suggested only when the BRAIN re-judges it scope='project'
  (which happens naturally: new members change the ledger sig → the synthesis re-runs → the scope
  verdict flips). Suggestion = the judge's verdict; acceptance = the human's.
- **Nothing else changes**: entity brains, scope judgment, recognition, deck grouping/bundles,
  rooms (a SUGGESTED project's room still opens from chips/deep-links — it has a brain), chat
  capabilities — all read the registry as before. Proactivity lives on the deck and never depended
  on portfolio placement.
- **Meetings side follows automatically**: `meeting-project-control` + the meetings sidebar read
  `/api/entities/portfolio` — they adopt the same accepted-first definition (picker = Your projects
  + "New project"; suggested reachable via search). ONE read defines "a project" everywhere.
- **Timeline lanes** = accepted projects; a user with ZERO accepted falls back to judged lanes (the
  pre-acceptance experience is never empty).
- **Existing users**: portfolios currently show judged projects — after F3 they see the Accept-all
  banner once (deliberate rug-pull avoidance is the banner, NOT auto-tracking — auto-track would
  defeat "the list is mine").

## F4 — ROOM OVERVIEW: simple first paint, everything one tap deeper
- First paint: the summary (header, already there) + **THE next-move button** (+ a single you-owe
  line when present) + the "Might belong here" suggestions (actionable, compact) + THREE quiet
  disclosure rows: **Work N · Meetings N · History** (Goals & Rules fold into a fourth). Stats
  strip, history list, goals/rules cards all move BEHIND their rows — nothing deleted, everything
  demoted.
- **"Might belong here" gains the JUDGE** (doctrine fix for the P2 version): the people-fingerprint
  match becomes the structural SHORTLIST only (recall — a shared person is a fact); ONE batched
  reasoned judgment (classification tier, sig-cached on the shortlist) decides "does this loose item
  belong to THIS body of work?" before anything is suggested — the recognition pipeline's own shape
  (recall structurally, judge reasoned). Kills the person-prior bug by the same move recognition
  killed it (a person on three deals no longer suggests all three).
- **Status manageable IN the room** (new): the room header gains the ⋯ menu (Done · Archive ·
  Rename · Merge into… · Not a project) — the same verbs as the portfolio row, same executors.
- The per-deal rail/chat and entity brain untouched.

## F5 — 2-WAY-LIVE GUARANTEES (verify + close small gaps)
- Portfolio mutations already broadcast (`broadcastProjectsUpdated`) + bust the brief; add
  `useLiveRefresh` to the portfolio (focus/interval refetch) so a meeting-side attach shows without
  reload; the room already refreshes on membership writes.
- Gate (cross-user, live): accept → appears in the meetings picker read; attach a meeting from the
  meetings view → the room's Meetings count + portfolio reflect it; mute → gone from both; deck
  bundles unaffected throughout.

## F6 — DOCTRINE SWEEP (the existing heuristic this pass retires)
- The portfolio's PROMINENCE formula (`weight >= 40 || momentum rules || owes+quietDays`) reduces to
  the REASONED priority alone: ordering by `priority.weight` (judged), the fold = a presentation
  cutoff over that reasoned value (plumbing). The momentum/quiet-days clauses were re-deriving
  judgment the synthesis already makes.

**Order F1 → F2 → F3 → F4 → F5 → F6.** Mostly deletion/demotion; the only new writes are Accept-all and
the room ⋯ menu (both reuse existing executors). Cross-user smokes per slice; all prior gates
(projecthood 25/25, voice, converse, room, rail, portfolio) stay green. The one-shell room
convergence stays queued as its own pass after this.


---

# PHASE 4 — THE ROOM DOES THE WORK — ✅ R1 + R3a–d + R2 SHIPPED (July 23)

**Shipped + gated** (smoke-tasks 24/24 incl. the LIVE loop on both users — chat-create → manual
commitment linked+locked → in the LEDGER (the brain sees it) → in the SPINE → complete stamps
resolved_at → cleanup; projecthood 31/31, room 15/15, converse 9/9, portfolio 12/12, coherence
22/22; build clean; ZERO migrations).

**The thesis (user):** structurally the accountable-work skeleton — a project, its TASKS, an owner,
a status — is best practice; the FEEL is ours (calm, one tap deep, no config surface). Copy the
FUNCTIONAL CORE (task = writable: create/edit/complete/date), refuse the chrome.

**THE OWNER RESOLUTION (user course-correction, load-bearing):** a task's OWNER is a HUMAN of the
deal — You, or the counterparty by name ("Waiting on Jean-Marie") — never AUGMTD/a coworker. The AI
is not a participant; it is the PREPARATION LAYER under YOUR tasks. Two different things were being
collapsed: who OWES the work (the human — the task list's truth) vs who does the MECHANICS (you /
the system / a coworker — the cognitive-cost ladder). AI involvement stays in its existing,
conversational shape: **Prepared** (your task arrives with the draft done — a token on the row) →
**Suggested** (ONE contextual "Sofia can take this →" chip on the next move) → **Asked** (the chat:
"have Max research this"). NO assignee column, NO assignment-triggers-execution, NO migration —
explicit AI-assignment is a later step taken on evidence, not now.

**The grounding law (user, hard):** everything rides the EXISTING system — brain, registry, spine,
capability map, delegation engine. NO parallel task store. Owner facts come from `direction` +
`counterparty` (already on every commitment); prepared tokens from the existing prepared-work
reader; the hand-off chip from the existing coworker suggestion + delegation engine.

## THE SUBSTRATE — a task IS a commitment (unchanged, now migration-free)
`commitments` is the task object: description · counterparty · due_date · status · resolved_at ·
source+source_id (provenance) · entity_links membership. **A manual task = `source: 'manual'`**
(TEXT, no CHECK — zero schema risk). Extracted commitments = the auto-created tasks, same list.
**ZERO new columns.** Downstream is AUTOMATIC (audited): the SPINE has no source filter → manual
tasks appear on the deck ("On your plate"), the Timeline (dated → due), the room; the LEDGER carries
them → the entity brain reasons over declared tasks (sig → re-judge); day-ring, undo, restore
inherit; a room-created task links `via='user', locked` at insert — recognition never re-judges it.
**Doctrine guards:** write-time dedup NEVER folds a manual task (a human creating one is a verdict);
extracted near-dups of a manual task keep being skipped. due_date only ever absolute-or-null.

## R1 — SMALL-FIXES BATCH (the tester's paper cuts)
1. Category pills REMOVED from the portfolio toolbar (search stays).
2. The star REMOVED (portfolio rows + room header) — Accept / "Not a project" is the control;
   `tracked` stays internal.
3. The "+ Add work" picker filters `isAutomatedSender` + `understanding.bulk` (facts) — no
   newsletters/promos.
4. Suggestions are INSPECTABLE: a suggestion row expands to its member items (portfolio `events`
   gain `{id, kind}`) with per-member ✕ (locked detach) — prune before Accept.
5. Editable CATEGORY tag: 4-option picker (row ⋯ + room) → `state.category` + `state.categoryLocked`
   (jsonb, no migration); the grounded backfill respects the lock.
6. Room name click-to-edit (same PATCH rename as the row ⋯).

## R3a — TASK CRUD (server + the one-truth chat wire)
- `POST /api/tasks` — { description, dueDate?, entityId? } → commitment (source 'manual', direction
  'you_owe', open) + locked entity link when room-scoped + activity log + softBustBrief.
- `PATCH /api/commitments/[id]` EXTENDED — { description?, due_date? } alongside the status flips.
- Chat capability `create_task_item` ({text, due_date?, project_name?} → the same POST path; in
  entity/item scope defaults to the room's deal). Exposure chief_of_staff → every chat surface at
  once. Completion already exists (`resolve_commitment`); hand-off already exists (delegation).
  (The planned `assign_task` capability is DROPPED — "have Max do X" already works.)

## R3b — THE ROOM'S TASK LIST (the heart of the phase)
The Work disclosure becomes ONE calm task list (lists, never kanban):
- **To do** (yours): ☐ · verb-first text (inline-editable when commitment-backed) · due date
  (click-to-set) · PREPARED token when the system already worked ("drafted" / the coworker's name —
  the existing prepared reader) · provenance ("from: <email/meeting>" / "added by you") · hover ✕
  detach.
- **Waiting on <name>** (direction 'awaiting', grouped BY COUNTERPARTY — the human owner made
  visible): same row anatomy, no checkbox pressure, a quiet "nudge" affordance where a nudge draft
  exists.
- **Done N** (folded).
- **"+ Task"** row at the bottom (type → Enter → created in this room, linked + locked).
- Inbox-backed rows (an actionable email IS a task): text = the reasoned ask (read-only), ☐ =
  the inbox complete path — same anatomy, existing executors.

## R3c — PROACTIVITY SURFACED, NOT ASSIGNED (replaces the owner-column slice)
- Your task rows carry the PREPARED token wherever prepared work exists (wire the existing
  `getPrepared` reader into the room list — read-only).
- The room's next-move card gains the ONE suggested hand-off chip ("Sofia can take this →") — the
  same `coworkerForMove` suggestion + one-tap delegation the item rail already has (surfacing an
  existing thing, not new machinery). The chat remains the free-form channel.

## R3d — TYPED INVENTORY (depth by kind; History/Gantt die)
Disclosures: **Tasks** (R3b) · **Conversations N** (threads incl. resolved; automated/calendar-system
mail excluded) · **Meetings N** (notes + upcoming calendar events) · **Files & docs N**
(knowledge_files by entity + pool deliverables through linked items + linked emails' attachments) ·
**Activity** (ledger lines, compact, collapsed, last). The per-room GANTT is deleted. All reads over
`entity_links` + existing tables — live by construction.

## R2 — THE ONE SHELL (last; the layout R3 defines is what converges)
- Extract the item deep-dive's per-kind mains into exportable ARTIFACT components.
- `EntityRoom` gains `focusedItem?: {kind, id}` → the main card renders that artifact with a slim
  breadcrumb ("<deal> › this conversation"); the rail stays (entity scope — the per-deal
  conversation continues across focus swaps).
- `/item/[id]` for an entity-linked item mounts the room with `focusedItem` (deep links unchanged);
  loose items keep the standalone shell. In-room navigation swaps focus + `history.replaceState`.

## GATES (cross-user, per slice — extend smoke-projecthood + new smoke-tasks)
- R3a live: chat "add a task on <deal>: <text>" → manual commitment, linked+locked → visible in the
  room list AND the deck spine AND the deal's LEDGER (the brain sees it) → complete → ring + undo →
  full cleanup.
- Dedup guard: manual tasks never folded; extracted near-dups of a manual task skipped.
- R3c: prepared token renders where prepared work exists; the room hand-off chip fires the SAME
  delegation as the rail chip (one engine).
- R1 structural: pills/star gone, picker filtered, suggestion expand present, category lock honored.
- R2: deep-link parity; rail conversation persists across focus swaps.
- All prior gates re-green.

**Order: R1 → R3a → R3b → R3c → R3d → R2. NO migrations in this phase.**


---

# PHASE 5 — POLISH + THE PREPARATION PASS (planned July 23, research-shaped)

**Research verdicts folded in (ClickUp/Jira-Rovo/Linear/Motion sweep):** the named market gap is
"AI that does the work for you" — incumbent agents do META-work (tickets/status/triage) and starve
because their tools are empty until humans type into them; configuration is the enemy (ClickUp
hated for it, Linear loved for refusing it, automation unused because user-built); trust fails on
"infer rather than verify"; Motion's over-packing shows proactivity must PREPARE AND OFFER, never
auto-act. Our lines, held: zero config surface · one chat entry · sub-second reads · approve-gated
sends · grounded-or-absent. Positioning: *they ask you to run the tool so their agents can help;
we run the work so you only approve.*

**PREREQUISITE: DEPLOY.** Prod's old code keeps rewriting entity states (wiping scope) on live
traffic — every visual evaluation is degraded until this arc ships.

## 5A — POLISH BATCH — ✅ SHIPPED (July 23; smoke-tasks 31/31, room 15/15, portfolio 12/12, projecthood 31/31, build clean)
1. **Suggestion member lines get TYPE ICONS** (Envelope / CalendarDays / CheckCircle by kind) and the
   per-member ✕ becomes ALWAYS-VISIBLE (it exists but hover-only — undiscoverable). Manage works
   both before Accept (prune) and after (the room) — same locked mechanics.
2. **Accept is INSTANT**: optimistic — the row animates out of Suggested into "Your projects"
   immediately (the shared motion idiom), PATCH runs behind; failure restores the row + toast.
3. **Files & docs**: (a) DEDUPE by normalized filename across sources (one row; prefer the knowledge
   entry, carry the attachment's date + both provenances as a suffix). (b) **PREVIEW modal** — one
   `FilePreviewModal`: signed Supabase-storage URL (knowledge_files path / email-attachments bucket),
   PDF+images inline via iframe/img, everything else shows the extracted text; reused anywhere files
   render (room Files, rail file chips later). Click a file row → preview, never a dead row.
4. **Embedded-artifact cleanup (R2 follow-through)**: in `embedded` mode the type pill ("For
   awareness") and the project chip are HIDDEN — the breadcrumb owns context; nothing said twice.
5. **Focus CONTINUATION in the chat**: focusing an artifact from the next-move/CTA pushes ONE
   deterministic narration turn into the room's per-deal conversation ("Here's the thread — the
   draft's below; tell me what to change."), assembled from anchor facts (NO AI call). Mechanism:
   `pushDealTurn(entityId, text)` exported from item-rail (writes the module store + dispatches a
   window event the mounted rail applies) — the room calls it on focus-from-CTA.
6. **Room first paint uses its width**: the Tasks disclosure OPENS BY DEFAULT when count > 0 (the
   heart of the room shows), content column widens (max-w 860 → 1000), and on wide screens the
   next-move card and Goals & Rules sit side-by-side. No new sections — better assembly.
7. **Home today-strip (small, last)**: one slim line under the greeting from the EXISTING schedule
   read (`b.schedule`) — "15:00 Fidelidade x Z100 · 2 more" → opens the day list. No new data path.
   (The fuller Home revamp stays parked per the user.)
- **Recorded decision**: NO per-room timeline — the global Timeline lens already clusters this deal's
  SAME spine items; if a per-deal dated view earns its way back it's a filtered lane there, never a
  second component.

## 5B — THE PREPARATION PASS OVER TASKS — ✅ SHIPPED (July 23; smoke-tasks 39/39, all suites green)
SHIPPED: the EXISTING Preparation Pass (lib/prepare/pass.ts — replies/nudges/coworker-routing/
doc-send) IS the engine; 5B made TASKS first-class citizens of it: (1) `declared` on the spine — a
manual commitment is never `triage` (the user's declaration IS the engagement), so manual tasks
enter the pass's working set (live-proven both users; the bug: freshly-bootstrapped entities made
EVERYTHING triage). (2) `classifyTaskShapes` exported (the routing judgment, testable without firing
delegations — "prepare a one-pager"→prepare_document, "call the lawyer"→other, live-gated). (3) NEW
`task_preparation` AIUsageSource on the pass's judge calls. (4) SURFACE: deck commitment rows carry
prepared tokens (one pool query in the brief route); the room's prepared tokens are TAPPABLE — a
pool deliverable opens in the preview modal (`ref {kind:'deliverable'}`), an inbox draft focuses the
thread. The pass NEVER sends (structural gate).
The ambient pass that today prepares replies/nudges walks OPEN TASKS: "can a built capability
advance this?" — if yes, the work arrives prepared; if no, the task is left honestly alone.
- **B1 — the pass** (`lib/prepare/task-pass.ts`): per user → open commitments (incl. manual, incl.
  entity-linked) WITHOUT prepared work → ONE `classifyStep` per task (the registry-derived reasoned
  classifier — judgment with the capability map in view, NO keyword rules; sig-cached on task text so
  unchanged tasks cost nothing) → a BUILT, NON-SEND atomic capability match runs via
  `assembleSystemStep` → the deliverable lands in the pool (`item_deliverables`, task-keyed) → the
  prepared token appears everywhere that already reads the pool. SEND-class matches PREPARE ONLY
  (draft artifacts — the approve gate is architecture). No capability → skip, never guess; a
  capability needing an unresolvable input (a file it can't find via the universal resolver) → skip,
  never fabricate.
- **B2 — the beat**: wired into the EXISTING draft-sweep cron (the ambient-prep cadence), after the
  reply/nudge pass. Budget guards: ≤6 tasks/user/run, classification tier, per-user time cap,
  `logAIUsage` with a NEW `task_preparation` source (the definitive AIUsageSource list grows by one).
- **B3 — the surface**: the task row's prepared token (already renders) becomes TAPPABLE → opens the
  deliverable in the 5A.3 preview modal; the DECK's commitment rows gain the same token (one cheap
  pool query in the brief route, mirroring the room's). Activity-logged per preparation.
- **B4 — gates (cross-user, live)**: a manual task shaped like a built capability ("draft an intro
  email to …") gains a prepared draft by the next pass; a human-only task ("call the lawyer") stays
  untouched (the honest-skip proof); NO send ever fires from the pass (structural + live assert);
  unchanged tasks re-run at zero AI cost (sig proof); all prior gates green.

## 5C — THE SHAREABLE DEAL STATUS UPDATE — ✅ SHIPPED (July 23; smoke-tasks 45/45, live cross-user)
SHIPPED: `POST /api/entities/[id]/status-update` — one reasoned compose over judged state + the
ledger since the last shared update; MACHINERY_REGISTER self-check + corrective retry; CACHED as an
`item_deliverables` row (kind 'entity', metadata {statusUpdate, sig}) — an unchanged deal re-serves
with zero AI (live-proven), and past updates anchor "since last time". Room ⋯ → "Share a status
update" → editable modal → Copy, or Send via the user's own mailbox (/api/compose/send) — recipient
only ever SUGGESTED from the people fingerprint, explicit approve. 5D rewrite queued: the MCP rail
(self-hosted servers behind the registry, Nango custody, review+pin per server; Composio ruled out
on sovereignty; core capabilities stay first-party) + vertical coworker packs (role × skills ×
grounding × tool slice × eval gates).
- `POST /api/entities/[id]/status-update` — ONE reasoned compose (the briefing's voice laws:
  colleague speech, say-less-than-you-know, grounded-or-absent) over the entity's judged state +
  recent ledger: "where it stands · what happened since <last update> · what's next · what we need
  from you". Cached per entity sig + last-shared marker (never re-composes an unchanged deal).
- Surface: room ⋯ → "Share a status update" → modal with the rendered update, EDITABLE → Copy, or
  Send as email (the existing ComposePanel, recipient SUGGESTED from the counterparty, never
  auto-filled beyond that — approve-gated send, as everywhere).
- Trust: refs ground to ledger lines; nothing invented; the voice smoke's banned-register check
  applies to the composed update too.

## 5D — CAPABILITY GROWTH: the MCP rail + vertical coworkers — ◐ SLICE 1 SHIPPED (July 24)
**The rail decision (locked):** Nango (custody, in place) + SELF-HOSTED MCP servers on our box
behind the capability registry. MCP = protocol/code, not a service — zero egress; Composio ruled
out on sovereignty; core capabilities (email/calendar/drafting/Slack) stay first-party; nothing
current migrates — MCP is for the unbuilt long tail.

**Slice 1 — the rail scaffold (SHIPPED, flag-gated, zero behavior change until enabled):**
- `infra/agentos/mcp_mount.py` — mounts `AGENTOS_MCP_SERVERS` (JSON) as Agno MCPTools; unset = [];
  every failure logged+skipped (a bad server can never take the workers down). Wired into
  `build_workers`.
- **THE TENANT-SAFETY FINDING (discovered before deploying anything):** AgentOS is ONE process for
  many users/companies, but ecosystem MCP servers take credentials at STARTUP — a static mount can
  carry only one tenant's token. Therefore an adoptable server must be credential-free or
  AUTH-SHIMMED (the acting user/company as a TOOL ARGUMENT, tokens fetched from Nango per call —
  the same pattern our HTTP tools already use). A startup-credential-only server is wrapped or
  skipped. This is a review-checklist item now, not a runtime surprise.
- `Capability.mcp?: {server, tool}` on the registry (the gate: an MCP tool without a row does not
  exist) + the per-server ADOPTION RUNBOOK in `infra/agentos/README.md` (review + pin → tenant-safe
  → least-scope → localhost-bound docker → env → registry row).
- **The shortlist (decided; adopt strictly ONE at a time):** 1) Google Drive/Docs WRITE (deliverables
  become real shareable docs — the biggest unlock; needs the auth-shim + a Drive scope on connect),
  2) Dropbox (files for Dropbox teams; also feeds the universal resolver's reserved 'dropbox'
  source). HubSpot/Xero/QuickBooks parked (user call, July 24).

## 5D SLICE 2 — "DELIVERABLES BECOME REAL GOOGLE DOCS" + the rail's live proof (planned July 24)

**THE SECURITY DOCTRINE ADDENDUM (settled while planning, load-bearing):** a model-visible tool
argument may NEVER carry identity — an agent that can pass `user_id` can pass someone else's.
Per-user credentials flow ONLY through paths where OUR code injects the acting user (the existing
HTTP-tool pattern: run_context → internal route → executor). Consequence, stated honestly:
**per-user-credential capabilities ship FIRST-PARTY; MCP mounts are for credential-free or
company-scoped-static servers** (until a per-run header mount exists in the runtime). The rail
stays; the first VALUE ships first-party — which is right anyway, because "deliverables become
real docs" is core-capability territory (trust + voice adjacent).

- **2a — `create_google_doc`, first-party** (`lib/tools/create-doc.ts`): googleapis Docs/Drive
  create using the user's EXISTING Gmail-connection token — **`drive.file` is already in
  GMAIL_SCOPES** (least-scope: app-created files only), so most users need NO reconnect; a
  pre-scope token degrades honestly ("reconnect Google to enable"). Registered everywhere the
  one-truth law demands: tools registry + `TOOL_FEATURE` ('drive') + `CAPABILITY_MAP` row (atomic,
  reversible — a private doc in the user's own Drive; exposure chief_of_staff + coworker +
  workflow) + the AgentOS internal tools route (TS dispatch — **no Python change, no box redeploy
  for the tool itself**). Outlook-only users: capability honestly absent (fact-gated on a Google
  connection); OneDrive equivalent later.
- **2b — surfaces (prepare-and-offer, never auto):** the preview modal (deliverables / status
  updates / prepared work) gains **"Save to Google Docs"** → the tool → the doc link stored on the
  deliverable's metadata + rendered; coworkers + workflows + the chief chat can call it by name
  ("save this as a doc"). The ambient pass may CITE the capability but never creates docs
  unprompted (the Motion lesson).
- **2c — the MCP rail's LIVE PROOF (the box session; explicit go + quiet window):** deploy ONE
  credential-free canary server (the reference `fetch` server) as a localhost-bound docker sibling →
  `AGENTOS_MCP_SERVERS` in agentos.env → AgentOS rebuild via the documented manual sequence →
  verify: service healthy, workers list the canary tool, a worker run uses it, rollback = previous
  image + env unset. This proves mount→discovery→call end-to-end so future company-scoped servers
  are config, not experiments.
- **2d — gates:** LIVE create→verify-via-API→trash a real Doc (user A); scope-missing degradation
  (a token without drive.file → the capability reports unavailable, never errors mid-run); canary
  tool discoverable post-redeploy; all suites re-green.

## 5D SLICE 3 — DROPBOX (its own pass, after slice 2)
Nango OAuth provider (self-hosted, custody unchanged) → READ first: fill the universal resolver's
reserved `dropbox` source ("find the deck" reaches Dropbox) + the picker surfaces → write later if
usage asks. Same first-party-vs-MCP test applies (per-user creds → first-party executor).

## 5D SLICE 4 — VERTICAL COWORKER PACKS (no infra)
role × skills pack × grounding slice × tool slice × eval gates — consulting first
(proposal/engagement shapes), then accounting. Pure configuration over the existing substrate.

**Order: DEPLOY → 5A → 5B → 5C; 5D backlog.** Cross-user smokes per slice (extend smoke-tasks +
a new smoke-preparation); the reasoning doctrine governs throughout (the pass's matching is the
registry-derived classifier, never keywords; skips are honest; sends never auto-fire).

---

**STATUS (July 24): 5D slice 1 shipped (MCP rail scaffold, flag-off). Slices 2–4 PAUSED — the
proactive loop must work and be FELT first. The next arc is `docs/work-loop-plan.md` (THE WORK
LOOP): grounded CTA narration, one reasoned coworker router (regex twins deleted), on-demand
"Prepare this", visible per-task work-state, the self-waiting spine heal, room-menu polish.**
