# Identified-Tasks Execution Plan — a prepared, editable, approve-before-commit workflow

**Supersedes / extends** `docs/home-actions-stage3-plan.md`. This is the full, *agnostic* architecture
for turning the Home "Identified tasks" panel (`components/home/item-detail.tsx` → `WhatThisTakes`
/ `TasksPanel`) from a static, AI-*guessed* checklist into an **executable, prepared-for-approval,
editable plan** where every step is done by the **System**, a named **Coworker**, or the **User** —
built on the engine we already have (`lib/workflows/*` + AgentOS + the tools registry), never a
parallel one.

The design invariant, stated up front: **adding a tool, a capability, or a coworker requires NO change
to the classifier, the executor, or the UI.** They all read one capability map + the tools registry +
the agent registry. Everything below serves that invariant.

---

## 1. North star

Today the panel does one honest-but-shallow thing: `lib/home/item-plan.ts` `generateItemPlan` asks a
classification-tier model to break an item into 1–5 sub-tasks and grade each `[System]` or `[You]`
against a *prose* capability blurb (`CAPABILITY_SET`). It's a **static list**: it never runs anything,
`[System]` steps show a display-only "I can handle this" hint, and the only wired action is the
existing draft→send compose flow (`ComposePanel` → `/api/compose/draft` + `/api/compose/send`).
"Hand to a coworker" is a disabled stub (`HandToCoworkerButton`).

The end state: the Identified-tasks panel becomes a **prepared, editable, approve-before-commit plan**.

- Each step is executed by **System** (atomic, deterministic), a **named Coworker** (judgment work,
  possibly several coworkers per item), or the **User** (a decision / an out-of-system action).
- **Content flows step to step** — fetch → analyze → draft → send — exactly like a workflow's
  `previousOutputs`.
- The system **prepares** each committable action (a filled-in draft, a filled-in invite) and **pauses
  at the irreversible boundary** for the user to review/edit/approve. It never fires blind. This is the
  AUGMTD "prepared work → validate → send" model already in `ComposePanel` and
  `components/inbox/meeting-proposal-card.tsx`.
- The plan is **living**: add / edit / reorder / cross-out steps; every edit re-runs the classifier on
  the changed step.
- It runs on the **existing** executor: each step maps to a workflow step type (`tool` / `ai` /
  `agent`) dispatched by `lib/workflows/execute-step.ts`; coworker steps route through
  `runWorkerStepViaAgentOS` (`lib/work/agentos-bridge.ts`). No second engine.

---

## 2. The Capability Map — single source of truth (agnostic)

Mirror the pattern of `lib/workspace/tool-capabilities.ts` (`TOOL_FEATURE`: one `Record`, every surface
reads it, "adding a tool = one line"). We add a **sibling** map that describes each capability's
*execution character* — this is what the classifier grades against instead of a prose blurb.

**Location:** a new `lib/home/capability-map.ts` (co-located with the classifier, imported by the
executor + the plan route). It reasons over the SAME registry keys used in `lib/tools/index.ts` and
`TOOL_FEATURE`, so the two maps stay aligned by construction.

### Proposed schema (per capability)

```ts
export type CapabilityKind = 'atomic' | 'judgment';

export interface Capability {
  intent: string;        // human phrase the classifier matches an item's step against ("send an email", "put a meeting on the calendar")
  tool: string;          // registry key in lib/tools/* (e.g. 'compose_email', 'search_knowledge_base', 'send_calendar_invite'), or null for a pure ai transform
  built: boolean;        // is the executor actually wired TODAY? false → grade [You] honestly (no over-claim)
  kind: CapabilityKind;  // 'atomic' → System runs it directly; 'judgment' → suits a Coworker (agent step)
  irreversible: boolean; // send / post / create-invite → forces an approval gate
  feature?: FeatureKey | null; // optional cross-ref to TOOL_FEATURE, so a workspace-disabled feature also gates the capability
}

export const CAPABILITY_MAP: Record<string, Capability> = { … };
```

### How each field drives behaviour

- **`built: false`** → the classifier grades the step **[You]** honestly ("process the refund in Stripe"
  has no tool → the user does it), and the UI shows it as a user step — never a fake `[System]` promise.
  When the tool later lands, flip `built` to `true` and the SAME step starts grading `[System]`. This
  replaces today's fragile prose "WHAT WE CANNOT DO" list in `CAPABILITY_SET`.
- **`kind: 'atomic'`** → System executes directly (a `tool` or `ai` workflow step): deterministic,
  no judgment (fetch a KB file, read the calendar, send a prepared draft).
- **`kind: 'judgment'`** → the work benefits from a coworker's voice / reasoning / skills → an `agent`
  step (`runWorkerStepViaAgentOS`). "Draft a LinkedIn post from Max's research", "write the exec brief".
- **`irreversible: true`** → the executor MUST insert an approval gate before it runs (send email, post
  Slack, create/send a calendar invite). Reversible prep (fetch/analyze/draft) auto-chains; the
  irreversible step is prepared and held for the user.

### The audited real capabilities (what to register)

From `lib/tools/index.ts` + `lib/tools/*` + `execute-step.ts` dispatch, the *actual* capability surface:

| Capability / intent | Registry tool | kind | irreversible | built |
|---|---|---|---|---|
| Read/search the knowledge base (Drive) | `search_knowledge_base`, `read_kb_file` / `read_document` | atomic | no | yes |
| Read emails / inbox | `get_emails`, `get_urgent_emails`, `get_email_body` | atomic | no | yes |
| Read calendar (upcoming) | `get_calendar`, `get_meeting_context` | atomic | no | yes |
| Web search / fetch a page | `web_search`, `fetch_url`, `browser_fetch` | atomic | no | yes |
| Deep research (multi-source) | `deep_research` | judgment | no | yes |
| RSS / PT tenders feeds | `rss_feed`, `get_pt_tenders` | atomic | no | yes |
| Draft an email (coworker voice) | `compose_email` (`lib/tools/coworker-email.ts`) | judgment | no (draft only) | yes |
| **Send** an email as the coworker | `sendCoworkerEmail` | atomic | **yes** | yes |
| **Send** an email as the user | `/api/compose/send` (Gmail/Outlook, coworker fallback) | atomic | **yes** | yes |
| **Reply** on a thread as the user | `/api/inbox/[id]/send-reply` | atomic | **yes** | yes |
| Generate a document / deliverable | `generate_document`, `lib/artifacts/builders` | judgment | no | yes |
| Read a Slack channel | `slack_read_messages`, `slack_read_channel` | atomic | no | yes |
| List Slack channels / members | `slack_list_channels`, `slack_list_members` | atomic | no | yes |
| **Post** to Slack | `slack_post_message`, `slack_send` | atomic | **yes** | yes |
| Find / read a teammate's work | `find_team_work`, `read_team_work` | atomic | no | yes |
| Task CRUD / run a task | `create_task`, `update_task`, `run_task`, … | atomic/judgment | run→yes | yes |
| Apply / list a skill | `list_skills`, `apply_skill` | atomic | no | yes |
| **Create / send a calendar invite** | **`send_calendar_invite` (TO REGISTER)** | atomic | **yes** | **partial → register** |

### The flagged gap: calendar invite

**Audit finding (exact state):** AUGMTD has a **full, real send-invite capability that is siloed, not
registered as a tool.**

- `lib/calendar/invite-sender.ts` has real create/update/delete: `sendGmailInvite` (Google Calendar
  `events.insert`, `sendUpdates: 'all'`, optional Meet link), `sendOutlookInvite` (Graph `/me/calendar/
  events` POST), plus `updateGmailEvent` / `updateOutlookEvent` / `deleteGmailEvent` /
  `deleteOutlookEvent` — all send **real notifications** to attendees. No `.ics` path (Google/Graph
  only).
- Exposed via API routes only: `POST /api/meetings/create`, `PATCH`/`DELETE /api/meetings/[id]`,
  `POST /api/meetings/[id]/rsvp`.
- User reaches it via the inbox chat `MEETING_SUGGESTION` token → `components/inbox/meeting-proposal-
  card.tsx` → `POST /api/meetings/create`.
- **It is NOT in `lib/tools/index.ts`.** No workflow `tool` step can call it; the item-plan classifier
  is even hard-coded to grade "create a calendar event / send an invite" as **[You]** (see
  `CAPABILITY_SET` in `item-plan.ts`, line ~42: *"we CANNOT put a meeting on the calendar… that is
  [You]"*). So a capability the product *has* is invisible to the plan.

**Fix (stage 1 of the build order):** wrap `invite-sender.ts` in a registered tool
`send_calendar_invite` (definition + executor exported from `lib/tools/index.ts`, dispatched in
`executeToolStep`), add its entry to `CAPABILITY_MAP` (`kind: 'atomic'`, `irreversible: true`,
`built: true`, `feature: 'meetings'`) and to `TOOL_FEATURE` (`'meetings'`). The instant it's in the
map, the classifier stops grading it `[You]`, the executor can prepare it, and coworkers can call it —
**with zero classifier/UI edits.** This is the concrete proof of the agnostic rule.

### The unification: system & coworkers share ONE capability set

There is **no separate "coworker powers."** A coworker step is an `agent` workflow step
(`executeAgentStep` / `runWorkerStepViaAgentOS`) that calls the **same** tools the System calls — the
AgentOS Python `@tool`s (`infra/agentos/tools_*.py`) call back into the same Next.js executors
(`lib/tools/*`) that the native loop uses (single source of truth, per CLAUDE.md). The boundary
between System and Coworker is **orchestration + judgment (`kind`), not different capabilities.** The
map is the one inventory both read.

**Agnostic rule:** *adding a capability = one `CAPABILITY_MAP` entry + a registered tool* → it flows
automatically into classification (a new intent the classifier can match), execution (the executor
dispatches by `tool`), and coworkers (an `agent` step can call it). No per-feature hardcoding anywhere.

---

## 3. The Classification Engine — one engine, run on generate AND on edit

Replace the prose-graded `generateItemPlan` with a classifier that answers three questions per step,
reading the map (not a hard-coded blurb):

1. **WHAT** — which capability/tool does this step's intent map to? (match `step.intent` against
   `CAPABILITY_MAP[*].intent`). Unmappable → `[You]`.
2. **WHO** — System / Coworker / You, derived from the boundary rules:
   - `built: false` → **You**.
   - `kind: 'atomic'` → **System**.
   - `kind: 'judgment'` → **Coworker** (a specific named coworker, chosen from the user's roster by
     fit — see §4; falls back to System-ai when no coworker fits).
   - workspace `feature` disabled → **You** (or hidden), reusing `isToolAllowed`.
3. **HOW** — the prepared, filled-in action params for the step: recipient(s), subject, the file id to
   fetch, the invite time/attendees. This is what makes a step *executable* rather than a label.

**Instance-honesty (kept and strengthened).** `item-plan.ts` RULE 2 already demands that a `fetch` is
only `[System]` when the thing to fetch is *evidenced in the item context*. Formalize it: the classifier
verifies the specific instance exists (the KB file is real via a lookup, the recipient email is known)
before it fills `HOW`; if not, it emits a **[You] input** step ("attach the deck", "confirm the
recipient's email") rather than a confident `[System]` promise. Category optimism never wins over
instance reality.

**Two run modes, one engine:**

- **(a) On generate** — initial plan for a freshly opened item (today's `POST /api/items/plan` path).
- **(b) On edit** — whenever the user **adds / edits / reorders** a step in the living plan, re-run the
  classifier on **just the changed step** (fast, targeted, cheap) to re-derive WHAT/WHO/HOW. Critically:
  it **respects the user's wording** — it classifies *how to execute what the user wrote*, it never
  rewrites the user's intent. Unmappable user text → `[You]` (the user does it themselves), never
  dropped or "corrected."

**Whole-plan coherence** (re-checking that a reordered plan still makes sense end-to-end — e.g. a
downstream draft depends on an upstream fetch that moved) is a **later refinement**, not stage-2 blocking.
The per-step re-interpret is the shippable core.

The classifier stays on the **classification tier** (`getAIClient(userId, 'classification')`) — the
reasoning-model blow-up documented in `item-plan.ts` (Kimi burning the token budget) is the reason;
keep it.

---

## 4. The Execution Model — prepared-action-per-step, gated at the commit boundary

Each step carries an **executor** resolved from WHO:

- **System** → a `tool` or `ai` workflow step (`executeToolStep` / `executeAIStep`).
- **Coworker** → an `agent` step for a **specific** `custom_agents` row (`executeAgentStep` →
  `runWorkerStepViaAgentOS`). **Multiple coworkers per item** are allowed — different steps can name
  different coworkers (Max fetches research, Luca drafts the post).
- **You** → a pause point: an input the run waits on (attach a file, confirm a recipient, make a
  decision, do an out-of-system action).

**Prepared-action-per-step (the AUGMTD invariant).** A `[System]`/`[Coworker]` committable step does
NOT fire blind. It **pre-fills the concrete action** and surfaces it for review/edit/approve, e.g.:

> **Send invite** — Thu 10:00 to Alexandre  ·  [edit] [Send]

This is exactly the shape of `ComposePanel` (pre-filled To/Subject/body, user edits, clicks Send) and
`meeting-proposal-card.tsx` (pre-filled time/attendees, user picks, clicks Send Invitation). The plan
generalizes that pattern to **every** committable capability via the map.

**Auto-chain the reversible prep; gate at the irreversible boundary.**

- Reversible steps (`irreversible: false` — fetch, analyze, draft, research) **auto-run and flow their
  output forward** (`previousOutputs`), so the user opens the item and the draft/analysis is already
  prepared. No clicking through fetch→analyze→draft.
- The run **halts** at:
  - any `irreversible: true` step (send / post / create-invite) — prepared, held for **approve**;
  - any `[You]` step or missing input.

**Default mode = Review** (auto-prep + approve-before-send). **Autopilot** (auto-run *including* the
send, under the existing undo + daily-cap safety — see `email_sends`, `lib/activity/restore.ts`, the
sonner "Undo" toast) is an **opt-in later stage**, framed as a **trust curve**: the user earns their way
to letting the system commit, per capability.

**Mapping onto the existing engine.** A plan is a **draft workflow** persisted on `item_plans`; running
it is `run-workflow` semantics with `tool`/`ai`/`agent` steps + the tools registry. Content-flow,
coworker delegation, and output materialization come **for free** (they're already workflow/agent
concepts in `execute-step.ts` / `run-workflow.ts`). The only new orchestration is the **pause/approve
gate** at `[You]` steps and `irreversible` steps — a step-runner that executes up to the next gate,
persists outputs, and waits.

---

## 5. The Living / Editable Plan

The panel becomes editable in place (lightweight — NOT the full Studio builder in
`components/work/studio-builder.tsx`):

- **Add a step** — an inline "+ add a step" input; the user types intent → the classifier interprets it
  (WHAT/WHO/HOW) and inserts it.
- **Edit in place** — edit a step's title/intent; re-classify that step.
- **Reorder** — drag/reorder; persist order.
- **Cross-out** — already shipped (`dismiss` toggles `dismissed`, struck-through + disabled, reversible;
  `PATCH /api/items/plan`).
- **(Later) change a step's executor** — reassign System ↔ a specific Coworker ↔ You.

Every edit → the **classification engine re-interprets** the changed step (§3, mode b). Persistence
stays on the existing `item_plans` jsonb (`ItemPlanTask[]` extended with `intent`, `tool`, `kind`,
`irreversible`, `executor` (agent id when Coworker), `params` (the prepared HOW), `status`/`output`).
`POST`/`PATCH /api/items/plan` extend to carry the richer task shape + add/reorder/re-classify ops.

---

## 6. Agnostic guarantees (the design invariant)

Explicitly, and non-negotiably:

- **Adding a tool** → export it from `lib/tools/index.ts` + one `CAPABILITY_MAP` entry. The classifier
  can now map an intent to it; the executor dispatches it by `tool`; coworkers can call it. **No
  classifier / executor / UI change.**
- **Adding a capability (a whole new kind of action)** → same: one map entry + a registered executor.
  `built: false` until wired keeps grading honest in the meantime.
- **Adding a coworker** → a new `custom_agents` row appears in the roster; the WHO step picks it for
  `judgment` capabilities automatically (roster is read at classify-time). **No code change.**
- **Turning a workspace feature off** → the existing `TOOL_FEATURE` / `isToolAllowed` gate (referenced
  via `Capability.feature`) already flips those capabilities to unavailable across every surface.

The classifier reads the **capability map**, the executor reads the **tools registry**, WHO reads the
**agent registry**. Nothing hardcodes a feature. That is the invariant.

---

## 7. Staging / build order (each stage shippable)

1. **Capability map + audit-driven registration.** Create `lib/home/capability-map.ts` with the audited
   real capabilities (§2 table). **Register `send_calendar_invite`** wrapping
   `lib/calendar/invite-sender.ts` as a real tool (`lib/tools/index.ts` + `executeToolStep` + a
   `TOOL_FEATURE: 'meetings'` entry). No behaviour change yet — just the inventory + the missing tool.
2. **Classification engine reading the map.** Refactor `generateItemPlan` to grade WHAT/WHO/HOW from the
   map instead of the prose `CAPABILITY_SET`. Run on **generate** and on **edit** (targeted re-interpret,
   respect user wording, unmappable → [You]). Instance-honesty preserved.
3. **Prepared-action execution for System steps, approve-before-commit.** Wire the step-runner: auto-run
   reversible prep, prepare + hold every `irreversible` step for approve/edit. Start with the two we
   already have plumbed — **draft→send** (reuse `ComposePanel` / `/api/compose/send`) and the
   **calendar invite** (reuse `meeting-proposal-card.tsx`'s prepared-invite UX + `/api/meetings/create`).
4. **Editable plan + re-interpret loop.** Add / edit / reorder in place, each edit re-classifying the
   step (§5). Persist the richer task shape on `item_plans`.
5. **Coworker (`agent`) executors + multi-coworker.** `judgment` steps route to a named coworker via
   `runWorkerStepViaAgentOS`; allow different coworkers on different steps; report the coworker's output
   back into the item (replace the disabled `HandToCoworkerButton` stub).
6. **Autopilot opt-in.** Per-capability trust curve: let the user allow auto-commit (incl. send) under
   the existing undo + cap safety.

---

## 8. Open questions / decisions

- **Irreversible-gate list.** Confirmed irreversible today: send email (user or coworker), reply on a
  thread, post to Slack, **create/send a calendar invite**, run a task (`run_task`). Deletes
  (`delete_task`, `deleteGmailEvent`) — gate too, or out of scope for the item plan? Proposed: any tool
  with `irreversible: true` gates; deletes are out of the item-plan surface for now.
- **How a coworker step reports back into the item.** `runWorkerStepViaAgentOS` returns a string; the
  richer `run-workflow` path produces a report-back card (`lib/workflows/report-back.ts`). For the item
  plan, propose: the coworker's output becomes the step's `output` (feeds the next step, shown inline),
  and — if it's a deliverable — an artifact chip in the item, not a separate DM.
- **Whole-plan re-coherence.** Per-step re-interpret ships first; a whole-plan pass (detect a moved
  dependency, a now-dangling fetch) is a later refinement. Decide the trigger (on every edit vs. an
  explicit "re-check plan").
- **Autopilot safety.** Per-capability opt-in vs. global? Proposed per-capability (trust the invite
  auto-send before trusting the Slack post), reusing `email_sends` caps + `activity_events` undo.
- **Where the capability map lives.** Proposed `lib/home/capability-map.ts` (co-located with the
  classifier, cross-referencing `TOOL_FEATURE`). Alternative: fold it into
  `lib/workspace/tool-capabilities.ts` so there's literally one file. Decision: keep separate (execution
  character is a different concern from feature-gating) but keep the keys 1:1 with the tools registry so
  they can't drift.
