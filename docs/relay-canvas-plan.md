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

## GATES (laws-need-gates — each wave ships its floor)
- The four-door parity sweep per primitive (generate-config emits · chat args accept · Studio
  edits · ledger serves) — the arc's standing gate.
- W1: normalizeTriggers table · REACTION SURVIVES THE EDITOR (the destroyer-bug floor) · each
  fire door fires exactly-once on the probe · readiness iterates doors · one-schedule constraint
  refused honestly · registry-driven rendering (no hardcoded source list outside the registry).
- W3 preview: depth-cap + circular refusal in readiness · test-never-fires-the-child.
