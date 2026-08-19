# THE PROCESSES ARC — a workflow's runs become visible, collaborative work

**Origin (Aug 18, owner mockups):** workflows need the collaborative shape — steps that wait on
different team members, a dedicated home per workflow, and the main page speaking what's
happening RIGHT NOW. The owner's mockups (Workflows page + process drawer + deep-dive with
Work/Timeline/Frames/History) are the design source. Frames stays ON STANDBY (roadmap fork).

**The semantic upgrade hiding in the mockups:** a run stops being an anonymous row and becomes a
PROCESS — a case with a subject ("Job profile — Senior Data Analyst"), people, a waiting-on
party, and receipts. Scheduled briefings stay calm single rows; the case grammar is ADDITIVE
(reaction/manual runs carry natural subjects today; handoffs arrive in Phase B).

## Laws

- **ONE DERIVATION, EVERY VIEW** (the machine pattern): `processStateOf` in
  `lib/workflows/process-state.ts` is the only reader of a run's human state — the deck, the
  Workflows page strip, the drawer, and the deep-dive all consume it. The page is a SCOPED
  PROJECTION of the deck's truth, never a sibling queue with its own state. Bucket words are
  fixed: **Needs my input · Running · Waiting on others · Delivered** (failed folds into
  Needs-my-input with its reason spoken; rejected/held lives in History).
- **ONE DEED, ONE DOOR**: Approve/Reject anywhere (drawer, deck card, room) fires the ONE
  existing resume route (`/api/workflows/runs/[id]/resume`) and lands the same ledger entry.
  New verbs (Reassign, Nudge — Phase B) get contracts at the same altitude, never per-surface
  implementations.
- **THE DECK STAYS THE ONE ATTENTION SURFACE**: a process needing you IS a deck row (the
  standing-commitment debt machinery already does this for parks). The strip's "Needs my
  input" renders the same derived rows — no new attention state anywhere.
- **ADDITIVE CALM**: a workflow with no handoffs and no parks looks exactly as quiet as today —
  one row, "completed 15h ago". Case chrome appears only when a case exists. Empty buckets
  don't render.
- **NO SECOND ROOM**: per-process conversation lives in the `run:<runId>` loose room
  (`room_turns` already accepts arbitrary keys). The drawer reads/writes THAT room (Phase B —
  comments ship with handoffs, whose asks they annotate). The workflow-level room stays the
  standing commitment's room.
- **RECEIPTS EVERYWHERE**: the drawer's Log and the deep-dive History are re-seatings of the
  run receipts that already exist (step outputs, durations, gate verdicts ✓/✎/⏸, decisions in
  the action ledger) — never a parallel record.
- **Frames = STANDBY**: the deep-dive builds the tab hidden behind a flag; no frame machinery
  in this arc.

## The derivation contract (`lib/workflows/process-state.ts` — orchestrator-owned)

```
ProcessState = 'needs_you' | 'running' | 'waiting_on_others' | 'delivered' | 'failed' | 'held_back'
ProcessRow = { runId, workflowId, workflowName, subject, state, reason?, startedAt, endedAt?,
               stepsDone, stepsTotal, gate?: {status, fixed}, triggeredBy }
```
- `queued`/`running` → running · `awaiting_approval` → needs_you (Phase A: every park is the
  owner's; Phase B adds assignee-aware waiting_on_others) · `succeeded` → delivered ·
  `failed` → failed (BUCKETED under Needs-my-input, reason carried) · `rejected` → held_back
  (History only).
- **THE SUBJECT LADDER** (derived, no migration): reaction-fired runs → the triggering event's
  title (the `reaction_fire` item_plans row is keyed by runId and carries the context);
  else the run's deliverable/artifact title; else `<workflow name> — <date>`. Scheduled
  repeat runs deliberately keep the plain workflow name (calm).
- Gate chip from the last verify verdict on step_outputs (the existing delta rule: silent
  when passed).
- Served by the LEDGER ROUTE (`/api/workflows/ledger` gains `processes: ProcessRow[]`,
  capped recent window) — one fetch feeds the strip, the drawer index, and (filtered by
  workflowId) the deep-dive Work tab.

## Phase A — the surfaces over existing truth (this arc)

- **A1 — the Workflows page restructure** (`components/workflows/workflows-ledger.tsx`):
  describe-one composer stays on top; ACTIVE PROCESSES strip (bucket counts + needs-you-first
  rows, each opening the drawer); YOUR WORKFLOWS rows in the mockup grammar (status dot ·
  name · shield/gate marks · schedule · delivered-by coworker · last state · play/pause/Edit
  in Studio); the recent-trail History view stays as the strip's HISTORY toggle.
- **A2 — the process drawer**: right side panel (the overlay idiom) opened from any process
  row — header (subject · workflow · presenter coworker · started), tabs **Handoffs | Log**.
  Phase A Handoffs = the owner-approval gate rendered as step 01 with Approve/Reject through
  the one door (Reassign/Nudge appear DISABLED with "coming with handoffs" only if trivially
  cheap — otherwise absent); Log = the RunAudit content (steps · durations · outputs · gate
  receipts) re-seated.
- **A3 — the deep-dive page** (`/workflows/[id]` route + `components/workflows/workflow-detail.tsx`):
  header (coworker avatar · workflow name · schedule · Run now · pencil→Studio), tabs
  **Work | Timeline | History** (+ Frames hidden). Work = this workflow's ProcessRows in the
  bucket table (drawer on click). Timeline = runs on one date axis (reuse the gantt-date
  helpers/idiom, lightweight). History = completed runs with duration, decisions count (action
  ledger), and the receipt chips. "Back to Workflows" — Studio remains the method editor.

## Phase B — THE HANDOFF ARC (the build contract, Aug 18)

The collaborative half: a step that waits on a HUMAN teammate. Owner decisions locked:
visibility default = the assignee sees THEIR step + minimal context (the ask + a short
preview), never the workflow; notification = coworker email, best-effort; **REASSIGN is
DEFERRED to B2** (a per-run assignee override needs its own store — the mockup button waits;
never render a disabled ghost).

- **THE STEP** (`HandoffStep` in types.ts): `{type:'handoff', id, label, assignee_user_id,
  assignee_name?, ask?, sla_hours?}`. Studio-authored (picker entry "Wait on a person";
  assignee from the workspace-member roster — /api/meetings/teammates). A handoff SITS WHERE
  PLACED — seatGate moves only verify; mid-pipeline handoffs are legitimate (review → publish).
  generate-config emission deferred (noted, not built).
- **THE PARK** (run-workflow loop, mirroring the approval branch): non-test → status
  `awaiting_approval` + snapshot (same loud-park law); `isTest` auto-passes
  (`[Handoff — auto-passed in test mode]`). On park, `lib/workflows/handoffs.ts` (new module)
  `parkHandoff`: (1) the ASSIGNEE'S ASK — a `commitments` row for the assignee
  (direction you_owe, source='handoff', source_id=runId, description = the ask + subject,
  due = SLA date when sla_hours set) so THEIR deck carries it (the deck stays the one
  attention surface, now per person); (2) an `approval` component turn in the assignee's
  commitment room (state {runId, workflowId, name, instruction: ask, preview ≤400,
  handoff: true}) — the existing room card renders Approve/Reject; (3) best-effort coworker
  email to the assignee (the workflow's presenting coworker writes it; failure never breaks
  the park); (4) the OWNER's standing narration ("waiting on <name> — <ask>").
- **THE GATE BELONGS TO THE ASSIGNEE** (`canResumeRun(admin, runId, callerId)` in handoffs.ts —
  the ONE authorization read): the OWNER may always resume; the CALLER may resume iff the
  run's CURRENT step (steps[step_outputs.length]) is a handoff assigned to them; everyone
  else refuses. The resume route consults it and otherwise stays THE ONE DOOR
  (approve→resume passes exactly that gate with `[Approved by <name>]`; reject→rejected).
  A decision closes the assignee's commitment, logs waited-time (commitment.created_at →
  now) into the run room + activity, and narrates.
- **THE DERIVATION grows viewer-aware** (process-state.ts, orchestrator-owned): for a parked
  run, the CURRENT step decides — a blocked-verify tail is ALWAYS the owner's (guardrail hold
  outranks: the next step must not misattribute the wait); an approval step → needs_you; a
  handoff step → needs_you when assignee === viewer else waiting_on_others + waitingOn
  {name, role?}. The ledger route serves the owner's view; the assignee's attention rides
  their own deck commitment (never a second queue).
- **THE SLA CHASE** (`sweepHandoffSLAs` in handoffs.ts, wired into the dispatch cron's
  after() tails): a parked handoff older than sla_hours → the coworker nudges the assignee
  (coworker email, ≤1/day per run — the fire record rides item_plans kind 'handoff_nudge')
  + the owner's room narrates the breach. The missed-promise floor, generalized to people.
  The drawer's NUDGE button (owner-only) fires the same nudge on demand through one route.
- **SURFACES**: Studio — the handoff step config panel (member picker, ask, SLA select) and
  a violet person-station render in the flow (a gate-like node wearing the assignee's name);
  drawer Handoffs tab — the NUMBERED list of human gates (approval + handoff steps) with
  per-step status (done/waiting/upcoming), Approve/Reject on the waiting one when the viewer
  holds its gate, Nudge (owner, when waiting on someone else); deep-dive Work rows +
  ledger strip speak "waiting on <name>".
- **GATES SHIP WITH THE ARC** (`scripts/smoke-handoffs.ts`): TWO probe users in one scratch
  company, the HR scenarios from the owner's mockups — H1 job-profile pipeline parks at the
  reviewer's gate (commitment + room card + owner narration land); H2 the owner's derivation
  reads waiting_on_others with the name while a blocked-verify tail still reads needs_you;
  H3 authorization truth-table (owner yes · assignee yes · stranger NO); H4 assignee approve
  → run completes, commitment closes, waited-time logged; H5 reject → rejected + honest
  narration; H6 SLA sweep nudges once (cap proven by double-run); H7 the hiring loop —
  TWO handoffs in one pipeline park sequentially (resume passes only its own gate);
  H8 verify-gate + handoff coexist; H9 test mode auto-passes and creates NO cross-user
  debris. Cleanup asserts zero leftovers on BOTH probes.

## Phase C — reach + depth (queued)

Inbound handoff replies (Slack/email — the scoped inbound build), drift analytics on History,
Frames on the roadmap's word, stored subjects/references if case volume warrants a registry.

## Phase B2 — THE PEOPLE SLICE (owner + reassign; specced Aug 18, owner's walk notes)

- **THE OWNER ≠ THE CREATOR** (the History mockup's "Owner changed" chip, now first-class).
  THE SPLIT LAW: **execution identity stays the creator** (`workflows.user_id` — whose mailbox,
  AI tier, coworkers, and connections every run uses; moving that is never on the table);
  **owner = the accountability layer**: `owner_user_id` (nullable column, migration applied
  manually; null = creator owns). The owner is who (1) carries the STANDING BINDING's debt on
  their deck, (2) approval parks default to (canResumeRun's 'owner' role reads owner_user_id ??
  user_id), (3) ghost notices reach (see the AI-Ops slice), (4) attribution speaks
  ("delivered by Max · owned by Jordan"). An owner change NARRATES into the standing room and
  the run History ("Owner changed" chip) — an accountability transfer is never silent. Surfaces:
  an Owner row in the deep-dive header + Studio identity section (workspace-member picker).
- **REASSIGN (the deferred B2 half)**: a parked handoff's gate moves to another workspace
  member. Per-run override store: item_plans kind='handoff_override' entity_id=`${runId}:${stepId}`
  tasks={assigneeUserId, assigneeName, by, at} — parkedGateOf/canResumeRun consult the override
  BEFORE the step's static assignee. Reassigning: closes the old assignee's commitment
  (resolved_reason 'reassigned'), parks a fresh ask on the new assignee (parkHandoff limbs 1–3),
  narrates in the owner's room, logs the decision. The drawer's Reassign button un-defers
  (owner-only, member picker). The workflow STEP definition never mutates (a per-run decision
  is not an authoring change).
- Rider (from the smoke suite's finding): decisions on manual workflows currently narrate to
  the activity ledger only — land them in the `run:<runId>` room too (the no-second-room
  clause's designated home), so every process has a spoken decision trail.
- Gates ride smoke-handoffs: owner-change narration; reassign closes-old/asks-new/authorizes-new
  (old assignee refused after); override outranks the static step; execution identity unchanged.

## THE METRICS TAB (receipts workstream; specced Aug 18 — small, substrate exists)

The per-workflow ROI receipt, seated LEFT OF HISTORY in the deep-dive tabs (Work · Timeline ·
Metrics · History). Substrate already live: `ai_usage_events` carries tokens/cost per
workflowId (AI-Ops instrumentation); run rows carry durations.

- **THE BASELINE IS AUTHORED, NEVER GUESSED**: one field at creation — "how long does this take
  you manually?" (`estimated_manual_minutes` on the workflow; asked on the creation card +
  Studio identity; generate-config prompts for it; nullable — absent renders "add your manual
  time to see time saved", never a fabricated number). This fixes the AI-Ops flat-15-min
  limitation AT THE SOURCE for workflows.
- **The tab shows**: runs completed · median/last run duration · tokens + cost (in/out split,
  the AI-Ops fmt) · time saved = runs × stated baseline (labeled "your estimate", the AI-Ops
  honesty law: estimated is never dressed as measured) · the gate's intervention rate (✎/⏸
  share — the quality receipt beside the money receipt).
- One aggregation endpoint (or a ledger-route sibling) over ai_usage_events + workflow_runs
  grouped by workflow_id; zero new instrumentation.

## GHOST AGENTS (AI-Operations governance slice; specced Aug 18 — AFTER the owner exists)

The company lens over the signal the personal tier already acts on (auto-pause after 3 unreviewed
runs, `reviewed_at`): automations that RUN but are never USED.

- **THE GHOST LIST** (AI-Ops dashboard section, admin-only): workflows across members with
  their unreviewed-output rate AND attached spend (per-workflow cost exists) — "suggests a post
  every week; never opened; €X this quarter". Detection = reviewed_at-null share over a window +
  last-reviewed age; deliveries the app can't observe (email home) stay EXEMPT and say so
  (the auto-pause exemption law, kept).
- **THE 30-DAY EXPIRATION POLICY**: a company setting (`companies.settings.ghost_expiry_days`,
  default ON at 30 when the admin enables it) — a workflow whose outputs go N days unreviewed
  auto-pauses via the EXISTING auto-pause machinery (time-based sibling of the 3-run rule),
  notifies the OWNER (owner_user_id — why this slice sequences after B2), and the pause
  narrates honestly ("paused by company policy — 30 days unreviewed; press play to resume").
  A human resume sticks (the dismissal-sticks law); the policy never deletes anything.
- Boundary held: this is OPERATIONAL policy (spend/usage), not content governance — the
  Strategy-tab invariant (company goals never reach coworker context) is untouched.

## Gates (laws-need-gates: shipped WITH the arc)

`scripts/smoke-processes.ts` — (1) pure derivation table-tests over `processStateOf` (every
status × subject-ladder branch, gate chip delta rule); (2) source floors: the strip/drawer/
deep-dive all import `process-state` (one-derivation law), the drawer's approve posts to the
one resume route (no second door), empty buckets don't render (calm floor), Frames behind the
flag; (3) the ledger route serves `processes[]` with the contract's fields.
