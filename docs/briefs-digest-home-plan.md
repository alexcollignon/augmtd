# Briefs / Digest Home — Plan

Evolve the Home from a **card dashboard** (lists of items) into a **briefing feed** — a chief-of-
staff's morning brief. Each area gets a short, grounded, first-person *brief* with a renderer made
for its type, organised by **source + where it sits in the taxonomy**. Builds on the unified
classifier + digest (see `docs/unified-classifier-digest-plan.md`).

## Principle
- **Narrative, not just cards.** "6 follow-ups where the ball is in your court… the AHK pilot and
  Sanjay note are the two I'd tackle first," each with a *Next move* — that grounded prose is the
  digital-twin feel a card list can't give.
- **Type-specific by source + taxonomy.** A brief renders for *what it is* — a follow-ups roundup,
  a calendar day, a topic-grouped FYI digest — not one generic card.
- **Compose what exists.** The taxonomy IS the brief structure; the digest data feeds it; the voice
  profile writes the prose; `lib/workflows/report-back.ts` already does a grounded first-person
  colleague summary — the pattern to reuse. Not from scratch.

## 1. The brief model
A brief = `{ type, title, teaser, time, narrative, items[], renderer }`.
- **title** — "Inbox triage complete", "6 follow-ups where the ball is in your court"
- **teaser** — one line shown in the feed ("2 urgent items need action today: Supabase + Revolut")
- **narrative** — the grounded prose body (AI, cached)
- **items** — the real records the narrative is built from (for the dedicated renderer + grounding)
- **renderer** — the type-specific component

## 2. Brief types (mapped to the taxonomy)
| brief | taxonomy bucket | renderer highlights |
|---|---|---|
| **Daily TLDR** | top-level | the day in 3–4 bullets + a **"1 thing you shouldn't miss"** callout |
| **Must respond** | `needs_reply` | urgent reply threads, each with a **"See draft"** action |
| **On your plate** | `to_do` + commitments | tasks/promises with due dates (overdue → today → dated) |
| **Follow-ups — ball in your court** | `waiting_on` | narrative roundup, **Next move** per item, "want me to draft these?" |
| **Today** | meetings/calendar | the day's meetings + reminders (last-time recall) |
| **FYI, by topic** | `fyi` | thematic digests ("🏢 Condominium — FYI"), grouped by sender/thread, not a flat list |

Each brief reads as the coworker wrote it (uses the user's first name, the voice profile).

## 3. Generation — grounded + cached
- **Grounded, non-negotiable.** Each brief is built from the area's structured records; the AI
  summarises + recommends, **never invents**. Reuse the report-back grounding discipline (facts in,
  prose out, cite real items: dates, names, status).
- **Cached + scheduled.** Generate on a schedule (or after sync), cache like today's `briefLine`,
  regenerate only when the underlying data shifts (signature-busted). **Never per page-load.**
- **Per-type generators.** `lib/home/briefs/<type>.ts` — each takes the area's digest slice +
  returns `{ teaser, narrative, items }`. One AI call per brief per regeneration.

## 4. Rendering — type-specific + a feed shell
- **Feed shell** — the Home is a vertical feed of brief entries (title + teaser + time), most
  important first (TLDR, then Must respond, then the rest). An entry expands to its full brief.
- **Dedicated components** — `components/home/briefs/<Type>Brief.tsx`, one per brief type. The
  follow-ups renderer (Next-move list) and the FYI-by-topic renderer are the most distinct.
- Keep each brief **tight** — a brief that sprawls becomes the backlog we've been avoiding.

## 5. Drafts — on-demand, not pre-generated
- **"See draft" generates on click** (the existing voice drafter), with a shimmer — so AI is spent
  only on replies you actually open. No `prepared_draft` storage, no background drafting job.
- The Follow-ups / Must-respond briefs offer "want me to draft these?" → generates the ones asked.

## 6. Data sources
The expanded `getDigest` (priorities, commitments, schedule, waitingOn, handled) already assembles
the records; the briefs are a *narration + rendering layer* over it. Plus: `classifyItem` (bucket),
the voice profile (`context_profiles` / memory), `report-back.ts` (the grounding pattern).

## 7. Controls (so it doesn't backfire)
1. **Grounding** — strict citing; no invented facts.
2. **Cost** — cache + schedule + signature-bust; one call per brief per change, not per load.
3. **Length** — each brief tight; the feed is scannable.

## 8. Phasing
- **Phase 1 — Daily TLDR brief.** The flagship: a grounded day-summary + "don't-miss" callout,
  replacing/expanding today's one-line `briefLine`. Proves the grounded-narrative pattern + caching.
- **Phase 2 — Per-type briefs.** Must respond, **Follow-ups with Next-move** (highest value),
  On your plate, FYI-by-topic — each a generator + a dedicated renderer.
- **Phase 3 — Feed shell + draft action.** Briefs as an expandable feed; on-demand "See draft".

## 9. Open decisions
1. **Feed vs. inline** — briefs as a collapsed feed (Serif "Inbox triage complete · 14h" entries you
   open) vs. rendered inline as today's sections. (Lean: feed for scannability; TLDR always expanded.)
2. **Brief cadence** — regenerate on sync, on a cron, or lazily on first load after data change?
   (Lean: after-sync + signature-bust, same as `briefLine`.)
3. **FYI topic grouping** — by sender, by thread subject, or AI-clustered themes? (Lean: start by
   sender/thread; AI-cluster later.)
4. **How many briefs on screen** — cap to the few that have content; suppress empty ones.
