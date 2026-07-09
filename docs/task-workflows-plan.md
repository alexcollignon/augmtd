# Task Workflows — the "Identified tasks" execution substance

**Extends** `docs/identified-tasks-execution-plan.md` (which designed the *surface*: the capability map,
the classifier, the prepared-action / approve-before-commit UX, the living/editable plan). **That plan
is shipped** — the panel in `components/home/item-detail.tsx` already renders per-step **owner · state ·
action**, `lib/home/capability-map.ts` proposes owners, and `/api/items/{plan,run,delegate,prepare,execute}`
run/hand-off/commit individual steps.

This doc designs the **substance underneath** that surface: turning each step from a *one-shot,
item-only, isolated* action into a **per-task engine-backed mini-workflow**, coordinated by a **per-item
deliverable pool** so that steps build on each other's output. It does **not** redesign the panel or the
classifier — it fills in *what actually runs when a step runs*.

> Read `docs/identified-tasks-execution-plan.md` first. This doc references its capability map, classifier,
> and approval gate rather than re-deriving them.

---

## 1. North star + the shift

### Where we are (the surface, shipped)

Today a step (`ItemPlanTask` in `lib/home/item-plan.ts`) is graded `[System]`/`[You]` with a coarse
`capability` (`draft|analyze|fetch|send`), and each of the three "run" paths does **one isolated thing,
grounded only in the item**:

- **`/api/items/run`** (`lib/home/run-step.ts` `runItemStep`) — a **single classification-tier LLM call**
  over `buildItemContext(...)`. It "analyzes/reasons" and returns text. **No tools, no other steps'
  output, no fetch that leaves the item.** It even refuses anything but `analyze`/`fetch`.
- **`/api/items/delegate`** (`lib/home/delegate.ts` `runDelegation`) — hands the step to a coworker via
  `executeAgentStep`, but with **`previousOutputs: []`** — the coworker sees the item context only,
  never what a prior step produced.
- **`/api/items/prepare` → `/api/items/execute`** — the one real, tool-backed, irreversible path
  (calendar invite via `executeSendCalendarInvite`), gated by an explicit approve click.

So the three steps of an item run **in isolation**. Max "researching" and Luca "drafting a post from
Max's research" are two independent LLM calls that never touch — Luca re-derives from the raw item, not
from Max's brief. The panel *looks* like an orchestration board; the engine under it is three unconnected
one-shots.

### Where we're going (the substance)

Each step becomes **its own engine workflow** — a small, real pipeline that produces a **deliverable**,
owned by system / a coworker / you, that can be run, re-run, and reassigned independently, and whose
output lands in a **per-item deliverable pool** that every later step reads. Concretely:

1. **Each step = its own mini-workflow** on the EXISTING engine (`lib/workflows/*` + `executeAgentStep`
   + the tools registry). Not one giant workflow for the whole item — per-step isolation of failure,
   ownership, re-runnability.
2. **Load is cheap; run is where reasoning happens.** On load we only *identify* (title · proposed owner ·
   rough capability) — that is exactly what `generateItemPlan` already does. On **run** the step
   *assembles itself* into an executable engine workflow (picks tools + params, gathers inputs from the
   pool, produces a deliverable). Just-in-time, with fresh, complete context.
3. **A per-item deliverable pool is the context mechanism**, not a hardcoded dependency graph. A step
   reads the item context **+ the pool of deliverables produced so far**; downstream steps build on
   upstream purely by reading the pool. Order is the user's choice.
4. **Owners are first-class and reassignable.** System (atomic tools), coworker (AgentOS agent workflow
   + skills, seeing the pool), or you (manual/external). Proposed on load, one-tap reassignable — already
   built via `proposeOwner` + the `OwnerMenu`/`reassignStep` path.
5. **Self-heal vs ask.** A step needing an absent input either auto-pulls the prerequisite (runs the
   step that would produce it) or asks you. Lean auto-pull; the pool prevents duplicate work.
6. **A step can REQUEST a file from you** ("I need the pitch deck — upload it") as a first-class step
   state. The upload lands in the pool; downstream steps use it. Reuses the existing attach/upload flow.
7. **Approve-before-commit stays** — any irreversible send pauses for one-tap approval (already the
   `prepare → execute` shape).

The shift in one line: **from three item-only one-shots to a board of engine-backed mini-workflows that
share a deliverable pool.**

---

## 2. The step-as-workflow model

### What one step compiles into

An `ItemPlanTask`, on **run**, compiles into an ephemeral **engine workflow** — an ordered list of
`WorkflowStep`s (`lib/workflows/types.ts`: `ToolStep | AIStep | AgentStep`) plus an `OutputConfig`,
run through the **same** dispatcher (`executeStep`) the Studio engine uses. The step's **owner** decides
the shape:

| Owner (proposed by `proposeOwner`) | Compiles to | Engine path |
|---|---|---|
| **system**, atomic reversible (`analyze`/`fetch`) | `[ToolStep?, AIStep]` | `executeToolStep` (real fetch: `search_knowledge_base`, `get_emails`, `get_calendar`, `web_search`, `deep_research`, `read_document`, `find_team_work`, `slack_read_messages`) → `executeAIStep` to synthesize |
| **system**, atomic irreversible (`send`) | `[AIStep(prepare), <gate>, ToolStep(commit)]` | `prepareAction` → approve → `executeSendCalendarInvite` / send. **Already built** — keep as-is, just record the sent deliverable in the pool |
| **coworker**, judgment (`draft`/`generate`/deep_research) | `[AgentStep]` | `executeAgentStep` → `runWorkerStepViaAgentOS` — coworker's tools + skills + memory, **now with the pool injected** |
| **you** | no engine run | manual: a checkbox, an external action, OR a **request-attachment** (§6) |

This is not a new executor. `executeStep` already dispatches all three step types; `executeAgentStep` is
already the flag-agnostic coworker entry point (`delegate.ts` already reuses it). The new thing is the
**assembler** that turns a *task* into these steps at run time (§3), and the **pool** they read/write (§4).

### Data-model additions to `ItemPlanTask`

`ItemPlanTask` (`lib/home/item-plan.ts`) is stored schemaless in `item_plans.tasks` jsonb — **no
migration needed for these fields** (same freedom that let `status`/`handedTo`/`result` be added). Add:

```ts
// NEW on ItemPlanTask (all optional; back-compatible)
deliverable?: {                 // what running this step PRODUCES (the "produces: …" line)
  kind: 'text' | 'document' | 'file' | 'sent' | 'draft';
  ref: string;                  // item_deliverables.id (§4) — the pool entry this step produced
  gist?: string;               // one-line summary rendered on the step ("produced: cost estimate")
};
needs?: string[];              // SOFT hints only — deliverable kinds/topics this step benefits from
                               // (e.g. ['research','deck']). NOT a hard graph; used by self-heal (§5).
awaitingInput?: {              // §6 — a [You] step that requested a file/doc from the user
  ask: string;                 // "Upload the pitch deck"
  accepts?: string[];          // mime hints
  fulfilledRef?: string;       // item_deliverables.id once the user uploads (then the step is satisfied)
};
```

Extend the existing `PlanTaskStatus` (`'working' | 'awaiting_approval' | 'done'`) with:

```ts
type PlanTaskStatus =
  | 'working'            // assembling/running its workflow now (existing)
  | 'awaiting_approval'  // prepared an irreversible commit, waiting for OK (existing)
  | 'awaiting_input'     // NEW — requested a file from the user (§6)
  | 'blocked'            // NEW — needs an absent input; self-heal will auto-pull or ask (§5)
  | 'done';              // resolved (existing)
```

`capability` / `actor` / `handedTo` / `result` / `dismissed` stay exactly as they are. `result` (system
direct-run text) and `handedTo.output` (coworker text) become **pool entries** rather than
step-local blobs (§4) — but keep the fields populated for back-compat rendering.

---

## 3. Load vs run — where the JIT assembly lives

### On LOAD (cheap identify — unchanged)

`POST /api/items/plan` → `generateItemPlan` already produces the cheap identification: 1–5 tasks, each
with `text` (title), `detail`, `actor`, `capability`. `proposeOwner(actor, capability)` gives the
proposed owner. **No execution reasoning happens here** — no tools, no params, no pool. This is exactly
the "cheap identify only" the model calls for. Keep it. Optionally have the load-time classifier also
emit the soft `needs?` hints (one extra field in the JSON schema — no new call).

### On RUN (JIT assembly — NEW)

When a step runs (per-step Run, or the panel's "Run all runnable" walk in `useItemPlan.runPlan`), a new
**`assembleStepWorkflow`** turns the task into an engine run:

```
lib/home/assemble-step-workflow.ts   (NEW)

assembleStepWorkflow(client, userId, {
  kind, entityId, task, pool          // pool = the item's deliverables produced so far (§4)
}): Promise<{ steps: WorkflowStep[], output: OutputConfig } | { kind: 'awaiting_input' | 'you', ... }>
```

Responsibilities (JIT — runs with fresh, complete context):

1. **Reason how.** A classification-tier call (same tier discipline as the rest of `lib/home/*` — never
   the reasoning tier, per the Kimi blow-up note in `item-plan.ts`) that, given the task title/detail +
   item context + **the pool's deliverable index**, decides: which tool(s) to call, with what params,
   and whether a needed input is present in the pool or must be pulled/asked.
2. **Pick tools + params** from the **capability map** (`CAPABILITY_MAP`) — the map already carries
   `tool`, `kind`, `irreversible`, `built`. The assembler only emits steps for `built:true` tools; an
   unmapped intent → a `you` outcome (honest, matches today's grading).
3. **Gather inputs from the pool** — inline the relevant pool deliverables as `previousOutputs`-style
   context (the engine already concatenates `previousOutputs` in `executeAIStep`/`executeAgentStep`).
4. **Emit the engine workflow** — the `WorkflowStep[]` + `OutputConfig` for this step's deliverable, then
   run it. For a **system** step, run the steps inline (a lightweight local loop that mirrors
   `run-workflow`'s per-step `executeStep` accumulation — we do NOT need the full `runWorkflow` thread/
   run-row machinery for an in-item mini-run; see §7). For a **coworker** step, call `executeAgentStep`
   with the pool folded into `previousOutputs`.

The assembler is the single place "reason how, pick tools, gather inputs, produce the deliverable" lives.
Load stays a cheap list; run is where compute is spent — and only on steps the user actually runs.

---

## 4. The deliverable pool

### Recommendation: a new `item_deliverables` table

The pool needs to be **queryable, per-item, typed, and durable across visits** (a document produced
Monday should still ground Tuesday's step). `item_plans.tasks` jsonb could hold small text blobs, but a
document/file deliverable wants a storage ref + a knowledge-base link, and self-heal wants to *query*
"is there a deliverable of kind X for this item?" — so a table is the right home.

```sql
-- supabase/migrations/2026XXXX_item_deliverables.sql  (APPLY MANUALLY, per repo convention)
CREATE TABLE IF NOT EXISTS item_deliverables (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,            -- item plan kind: email|meeting|commitment|awareness|followup
  entity_id    TEXT NOT NULL,            -- the item this deliverable belongs to (matches item_plans)
  task_id      TEXT,                     -- the plan step that produced it (null = user upload)
  d_kind       TEXT NOT NULL,            -- text | document | file | sent | draft
  title        TEXT,                     -- short label ("Research brief", "Cost estimate", "Pitch deck")
  gist         TEXT,                     -- one-line summary for the pool index / step subtitle
  body         TEXT,                     -- inline text (analysis, draft, research) — the poolable content
  storage_path TEXT,                     -- for document/file deliverables (work-artifacts / email-attachments)
  knowledge_file_id UUID,               -- link to knowledge_files if indexed (searchable)
  artifact_id  UUID,                     -- link to work_threads.artifacts entry when produced by a run
  metadata     JSONB DEFAULT '{}'::jsonb,-- e.g. { sent_to, message_id, mime, source:'upload'|'run' }
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS item_deliverables_lookup_idx ON item_deliverables (user_id, kind, entity_id);
ALTER TABLE item_deliverables ENABLE ROW LEVEL SECURITY;
-- owner-RLS (select/insert/update) mirroring item_plans policies.
```

Rationale for a table over reusing `work_threads.artifacts`: artifacts are keyed to a *run's thread*,
not to a Home *item*; the pool is item-scoped and mixes lightweight text (which never wants an artifact)
with real docs/files/sent-records. The table can still **reference** the heavy stores (a document
deliverable's `storage_path` points at `work-artifacts`, a coworker-produced doc's `artifact_id` +
`knowledge_file_id` link into the existing Drive/KB indexing) — reuse, not duplication.

### What a deliverable is

- **text** — an analysis/summary (today's `runItemStep` output; today's coworker `handedTo.output`).
  Lives in `body`. The cheapest, most common pool entry.
- **draft** — a prepared, not-yet-sent email/message. `body` = the draft; `metadata` = to/subject.
- **document** — a generated deliverable (from `generate_document` / a coworker). `storage_path` in
  `work-artifacts` + `knowledge_file_id` when indexed — reuses `materialiseOutput` / `indexArtifact`.
- **file** — a user-uploaded file (§6) or a fetched attachment. `storage_path` in `email-attachments` +
  `knowledge_file_id` from `indexUploadedFile`. `body` = extracted text (from `text-extractor.ts`).
- **sent** — a record that an irreversible commit happened (invite sent, email sent, Slack posted).
  `metadata` = the receipt. Not re-runnable; grounds downstream ("the invite went out Thu 10:00").

### How a step reads the pool at run

`assembleStepWorkflow` loads `item_deliverables` for `(user, kind, entity_id)`, builds a compact **pool
index** (title + gist + d_kind per entry) for the reasoning call, and inlines the **bodies** of the
relevant entries as `previousOutputs`-shaped context. A coworker step (`executeAgentStep`) gets the same
pool folded into its `previousOutputs` — so Luca literally sees Max's research brief. This is the whole
mechanism: **no dependency edges, just a shared, growing context each run reads.**

### Self-heal / auto-pull (see §5)

At assembly, if the reasoning call says "this step needs a deliverable of kind/topic X and the pool has
none," the assembler either (a) **auto-pulls**: finds the plan step that would produce X (by `needs`/
capability match), runs *it* first (recursing into `assembleStepWorkflow`), lands its deliverable in the
pool, then proceeds; or (b) **asks**: flips the step to `blocked`/`awaiting_input`. Default: auto-pull
for a *cheap, reversible, system/coworker* prerequisite; ask when the prerequisite is a `you` step or a
file only the user has.

### Dedup

Before producing, the assembler checks the pool for an existing deliverable that already satisfies the
step (same task_id re-run, or a matching kind/topic) — so re-running the item doesn't duplicate Max's
brief, and auto-pull never re-does work another step already did. `task_id` uniqueness per item +
gist-match is the dedup key.

---

## 5. Owners & execution paths

Owner is proposed by `proposeOwner(actor, capability)` (unchanged) and reassignable via the shipped
`OwnerMenu` → `PATCH /api/items/plan action:'reassign'`. What each owner *runs* under the new model:

### System (atomic tool)

`assembleStepWorkflow` emits `tool`/`ai` steps and runs them inline (the local mini-loop, §7). Reversible
system steps (`analyze`/`fetch`) auto-run and drop a **text/document** deliverable in the pool. This
*replaces* today's `runItemStep` "single LLM over item context" with a **real tool-backed fetch +
synthesis** that can read the KB, the calendar, the web, a teammate's work — grounded and pooled.

### Coworker (AgentOS agent workflow + skills + pool)

`judgment` steps route to a named coworker via `executeAgentStep` → `runWorkerStepViaAgentOS` (the live
prod path when `WORKERS_USE_AGENTOS` is on; native fallback otherwise). The ONE change vs. today's
`delegate.ts`: **pass the pool as `previousOutputs`** so the coworker builds on upstream deliverables.
The coworker keeps its tools + skills + memory + per-user context (already wired). Its output becomes a
**text/draft/document** pool deliverable (and, when a document, indexes into Drive/KB via the existing
`indexArtifact` path). The report-back (`generateReportBack`) stays for the DM feel. **Multiple coworkers
per item** already works — different steps name different coworkers.

### You (manual + request-attachment)

A `you` step is a pause: a checkbox (done), an external action, or a **request-attachment** (§6). When
the you-step is a decision/upload that produces something (an uploaded file), that lands in the pool too.

### Approve-before-commit gating (unchanged, reused)

Any `irreversible:true` capability (`send_email`, `slack_post_message`, `send_calendar_invite`) never
auto-fires. The **already-built** `prepare → execute` gate handles the calendar invite; the same shape
generalizes to email send (the shipped `ComposePanel` / `/api/compose/send` for user-voice, or
`sendCoworkerEmail` for coworker-voice) and Slack post. The commit records a **sent** deliverable in the
pool. Autopilot (auto-commit under `email_sends` caps + `activity_events` undo) remains a later opt-in,
per `docs/identified-tasks-execution-plan.md` §7.6.

---

## 6. Request-attachment-from-user (NEW)

A step must be able to say **"I need the pitch deck — upload it"** and pause until the user provides it,
then let downstream steps use the file. This is a first-class step outcome, not a dead-end.

### The step state

When `assembleStepWorkflow` (or the classifier at load, via `needs`) determines a step depends on a file
the item doesn't evidence (instance-honesty already downgrades an unevidenced fetch to `[You]` in
`item-plan.ts`/`capability-map.ts`), the step becomes **`awaitingInput`**:

```ts
task.status = 'awaiting_input';
task.awaitingInput = { ask: 'Upload the pitch deck', accepts: ['pdf','docx','pptx'] };
```

### The UI ask

The panel's `StepperRow` renders a **request-attachment affordance** for an `awaiting_input` step — an
inline "Upload →" that opens the existing attach surface (`AttachSurface`/`AttachMenu` already in
`item-detail.tsx`). Reuses the shipped file-attach UX; no new picker.

### The upload path (reuse existing)

Land the file exactly as chat attachments do — **do not build a new pipeline**:

- A new thin route **`POST /api/items/attach`** `{ kind, entityId, taskId, file }` (mirrors
  `app/api/work/threads/[id]/chat-attach/route.ts`): upload to the `email-attachments` bucket, extract
  text via `lib/attachments/text-extractor.ts`, and fire-and-forget **`indexUploadedFile`** (KB indexing
  + embeddings, so the file is searchable). For big files (>~4 MB Vercel body cap), reuse the Drive
  **presign** path (`/api/drive/upload/presign` → `confirm`, 25 MB) and pass the resulting
  `knowledge_file_id`.
- **Insert an `item_deliverables` row** for the upload: `d_kind:'file'`, `body` = extracted text,
  `storage_path`, `knowledge_file_id`, `metadata:{ source:'upload' }`, `task_id` = the requesting step.
- Set `task.awaitingInput.fulfilledRef` = the new deliverable id and flip the step to `done` (its ask is
  satisfied) — or, if the step was a *prerequisite pull* for a downstream step, resume that step.

### Resuming downstream

Once the file is in the pool, any later step's `assembleStepWorkflow` sees it in the pool index and uses
its `body`/`knowledge_file_id` as grounding — the deck flows to the recap email automatically. Self-heal
(§5) turns "downstream step needs a deck, none in pool" into "insert an `awaiting_input` request on an
upstream step," so the ask surfaces before the dependent work runs.

---

## 7. Reuse map — existing engine vs. new

| Concern | Reuse (existing) | New |
|---|---|---|
| Step dispatch | `executeStep` + `executeToolStep`/`executeAIStep`/`executeAgentStep` (`lib/workflows/execute-step.ts`) | — |
| Coworker run | `executeAgentStep` → `runWorkerStepViaAgentOS` (flag-agnostic, tools + skills + memory) | pass **pool** as `previousOutputs` |
| Tools | the whole registry (`lib/tools/index.ts`): `search_knowledge_base`, `read_document`, `get_emails`, `get_calendar`, `get_meeting_context`, `web_search`, `deep_research`, `find_team_work`, `slack_read_messages`, `compose_email`, `generate_document`, `send_email`, `send_calendar_invite`, `slack_post_message` | — |
| Capability grading + owner | `CAPABILITY_MAP`, `proposeOwner`, `isDirectRunnableCapability`, `renderCapabilitySet` (`lib/home/capability-map.ts`); `generateItemPlan`/`classifyStep` (`lib/home/item-plan.ts`) | soft `needs` hints (one JSON field) |
| Irreversible commit gate | `prepare-action.ts` + `/api/items/prepare` + `/api/items/execute` + `executeSendCalendarInvite`; `ComposePanel` + `/api/compose/{draft,send}` | generalize the "record a **sent** deliverable" step |
| Document deliverable materialization + KB indexing | `materialiseOutput` / `uploadArtifact` (`work-artifacts` bucket) + `indexArtifact` (`lib/knowledge/indexer.ts`) | link into `item_deliverables` |
| File upload + extraction + indexing | `chat-attach` pattern + `text-extractor.ts` + `indexUploadedFile`; Drive presign (25 MB) | `POST /api/items/attach` (thin, mirrors chat-attach) |
| Report-back DM | `generateReportBack`/`fallbackReport` (`lib/workflows/report-back.ts`) | — |
| Panel UI (owner·state·action, Run, dismiss, reassign, delegate) | `item-detail.tsx` (`useItemPlan`, `StepperRow`, `OwnerChip`/`OwnerMenu`, `StateChip`, `TasksPanel`, `InvitePreviewCard`, `AttachSurface`) | new states (`awaiting_input`, `blocked`), a `deliverable` line, an "Upload →" affordance |
| Plan persistence | `item_plans` jsonb (`ItemPlanTask[]`) — schemaless, no migration for new fields | `item_deliverables` table (one new migration) |

**New modules (small):**
- `lib/home/assemble-step-workflow.ts` — the JIT assembler (§3): task + item + pool → engine steps → run.
- `lib/home/deliverable-pool.ts` — read/write/index `item_deliverables`, build the pool index, dedup.
- `POST /api/items/attach` — the request-attachment upload (§6), mirroring `chat-attach`.
- one migration: `item_deliverables`.

**How the current routes fold in:** `/api/items/run`, `/api/items/delegate`, `/api/items/execute` all
become thin callers of **"run this step's assembled workflow"**:

- `/api/items/run` → `assembleStepWorkflow` (system path) instead of the item-only `runItemStep` LLM call.
  It now runs real tools, reads the pool, writes a deliverable. `runItemStep` is kept as the trivial
  fallback (assembler emits a single `ai` step ⇒ same shape).
- `/api/items/delegate` → still `runDelegation`/`executeAgentStep`, but seeded with `previousOutputs =
  pool` and it writes the coworker's output as a deliverable.
- `/api/items/execute` → unchanged commit, plus it inserts a **sent** deliverable.

No second engine. Each step is a workflow-shaped run on the engine that already exists.

---

## 8. Agnostic + future tools

The design invariant from `docs/identified-tasks-execution-plan.md` holds and gets *stronger* here:
**adding a tool = one `CAPABILITY_MAP` entry + a registered executor** and it flows into (a) load-time
grading (`renderCapabilitySet`), (b) run-time assembly (`assembleStepWorkflow` picks it by `tool`), (c)
coworkers (an `agent` step can call it). Nothing about the pool or the assembler hardcodes a capability.

- **Owner flips for free.** A step graded `[You]` today because no tool exists (e.g. "forward the deck to
  finance", "pull the invoice from the billing system") flips to **system/coworker** the instant that
  capability lands `built:true` — with **zero** classifier/assembler/UI change. Concrete near-future
  entries: `forward_email`, a billing/CRM read, `linkedin_post` (already deprecated from the picker but
  executable), `schedule_send`. Each is one map row; `proposeOwner` re-derives the owner; the assembler
  starts emitting the step.
- **New coworker = new roster row.** `judgment` steps pick it automatically at classify/assemble time —
  no code change.
- **Feature gating** rides the existing `TOOL_FEATURE` cross-ref (`Capability.feature`) so a disabled
  workspace feature flips those steps to `[You]` everywhere.

---

## 9. UI reflection

The panel already renders the board (`item-detail.tsx`). Per-step it shows **owner · state · action**
(the shipped `OwnerChip`/`StateChip`/action-line in `StepperRow`). This model adds:

- **Deliverable line** — when a step has produced a pool entry, render `task.deliverable.gist`
  ("produced: cost estimate", "produced: research brief · Drive") under the title, with a chip that opens
  the document/file. A **sent** deliverable reads "sent · Thu 10:00 invite".
- **New states** — `awaiting_input` (amber "Needs a file" + an **"Upload →"** affordance opening
  `AttachSurface`); `blocked` (subtle "waiting on an earlier step" while auto-pull runs, then clears).
- **Run** semantics (already in `useItemPlan.runPlan`) become: for each live step in order, assemble +
  run its mini-workflow (system inline / coworker via AgentOS), pausing at irreversible commits and
  `awaiting_input`. "Run all runnable" walks the board; per-step Run runs one; both go through
  `assembleStepWorkflow`. The pool grows as the walk proceeds, so a later step in the same walk sees an
  earlier step's fresh deliverable.
- **Approval** — unchanged `InvitePreviewCard` / composer gate on irreversible steps.

No panel rewrite — the surface is done; we're wiring real substance to the existing owner·state·action
rows and adding two states + a deliverable line.

---

## 10. Worked examples (validated with the user)

Each shows **load** (cheap identify) → **run** (JIT assemble) → **pool** (what lands, what downstream
reads).

### A. Email meeting-request ("Can we meet Thursday?")

- **Load:** `generateItemPlan` → `[1] Confirm the meeting (system/send · invite)`; `[2] Reply to Sarah
  (system/send · draft)`. Owners: invite → system, reply → coworker/system.
- **Run [1]:** assembler routes to `send_calendar_invite`; `prepareCalendarInvite` grounds time +
  attendees from the item (already built) → **awaiting_approval** → user approves → invite sent. Pool
  gets a **sent** deliverable `{ d_kind:'sent', gist:'Invite Thu 10:00 → Sarah' }`.
- **Run [2]:** assembler drafts the reply; reads the pool → sees the invite went out → the draft says
  "sent you an invite for Thu 10:00" instead of re-proposing a time. Pool gets a **draft**; on send, a
  **sent**. Downstream coherence with zero explicit dependency wiring.

### B. Meeting follow-up (coworker → coworker deliverable flow)

- **Load:** `[1] Research the account (coworker · Max)`; `[2] Draft the recap post (coworker · Luca)`;
  `[3] Post to the channel (system/send · Slack)`.
- **Run [1]:** `executeAgentStep(Max)` with pool (empty) + item → Max uses `deep_research`/
  `find_team_work` → **document/text** deliverable `{ title:'Account research brief', body:… }` in pool.
- **Run [2]:** `executeAgentStep(Luca)` with **pool = [Max's brief]** as `previousOutputs` → Luca writes
  the post *from Max's brief*, in his voice + skills → **draft** deliverable in pool. (This is the case
  that is broken today — `delegate.ts` passes `previousOutputs: []`.)
- **Run [3]:** irreversible Slack post → prepared → approve → **sent** deliverable. The pool carried the
  content the whole way; order was the user's choice, running [1] then [2] just enriched [2].

### C. You-owe commitment ("send the signed NDA")

- **Load:** `[1] Locate the signed NDA (you · needs a file)`; `[2] Reply attaching it (system/send)`.
- **Run:** `[1]` has no evidenced file → **awaiting_input** `{ ask:'Upload the signed NDA' }`. User
  clicks **Upload →** (`AttachSurface`) → `POST /api/items/attach` stores + extracts + indexes → **file**
  deliverable in pool → step done.
- **Run [2]:** assembler sees the NDA file in the pool → drafts the reply with the file as an attachment
  (self-heal turned "step 2 needs a file" into "ask on step 1" up front) → approve → **sent**. The
  requested file flowed downstream automatically.

### D. Future-tool owner-flip ("forward the deck to finance")

- **Today:** graded `[You]` (no `forward_email` tool) — the user forwards it manually.
- **Add one map entry** `forward_email` (`built:true`, atomic, irreversible): next load, `proposeOwner`
  makes the same step **system**; the assembler emits a `forward_email` tool step (gated behind approve);
  the deck (a **file** deliverable already in the pool from example C's upload) is the payload. No
  classifier/assembler/UI change — the proof of the agnostic rule.

---

## 11. Staged build order (each slice shippable + testable)

**S1 — Deliverable pool + on-run assembly for system steps.**
Add the `item_deliverables` table + `lib/home/deliverable-pool.ts`. Write `assembleStepWorkflow`'s
**system path** (tool + ai steps, run inline). Re-point `/api/items/run` at it. A reversible system step
now does a real tool-backed fetch/synthesis and **writes a deliverable**; the panel shows "produced: …".
*Test:* an "analyze the thread" step that also reads a KB doc; verify a pool row + the gist line.

**S2 — Coworker steps read + produce into the pool.**
Seed `executeAgentStep`'s `previousOutputs` from the pool in `/api/items/delegate` (`runDelegation`);
write the coworker's output as a deliverable (+ index documents). *Test:* example B — Max then Luca;
confirm Luca's output references Max's brief.

**S3 — Request-attachment-from-user.**
Add the `awaiting_input` state, the panel "Upload →" affordance, and `POST /api/items/attach` (mirroring
chat-attach + `indexUploadedFile` / Drive presign). Land the upload as a **file** deliverable. *Test:*
example C — request the NDA, upload, verify it appears in the pool and the next step attaches it.

**S4 — Self-heal / auto-pull.**
Wire the assembler's pool-gap reasoning: auto-pull a cheap reversible prerequisite (recurse), else flip
to `awaiting_input`/`blocked`; add dedup against existing deliverables. *Test:* run a downstream draft
step first and confirm it either pulls the upstream research or asks for the missing file, and doesn't
duplicate an existing brief.

**S5 — Future-tool owners.**
Register one new capability (e.g. `forward_email` or `schedule_send`) and confirm the owner flips and the
assembler emits it with **no** classifier/assembler/UI edits (example D). This slice is the regression
test for the agnostic invariant.

Each slice is independently shippable: S1 works alone (system steps get real substance); S2 adds coworker
flow; S3 adds uploads; S4 adds intelligence; S5 proves extensibility.

---

## 12. Open questions / decisions

- **Auto-pull vs ask (default).** Proposed: **auto-pull** a *cheap, reversible, system/coworker*
  prerequisite (research, fetch, analyze — the pool dedups so it's not wasteful); **ask** when the
  prerequisite is a `you` step or a file only the user holds. Confirm the cost ceiling for auto-pull
  (deep_research is not "cheap" — cap auto-pull to non-`judgment` fetches?).
- **Deliverable persistence / expiry.** Do pool entries live forever with the item, or expire? Proposed:
  persist with the item (a resolved item's plan is already durable); GC on item resolution/dismissal is a
  later concern. Documents/files already have their own lifecycle in Drive/KB.
- **Parallel vs sequential run.** "Run all" walks sequentially today (so the pool is populated in order —
  which is what makes downstream steps see upstream output). Parallelizing independent steps is a later
  optimization; keep sequential so the pool-flow semantics are deterministic.
- **How much a coworker step "reasons."** `executeAgentStep` gives the coworker its full tool loop
  (AgentOS) — it *can* fetch/research within its own step. Decision: let the coworker reason freely
  within its step, but the **pool** is the cross-step channel — a coworker shouldn't re-fetch what an
  upstream deliverable already holds (surface the pool prominently in its `previousOutputs`).
- **Re-run semantics.** Re-running a step: overwrite its existing deliverable (same `task_id`) or append
  a new version? Proposed: **overwrite** (latest wins; keep it simple), with dedup keyed on `task_id`.
  A **sent** deliverable is never re-run (it's a committed side effect).
- **Where assembly output lives vs. a real `workflow_run`.** Proposed: the in-item mini-run does NOT
  create `workflow_runs`/`work_threads` rows (that machinery is for scheduled Studio tasks); it runs the
  steps inline and records only the **deliverable** + the existing `activity_events` log. Revisit if we
  want the item's runs to appear in the Activity/Drive timelines as first-class runs.

---

## Appendix — the honest gaps in the real engine

Places the current engine does **not** cleanly support the model, called out so the build doesn't assume
they're free:

1. **`delegate.ts` passes `previousOutputs: []`.** The coworker path is the biggest substance gap — today
   a coworker never sees a prior step's output. S2 fixes it, but it means the delegate route must load the
   pool *before* running and thread it through `runDelegation` → `executeAgentStep`.
2. **`runItemStep` has no tools.** It's a single classification-tier LLM over item text — it cannot
   actually fetch a KB doc or read the calendar despite `fetch` being a graded capability. The
   assembler's system path is a genuine rewrite (emit + run real `tool` steps), not a wrapper.
3. **`run-workflow.ts` is heavyweight for an in-item step.** It creates a run row, a thread, a report-back
   card, fires notifications, and materializes to a single `OutputConfig` home. An in-item mini-run wants
   a *lightweight* per-step accumulation (just `executeStep` in a loop + a pool write) — so we reuse
   `executeStep`/`executeAgentStep`/`materialiseOutput` **but not** `runWorkflow` itself. (§7, §12.)
4. **No image/scanned-PDF vision on the AgentOS path.** Per CLAUDE.md, the AgentOS bridge is text-only —
   an uploaded scanned deck reaches a coworker as extracted text only. `text-extractor.ts` + KB OCR cover
   most cases; true vision grounding for a coworker step is out of scope.
5. **Instance-honesty must extend to the pool.** The classifier already downgrades an unevidenced fetch
   to `[You]`; the assembler must apply the same honesty to the pool — never claim to "use the deck"
   unless a deck deliverable actually exists in the pool (§4 dedup + §5 self-heal enforce this).
