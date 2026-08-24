# THE RELAY CANVAS — workflows as a readable track (spec v1, Aug 21)

**The sentence**: a workflow reads top-to-bottom as one relay — doors converge at the top,
blocks pass the baton down a machine-laid track, stations guard the line, one endpoint delivers —
and everything the canvas can draw is sayable through every other door.

Born from René's CV-triage whiteboard (the gap ladder recorded in the processes plan) + the
owner's calls: keep the building-blocks relay (NOT a free 2D canvas — layout is always the
machine's job, never the user's); Make/n8n's recognizability with Zapier's spine; current
capabilities only (no new integrations — the trigger/step catalogues stay registry-driven so a
future integration is ONE ROW); the interview problem is solved by SUBPROCESS COMPOSITION, not a
branching engine (pipelines stay linear; the process becomes a graph of pipelines).

## THE LAWS

1. **ONE SCHEMA, FOUR DOORS (the parity gate).** Describe-it, coworker chat (create/update_task),
   Home chat, and the canvas all read/write the SAME workflow config. A primitive that does not
   reach all four doors in its own wave DOES NOT SHIP — gated (the P21 precedent: a verb without
   a preparation path is a build error). The known pre-existing violation this arc opens by
   fixing: Studio's trigger editor cannot author a reaction trigger and DESTROYS one on touch.
2. **THE MACHINE LAYS OUT.** No pan, no zoom, no user-placed nodes, no crossing wires.
   Convergence exists at DEFINED points only: the intake fan (many doors → the first block) and
   source fan-in before a synthesis block (which is today's engine semantics drawn honestly —
   every step already sees all prior outputs). Free-form wiring is structurally impossible.
3. **THE REGISTRY IS THE CATALOGUE.** Trigger sources and step tools are registry rows
   ({key, label, feature, icon, …}); the WHEN block, readiness, the dispatcher, generate-config
   and the chat tools all render from the registry. Adding a source/tool = one row (the
   CAPABILITY_MAP invariant applied to triggers).
4. **BLOCKS CARRY THEIR RECEIPTS.** A block shows its verb in a human sentence, its check chip,
   and ITS OWN readiness (the unassigned handoff wears "needs a person" on itself, live while
   building — readinessOf is pure, so this is nearly free). Stations are pills ON the line
   (verify · approval · handoff · SUBPROCESS); endpoints cap the rail (WHEN at top with the
   inputs tray, DELIVERS at bottom). The gate station speaks its aggregation ("checks from 3
   steps · 2 of your rules").
5. **A SUBPROCESS IS A HANDOFF TO A MACHINE.** Step type `workflow`: the parent parks at the ⧉
   station (the SAME awaiting machinery as human gates), the child runs its own rail with its
   OWN gate/owner/SLA, its completion resumes the parent with its deliverable as the step
   output (the get_workflow_output semantics, awaited). Floors: depth cap 1 (a child may not
   contain a workflow step — readiness refuses), circular-reference refusal, test mode NEVER
   fires the real child (it uses the child's latest delivered output, exactly like
   get_workflow_output today). Loops = composition: "when another workflow delivers" is a
   TRIGGER SOURCE, so two linear pipelines form René's cycle with no loop engine.
6. **MANY DOORS, ONE RUN.** `triggers[]` is any-of: each door fires ITS OWN run carrying the one
   thing that arrived (which door fired rides the run's context — the normalizer step can see
   it). Constraint v1, stated not hidden: at most ONE schedule trigger per workflow (next_run_at
   is singular); manual is always available. Cross-run accumulation is NOT fan-in — that is the
   case layer (W4).
7. **INPUTS ARE VISIBLE.** A workflow's reference material (policies, templates) is a pinned
   INPUTS TRAY on the rail — first-class config, not a buried skill; the triggering event's
   attachments flow into the run as material; Run-now gains the material door (which also makes
   reaction workflows testable — the clause the refusal copy earns back).
8. **CURRENT CAPABILITIES ONLY.** W1–W4 touch no external surface. Internal event sources ship
   first: mail reaction (exists) · a file lands in Knowledge · a meeting is recorded · another
   workflow delivers. René's own "Later" boxes (talent platform, LinkedIn) wait for their
   registry rows.

## THE SCHEMA (additive; ONE migration — the arc's only one)

⚠️ **`supabase/migrations/20260821_workflows_triggers.sql` must be applied manually** (Supabase
SQL editor, the house rule): `workflows.triggers JSONB` — deliberately NULLABLE with NO default
(discovery reads `triggers is not null`; a `DEFAULT '[]'` would make every workflow a candidate)
+ a partial index. Until applied, everything degrades to legacy-mail-only (proven: no throw,
no fire). The spec's "no migrations" survives everywhere else.


- `workflows.trigger` stays authoritative for manual/schedule (next_run_at unchanged).
  NEW `workflows.triggers: ReactionTrigger[]` (jsonb, additive) = the EVENT DOORS
  (`{type:'reaction', source: <registry key>, when, label}`). `normalizeTriggers(wf)` in
  `lib/workflows/trigger-sources.ts` is THE ONE READER (legacy single reaction trigger folds in;
  every consumer — dispatcher, readiness, matching, serving, Studio — reads the normalized list).
- `lib/workflows/trigger-sources.ts` also owns the SOURCE REGISTRY:
  `mail` (exists) · `file` (knowledge upload confirmed) · `meeting` (insights generated) ·
  `workflow` (a named workflow's run succeeded). Each row: {key, label, icon, feature,
  configShape}. Fire doors all converge on the EXISTING reaction fire machinery (one exactly-once
  record shape, per-source event context block).
- Inputs (W2, build decision Aug 22 — NO second migration): `item_plans` kind
  `'workflow_inputs'`, entity_id = workflowId, tasks = `{ docs: [{kbFileId, name}],
  acceptMaterial }` (the workflow_owner/workflow_scope/frame_share store precedent). Served on
  the workflow GET as `inputs`; written through the [id] PATCH. THE RUN CARRIES THEM as a
  `[WORKFLOW INPUTS]` block (doc heads, excerpt-marked — the excerpt-honesty law) visible to
  every ai step. THE MATERIAL DOOR: `POST /api/workflows/[id]/run` accepts
  `{ material: { text, name? } }` → rides as trigger context labeled MANUAL MATERIAL — which
  makes reaction workflows TESTABLE and earns the refusal sentence its second clause back.
  THE FILE DOOR MATURES: its fire moves to extraction-complete (the indexer tail, user uploads
  only as before) so the event carries real content, not just a filename.
- Subprocess (W3): step `{type:'workflow', workflow_id, label}`.
- Case (W4): own spec addendum before build — the normalizer step binds runs to a work_entities
  case; NOT started until W1–W3 land.

## THE WAVES

- **W1 — THE WHEN BLOCK**: schema + normalizeTriggers + the source registry; the three internal
  fire doors (file/meeting/workflow) hooked at their existing pipeline seams; dispatcher +
  readiness + reaction matching iterate the list; Studio's trigger panel becomes the WHEN block
  (Manual · Schedule · "When something happens" with the registry picker; multi-door chips;
  REACTION-PRESERVING — the destroyer bug dies); generate-config + worker-tasks author
  triggers[]; ledger serves door labels. Gates ship with the wave.
- **W2 — THE INPUTS TRAY + THE MATERIAL DOOR**: pinned docs on the rail feeding steps as staged
  material; reaction attachments ride into the run; Run-now accepts material (and the reaction
  refusal sentence earns back its second clause).
- **W3 — THE SUBPROCESS STATION** (law 5 whole).
- **W4 — THE CASE LAYER** (spec addendum first).
- **The re-skin rides the waves**: W1 lands the rail endpoints (WHEN/DELIVERS as blocks) + the
  intake fan; receipts-on-blocks and the picker unification land with W2; the mini-rail shared
  component (draft card + chat card + canvas, one renderer) lands when two doors need it.

## PROGRESS

**W1 — THE WHEN BLOCK BUILT (Aug 21; loop-engineered — 5 Opus agents, every diff reviewed;
suite `scripts/smoke-relay.ts` 135/135 ×3 · processes 124/124 · frames 216 · handoffs 250 ·
run-record 102 · build green; the `triggers` migration IS APPLIED live — doors are live):**
- Engine: the registry + normalizeTriggers (THE ONE READER; legacy reaction folds to a mail
  door; unknown sources dropped never invented; dedupe; law-6 one-schedule) · reactions
  generalized (ONE judge/fire/exactly-once/backstop, N sources; `workflow` source STRUCTURAL —
  zero AI, proven by an AI-fence live gate; mail keeps the HISTORICAL `:inbox:` token, pinned —
  a token change would re-fire history) · **THE SELF-LOOP GUARD was MISSING and caught by the
  seam agent** (a self-naming door would chain-fire per delivery, fenced only by the daily cap)
  — one engine line + live floor.
- Seams: file = HUMAN UPLOADS ONLY (the confirm route's four callers are all user surfaces;
  indexer paths never reach it — a workflow-made file cannot fire workflows) · meeting at the
  ONE insights-complete point · workflow-delivers in the success tail inside if(!isTest).
- Studio: the WHEN block (door chips + converging fan ≥2; three-section editor, schedule body
  byte-preserved) · **THE DESTROYER IS DEAD** (primary/doors independent writes; save carries
  both keys; legacy reaction migrates, never drops — 12 source floors).
- Parity: ONE sanitiser (`author-doors.ts` — registry→feature→condition→by-name workflow
  resolution with ambiguity refusal→law-6; notes ride as needs_door_note, spoken on the draft
  card) feeding generate-config AND worker-tasks (add/remove door verbs — additive, never
  full-replace: a partial utterance must not silently delete) · ORCHESTRATOR CLOSED the
  create-path hole (POST /api/workflows + the draft card Confirm carry doors; best-effort write
  isolated so pre-migration creation never breaks). AgentOS Python arg mirror lags a box
  redeploy (documented).
- Suite lessons: a repo-grep floor must exclude the defining module; a brace-guard assertion
  must brace-match, not first-occurrence.

**W2 — THE INPUTS TRAY + THE MATERIAL DOOR BUILT (Aug 22; suite relay 208/208 ×2 · processes
124/124 ×2 (4 declared re-points — THE LYING-DOOR FLOOR INVERTED: the "sample material" phrase
went from forbidden to REQUIRED-AND-BACKED, both directions) · frames 216 · handoffs 250 ·
run-record 102 · build green):**
- Store: item_plans kind `workflow_inputs` (no migration; foreign kbFileIds dropped+counted;
  stored names re-derived from the file rows). `buildInputsBlock` = excerpt-marked doc heads,
  every doc represented under budget, not-yet-indexed docs NAMED honestly.
- THE THREADING CALL: the inputs block rides the projectGrounding SYSTEM channel — never
  previousOutputs (can't be middle-cut away by step-output truncation) and inherited-excluded
  from the verify gate (a gate judges the draft against the run's own sources, never
  "corrects" from standing reference text).
- THE MATERIAL DOOR: run POST `{material}` → triggerContext; a reaction workflow WITH material
  RUNS (material is the event stand-in), without still refuses — with the sentence's earned
  clause. NOT gated on acceptMaterial (the flag is a surface affordance; gating would make the
  refusal's promise false for unconfigured trays).
- THE FILE DOOR MATURED: fires at extraction-complete via an EXPLICIT onIndexed listener
  argument (the shared indexer never guesses; artifact/source/chat-attach callers pass none —
  a made file structurally cannot fire workflows); gist carries the content head; a
  same-content re-upload lands the SAME exactly-once key (previously re-fired under a new row).
- Surfaces: the WORKS WITH tray (mention-picker reuse, both-keys save discipline,
  undefined-never-sent) · ONE run-material-sheet at both Run doors (readiness toast FIRST;
  runNow/startRun split — runNow holds no POST, gated) · ledger serves acceptMaterial
  (orchestrator's ride-along).
- Parity: authorInputs beside authorDoors — ONE shared resolveByName ladder (matchWorkflowByName
  now delegates); needs_input_note a SIBLING channel (a field named for doors must not carry
  document refusals); tri-state acceptMaterial (unsaid ≠ false — a partial utterance can't
  close a door the user opened); create-path ridden from birth this time.

**W3 — THE SUBPROCESS STATION BUILT (Aug 24; relay 336/336 ×2 (+128) · processes 124/124 ·
RENÉ'S LOOP LIVE):**
- lib/workflows/subprocess.ts = the whole law: async door check at fire time (missing/draft/
  depth-cap — readiness rule 7 and the door speak ONE identical self-reference sentence) ·
  insert-first claim (`subprocess_link`, the BATON stored on the row — auditable + durable) ·
  atomic parent claim on resume (double-completion can't double-resume) · failure propagation
  (a failed child fails the parent with a spoken sentence, never strands it) · the stranded-park
  sweep on the dispatcher · test mode borrows the last delivery, marked, never fires the child.
- run-workflow: the park at the station; `resumeSeeded` (seeds outputs, passes NO human gate —
  proven live: the resumed run parks again at its own later approval); FOUR terminal ends notify
  the parent through one seam. reactions' stale-child backstop re-fires WITH the stored baton
  (orchestrator fix). TWO LYING DOORS closed: the ledger's awaiting list excludes machine parks;
  the resume route 409s them ("…it continues by itself when that delivers").
- Surfaces: the ⧉ compound block (exclusions NAMED not hidden: self/draft/nested); the drawer's
  SubprocessStation (machine gate, structurally zero human verbs, no GateObject);
  waitingOn.role='process' (a process never renders as a person's face). Parity:
  authorSubprocessSteps on the ONE ladder, FIREABLE-SET ALIGNED with the door (authoring can
  never seat a station the fire door refuses), needs_step_note third sibling, the ⧉ card word.
- **THE CYCLE CEILING — RESOLVED BY W3b (owner call, Aug 24)**: the cap became THE THROTTLE
  (queue-not-drop, editable 1–100, default 20) — a composed cycle is throttled-and-lossless,
  bounded per day, never dropped and never an explosion. Still no cycle detector (gated fact;
  the ledger + auto-pause are the visibility net).

**W3b — THE THROTTLE BUILT (Aug 24; relay 407/407 ×2 (+62 TL/TD/TR/TB/TS; F refit; RL matured
to "the cycle DEFERS at the throttle") · processes 124/124 · smoke-compute PA6a re-pointed
(stronger: "queues what it defers and says so"; 4 pre-existing unrelated reds on record —
PA1/PA5/CS6/OP1)):**
- reactions.ts: DAILY_CAP dead; THE COUNTING FACT = `deferred !== true` (one predicate, three
  readers — reads every pre-W3b record with zero backfill); deferral = the same exactly-once
  record + queued run, no start; the throttle sits BEHIND the judge (a deferred event costs no
  second judge); `drainDeferredFires` (oldest-first, headroom = limit − startedToday, atomic
  conditional-update start claim); the backstop skips deferred-unstarted (the flag PARTITIONS
  the lanes — no double-start by construction); subprocess children uncapped by construction.
- fire-limit.ts: default 20, floors 1–100 (SYSTEM ceiling — with queueing, "unlimited" only
  buys unbounded same-day spend); default-write deletes the row; THE FLOOR IS THE FLOOR ('' /
  0 / negatives land on 1, never 0 — gated).
- Surfaces + parity: the WHEN-panel stepper (doors-only, constants imported — no literal
  ceilings); "at most 3 a day" authors fire_limit; daily_run_limit on both chat verbs through
  ONE write path; clamps SPOKEN everywhere; the draft card claims the pace only when
  non-default; the POST create-path ride.
- **SUITE LESSON (permanent, top of smoke-relay)**: an in-process env fence + a module-level
  client cache = a poisoned process — fences live in CHILD PROCESSES (frames' L3 pattern);
  structural proofs should be refit to structural fixtures so no fence is needed at all.
- AgentOS Python arg mirror (daily_run_limit) lags a box redeploy, as with W1/W2 args.

## W3b — THE THROTTLE, NEVER A SHREDDER (owner call, Aug 24 — resolves THE CYCLE CEILING)

The daily fire cap's failure mode was wrong for intake: the 6th application of a busy day was
SKIPPED (loud in a log, invisible to the user — a dropped job application is a trust violation).
THE LAW: **the limit paces, it never loses.**

- **QUEUE, NOT DROP**: at the limit, a matched event still writes its exactly-once fire record
  and a `queued` event run — it just doesn't START. The drain (the dispatcher's backstop lane)
  starts deferred runs up to `limit − startedToday`, oldest first; the stale-run backstop
  RESPECTS the throttle (it must not flush the queue past the limit). Nothing is ever lost;
  compute is bounded per day. A pathological composed cycle becomes a slow perpetual loop at
  throttle rate — visible in the ledger, catchable by the existing auto-pause machinery — never
  an explosion and never a silent stop.
- **EDITABLE**: per-workflow `dailyFires`, store = item_plans kind `workflow_limit` (the house
  storeless precedent), DEFAULT 20, floors 1–100 (the ceiling is SYSTEM, non-editable — with
  queueing, "unlimited" only buys unbounded same-day spend). Studio: a stepper in the WHEN
  panel — "Up to N event runs a day; extra ones wait for tomorrow."
- **PARITY (law 1)**: generate-config may author it when the description says ("at most 3 a
  day"); worker-tasks gains `daily_run_limit` on create/update; get_task speaks it; served on
  the ledger/GET. Out-of-range values CLAMP with a spoken note, never refused silently.
- Gate re-points declared: smoke-relay's RL ceiling gates (the cycle "stops at the cap") become
  "the cycle DEFERS at the throttle" — same law, lossless form.

## W4 — THE CASE LAYER (spec addendum, Aug 24 — build contract)

René's step 2: "Augmtd links application to job opening." Applications arrive over days through
many doors; each run carries ONE; the comparison needs the OPENING'S ACCUMULATED candidates.
Cross-run state — the last structural gap in the diagram.

**THE DECIDING LAW: A CASE IS AN ENTITY.** No second registry, no `cases` table, no migration.
A job opening is a `work_entities` row (machine-founded, UNTRACKED — recognition already founds
untracked entities from real work; THE PINNING LAW untouched: tracking stays a human decision).
Riding the one brain buys everything at once: the case has a ROOM, a ledger, recognition,
portfolio visibility ("smaller things"), and the EXISTING one-grounding machinery becomes the
case's memory — no new accumulation store.

- **THE CASE STEP** — `{ type: 'case', id, label, case_instruction }` ("the job opening named in
  the application"). Executed IN the run loop (engine-side, like the ⧉ station — it needs the
  stores): (1) a deterministic token pre-pass then ONE cheap reasoned resolve of the event
  against THE WORKFLOW'S OWN CASE INDEX (match-first, conservative); no match → FOUND an
  untracked entity named by the case key ("Senior Data Analyst — Acme"); (2) the index row:
  item_plans kind `workflow_case`, entity_id `${workflowId}:${entityId}`, tasks {caseName,
  openedAt} (the house storeless precedent — the workflow's own case list, one read); (3) LINK
  the triggering event to the case through the EXISTING entity_links machinery where the event
  has a real atom (mail → the inbox item; file → the knowledge file; via 'workflow_case' as the
  link's via-word), so the case's room fills through the same door every other atom uses;
  (4) the step's OUTPUT is the case card in words (name · what arrived · what the case now
  holds), and — the payoff — **THE RUN'S GROUNDING SWAPS TO THE CASE**: from this step on,
  aiContext carries the CASE entity's grounding (the same one-grounding read every reasoner
  uses), so the comparison step sees the opening's accumulated candidates BY CONSTRUCTION.
- **THE SUBJECT WEARS THE CASE**: a run that resolved a case serves `case {entityId, name}` on
  its ProcessRow; the subject ladder prefers it; the table's customer chip speaks it (falling
  back to the workflow's static scope as today).
- **READINESS**: a case step with a blank instruction → "The 'link to its case' step needs to
  know what identifies a case."
- **FLOORS**: match-first, found-only-when-no-match (dedupe is the default posture); founded
  entities are UNTRACKED and never auto-tracked; the resolve is ONE classification-tier call
  per run (the throttle already bounds runs/day, so founding is bounded transitively); an
  unresolvable event (no case key in the material) parks NOTHING — the step outputs an honest
  "no case named; continuing without one" line and the run proceeds ungrounded-swap (the
  workflow's static scope stays).
- **PARITY**: "link each application to its job opening" → generate-config emits the case step
  (instruction in the user's words); Studio renders the normalizer block (the mockup's
  case-chip block) with the instruction field; the chat tools ride the generator (steps), as
  with the ⧉ station.
- **Deliberately NOT in W4**: a Cases tab/surface (the case's room IS the surface — law 5 of
  the one-surface world); case lifecycle verbs (close/merge — the entity machinery's existing
  doors serve); cross-workflow case sharing (the index is per-workflow v1; the ENTITY is
  global, so two workflows naming the same opening converge through recognition naturally).

**W4 BUILT (Aug 24; relay 501/501 ×2 (+94) — A CASE IS AN ENTITY, live-proven: the grounding
swap carried a code word reachable only through another run's filed material; the index is
PER-WORKFLOW (discovered mid-gating, now a floor); founding mirrors recognition, UNTRACKED,
the pinning law gated (`tracked: true` cannot exist in the module); never-overwrite links;
test mode founds nothing).** ⚠️ OWNER CLARIFICATION (Aug 24): the owner read "link to its
case" as filing into THE COMPANY'S OWN records — the no-integration reading (AUGMTD as the
record-keeper, self-bootstrapping folders) was MY call from the diagram's wording + the
current-capabilities directive, surfaced late. RENAMED "File it under its record" (W5).
Queued proposals awaiting the owner: the resolver consults the PINNED openings doc (filing
against company data, zero integrations); external records as a resolution source when
connectors land (the same step, one registry row).

**W5 — THE DOOR FILTERS BUILT (Aug 24; relay 568/568 ×2 (+DF/DL/DS) · processes 125/125; the
owner's 80/20)**: deterministic per-source filters ON the registry rows (mail: Sender is/
domain is · Subject contains; file: name contains · Type is; meeting: Title contains) —
FAIL-CLOSED (an unanswerable filter never passes), AND semantics, filters gate candidacy
BEFORE the judge (the spend win: filters-only doors fire with ZERO AI, reason "matched the
door's filters"); fireability = condition OR filter at all four readers; chips + one registry
popover in Studio (op-as-a-word when a field offers one); PREFER-A-FILTER + THE OMIT RULE in
authoring (round-1 probe caught the model restating its filters as a redundant judged
condition — every event would have paid for a judgment that bought nothing); topical ≠
structural drawn deliberately ("about the analyst role" stays judged — a subject-contains
filter would silently drop applications that omit the word). REPAIRS: the two upload-confirm
floors' 900-char windows had drifted (green on empty text) — structural brace-match anchors
now, and the host-safety law HARDENED (the innermost try must reach the call directly).

**THE MATERIAL LANE BUILT (Aug 24, `c8fb7a3`; relay 576/576 — found live against a REAL
application email on a pilot inbox)**: a mail-fired run knew a candidate applied but never saw
the attached CV — the sync had already downloaded + text-extracted the attachments onto the very
inbox row the door read, and the fire context carried only a 500-char body gist; the file door
fired on a 400-char clip of its own document (the seeded demo's hand-built contexts masked
both). `ReactionEvent.material` = fuller text for the FIRED RUN's context only (mail lifts
`source_data.attachments[].extractedText`, clipped per file + excerpt-marked; the file seam
passes the uploaded document's own extracted text) — `triggerBlock` appends it AFTER the head's
own 2400 cap so the slice can never decapitate it; deferred fires replay it from the stored
record unchanged. THE JUDGE STAYS CHEAP BY STRUCTURE: it never reads material — the FACT of the
attachments rides the gist as names (`[Attached: …]`), which is all "is this an application"-
class conditions need. Six gates (context carries it · cap can't eat it · judge never sees it ·
both seams feed it). SUITE LESSON RE-LEARNED: killing a suite mid-run strands probe rows that
poison the next run's live scenarios — sweep probe state before rerunning; never kill a suite
casually.

**W4 POST-SCRIPT — A FILED FILE IS A VISIBLE FILE (Aug 24, in `ebea2f9`)**: the demo assembly
found a file-door filing accumulated INVISIBLY — the room grounding reads documents off
`knowledge_files.entity_id` (its entity_links read covers only inbox_item/commitment), so the
link existed but no later run's comparison could see the filed CV. The case link writer now
stamps `knowledge_files.entity_id` fill-if-empty (ingest's own upload idiom — never an
overwrite); two gates hold it.

**THE DEMO (owner account, live; seeder untracked)**: scenarios A–E retired (workflows deleted,
seeder code removed); scenario F = the CV-triage whiteboard end to end — 3 doors (filtered mail
zero-AI · file · loop), Hiring Policy tray, case filing (2 openings; accumulation proven live),
3 parked approvals, interview child w/ Interview Policy + prepared-scheduling-email draft, FRAME
output (validated series head), winner/decline emails as DRAFTS inside the gated deliverable.
Spoken simplifications: ONE approval (not the whiteboard's two); emails never send.

**⚠️ OPEN ENGINE GAP (owner call pending)**: an EVENT-FIRED run parked at approval gets NO deck
ask — `narrateApprovalAsk` rides `openStandingCommitment`, which only a SCHEDULED workflow has;
event-driven approvals are reachable via the workflows page + drawer only, never the Home
attention surface.

## GATES (laws-need-gates — each wave ships its floor)
- The four-door parity sweep per primitive (generate-config emits · chat args accept · Studio
  edits · ledger serves) — the arc's standing gate.
- W1: normalizeTriggers table · REACTION SURVIVES THE EDITOR (the destroyer-bug floor) · each
  fire door fires exactly-once on the probe · readiness iterates doors · one-schedule constraint
  refused honestly · registry-driven rendering (no hardcoded source list outside the registry).
- W3 preview: depth-cap + circular refusal in readiness · test-never-fires-the-child.
