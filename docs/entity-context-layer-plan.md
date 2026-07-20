# Entity Context Layer — plan

## The idea
Today the pipeline reads each email in a vacuum. A human reads it inside a web of relationships:
*"this is Léa from the Soboplac deal, we met Jean-Marie last week, I owe them a pricing offer."* That
recognition IS the context, and it's what makes the judgment correct. We give the pipeline (and the user)
that same relationship context.

**Principle:** assemble the relational neighborhood we already have (deterministic entity resolution) →
let the model reason **over** it → expose it as ONE reusable service for every AI touchpoint **and** the
human deep-dive. No graph DB, no keyword rules. The graph is already implicit in our FKs + initiative keys.

**Why it's the root fix:** the recall bug (a deal email classified FYI, initiative never reasoned, orphaned
from its project) disappears when classification reasons *with* the neighborhood. Context beats model size —
a modest model that knows the account beats a bigger model guessing blind.

---

## The primitive

`EntityContext` — the dossier around an email's participants + its initiative:

```
EntityContext = {
  people:      [{ email, name, relationshipStrength, isInternal }],
  initiative:  { label, projectId, projectName } | null,   // grounded canonical (getInitiativeCandidates)
  openCommitments: [{ id, description, direction, dueDate }],      // by counterparty (alias-aware)
  recentMeetings:  [{ id, title, date, initiative }],             // past transcripts w/ these people
  upcomingMeetings:[{ id, title, startTime }],                    // future calendar w/ these people
  recentThreads:   [{ subject, lastActivityAt, itemId, href }],   // other correspondence w/ them
  relationship:    { strength, lastContactAt } | null,
}
```

- `buildEntityContext(supabase, userId, participants, opts)` — one contact/thread.
- `buildEntityContextMap(supabase, userId, allParticipants)` — **batched**: one corpus pass per sync batch,
  returns `Map<personKey, EntityContext>`, shared by every email in the batch. Mirrors `buildInitiativeMap`.
- `renderEntityContextForPrompt(ctx)` — compact text block for model injection.

**Assembly = deterministic relational lookups** (join by person/initiative). **Reasoning = the model's job.**
This is the "reason once grounded, join cheaply" split the system already uses — entity resolution, NOT the
keyword hardcoding we rejected.

**Reuse (no new infra):**
- `lib/projects/identity.ts` — alias/name-token person unification.
- `lib/inbox/initiative-candidates.ts` `getInitiativeCandidates` — the grounded canonical initiative.
- `lib/projects/initiative-resolver.ts` — the corpus-pass pattern + the **corporate-domain / internal-colleague
  guard** (so context never bleeds across unrelated people on a shared domain — the Galp 47-meetings lesson).
- Tables already present: `inbox_items`/`emails`, `commitments` (counterparty), `meeting_transcripts` (past),
  `calendar_events` (future), `relationship_graph`, `projects`.

---

## Pipeline reality — WHERE the label is actually decided (this reframes Slice 1)

The email-labeling decision is made by two gates in `sync-emails.ts` that run **before** any rich context
exists. Each synced batch:

- **Gate A — batch pre-classifier** (`batchClassifyEmails`). Sees ONLY `{from, subject, snippet, body_preview}`.
  Decides `process` | `fyi_only` | `noise`. **This is the routing gate.**
- **Gate B — rules engine** (`batchMatchRules` + `evaluateDeterministic`). Sees the same envelope + the user's
  inbox rules. Decides the `rule_type` label; an actionable rule can PROMOTE a `fyi_only` email to full processing.
- **Fork:** `noise`/`fyi_only` (unpromoted) → **fast-path** (stamp `work_state: noted/noise`, store, STOP — no
  `processEmail`, so `understanding: NULL`). `process`/promoted → **Phase 2 `processEmail`** → `computeUnderstanding`
  (+ `formatCalendarContext` upcoming meetings + `formatThreadContext`).

**The gap:** ALL rich context — calendar/meetings, thread history, and the entity context — lives in **Phase 2**,
i.e. AFTER Gates A/B already decided. The gates that actually pick the label are **context-blind** (own text only).
So a deal email that reads routine is routed `fyi_only` at Gate A and never reaches `computeUnderstanding`. This is
why the Soboplac emails are `NULL`, and why **a backfill is a band-aid** (it re-runs Phase 2 on those rows but leaves
the blind gate that keeps dropping future deal mail).

**Best practice = retrieval-augmented classification: enrich the input BEFORE the classifier decides, not after.**
Assemble the entity context once per batch and thread a compact relationship signal into the `EmailEnvelope`, then
feed the enriched envelope to Gate A **and** Gate B. This is *context-aware routing* — strictly better than
"remove the fast-path / reason about everything": genuine noise still fast-paths (keep the cost saving), and a
live-deal contact is **never** routed to noise/fyi. The load-bearing move is **context → envelope → the two gates**,
not context → the last stage.

## Slices (in build order)

### Slice 0 — the context service (foundation, no behavior change) — DONE
- `lib/context/entity-context.ts`: `buildEntityContext` + `renderEntityContextForPrompt` (+ `buildEntityContextMap`
  for the per-batch share, still to add). Deterministic assembly; two-hop deal awareness (person → initiative →
  the deal's commitments/meetings); assembled over ALL participants (from+to+cc), since the label often lives with
  a cc'd colleague.
- **Verified (read-only, cross-user):** the Soboplac email assembles {Soboplac AI Agent System, the Jean-Marie
  meeting 2026-06-23, 3 open commitments, the other threads}; across 4 users 17/60 person-emails grounded a deal,
  sparse accounts correctly empty (no hallucination); ~115–380 tok/email (avg ~230).

### Slice 1 — make the LABELING context-aware (the real root fix)
Slice 1 is NOT just "inject into `computeUnderstanding`" — that's only the last stage. Three parts, in order of
leverage:
- **1a — `computeUnderstanding` context (DONE).** Injects the entity context over all participants; the initiative
  grounding rides the richer all-participants label. A `useEntityContext` seam enabled the A/B. **A/B proved better
  AND cheaper on the cheap tier:** deals consolidate to the canonical label instead of inventing synonyms (Soboplac,
  GALP, Genpact), confidence rises (4/5 up), controls (newsletters) unchanged. This fixes reasoning *when it runs* —
  but it's downstream of the gate, so insufficient alone.
- **1b — enrich the `EmailEnvelope` + feed Gate A & Gate B (the load-bearing part).** Build ONE `buildEntityContextMap`
  per sync batch; add a compact `relationship` signal to the envelope (deal label + open-commitment count + last/next
  meeting). Pass it to `batchClassifyEmails` (so a live-deal contact is never `noise`/`fyi_only`) and `batchMatchRules`
  (relationship-aware matching). This is where the Soboplac email stops being dropped at the door — by construction.
- **1c — backfill the already-orphaned rows** (secondary, symptomatic): recompute `computeUnderstanding` on existing
  `understanding: NULL` person-mail so the current deal emails get rescued too. Reuse the `rebackfill-understanding`
  pattern. Do AFTER 1b so it isn't re-orphaned.

**Supersedes the earlier "batched-understanding on all mail" idea:** context-aware routing keeps the fast-path's cost
saving for real noise instead of reasoning about every newsletter — the cheap gate just makes a smarter call.

### Slice 2 — human-facing context rail (the deep-dive)
- `GET /api/items/[id]/context` → `EntityContext` for the item's participants.
- In `components/home/item-detail.tsx` (email variant) + the inbox detail: an **"About this"** rail —
  person + relationship · the deal (with the Add-to-project control we shipped) · open commitments with them ·
  last meeting + next meeting · related threads (clickable). Same assembly, human consumer. This is the other
  half of the ask: *you* also get the context when going through mail.

### Slice 3 — fan-out to the other AI touchpoints (build-once, serve-many)
- **Drafter** (`lib/inbox/draft-reply.ts` / `/api/compose/draft`): inject context → replies that know the history.
- **Home brief "why it matters"** (`lib/home/synthesize-brief.ts` / `name-bundles.ts`): grounded in real
  relationship facts, not invented urgency.
- **Coworker chat** (meeting/inbox context in `app/api/assistant/chat` + the worker bridge): the AI knows the
  account. Respect existing trust boundaries (company goals never reach coworkers).

### Slice 4 — precompute + cache for scale (only when volume demands)
- A durable per-contact / per-initiative **dossier** (a table or `profiles` jsonb) updated as items arrive, so
  read-time is instant and the batch pass shrinks to a delta. Optional; the per-batch map + TTL cache carries
  us until then.

---

## Cross-cutting guards
- **Deterministic assembly, model reasoning** — never encode the relationship in keywords.
- **One service, many consumers** — classification, drafter, brief, coworker chat, deep-dive rail.
- **Over-association guard** — reuse the corporate-domain / internal-colleague exclusion so a shared-domain
  colleague doesn't drag unrelated context in.
- **Trust boundary** — entity context is the USER's own data; company Strategy/goals never enter coworker context.
- **Cost** — batch per sync + cache per contact; a durable dossier (Slice 4) if volume grows.
- **Freshness** — TTL + bust on new item for the contact/initiative.

## Sequencing
Slice 0 (service + verification) **[DONE]** → **Slice 1a** context→`computeUnderstanding` **[DONE]** →
**Slice 1b** context→envelope→Gate A + Gate B **[the load-bearing part, next]** → Slice 1c backfill →
Slice 2 (human rail) → Slice 3 (fan-out) → Slice 4 (durable cache). 1b is the real fix — where the label
is decided; without it 1a/1c are downstream of a blind gate.

## Status
- Committed/pushed on `dev`: the meetings→projects + add-to-project batch (separate arc).
- On disk, NOT committed: `lib/context/entity-context.ts` (Slice 0), the `computeUnderstanding` context
  injection + `useEntityContext` seam (Slice 1a). Build + type-check green; A/B run (not shipped to prod
  behavior beyond Phase-2 emails, since the gate change 1b isn't in yet).
