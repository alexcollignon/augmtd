# The Initiative Brain — plan

## The pivot
Everything so far made the *understanding* correct (an email lands on the right initiative). This is the pivot from
**organizing → doing**. The unit of work is not the email — it's the **initiative**. Nobody thinks
"process item #47"; they think *"where's Soboplac and what do I do next."* The Initiative Brain is the durable
per-initiative context + synthesized state + **one prepared next move**, and it serves BOTH halves of the goal:
a filtered *"where each initiative stands"* view (what's happening around your work) AND grounded execution (the how).

**The hard principle (the anti-dashboard rule):** the Initiative Brain is NOT another screen to read. Each
initiative collapses to **one headline (where it stands) + one prepared next move (executable)**. Reading and
doing are the SAME surface. If it becomes a dashboard you scan, it failed.

**Generic by design (not a sales tool).** An initiative is whatever bounded body of work a person is running —
a client engagement, a hiring round, a launch, a migration, an internal program, a personal project. People do
different work and treat email differently, so the brain assumes NO fixed pipeline, stages, or "deal" shape:
everything (state, momentum, next move) is REASONED from the initiative's own content, never a template.
"Project" is the user-facing name (the tracked form); "initiative" is the underlying reasoned cluster (tracked
or not) — the vocabulary the code already uses (`understanding.initiative`, `initiative_key`).

## LIVE / event-driven — the brain is the structure, everything else is an event on it
The Initiative Brain is not a periodic report; it's a **living ledger** that updates AS THINGS HAPPEN — an email
arrives, a reply is sent, a meeting is transcribed, a doc is shared. It always knows **what happened, who's
who, and who did what**. The key reframe the user named:

> "in a way it's a structure for the commitments — or a commitment is just a data point of this."

Exactly. **The initiative is the primary structure; emails, meetings, sent mail, decisions, docs — and commitments —
are all EVENTS on it.** A commitment is not a parallel first-class thing; it's one *derived* signal
("something is owed") in the initiative's ledger. `whoOwes`, the next move, the task list — all are **derived views
of the ledger**, not separate stores. This inverts today's model (commitments as their own surface) into:
the initiative is the noun; commitments/tasks/replies are what the initiative is DOING.

### The ledger (who did what, when)
Every atom already carries `initiative` (understanding) / `project_id` (magnet) + a timestamp + an actor
(from-address / is_from_user / attendee / coworker). So the per-initiative **event ledger** is derivable on read
from the atoms we already store — no new extraction, no duplication:

```
initiative event (derived from existing atoms, keyed by initiative)
  kind        email_in | email_out | meeting | commitment | doc | calendar | coworker_action | decision
  actor       you | <person> | <coworker>        -- WHO did it
  counterparty <person/org>                        -- who it's with
  at          timestamp                            -- WHEN
  summary     1 line                               -- WHAT happened
  ref         inbox_item / transcript / commitment / work_thread …
```
Optionally we materialize this into a durable `initiative_event` timeline later (a clean audit/narrative), but v1
DERIVES it from atoms (reuse the entity-context corpus). "Live" = it re-derives the moment a new atom lands.

### The live mechanism (how it stays current)
- **On ingestion** — every place an atom gets tagged to an initiative already runs: email sync (`sync-emails`),
  meeting insight (`storeTranscriptAndGenerateWork`), sent mail, commitment extract, calendar. Each **marks
  the initiative's state stale** (bump `sig`) and refreshes it in the background (the `after()` fold we use for
  `home_brief`). So a new email/meeting/send updates "where it stands" + the next move within seconds.
- **Who's who** — a per-initiative people graph derived from participants + `relationship_graph` + coworker
  attribution: external counterparties (+ inferred role), the internal team, which coworker did what. The
  internal-colleague guard we just shipped keeps this clean.
- **Who did what** — every event is attributed (you sent / they replied / Clara drafted / Jean-Marie decided),
  so the state can say "you sent the offer Tue; Léa hasn't replied (3 days)" — not just "there's an email."

## What it holds (three layers)
1. **Context** (the neighborhood — we already assemble this: `lib/context/entity-context.ts`): the people
   (external counterparties + internal team), emails, meetings (past + upcoming), commitments (both directions),
   docs. Deterministic, grounded, no keywords.
2. **State** (synthesized, the new part): a short *where-it-stands* + `momentum` (active / needs-you / gone
   quiet N days / stalled) + `whoOwes` (you owe X · they owe Y) + what's blocking. Reasoned ONCE from the
   context, cached, refreshed on new activity.
3. **Next move** (the execution part): the SINGLE most important next action for the whole initiative — prepared,
   in the user's voice, one-click. Not a per-item "Reply" button; the initiative-level next thing.

## How it's built (reuse, don't reinvent)
- **Assemble** the initiative's atoms deterministically — the entity-context primitive, but keyed by
  **initiative** instead of per-email (aggregate all atoms carrying this initiative / `project_id`). We already
  have the parts: `getActiveInitiatives` clusters, the magnet sets `project_id`, understanding carries `initiative`.
- **Synthesize** state + next move in ONE grounded AI pass per initiative (the `synthesizeBrief` / `computeUnderstanding`
  discipline: reason once, grounded in real facts, never invent). Cached with a `sig` (atom counts + freshest
  timestamps), refreshed only when the initiative actually moves — like `home_brief`.
- **Prepare** the next move with the EXISTING engine: the capability map + `proposeOwner` (AUGMTD / coworker /
  you) + `/api/items/prepare` → `/api/items/execute` (approve-before-commit). The Initiative Brain just picks THE
  next move across the whole initiative instead of per item.

## Data model (durable, keyed by initiative — works BEFORE tracking)
The brain must exist for every **active** initiative, not only tracked projects (so "what's happening" covers
everything). So it's keyed by the stable `initiative_key`, with `project_id` linked once tracked.

```
initiative_state           -- one row per (user, active initiative)
  user_id
  initiative_key   text     -- normalizeInitiative(label) — stable id across tracked/untracked
  label            text     -- canonical display label
  project_id       uuid?    -- linked when the user tracks it (ON DELETE SET NULL)
  state            jsonb     -- { summary, momentum, whoOwes, blocking, lastMoveAt }
  next_move        jsonb     -- { title, owner, capability, prepared?, entityRef }
  sig              text      -- invalidation signature (atom counts + freshest timestamps)
  last_activity_at timestamptz
  updated_at       timestamptz
```
Alternative considered: store on `projects.settings` (jsonb) — rejected, because it can't cover untracked
initiatives, and the "what's happening" view needs those too.

## The synthesized STATE (fields, all reasoned — never keyword)
- `summary` — 1 line: where it stands ("Pricing offer sent; awaiting Léa's confirmation").
- `momentum` — `active | needs_you | waiting | gone_quiet | stalled` + `quietDays` (from last inbound/outbound).
  This is the proactive signal the current reactive to-do list lacks.
- `whoOwes` — you owe [..] · they owe [..] (from commitments + read-time reply state, already computed).
- `blocking` — what's in the way, if evidenced (a missing doc, an unanswered question). Omitted if none.
- `stage` — a SHORT reasoned phrase describing where THIS initiative is, in ITS OWN terms — never a fixed
  sales funnel. An initiative can be a client engagement, a hiring round, a launch, a migration, an internal
  program, a personal project — people work differently and treat mail differently. So the stage is inferred
  from the initiative's own content ("waiting on candidates", "rollout in progress", "awaiting sign-off"),
  not slotted into scoping/proposal/negotiation. Omitted when there's no meaningful stage.

## The NEXT MOVE engine (the "how")
The synthesis picks the one next move for the initiative, graded by the capability map:
- you owe a reply → **draft the reply** (prepared, in voice) — AUGMTD prepares, you approve.
- you owe a commitment (send the offer/doc) → **prepare the send** — approve-before-commit.
- they owe you + gone quiet → **prepare a nudge**.
- meeting upcoming → **prep brief** (coworker/AUGMTD).
- nothing pending → no action; the initiative is *awareness* only (it still shows state, no move).
`proposeOwner` decides AUGMTD (atomic) / coworker (judgment) / you. One hero button per initiative → prepare →
approve → execute. This is where per-N-item plans collapse into ONE initiative-level action.

## The surfaces (filtered view + execution = ONE thing)
- **Home "What's happening around your work"** — the initiative-brain rollup: each active initiative = label · state
  headline · momentum · **the next move (inline, executable)**. Sorted by attention (needs-you → gone-quiet →
  waiting → active). This is the ambient half we're missing. Loose (non-initiative) items stay a small separate bucket.
- **Project detail LEADS with the brain** — where it stands + the next move, then the context. (We already
  de-ClickUp'd it; this makes the lead a living state + action, not a board.)
- **The item deep-dive** already shows the "About this" rail (Slice 2) — it links up to the initiative brain.

## The loop closes (living state)
- **Execution updates state**: send the offer → `whoOwes` flips to "awaiting them", momentum → waiting,
  `lastMoveAt` bumps (optimistic + recompute).
- **Inbound updates state**: they reply → ball's in your court, momentum → needs_you, next move regenerates.
- This is what makes it a *brain*, not a snapshot — it tracks the initiative moving.

## Scale + cost (the discipline we've held)
- ONE cached synthesis per ACTIVE initiative (not every initiative ever), `sig`-invalidated — recompute only when
  the initiative moves. Same fold as `home_brief`.
- Assembly is deterministic (reuse entity-context corpus); one cheap `classification`-tier pass for state +
  next-move selection; the heavy prepare only on engage (lazy). No per-load recompute.
- The internal-colleague guard + corroboration + grounded-labeling all carry over (garbage in → no initiative).

## Trust boundaries (unchanged)
Per-user, the user's own initiatives. Company Strategy/goals NEVER enter an initiative brain or coworker context. Coworker
delegation reuses the existing prepare-and-report guardrail.

## Slices (build order)
- **S1 — the ledger + state, read-only.** `buildInitiativeBrain(initiativeKey)` = derive the initiative's **event ledger**
  (who did what, when — from the atoms) → one grounded synthesis → `{summary, momentum, whoOwes, stage,
  people}`. Verify read-only across users on real initiatives (Soboplac, Genpact, Emirates): does the ledger read
  true (right people, right who-did-what) and does the state read true? No surface yet.
- **S2 — the next-move selector.** Add `next_move` (reuse capability map + proposeOwner). Verify it picks the
  RIGHT one move per initiative (draft reply / prepare send / nudge / prep) across users. Still no commit.
- **S3 — durable state + LIVE refresh.** The `initiative_state` table + `sig` cache; wire the ingestion points
  (email sync, meeting insight, sent mail, commitment extract, calendar) to mark the initiative stale + background-
  refresh — so it's live as things happen. Cheap: recompute only on real movement.
- **S4 — the Home "what's happening" surface.** The initiative rollup: state + inline executable next move. The
  filtered view. (Reconcile with the existing "what needs you" — initiatives primary, loose items secondary.)
- **S5 — execute + close the loop.** Hook the next move to prepare→execute; update state on execute + on
  inbound. Project detail leads with the brain.

## Decisions (LOCKED)
1. **Home reframe** — the initiative rollup sits BESIDE the per-item list; **initiatives primary**, loose (non-initiative) items
   a small secondary bucket.
2. **Which initiatives get a brain** — **corroborated "real" initiatives only** (a commitment/meeting/real thread
   behind it), never a bare label. Reuses the corroboration guard we shipped.
3. **Momentum / "gone quiet"** — **reasoned per initiative**, from its own cadence (a weekly-cadence initiative quiet 3
   days ≠ a hot initiative quiet 3 days), not a fixed N-day rule.
4. **Durable state** — YES, a durable `initiative_state` (derived state) so it tracks transitions + closes the
   loop. The event LEDGER is derived-on-read from atoms in v1 (materialize `initiative_event` later if we want a
   durable narrative).
5. **LIVE** (new) — the state updates on every ingestion event (email in/out, meeting, commitment, calendar),
   background-refreshed like `home_brief`, so it always reflects the latest "what happened / who did what".
6. **Commitments are a data point** (new) — the initiative is the structure; commitments feed `whoOwes` as one
   derived signal, not a parallel first-class surface. Same for tasks/next-moves — all derived from the ledger.

## Backlog — human MERGE of projects (deferred, keep in mind)
Because labeling is now CONTENT-FIRST (a person's distinct areas are kept apart to avoid over-merge), the
system will sometimes create two projects the USER considers one. The complement is a human **merge** — the
safety valve, and it TEACHES: pick two projects → choose the surviving label → remap the loser's atoms
(inbox/commitments/meetings/calendar `project_id`) → record the absorbed label as an **alias** so future
labeling + clustering consolidate automatically. Fits the model (conservative auto; a human decision outranks
the machine and sticks — `project_locked`-style). Safer than any blind auto-merge (the Galp lesson). Not built
yet; noted so it isn't lost.
