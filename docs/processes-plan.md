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

## THE MOCKUP-FIDELITY WAVE (Aug 19 pm — the owner refocused on the original mockups; build contract)

Closing the remaining mockup gaps. Orchestrator decisions locked: comments = the `run:<runId>`
room (NO SECOND ROOM — stored under the workflow CREATOR's user_id, served/written through ONE
authorized route: owner, accountability owner, or any current/past gate holder of that run;
author attribution on every turn); the deep-dive composer = A DOOR TO THE STANDING ROOM'S
CONVERSATION (converse scoped to the standing commitment item when a binding exists — steer/run
intents already live there; without a binding the composer hides, honestly); REFERENCE IDS stay
deferred (registry-tier); the mockup's cross-workflow Work table is read as the DEEP-DIVE's
per-workflow table (the strip stays the cross-view).

- **THE PROCESS TABLE** (deep-dive Work tab, the mockup's grammar): columns SUBJECT (+ customer
  chip = the workflow's entity scope name; 'Internal' when none) · PEOPLE (facepile: the run's
  gate holders incl. overrides + the owner; initials discs, no photos we don't have) · WAITING
  ON (the served waitingOn / 'You' / '—') · PROGRESS (bar + n/n) · LOG ('N steps' opening the
  drawer's Log tab). 'Show completed (N)' toggle appends delivered/held rows.
- **HANDOFF COMMENTS**: `GET/POST /api/workflows/runs/[id]/comments` — turns in the creator's
  `run:<id>` room (role user, author {name}, dedupe-free), authorization as above; the drawer's
  gate cards show 'N comments' + an expandable thread + a one-line composer. The decision cards
  in the run record quote the thread's latest line at decision time when present.
- **THE RUN RECORD** (read-only drawer from History rows): header + 'Read-only record.' line;
  tabs **Decisions | Log | vs. previous**. Decisions = every human gate of the run: approvals
  from step outputs ('You approved'), handoffs from their commitment rows (who — name+role
  line, when, WAITED = resolved_at−created_at, 'over target' when waited > sla_hours, the
  decision comment). Log = the existing receipts grammar. **vs. previous (v1, deterministic,
  no AI)**: this run vs the SAME workflow's previous completed run — duration delta, executed
  step labels added/removed (config drift), gate findings delta, decisions count delta.
- **DRIFT CHIPS on History rows** (deterministic derivations, one module
  `lib/workflows/run-record.ts` — orchestrator-reviewed): `Rejected` (status) ·
  `Handoff over SLA` (any handoff waited > its sla_hours) · `Owner changed` (an owner-change
  activity/narration between this run and the previous) · `Review step skipped` (the previous
  completed run executed a verify/approval step this run's outputs lack — config/behavior
  drift). Rows gain decisions count · waited summary · facepiles. Client-side search filters
  by subject/decider names.
- **TIMELINE bar-end labels**: 'You' / the waiting person's name at the bar's right edge
  (the mockup's grammar; served waitingOn only, never derived locally).
- Gates ship with the wave (laws-need-gates): derivation table-tests for run-record
  (waited/over-target/skipped-step/vs-previous on fixture runs), the comments authorization
  truth table (owner yes · holder yes · stranger 404), source floors (one comments route,
  composer renders only with a binding, facepiles from served data).

**PROGRESS (Aug 19 eve — BUILT, uncommitted): the whole wave landed, loop-engineered (3 Opus
build agents + 1 gates agent, every diff orchestrator-reviewed). Suite `scripts/smoke-run-record.ts`
97/97 ×2 · processes 65/65 · handoffs RE-EARNED 201/201 · tsc + production build green.**
- Engine: `lib/workflows/run-record.ts` (Decision/RunSummary, pure driftChipsOf/vsPrevious,
  `canReadRunRecord` = the ONE visibility predicate — past gate holders keep READ, resume stays
  current-holder-only) + `runs/[id]/comments` (GET/POST, role-'user' turns in the creator's
  `run:<id>` room, system narrations filtered out) + `runs/[id]/record`. HONESTY FLOORS: a
  multi-handoff run NEVER borrows an SLA (slaHours null rather than guessed); a test auto-pass is
  not a human decision; unknowable timestamps stay null; a nameless handoff decider renders
  "A teammate", never "You" ("You" is claimed by KIND — approval gates only).
- Surface: process TABLE (subject+scope chip · served facepiles · waiting-on · progress · Log
  link opening the drawer ON its Log tab via new `initialTab`; row itself is the door;
  Show completed fold), History regrammar (drift chips · decisions count · waited summary ·
  client search) opening the read-only RUN RECORD drawer (Decisions | Log | vs. previous — zero
  affordances), Timeline bar-end labels (served map only; failed ≠ "You"), drawer per-gate
  "N comments" → ONE honest run-level thread ("Notes on this process" — never fake per-gate
  threads), the composer = the standing room's door (words persist FIRST via /api/room/turns,
  then steer, then the reply — a failure never drops the user's text; no binding → hidden).
- ORCHESTRATOR FIXES ON REVIEW: (1) ONE RUN ROOM — both `narrateInRunRoom` call sites in
  handoffs.ts re-keyed from the transferable accountability owner to the CREATOR (matching
  comments; an ownership change was about to split one run's trail across two rooms); gated (C-B5).
  (2) reviewStepLabels fallback aligned with executedStepLabels (diverging fallbacks would chip
  "Review step skipped" chronically on unlabeled review steps); gated (A4b).
- Two stale smoke-processes gates RE-POINTED (the pre-mockup "Work drops held_back" law was
  superseded BY DESIGN by the Show-completed fold — replacement pins the new law equally hard).
- Suite lesson worth keeping: a source floor counting call sites must count COMMENT-STRIPPED code
  (the raw grep counted the comment that *says* it's the only call site).
- **THE BADGE POINTS AT ITS ROWS (owner walk, Aug 19 eve — suite now 101/101)**: the nav's
  Workflows badge (unreviewed succeeded runs, 30d — rooms/recent) never named WHICH rows it meant.
  Now the ledger route serves the SAME predicate per workflow (`unreviewed` on ledger rows + recent
  groups — a dedicated query, NOT derived from the 25-run window, so badge N = Σ row pills by
  construction); the rows wear the identical indigo pill; and every reviewing deed clears through
  the ONE reviewed_at stamp: open a deliverable (existing) · expand the run trail (new) · open the
  workflow's deep-dive page (new mount stamp) — each optimistically zeroes the pill and bumps the
  sidebar via `aug:conversation-changed`. Gate C6 pins predicate parity across both routes, the
  served share, the rendered pill, and the stamping doors.
- **A RUN NEEDS ITS MATERIAL (René's incident, Aug 20 — processes 124/124 ×2; suites re-earned
  handoffs 250 · frames 216 · run-record 102)**: a draft reaction workflow ran with no event and
  SUCCEEDED with a six-step narrated-emptiness cascade as its "deliverable" (which the frame
  lane then dressed). TWO STATES, DELIBERATELY DISTINCT: **READINESS** (workflow-level,
  `lib/workflows/readiness.ts` — ONE pure rule table, first failing rule speaks: no steps ·
  draft · unassigned handoff · feature-gated tool · blank reaction trigger; paused IS ready;
  null features abstains) served on ledger rows + workflow GET → the amber "Not ready" chip +
  reason in the state slot, RUN NOW SPEAKS the reason instead of firing (no dead buttons), the
  dispatcher SKIPS (no doomed run row; next_run_at still rolls); and **THE REFUSAL AT THE DOOR**
  (run-level, run-workflow): not-ready · reaction-without-its-event (structural fact =
  empty triggerContext; resumeFromApproval exempt) · empty-first-tool-material → ONE ordinary
  failed run with the spoken reason, ZERO steps, no thread/deliverable/frame/report-back — the
  existing failed→needs_you lane carries it (NO new run status). COPY LAW enforced on review:
  the refusal sentence claimed "attach sample material to test" — an affordance that doesn't
  exist; corrected + a copy floor pins "sample material" out. PLUS the drawer's GATE OBJECT
  ("What's being approved" on the waiting card via the SAME previewFromOutput, one lifted run
  fetch). Gates P7a–P7k.
- **THE GATE CARRIES ITS OBJECT (owner-found, Aug 20 — handoffs 250/250 ×2; closed the arc's
  last UX gap)**: the handoff commitment room's decision card now SHOWS the work being gated —
  served block `handoff{workflowName, runId/At, ask, slaHours, askedByFirst, selfGate,
  workerName, parked, preview{text, truncated}}` on GET /api/commitments/[id] (ONE derivation,
  `lib/workflows/handoff-context.ts`; entitlement = the caller's own handoff row, the same fact
  canReadRunRecord grants 'holder' on; preview = the run's last output, 20k whitespace-honest
  cut). The card: provenance header (kills the false "no linked source" line for handoffs only) ·
  "What you're approving" scrollable object · optional note → the run's ONE comments room,
  best-effort BEFORE the resume · "See the run's receipts →" reuses RunRecordDrawer (a refused
  owner-scoped read passes NULL → the Log tab speaks ACCESS, never a false "no receipts") ·
  selfGate softens to "your own gate". **THE MOVE YIELDS, agnostically**: render-plan's
  PanelPlanInput gained hasGatedDecision, folded into ONE hasDecision BEFORE the table (the
  table never branches on kind); pure applyPanelPlan strips move/offers at the door — room-shell
  and item-rail untouched (H17g source floors pin the invariant). Gate-suite lesson: the
  one-door endpoint gate must match URL LITERALS with interpolations stripped (`${handoff.…}`
  false-fired on a variable name). Hygiene note queued: a generic run-room turn sweep over
  runIdsCreated in smoke-handoffs' finally (H10–13 narrations linger on probe A).
- THE SENDER FALLBACK LADDER (owner, Aug 20 — handoffs 204/204): a coworker-less workflow's
  park/nudge email speaks as the OWNER'S PERSONAL ASSISTANT (resolved at the ONE emailAssignee
  seam both park and chase ride), never the generic team@ stranger; team@ survives only as the
  never-crash floor. Gate H16.
- Walk polish (same eve): the ledger column widened (max-w-3xl → 5xl, the mockup's breathing
  room); THE TILE WEARS THE STATE — workflow rows lead with a 40px identity tile (house bolt
  fallback, rounded-xl at that size) carrying the status dot on its corner (ring-2 ring-white),
  replacing the stray gutter dot + 22px inline mark; the deep-dive header's SSR'd date is
  hydration-guarded (the client owns the clock — locale/tz mismatch found live; gate C7);
  THE LEDGER ROUTE FLATTENED ("loading takes a bit of time") — six independent reads (owners ·
  agent names · thread artifacts · reassign overrides · team shared · features flag) were awaited
  SEQUENTIALLY (~7 extra round-trips per cold load); now pure derivations hoist first and
  everything flies in ONE Promise.all (route ≈ 3 round-trip phases total; the LS instant-paint
  already covered warm visits — the cold paint was exactly this route's latency); and the cold
  paint itself wears A SKELETON IN THE ROW'S OWN SHAPE (card + tile + two shimmer lines, header
  kept) — never a bare "Loading…" string, no layout jump when the truth arrives.

## Phase C — THE REPLY RAIL (owner decision Aug 19: ON DATA TRIGGER, not queued)

Inbound handoff replies (Slack/email reply-to-approve — the scoped descendant of the original
"Slack inbound" strategic bet; the entry rung that builds the webhook/verification rails the
bigger senses-for-the-ledger vision later reuses). DEFERRED DELIBERATELY: approvals stay
IN-PLATFORM — the email deep link lands on the one-button decision card, assignees are workspace
members with decks, and reply-by-email is an action gate driven by spoofable identity (a new
security surface the regulated tier shouldn't carry before it earns its risk). **THE TRIGGER IS
THE RECEIPTS**: the SLA machinery records every chase (handoff_nudge rows, waited-times) — build
the rail when the data shows asks dying at the login wall (repeated nudges, long gate waits),
not before. Also still here: drift analytics on History, stored references if case volume
warrants, Frames on the roadmap's word.

## Phase B2 — THE PEOPLE SLICE (owner + reassign; specced Aug 18, owner's walk notes)

- **THE OWNER ≠ THE CREATOR** (the History mockup's "Owner changed" chip, now first-class).
  THE SPLIT LAW: **execution identity stays the creator** (`workflows.user_id` — whose mailbox,
  AI tier, coworkers, and connections every run uses; moving that is never on the table);
  **owner = the accountability layer**: STORE (build decision, Aug 19 — no migration): item_plans
  kind='workflow_owner' entity_id=workflowId tasks={ownerUserId, ownerName, by, at} — the
  workflow_scope precedent; absent = creator owns; promotable to a column if the read gets hot. The owner is who (1) carries the STANDING BINDING's debt on
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
  you manually?" (STORE, build decision Aug 19: `output_config.estimated_manual_minutes` — one
  existing save path, no migration; asked in Studio identity + the creation card;
  generate-config prompting deferred; absent renders "add your manual time to see time saved",
  never a fabricated number). This fixes the AI-Ops flat-15-min
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
