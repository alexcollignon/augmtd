# THE WORKBENCH — what the power user built by hand, done by the brain (July 2026)

Follows THE ORCHESTRATED LOOP (shipped). The trigger: a real user built her OWN task manager on the
side — the highest-signal user research there is. This arc absorbs what she proved by daily use,
mapped onto our architecture (reasoned, one-source, no bandaids), NOT cloned. Decisions locked with
the user:
- **Take**: the Accept/Reject gate on extracted work · the living context doc · human-writable
  status/priority · the prep horizon · project envelope + per-project urgency on the portfolio ·
  the Gantt inside the deal room · the three-plane shell (conversation / artifact / context)
  universal for deals AND loose items.
- **Hold**: wholesale Home clone (ours stays deck-first with a plan-lane added), personal category
  taxonomies (revisit on demand).
- **Ground facts**: `commitments.status` is free TEXT (probed live — no CHECK), so `suggested` and
  `in_progress` are migration-free. The detail route already returns `gantt`; the shared
  `components/projects/gantt-chart.tsx` exists. The room shell already has the three planes.

Doctrine holds throughout: the machine fills the blanks, a human's hand outranks it permanently;
judgment is reasoned (the extractor/synthesis already judged — the new surfaces mostly ASSEMBLE);
approve-before-commit never weakens; smoke across users per slice.

---

## B1 — The room's Schedule + the living status brief

- **B1a · Gantt in the room.** A "Schedule" disclosure renders the detail route's existing `gantt`
  through the shared `gantt-chart.tsx` (the room stopped rendering it when the old entity-detail
  died — this is render-work). The time envelope (start/end) is DERIVED: earliest arrival → latest
  due/meeting date across the deal's rows. No new columns; a manual envelope can come later if
  asked.
- **B1b · the living status brief** (her "Current status" — *What it is / Priority now / Key dates /
  People / Deliverables / Watch-outs*). Zero new AI: every line is already judged or already a fact —
  ASSEMBLY, which is plumbing. `lib/entities/status-brief.ts` `assembleStatusBrief`:
  - What it is → `state.summary` · Priority now → `next_move`
  - Key dates → the deal's dated rows (due dates, meeting dates) as a short chronological list
  - People → the people fingerprint (canonical names) · Deliverables → the pool rows (typed, by-whom)
  - Watch-outs → `state.blocking` + any evaluator `flag`/`revise` verdicts riding artifacts
  Rendered as the room Overview's lead card (replacing the bare summary line); each line links to
  its source (dates → the row, deliverables → the artifact plane). The share-status-update compose
  can read the same assembly (one source).
- **Gates:** room renders the Gantt from served data; the brief's every line traces to a stored fact
  (structural); live per user: a deal's brief assembles with ≥3 sections populated; no new AI calls
  on the room read (assembly only).

## B2 — Accept/Reject: meeting-extracted work becomes SUGGESTED

Her strongest pattern, and it is our own Prepared→Suggested→Awareness doctrine applied to
extraction. **Decision (behavior change, deliberate): meeting-extracted commitments land as
`status='suggested'`** — meetings are noisy (the misheard obligation, the self-counterparty class)
and she proved users want the review. Email-extracted commitments stay auto (grounded in explicit
written text — today's trusted behavior).

- `writeMeetingCommitments` writes `status: 'suggested'` (free TEXT, no migration). The spine
  EXCLUDES suggested from needsYou/waiting (never triage, never nag); the room's Tasks section gets
  a "Proposed from the meeting" block — card per suggestion: text · counterparty · due · provenance
  ("from <meeting>") · **Accept** (→ `open`, a learning signal) / **Reject** (→ `dismissed`, a
  learning signal — `logActivity` + `learning_signals`, both undoable via the existing restore path).
- The meeting deep-dive shows the same block (accept where you are). An "Accept all" affordance for
  the clean-meeting case.
- Backfill: none — existing open commitments stay open (no retroactive demotion).
- **Gates:** a synthetic meeting extraction lands suggested; suggested rows never appear in
  needsYou/waiting on any user's spine; accept flips to open + signals; reject dismisses + signals;
  restore un-does both.

## B3 — Home: the composer invites work; the horizon shows what's coming

- **B3a · composer promotion.** The Home ask bar's placeholder + chips become task-verbed:
  "Add a task…", "Plan my week", "What needs prep this week?" — the converse core already executes
  `create_task_item` and planning questions; this is framing, not new capability. A bare "add a
  task" with no project lands LOOSE (honest), with the room's founding chip as the upgrade path.
- **B3b · the Coming-up lane.** Above/beside the deck: **This week's meetings** + **To prep — next
  2 weeks** from the calendar cache, each keyed to its deal (entity link) where known; tapping opens
  the deal room (or the meeting). Deterministic assembly — the calendar reads exist.
- **B3c · prep-the-meeting (pass extension).** `prepareOneItem` gains a meeting-prep branch: an
  upcoming linked meeting inside the horizon gets a PREP BRIEF prepared (the deal's status brief +
  open tasks + last-thread pulse — assembled, then ONE reasoned tightening pass), landing in the
  pool attributed to the assistant, evaluated like everything else. Capped (2/day) and idempotent
  per meeting.
- **Gates:** chips fire real converse turns (live: "add a task for <deal>" lands linked+locked);
  the lane shows real calendar rows across users; a prep brief lands in the pool for a linked
  upcoming meeting (controlled fixture), idempotent second run.

## B4 — Human status + priority on tasks

- **`in_progress`** joins the status vocabulary (free TEXT): the room TaskRow's checkbox becomes a
  three-state cycle (todo → in progress → done; in-progress renders a half-filled box + the row
  joins a "Doing" group at the top of To-do). The spine maps `in_progress` → state `in_progress`
  (the WorkItem type already has it).
- **Manual priority** — ONE small migration `20260724_commitments_priority.sql`
  (`priority TEXT NULL` — 'high'|'low'; apply manually, flagged): a hover control on the row. The
  spine honors it as an OVERRIDE over the computed weight (human outranks machine, the
  `project_locked` precedent); the deck's ordering reads the same override.
- **Gates:** cycle persists + spine reflects it; an overridden priority reorders the deck above a
  higher machine weight (live); no keyword/heuristic — the override is a stored human fact.

## B5 — The artifact plane, universal (the Claude pattern for work)

The shell's three planes are locked: **conversation** (the per-deal rail, persistent) ·
**artifact** (the work surface) · **context** (the room, one breadcrumb away). What's missing is
universality of the artifact plane:

- A pool **deliverable opens IN the main card** (the same `focusedItem` mechanic — new focus kind
  `deliverable`), replacing the preview modal for room/deep-dive contexts: title, provenance,
  by-whom, the evaluator's caution when flagged, and the content.
- **Chat-reworkable**: "tighten the intro" in the rail regenerates THAT deliverable through the
  converse core (the draft re-seed path generalized — the steer carries the focused deliverable id;
  the rework writes a new pool version, never mutates history).
- **Loose-item parity**: the `/item` deep-dive uses the same focus kind — one shell whether or not
  a deal exists (the rule: loose = the same three planes minus context; founding a project adds the
  plane in place).
- **Gates:** structural — one focus mechanic serves email/meeting/commitment/deliverable; the modal
  path gone from room+deep-dive; live — a rework turn produces a NEW pool version linked to the
  same task, old version retained.

## B6 — Portfolio urgency (small)

Portfolio rows gain the per-project actionable line she proved: the next move + an urgency badge
(Overdue / Due soon — derived from the deal's own dated rows, deterministic) + the due date. No new
judgment — the reasoned prominence already ranks; the badge is a fact.

## Gates & order

`scripts/smoke-workbench.ts` grows per slice; regression: orchestrated-loop 39/39, work-loop 44/44,
tasks 72/72, room 15/15, briefing 11/11, recognition-integrity clean — every slice, all four users.

**Order: B1 → B2 → B4 → B6 → B3 → B5.** (B1 is pure reuse and feeds B3c's brief; B2 is the trust
gate; B4 unlocks her working style; B6 rides B1's derivations; B3 touches the Home last-but-one so
the deck stays stable while the substance lands; B5 is the deepest UI change and goes last.)

**Not in scope:** personal category taxonomies, a Home clone, manual project start/end dates
(derived only, until asked), Slack/email inbound, 5D capabilities (still paused).

---

## STATUS (July 24) — B1–B6 SHIPPED (B5 first half), gates green

`scripts/smoke-workbench.ts` **38/38** · orchestrated-loop 39/39 · work-loop 44/44 · tasks 72/72 ·
room 15/15 · portfolio 12/12. Notes:
- **B1** — Schedule disclosure (the ONE shared Gantt) + the living status brief (pure assembly,
  zero AI on read; people canonicalize through the registry, self excluded).
- **B2** — meeting follow-ups land `suggested`; Accept/Reject/Accept-all in the room; both are
  learning signals; the spine excludes suggested by construction. Proven live end-to-end.
- **B4** — `in_progress` + Doing group + Start/Pause; the CHECKBOX STILL COMPLETES IN ONE TAP
  (deliberate deviation from the plan's literal 3-state cycle — completion speed is sacred; the
  cycle lives in the Start/Pause control). Manual priority ships but ⚠️ **migration
  `20260724c_commitments_priority.sql` is NOT yet applied** — the spine degrades to no-overrides
  until it is (the live gate passes vacuously and says so).
- **B3** — composer chips ("Add a task…" prefills — a trailing … means fill-in, not send; "Plan my
  week" asks); the Coming-up lane (deterministic /api/home/horizon); the pass preps deal-linked
  upcoming meetings (live: 2 briefs each for users A+B, attributed to the assistant, evaluated).
- **B6** — portfolio urgency badge from the earliest OPEN due date (a fact, derived client-side).
- **B5 — first half shipped**: a deliverable is a first-class FOCUS (opens in the main card with
  by-whom/when; the modal path for deliverables is gone; entity-level deliverables surface in the
  room pool). **Queued second half**: chat-driven REWORK (a rail turn writes a NEW pool version —
  needs a converse capability) + loose-item `/item` parity for the deliverable focus.
- **Prod-skew note**: until the next dev→main deploy, PROD still mints pre-O1 rows (one new
  self-counterparty commitment appeared from prod's 16:43 sync — healed by the sweep) and composes
  pre-arc briefings (the briefing smoke's restatement fail is prod-composed content). Both end at
  deploy; re-run `scripts/heal-self-identity.ts --apply` after deploying.

## ITERATION (July 24, evening — user call after comparing homes)

The focus+peek deck is RETIRED — the 4th presentation of "What needs you" and the one that sticks:
**the TIME-GROUPED LIST.** The lesson across all four attempts (report-list reverted, carousel
reverted, deck retired): curation decides WHAT (the judged pool, unchanged), TIME decides the
visible frame (Overdue with ages · Due today · This week · When you can — legible, verifiable),
ONE row anatomy decides HOW (everything visible, actionable in place; judged priority still orders
WITHIN each group — a date-frame over the reasoned order is presentation, doctrine-clean). First
row keeps the emphasis treatment. Layout is TWO COLUMNS: the list + a day-grouped THIS WEEK
calendar card (sticky, deal-chipped, `lg:grid-cols-[minmax(0,1fr)_300px]`); the "To prep" card was
removed — the prep pass still prepares, its briefs live in the deal rooms. Gates updated
(smoke-workbench 39/39, agenda-coherence 22/22 — the spine's hero semantics are untouched);
production build clean.
