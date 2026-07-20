# THE ONE BRAIN — entity memory + reasoned recognition (the core rebuild)

**North star.** The system reasons like a human: it has MEMORY of the things in your working life (deals,
programs, people, projects), it RECOGNIZES new input against that memory ("ah — this is the Jean-Marie pilot
we discussed Tuesday"), and everything else — Home, coworkers, chat, drafting — READS that one memory. Built
once, properly, as the core of the product. No legacy label layer left behind, no bandaid patching, no
fake-reasoning heuristics.

**The governing principle (what "no heuristics" means, precisely).**
- **Judgment is always reasoned.** Anything that answers "what is this about?", "are these the same thing?",
  "what matters most?", "what's next?" is decided by the model WITH MEMORY IN VIEW — never by keyword lists,
  string similarity, frequency priors, or hand-tuned scoring formulas.
- **Facts are structural.** A reply in an already-linked thread IS part of that conversation — a human doesn't
  re-reason that either; it's identity by construction, not a decision. Thread continuity, participant lists,
  calendar linkage: these are EVIDENCE fed to reasoning, or structure that makes a decision unnecessary.
- **Plumbing may be mechanical.** Caching, sig-gating (recompute only what changed), embeddings-as-recall,
  RLS — cost control and infrastructure, not judgment.

The failed pattern this replaces: understanding compressed into STRING LABELS at ingest (one-shot, frozen,
amnesiac), then identity reconstructed downstream by string matching (`normalizeInitiative` keys, grounding
clauses begging the model to reuse strings). Diagnostic baseline (scripts/smoke-labeling-diagnostic.ts):
**50% of multi-item labels lump distinct topics** (half single-contact — the person-prior bug) and **true
synonym splits persist** despite the reuse prior. A string is not an identity. No prompt tuning fixes it.

---

## 1. The memory — entity registry

One registry of the THINGS in the user's working life. Two kinds now, room to grow.

```sql
work_entities (
  id uuid pk, user_id uuid,
  kind text,                -- 'initiative' | 'person'
  name text,                -- display name (an OUTPUT of memory, not the identity)
  summary text,             -- the entity's evolving self-description (reasoned, re-synthesized)
  aliases jsonb,            -- names/emails this entity is known by (person: addresses; initiative: old labels)
  state jsonb,              -- the synthesized brain state (momentum, whoOwes, stage… — today's initiative_state/person_state shape)
  next_move jsonb,          -- the ONE next move (reasoned)
  priority jsonb,           -- REASONED priority {weight, reason} — replaces the hand-tuned verdict formula
  embedding vector(1536),   -- of the summary+recent-ledger — the recall index
  tracked boolean,          -- user formalized it (the "project" bit — projects collapse into this)
  status text,              -- active | done | archived | muted
  sig text, last_event_at timestamptz, created_at, updated_at
)

entity_links (
  user_id uuid, entity_id uuid,
  item_kind text,           -- 'inbox_item' | 'email_thread' | 'meeting' | 'calendar_event' | 'commitment' | 'document'
  item_id text,
  via text,                 -- 'structural' | 'recognized' | 'user'    (audit: HOW it was linked)
  reason text,              -- the model's stated reason when recognized
  locked boolean,           -- a user decision outranks the machine, permanently (project_locked, generalized)
  created_at,
  unique (user_id, item_kind, item_id)
)
```

- **People are entities too** — same registry, `kind='person'`, `aliases` holding every address/name form.
  This structurally kills the alias-dup bug (Joyce×2, René/Rene, Nevine×2 at the top of the deck): one
  entity, many aliases, recognition links to the entity.
- **Projects collapse into entities**: a "project" = an entity with `tracked=true` (+ goals/rules moved onto
  it). `initiative_state` and `person_state` become the `state` of entities. One table where three overlapping
  systems (projects / initiative_state / person_state) live today.
- The **ledger stays derived** from links at read time (as `brain.ts` does now) — memory accumulates as
  links; state is re-synthesized when the sig moves (existing machinery, kept).

## 2. Recognition — how things enter the brain (replaces label minting)

Per new item (email at sync, meeting at insights, calendar event, commitment):

1. **Structural inheritance (no decision exists).** The item's thread is already linked → same entity, done,
   `via='structural'`. Most thread replies cost zero AI. A meeting's transcript and its commitments inherit
   each other's entity. This is memory, not a heuristic.
2. **Recall (retrieval, not decision).** Embed the item's content. ANN-search `work_entities.embedding` +
   pull entities linked to the participants + recently-active entities. → a shortlist of REMEMBERED THINGS
   this could be. (pgvector — already run for the KB; "embed inbox_items" was already on the backlog.)
3. **Reasoned recognition (THE decision — always the model, memory in view).** One `classification`-tier
   call: the item (subject/body/participants) + each candidate entity's `summary` + recent ledger lines.
   *"Which of these remembered things is this about? Or is it something new? Or is it not a body of work at
   all (broadcast/notification)?"* → `{entity_id | new: {name, summary} | none, reason}`. The model sees
   actual memory — entity descriptions — not an instruction to reuse a string. Same person + different topic
   resolves correctly because the CONTENT is judged against remembered CONTENT.
4. **Memory update.** Link written (with `via`+`reason` — auditable). Entity `last_event_at`/sig move → the
   existing live-refresh re-synthesizes `summary`/`state`/`next_move`/`priority` (all reasoned). A new entity
   is founded with its first item + an embedding.
5. **Reflection (memory maintenance, reasoned).** Event-driven pass over adjacent entities (embedding
   proximity / shared participants): *"are these the same body of work?"* → reasoned MERGE (aliases absorbed,
   links repointed, audit + undo) or stay apart. **User merge/split is authoritative** and teaches aliases
   (`locked`). This replaces the entire over/under-merge oscillation with honest, separate, correctable
   memory maintenance.

**Recognition-tier rule:** `classification` tier ONLY (the documented reasoning-tier trap — 3 hits).

## 3. Reading the brain (consumers — mostly already wired)

The read contract survives intact — this is why the rebuild is tractable:
- **The verdict contract stays** (one judgment authority, every surface a reader) — but its DERIVATION
  upgrades: `weight` stops being a hand-tuned formula (REL_WEIGHT/IMOM_WEIGHT tables — deadweight under the
  new standard) and becomes the entity's **reasoned `priority` {weight, reason}**, emitted by the same
  synthesis that writes momentum/next-move. Surfaces show the number AND can show the reason.
- Home deck / Projects / Timeline / deep-dive already read brains+verdict → they re-point to entities.
- `renderBrainContext`/`renderWorldContext` (drafter, coworker chat, delegation) → read entities.
- Bundling groups by `entity_id` — REFERENCE, not string-matching. (The "reason once, match cheaply" lesson
  survives purified: the key IS the reasoned recognition; downstream grouping is just referencing.)

## 4. Demolition list (no legacy — DELETED, not fallback'd)

- `initiativeGroundingClause` + the person-prior grounding in `getInitiativeCandidates` (the root bug)
- `initiative` string minting in `computeUnderstanding` + the commitment extractor + meeting insights
- ALL `normalizeInitiative` string-key joins: `active-initiatives`, `cluster.ts` suggestProjects,
  `associate.ts` (the magnet — replaced by recognition + `tracked` entities), `initiative-resolver.ts`
  (person-bridge + internal-colleague guard — calendar events just go through recognition),
  `brain.ts` label matching, the brief/timeline/projects verdict lookups by name
- `person_state` email-string keying (→ person entities with aliases)
- The hand-tuned weight tables in `verdict.ts` (→ reasoned `priority`)
- Label backfill scripts (archived), `deal_aliases`-style patches never built
- `projects` as a separate identity system (→ `tracked` entities; table kept only as a view/compat during
  migration, then dropped)

**Explicitly KEPT (not legacy — different jobs or pure plumbing):** email triage rules (needs-reply/FYI
posture — user-owned, a different question than identity; revisit separately), pgvector infra, live hooks,
sig-gating, instant-load caches, RLS patterns, the reasoned syntheses themselves.

## 4b. Phase A0 — model routing by CALL SHAPE (prerequisite, same disease as the labels)

The task enum (`planning|summarization|classification|…`) is a lossy semantic LABEL standing in for the
call's real SHAPE — the same bug as string-label identity, in the routing domain. Evidence: the
reasoning-model trap (hit 3 documented times: reasoning tiers burn max_tokens on JSON-shaped prompts → empty
→ silent fallback), the scattered "⚠️ MUST use classification tier" tribal-knowledge comments compensating
for it, `unfence()` copy-pasted across ≥3 files, and AVOIDANCE — everything crowds onto Haiku even where deep
reasoning would give better output, because the strong tiers are booby-trapped.

**Design — two orthogonal axes (currently conflated):**
- **Tier** stays: WHERE models come from (privacy/procurement — standard, bedrock_optimised, …).
- **Shape** is new: WHICH model fits — the caller declares the call's truth, not a category name:
  `aiCall(userId, { output: 'json'|'text'|'stream' (+schema), reasoning: 'none'|'deep', latency: 'interactive'|'background', voice? })`
- The router maps shape→model per tier and CENTRALIZES the scattered plumbing: fence-stripping, JSON
  parse/retry, per-provider response_format quirks, max_tokens per shape (incl. a real reasoning-channel
  budget so reasoning models can SAFELY emit JSON — unlocking them instead of avoiding them), retries,
  logAIUsage. The ⚠️ comments die because the mistake becomes unexpressible.

**Sequencing:** BEFORE the One Brain's new channels (recognition / reflection / entity synthesis / reasoned
priority) — they're born on the clean router, never needing the tribal comment. Independently shippable:
existing callers migrate one by one (the enum delegates to shapes during transition, then is DELETED per the
demolition rule).

## 4c. A0.1 — bedrock_optimised normalized + task-channel audit (July 2026, SHIPPED)

**Tier normalization (user decision):** `bedrock_optimised` is now BEDROCK-ONLY for completions, with **Sonnet
as the intelligence/cost cap** (never Opus): Haiku 4.5 for volume work (classification/summarization/assignment/
generation/ocr), Sonnet 4.5 only where intelligence pays (conversation, planning/deep). Replaced the Together
split (Kimi/gpt-oss) → no prompt leaves Bedrock AND the reasoning-channel trap is gone from this tier entirely.
**Sole exception: embeddings stay on Together** — switching embedding models invalidates every pgvector index
(full cross-tenant KB re-index); a deliberate future decision, not a side effect. Verified live: all four
affected legacy channels (planning→Sonnet, summarization/assignment→Haiku, classification→Haiku) resolve +
complete for a real bedrock user; router matrix all-Bedrock; brain-synthesis parity holds.

**Call-site audit (the uniformity review):** ~78 `getAIClient`/`getSystemClient` sites total —
classification 18 · conversation 17 · summarization 16 · generation 10 · planning 7 · ocr 4 · embeddings 3 ·
assignment 2. No code branches on model names (Kimi/gpt-oss references are comments + pricing rows only).
3 sites migrated to `aiCall` so far (both brain syntheses + bundle naming). **Migration checklist (opportunistic
— migrate when touching a file; enum dies in Phase D):** email-processor (planning+classification), item-plan,
commitments/extract, meeting insights (bot-manager), KB indexer, draft-reply/nudge, synthesize-brief,
synthesize-alignment, workflows execute-step/run-workflow/generate-config, memory extraction, voice-profile,
render-memory, intent-classifier, starters, suggest/open-workflow routes. Stale "planning = Kimi" comments in
item-plan.ts / email-processor.ts / assemble-step-workflow.ts die with their sites' migration.
**Follow-up (infra, separate deploy):** `infra/agentos/models.py` on the Hetzner box still builds Bedrock +
Together clients — align to Bedrock-only-capped-at-Sonnet in its own pass + box redeploy.

## 5. Migration (the backfill IS the system)

- **A — build + shadow.** Schema + recognition pipeline behind `ONE_BRAIN`. Run recognition ALONGSIDE labels
  on live traffic; compare against the Phase-0 baseline (50% over-merge / synonym rate). No consumer reads
  it yet.
- **B — reasoned backfill.** Walk each user's corpus CHRONOLOGICALLY through the same recognition pipeline —
  the system "remembers its history" the way a human would recount it, founding entities as they first
  appear. Not a separate script logic; the pipeline itself, replayed. Bounded per user; one-time cost.
- **C — cutover.** Consumers re-point to entities (deck, projects, timeline, deep-dive, brains context,
  delegation). Projects migrate to `tracked` entities; user locks carry over.
- **D — demolition.** Delete the label layer (list above). No fallback remains. Re-run the diagnostic on
  entities: **success = over-merge AND synonym-split both drop sharply** vs 50%/68%, alias-dups gone from
  the deck, and every link auditable (`via` + `reason`).

## 6. Cost honesty

- Per new item: one embedding (~free) + usually ZERO recognition calls (structural inheritance covers thread
  replies) or one Haiku call. Reflection is event-driven + sig-gated. Backfill is a real one-time spend.
- What buys the "just knows" feel is that every call is SMALL — memory does the heavy lifting; the model
  only ever judges a shortlist of remembered candidates.

## 7. Risks, honest

- Recognition is still an AI judgment — same failure CLASS as labeling, but a better-shaped question
  (content vs remembered content, candidates in view) + auditable reasons + user-correctable + a reflection
  pass that can repair. The baseline test proves it or we don't cut over.
- The migration touches every consumer — staged (shadow → cutover → demolition), each stage smoked
  cross-user before the next.
- Entity granularity ("one entity or two?") has no perfect answer even for humans — the design accepts this:
  recognition decides with reasons, reflection repairs, the user's merge/split is final and remembered.
