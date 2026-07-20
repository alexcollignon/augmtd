# Person Brain — implementation plan (Step 1 of the context-layer arc)

**Goal.** A durable, live, per-PERSON state — the twin of the Initiative Brain (`lib/initiatives/`). Where the
initiative brain answers *"where does this body of work stand + the one next move,"* the person brain answers
*"who is this, our whole history, who owes whom, are they going quiet + the one relational next touch."* It is
the people-first half a chief of staff needs, which today does not exist (we only have a contact + interaction
counter in `relationship_graph`).

**Principle (unchanged from the initiative brain).** Assembly is DETERMINISTIC relational lookup; the AI only
synthesizes the *judgment*. Split `assemble` (cheap, no AI) from `synthesize` (Haiku) so a `sig` skips the call
when nothing moved. Entity resolution is alias-aware (`lib/projects/identity.ts`). Honest "none" — no invented
busywork. Refer to the user as "you", never third-person. MUST use the `classification` tier (Haiku / gpt-4o-mini);
reasoning tiers burn the budget → empty (the documented trap). Strip ```json fences (Bedrock-Haiku).

---

## What already exists (reuse — do NOT reinvent)

- **`lib/initiatives/brain.ts`** — the exact pattern to mirror: `fetchBrainCorpus` (one shared fetch), `assembleInitiativeLedger` (ledger + people + sig, no AI), `synthesizeBrain` (Haiku), `unfence`, `getUserName`.
- **`lib/initiatives/state-store.ts`** — `refreshInitiativeState` (sig-gated), `refreshInitiativeStates` (batch, shared corpus, bounded concurrency), `upsert`. Copy the shape.
- **`lib/projects/identity.ts`** — `canonicalPerson(s)`, `sameAttendee(a,b)`, `nameTokens`, `emailDenotesName`, `emailLocalpart`, `norm`. Alias-aware person matching — the keying + ledger-filtering primitive.
- **`lib/contacts/extract-contacts.ts` `upsertContacts`** — already maintains `relationship_graph` (`contact_email`, `contact_name`, `interaction_frequency`, `last_interaction`), written from `sync-emails` (~1834) + `meeting-processor`. This is the **seed set of people** + the frequency signal.
- **`lib/inbox/automated.ts` `isAutomatedSender`** — skip no-reply/notifier addresses (a Notion/Canvas notifier is not a person).
- **`corporateDomains(supabase, userId)`** (pattern in `lib/inbox/initiative-candidates.ts`) — the user's non-free-provider domains → the `is_internal` flag (the Galp/internal-colleague guard, reused as a *flag*, not an exclusion — an internal colleague IS a person, just weighted differently later).
- **`lib/context/entity-context.ts`** — the dossier assembler; in Step 2 it becomes the READER over `person_state` + `initiative_state`. Not touched in Step 1 beyond an optional read.
- **`components/home/relationship-context.tsx` (`RelationshipContext`)** — already on the deep-dive; S1c upgrades it to render `person_state`.

---

## Entity resolution / keying (the one genuinely hard part — stage it)

- **v1 (this plan): key by email.** `person_key = canonicalPerson(primary_email)` (fallback: lowercased email). Seed the person set from `relationship_graph.contact_email`. Store `display_name` + `emails: [that address]`. Cheap, correct, ships immediately.
- **v2 (later): alias-merge.** Collapse a person's work+personal addresses and email↔name forms into one cluster via `sameAttendee` / name-token-subset — the SAME evidence-based merge used for initiative grounding. Merge on evidence, never blind. Out of scope for Step 1; the schema (`emails` jsonb array) is already shaped for it.
- **Guards:** `isAutomatedSender` → skip (not a person). `is_internal` (corporate-domain colleague) → keep as a person but flag it (they're on everything; downstream weighting handles it — do NOT drop them, they're real colleagues).

---

## Data model — migration `supabase/migrations/2026XXXX_person_state.sql` (apply manually)

```sql
create table if not exists person_state (
  user_id        uuid not null references auth.users(id) on delete cascade,
  person_key     text not null,           -- canonicalPerson(primary email)
  display_name   text,
  emails         jsonb not null default '[]'::jsonb,   -- alias cluster (v1: one address)
  org            text,                     -- domain-derived
  role           text,                     -- title from signature/enrichment (nullable)
  is_internal    boolean not null default false,
  initiatives    jsonb not null default '[]'::jsonb,   -- initiative keys this person is tied to
  state          jsonb,                    -- the synthesized judgment (below)
  next_touch     jsonb,                    -- the ONE relational next move
  people         jsonb,                    -- reserved (co-participants), parity with initiative_state
  quiet_days     integer,
  people_sig     text,                     -- event-count : freshest-ts (the cheap change key)
  last_touch_at  timestamptz,
  updated_at     timestamptz not null default now(),
  primary key (user_id, person_key)
);
alter table person_state enable row level security;
create policy "own person_state" on person_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists person_state_user_idx on person_state(user_id);
```
Mirrors `initiative_state`. `IF NOT EXISTS`-guarded → safe to re-run.

### `state` jsonb shape
```
{
  summary:      "<=15 words: who they are + where you stand with them",
  relationship: "client | colleague | prospect | vendor | partner | personal | unknown",
  momentum:     "active | waiting_on_them | you_owe | gone_quiet",
  cadence:      "<=12 words: how often you talk, who initiates, typical latency",
  whoOwes:      { you: ["<=5 short"], them: ["<=5 short"] },
  last_touch:   { when: ISO|null, what: "<=8 words", channel: "email|meeting" },
  style:        "<=12 words learned comms notes (brevity/tone/timezone), or null"
}
next_touch = { kind: "reply"|"followup"|"none", title: "<=10 words imperative", reason: "<=15 words", entityRef: "inbox:<id>|null" }
```

---

## `lib/people/brain.ts` (mirror `initiatives/brain.ts`)

- **`type PersonLedgerEvent`** = reuse `LedgerEvent` shape: `{ kind: 'email_in'|'email_out'|'meeting'|'commitment', at, actor, counterparty, summary, ref }`.
- **`fetchPeopleCorpus(supabase, userId)`** — ONE shared fetch (parity with `fetchBrainCorpus`): inbox emails (from/subject/received), sent emails (to/subject), meeting_transcripts (attendees/title/start), commitments (counterparty/direction/description/due), relationship_graph (frequency), corporate domains. Returned once; per-person assemble works from memory.
- **`assemblePersonLedger(corpus, personKey)`** — no AI:
  - Filter each source to this person via `sameAttendee(personKey, candidate)` (alias-aware): `email_in` (from = person), `email_out` (to includes person), `meeting` (attendee = person), `commitment` (counterparty = person).
  - `if (no events) return null` (parity — no phantom people).
  - Build `whoOwes` from the person's commitments (dedup). `quiet_days` = days since last PAST touch (exclude future calendar, same fix as the initiative brain). `last_touch_at`, `is_internal`, `initiatives` (distinct initiative labels across their atoms). `people_sig = ledger.length + ':' + freshest_at`.
- **`synthesizePerson(supabase, userId, assembly)`** — Haiku, sig-gated by the caller. Prompt: person-focused analog of the initiative prompt (who is this + where you stand + momentum + whoOwes + cadence + style + the ONE next touch). Grounded strictly in the ledger; honest "none"; "you" not third-person; `unfence` before parse; validate momentum/next_touch enums.

## `lib/people/state-store.ts` (mirror `initiatives/state-store.ts`)

- **`refreshPersonState(supabase, userId, personKey, { force?, corpus? })`** — assemble (cheap) → if `people_sig` unchanged vs the stored row, return (no AI, no write) → else synthesize → upsert.
- **`refreshPersonStates(supabase, userId, personKeys[], opts)`** — dedupe, fetch corpus ONCE, bounded concurrency (chunks of 4), sig-gated per person. Non-fatal.
- **`getPersonStates(supabase, userId)`** / **`getPersonState(supabase, userId, personKey)`** — instant reads for surfaces.

---

## Live hooks (same 3 sites already wired for initiatives; add a sibling call)

- **`lib/email-sync/sync-emails.ts`** (end, ~1907, next to `refreshInitiativeStates`) → `refreshPersonStates([from-addresses of the emails synced this batch])`. Background, sig-gated, non-fatal.
- **`lib/integrations/meeting-bot/bot-manager.ts`** (~390) → `refreshPersonStates([meeting attendees])`.
- **`app/api/inbox/[id]/send-reply/route.ts`** (`after()`, ~170) → `refreshPersonStates([the recipient])`.
All fire-and-forget, degrade to no-op pre-migration (wrapped in try/catch like the initiative calls).

---

## Surface (the visible S1 win)

- **S1c — "Who is this" on the deep-dive:** upgrade `RelationshipContext` to read `getPersonState` — render `summary · relationship · momentum · whoOwes · last touch · cadence`, with the `next_touch` as a chip (opens the deep-dive to act). Falls back to the current thin dossier when no state yet.
- **S1d (optional) — people rail on the brief:** a compact "people to keep warm" list = person_states with momentum `gone_quiet` + an open loop. Reassurance/relationship-maintenance surface.

---

## Backfill — `scripts/backfill-person-state.ts` (dry-run default, `--apply`)

Iterate `relationship_graph` contacts per user (skip `isAutomatedSender`), `assemblePersonLedger` + `synthesizePerson`, upsert. Bounded + staggered (Haiku cost). Mirrors `scripts/backfill-initiative-canonical.ts`. Run per test user (Alexandre, Rene) after the migration.

## Smoke — `scripts/smoke-person-brain.ts` (READ-ONLY, cross-user)

Mirror `scripts/smoke-brain-coverage.ts`. Per user with contacts: how many people ASSEMBLE a ledger (coverage), sample synthesized states (do summaries/whoOwes read true?), verify automated senders are excluded, verify `is_internal` flagged (not dropped), verify `quiet_days` never counts a future meeting. Report totals. No writes.

---

## Guards / trust / tradeoffs (eyes-open)

- **Trust boundary:** `person_state` is PER-USER, RLS-owned, personal memory. It NEVER crosses into company/coworker-facing context by default (same rule as goals). It WILL feed grounded delegation in Step 4 — but only to that user's own coworkers.
- **Entity-resolution risk:** wrong merge/split. v1 keys by email (no merge risk); v2 alias-merge on evidence only, internal-colleague flag kept. Same discipline that fixed the initiative over/under-merge.
- **Cost:** one-time backfill synthesis per contact; steady-state is sig-gated (a quiet person costs nothing). Corpus fetched once per refresh batch.
- **No real names** in code/prompts/comments — generic fakes only (grep-sweep before finishing).

---

## Phasing within Step 1

- **S1a** — migration + `lib/people/{brain,state-store}.ts` + backfill + smoke. Ship, verify data cross-user. (No UI — data-first, provably correct before surfacing.)
- **S1b** — the 3 live hooks.
- **S1c** — `RelationshipContext` reads `person_state` (the visible win on the deep-dive).
- **S1d** — optional brief people rail.

## Explicitly NOT in Step 1 (later steps of the arc)

- Alias-merge v2 (multi-address people) — schema-ready, deferred.
- `entity-context` becoming the unified reader (Step 2).
- Read-time understanding / retiring the reconcile patches (Step 2/3).
- The weight/priority model (Step 3) and grounded delegation to coworkers (Step 4).

**One line:** build `person_state` as a twin of `initiative_state` — deterministic assemble, Haiku synthesize, sig-gated, live on the same 3 hooks — backfill + smoke first, then surface as the "who is this" card. Low risk (the pattern is proven), and it visibly improves the deep-dive + every draft on its own.
