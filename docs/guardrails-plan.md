# THE GUARDRAILS ARC — the gate speaks, the user steers it, the run keeps receipts

**Origin (Aug 14):** pilot feedback (René) — workflows need visible guardrails: per-step QA the user
can see, custom policy rules, and easy audit of executed runs. Design mockup approved by owner
(artifact "Studio Guardrails"). This plan is the build spec; the orchestrator (Fable) owns the
contracts and review, Opus subagents implement against surgical briefs.

**The thesis:** we already run the guardrail substance — the verify gate (arithmetic floor +
grounded-claims pass), the approval park, the registry gate, per-tool date/window floors. What's
missing is that the gate is MUTE (its findings evaporate into the corrected draft), UNSTEERABLE
(no user rules), and DEAD-ENDED (a hard violation has nowhere honest to go). Three deltas close it:

1. **THE STRUCTURED VERDICT** — the gate returns `{status, findings[]}` beside the corrected draft.
2. **YOUR RULES + THE BRIEF** — user policy rules ride the verify step; the producing step's own
   prompt becomes a spec the gate enforces (nothing guessed at build time).
3. **RETRY-THEN-HOLD** — a blocked verdict re-runs the producing step once with the findings; a
   second block parks the run through the EXISTING `awaiting_approval` machinery.

## Laws

- **The gate describes, never invents.** Every finding carries a quote from the draft's own words.
  A `blocked` status is honored ONLY when at least one finding cites a user rule — the model can
  never block on vibes (code-enforced downgrade to `corrected`).
- **Three layers, none guessed:** (1) engine guarantees — static per step type (the built-ins map);
  (2) THE BRIEF — the producing step's own prompt, read at run time, enforced as stated
  (language/structure/length/format it explicitly claims — never requirements it doesn't state);
  (3) the user's rules — authored, gate-level only. One gate, one rules list — per-step rule
  fragments are forbidden (two competing verifiers, the generate-config lesson).
- **Studio shows the promise; the Runs surfaces show the receipts.** No verdicts in the build view.
  The Test-run panel is the deliberate exception — it is where rules are authored, so it must show
  what a rule catches (the tuning loop).
- **Failure honesty:** a missing/unparseable verdict sentinel degrades to
  `{reported: false, findings: <arithmetic floor only>}` — never a fabricated "passed".
  A park that cannot persist is a FAILED run (the existing loud-park law).
- **Test mode never parks** (a paused simulation proves nothing): `isTest` + blocked → verdict
  preserved on the step output ("would be held"), run continues.
- **Same visual = same meaning:** the gate chip is one shape everywhere — configuration tense in
  the Studio ("+ 2 of your rules"), outcome tense on a run ("✎ Corrected · 3").
- **No real names** in code, prompts, or fixtures (Sam Miller / Acme only).

## Contracts (owned by the orchestrator — written first, agents compile against them)

`lib/workflows/types.ts`:
- `VerifyStep.rules?: string[]` — plain-language user rules (each ≤200 chars, list ≤10).
- `GateFinding { source: 'numbers'|'grounding'|'citation'|'structure'|'dates'|'brief'|'rule';
  rule?: string; quote: string; action: 'corrected'|'removed'|'masked'|'blocked'; note?: string }`
- `GateVerdict { version: number; status: 'passed'|'corrected'|'blocked'; findings: GateFinding[];
  reported: boolean; retried?: boolean }`
- `StepOutput.verdict?: GateVerdict` — rides `workflow_runs.step_outputs` (jsonb); flows to the
  runs API, TestRunPanel, and activity tab with ZERO route changes.

`lib/workflows/builtin-checks.ts` (new, pure data): `builtinChecksFor(step) → {title, lines[]} | null`
— the static truthful map of engine guarantees per step type / tool id. Shared by the Studio edge
chip, the gate panel's locked list, and any receipt surface. Only claims checks the engine
actually runs.

## Workstream A — the engine (Opus agent)

`lib/workflows/execute-step.ts`:
- `VERIFY_GATE_VERSION` → 2.
- `executeVerifyStep` rewritten: arithmetic floor (kept, findings captured as `source:'numbers'`),
  THE BRIEF block (producing step's prompt, ai/agent only, clipped), numbered user rules, and the
  SENTINEL protocol — the model returns the corrected draft, then a final line
  `===GATE_VERDICT===` followed by one JSON object. Parse from the LAST sentinel; strip it from
  the draft; degrade honestly when absent. Return type: the step's `output` stays the corrected
  draft STRING (downstream contract unchanged); the verdict is attached by `executeStep` to the
  StepOutput (verify branch returns `{text, verdict}` internally).
- `StepContext.guardrailFeedback?: string | null` — consumed by `executeAIStep` +
  `executeAgentStep` as a MUST-FIX block in the user prompt.

`lib/workflows/run-workflow.ts` — the retry-then-hold loop:
- After a verify step lands with `verdict.status === 'blocked'`: if not yet retried this run and
  the previous step is ai/agent — pop the producing output, re-execute it with
  `guardrailFeedback` (findings rendered as MUST-FIX lines), re-execute the verify step
  (`retried: true` on its verdict), checkpoint each move. Second block (non-test): park
  `awaiting_approval` with step_outputs INCLUDING the gate output, narrate the hold
  (`narrateGuardrailHold` in standing.ts — same `approval` component so the existing room card +
  `/api/workflows/runs/[id]/resume` work UNCHANGED; resume seeding finds no approval step after
  the boundary → continues at the next step, which is exactly right). Return
  `status:'awaiting_approval'`.
- Report-back: `ReportFacts.gateNote?: string` — one factual line from the final verdict
  ("checked against the sources — corrected 2 figures, masked 1 name under your rule"), in
  `fallbackReport` and the FACTS block of `generateReportBack`. Passed-with-nothing → no note.

`lib/workflows/generate-config.ts`: verify step JSON may carry `"rules": [...]`; prompt rule —
user-stated policies (privacy/confidentiality/tone/disclosure) become verify RULES, never AI-step
prose. Keep the one-gate code enforcement.

## Workstream B — the Studio (Opus agent, `components/work/studio-builder.tsx` only)

- **Gate nodes:** verify/approval render as pill stations (not step cards) — 88% width, centered,
  connector passes through; teal family for verify (+ "N of your rules" count chip), amber for
  approval. Click opens the existing config panel. Reorder/remove affordances preserved.
- **Edge chips:** steps with a `builtinChecksFor` entry get a small shield chip on the card's
  right edge; CLICK (never hover) opens an `AnchoredPopover` listing the lines + "Always on ·
  part of the engine". Zero added card height.
- **The dashed slot:** when no verify step exists, a dashed "Add a check before delivery" slot
  renders between the last content step and the Output card; click inserts the verify step there
  and opens its panel. Removing the gate brings the slot back.
- **The gate panel** (verify branch of StepConfigSection): locked "Always checked — built in"
  list; "Your rules" editor — rows with remove, add-input, three starter chips (hide personal
  data / never internal pricing or margins / keep tone professional); the escalation footnote
  ("fix → note it → redo once → hold for your review"). Approval panel keeps its instruction field.
- **Test-run panel:** verify rows wear the verdict chip (✓ Passed / ✎ Corrected · N / ⏸ Would be
  held) with expandable findings (source or rule label · quote · action/note).
- UI kit rules: no sparkles/folder emoji; existing icons (ShieldCheckIcon, HandRaisedIcon);
  indigo tokens; radii per kit (pills rounded-full).

## Workstream C — the runs surfaces (small, after A)

`components/workers/tabs/worker-activity-tab.tsx`: run rows derive a verdict glyph from
step_outputs (✓ / ✎ / ⏸ from the last verify verdict; nothing when no gate) — scannable history.
(The full findings view already exists via the TestRunPanel idiom; deeper run-detail surfaces ride
later arcs.)

## Workstream D — the smoke suite (`scripts/smoke-guardrails.ts`, probe host)

Real-call outcome gates on the shared probe user (scripts/probe-user.ts pattern; guarded env):
- **G1 verdict presence + degradation:** a verify run always lands a `GateVerdict`; sentinel-less
  outputs degrade with `reported:false`, never fabricate.
- **G2 the arithmetic floor speaks:** planted wrong percentage vs a stated source table →
  `corrected` with a `numbers` finding; corrected draft carries the right value.
- **G3 your rule enforces:** rule "replace any person's name with [hidden]" + planted fake name →
  `rule` finding, masked draft.
- **G4 retry-then-hold, full loop:** a producing prompt that REQUIRES forbidden content + a block
  rule → blocked, retried once, parked `awaiting_approval`, hold ask narrated; explicit resume
  completes the run. (Skips with a loud note if the status CHECK constraint predates migration
  20260808.)
- **G5 real-workflow replay:** clone the step config of a live production workflow (read-only on
  the source account; runs on the probe; output home 'message'; isTest) + rules → verdict present,
  structure preserved, no external delivery.
- **G6 no-gate regression:** a gateless workflow runs byte-identical behavior, no verdict field.

## v1.1 — THE PINNED GATE + THE STEP'S OWN ASK (Aug 15, owner walk findings)

The owner's first walk exposed two truths: (1) the gate could DRIFT — inserted once, it stayed
put while steps were added after it, so "Checked before delivery" stood mid-pipeline as a false
claim, and the vanished slot left no repair door; (2) the per-step shield chip was visibility-only
— correct but inert ("doesn't seem it has much use").

- **THE PINNED STATION (Studio):** one delivery gate per workflow, never a reorderable list
  member. `seatGate(steps)` normalizes on every mutation (add/move/remove): the verify step sits
  after the last content step, before trailing approval steps. Verify is excluded from manual
  reorder. The label is thereby always true.
- **THE PROTECTIVE DEFAULT (Studio):** manual builds get the gate AUTO-SEATED the moment the
  USER'S OWN ACTION introduces external material (rss_feed/web_search/fetch_url/deep_research/
  get_pt_tenders/browser_fetch) or an external home (email/slack) — parity with generate-config.
  Never on load of an existing workflow (an open must not mutate saved work). An explicit removal
  suppresses re-adding for the session — the human's decision sticks.
- **THE STEP'S OWN ASK (engine + Studio):** `ToolStep.check` — authored on the step's shield
  node ("Also check on this step…"), ENFORCED BY THE ONE GATE: the run loop aggregates every
  tool step's check into the gate prompt as attributed lines (`From the "Fetch emails" step: …`),
  and findings that enforce one carry `stepLabel`. Authoring is contextual; enforcement stays
  single; the audit points home. AI steps get NO new field — their prompt already IS the enforced
  brief; the popover now SAYS so (showing the prompt's first line) instead of leaving the
  enforcement invisible.
- Deferred within this slice: step-completion assertions checked by code right after a tool step
  ("expect ≥5 items" → failure honesty) — a different mechanism than the gate; `check` docs in
  generate-config (generated flows put policy in gate rules).

## v1.2 — SYMMETRY + THE TRANSPARENT STORY (Aug 15, second owner walk)

The owner's second walk: "weird that AI steps get the node but can't take my guardrails like tool
steps" + "be maximally transparent about what is happening — checked, identified right or wrong,
fixed — across workflows and runs." Two truths conceded:

- **THE POSITIONAL BRIEF OVERCLAIM:** "its instruction becomes the brief" was shown on EVERY ai
  step, but the gate enforces only the prompt of the step FEEDING it (producingPromptFor walks to
  the nearest ai/agent). The claim is positional — the static map stops making it; the UI appends
  it only on the feeding step.
- **PROMPT ≠ CHECK even on the same step:** the prompt is what to make (hoped for); a check is
  what must be TRUE (verified, with a receipt). So `AIStep.check` lands with the identical
  contract as ToolStep.check — same shield-node input, same one-gate aggregation, same stepLabel
  attribution. ONE GATE STAYS (the gate verifies the final draft against the ORIGINAL sources —
  mid-step corruption is caught at the end because the uncorrupted material never leaves the
  context; N gates = N verdicts + fragmented audit). The narrow honest limit: a violation only
  fixable by REDOING an early step's work parks for the human after the one retry.
- **THE TRANSPARENT STORY at every surface:** the gate speaks check-identify-fix plainly — panel
  intro ("checked against the original material the run gathered; what can be proven wrong is
  fixed and noted; what can't be fixed is held for you"), the flow node sub ("checks & fixes the
  draft against this run's sources"), findings show their ACTION verb (fixed/removed/masked/
  blocked), a passed gate says "checked — nothing needed fixing" when expanded, and the
  reported:false degradation line stays honest.

## Rollout notes

- No migration: the verdict rides existing jsonb; the hold reuses `awaiting_approval`
  (migration `20260808_workflow_runs_approval_status.sql` — required for G4's park, already
  required by approval steps).
- Deferred (recorded, not built): deterministic PII regex pre-pass + entity-registry client-name
  masking (the moat version of "hide client names"); workspace-level admin rules injected into
  every gate (the sovereign sell); run-list verdict filters.
