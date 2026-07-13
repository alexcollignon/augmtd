# Calendar-aware initiative machine — plan

**Goal.** Turn AUGMTD's scattered atoms (emails, calendar events, meeting notes, commitments) into one
coherent, agnostic **initiative graph** that every surface reads. One concept — an *initiative* — resolved
once at ingest, joined deterministically, expressed per-lens (Home groups by it, Timeline overlays it,
Projects is the object). Calendar becomes a first-class initiative signal so unrecorded meetings still count.

## The core idea

**An initiative is a people/org + topic cluster, not a text string.** The label ("Galp X Zero to 100") is
its display name. Identity is anchored on **topic** (so distinct deals never merge) and **people** (so an
atom with no/weak label can still be placed) — but *topic is authoritative*; people only place orphans.

## Layers

### Layer 0 — Sources (understood ONCE at ingest)
Every source emits a common denominator `{ initiative-label, people[], dates, kind }` at ingest — the
"reason once" pass, never re-run downstream. Filtering (automated senders, personal/canceled/recurring
calendar noise) happens HERE so noise never reaches the join.

| Source | Ingest / understanding | Store |
|---|---|---|
| Email | `lib/ai/email-processor.ts` `computeUnderstanding` · `lib/inbox/item-understanding.ts` | `inbox_items.source_data.understanding` |
| Calendar *(new)* | **NEW** `lib/calendar/event-understanding.ts` ← `lib/calendar/sync-calendar.ts` | `calendar_events.metadata` (jsonb, no migration) |
| Meeting note *(if recorded)* | `lib/integrations/meeting-bot/bot-manager.ts` · `lib/commitments/extract.ts` | commitments + `inbox_items` |
| Commitment | `lib/commitments/extract.ts` (`initiative`) | `commitments.initiative` |
| Rules (authoritative) | `lib/inbox/rules/*` | — |

### Layer 1 — Identity spine (deterministic join, ZERO clustering AI)
- `lib/inbox/item-understanding.ts` `normalizeInitiative` — the topic key (despace-safe).
- **NEW** `lib/projects/identity.ts` — shared alias-aware person helpers (`sameAttendee` / `emailDenotesName`
  / `emailLocalpart` / `nameTokens` / `norm`), extracted from `lib/commitments/extract.ts` (single source).
- **NEW** `lib/projects/initiative-resolver.ts` — `buildInitiativeMap(userId)` (person→topic-keys, from
  emails + commitments + calendar) + `resolveInitiative(atom, map)` implementing the decision tree.

**The decision tree (the guardrail against "same people, different topics"):**
1. Atom has a clear topic label → **use the label** (topic authoritative; people only confirm).
2. Label-less/vague → look up attendees in person→topic-keys:
   - exactly ONE candidate key → **bridge** (attach).
   - MANY (person works on several initiatives) → **ambiguous** → optional constrained cheap pick over
     *those candidates only*; else stay **loose**. Never guess.
   - NONE → **loose**.
3. **People may attach an orphan to an existing topic; they may NEVER merge two distinct topic keys.**

### Layer 2 — Derived structures (read-time, no new tables)
- `lib/work-items/model.ts` `buildWorkItems` — add `calendar_events` as dated **context** items (never actions).
- `lib/projects/cluster.ts` · `lib/projects/associate.ts` · `lib/projects/health.ts` — consume the resolver
  + calendar membership + an "active this week" signal.

### Layer 3 — Surfaces (read-only lenses; never re-classify)
| Surface | Axis | Project role | Calendar role |
|---|---|---|---|
| Home | action-first | *group* loose actions (≥2 real), lead with next move, `↳ advances {X}` | ambient schedule, tagged; NOT an action |
| Timeline | time-first | *overlay* — tag + color + filter | real dated context points |
| Projects | the object | detail / health / board | meetings as project activity |

Files: Home `app/api/home/brief/route.ts` · `lib/home/synthesize-brief.ts` · `lib/home/brief-context.ts` ·
`components/home/home-view.tsx`. Timeline `app/api/home/timeline/route.ts` · `components/timeline/timeline-view.tsx`.
Projects `app/api/projects/*` · `components/projects/*`.

## Sequence (each phase shippable + smoke-tested on TWO tenants — Alexandre & Rene)

- **Phase 0 — Identity resolver (Layer 1, pure lib, no UI).** `identity.ts` (+ de-dup `extract.ts`) +
  `initiative-resolver.ts`. Read-only smoke: distinct deals stay separate, ambiguous stays loose, unambiguous
  bridges resolve. Previews calendar coverage by resolving real `calendar_events` against the email-built map.
- **Phase 1 — Calendar as Layer-0 source.** `event-understanding.ts` (filter personal/canceled/recurring) →
  `calendar_events.metadata` + backfill. Additive, no migration.
- **Phase 2 — Calendar into the spine → Timeline dated points.** `buildWorkItems` emits calendar context items
  (dated, non-action). Home unaffected (doesn't read spine).
- **Phase 3 — Coverage propagation (fatten).** Resolver into the magnet + backfill: label-less atoms that
  resolve unambiguously via a shared person inherit the initiative. Verify coverage delta, zero wrong attaches.
- **Phase 4 — Projects consume calendar + resolver.** Richer suggestions, meetings as activity, active-health.
- **Phase 5 — Home grouping tier (UI, only once coverage is fat).** Group by project (≥2 real), action-first,
  expandable, tag schedule.
- **Phase 6 — Timeline overlay polish + rail cleanup** (double-label fix).

Ordering is deliberate: **0→4 build & fatten invisibly (Home-neutral); 5→6 feature it** — so we never ship an
empty grouping UI, and stopping after Phase 4 still yields a richer Timeline + Projects with zero Home risk.

## Invariants (locked)
1. One `{initiative, people}` shape emitted by every source at ingest — reason once.
2. One deterministic join (topic key + person). Zero clustering AI. Distinct topic keys NEVER merge.
3. Topic authoritative; people only place orphans; ambiguous defers (constrained pick → loose), never guesses.
4. Calendar/meetings ENRICH projects + timeline; they never mint Home action items.
5. Layer-0 filtering keeps automated/personal/canceled/recurring-dupe out of the join.
6. Surfaces read derived views; no lens owns a classifier.
7. Adding a source = ONE Layer-0 adapter emitting `{initiative, people}`. Spine/projects/surfaces untouched.
8. Agnostic — entities & keys, never hardcoded names. Additive + reversible (`ON DELETE SET NULL`, un-assign).
9. Verified on ≥2 tenants every phase.
