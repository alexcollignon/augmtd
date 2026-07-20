# The Reasoned Briefing — chief-of-staff Home

The Home's top becomes a short brief WRITTEN BY THE BRAIN — prose whose every sentence is judgment (never
restatement), whose every noun is an action, that remembers what it already told you. Replaces the deck
header + MovingTier wall; the deck survives as the *unfolded state* of the prose. Derived from the six
laws (docs discussion, July 19):

1. **Judge, never restate** — the reasoning pass sees only judged state (it cannot restate content it
   never sees). Every sentence must carry a stake / reason / connection / move.
2. **Say less than you know** — conviction caps length, not layout. Sure things get sentences; the rest
   become counts inside an unfold clause. 5 confident sentences > 20 ranked rows.
3. **Never repeat yourself** — yesterday's brief is INPUT. Unchanged → silence or one continuity clause.
   Quiet day → says so.
4. **The word is the deed** — every mention carries its action inline (chip → draft/deep-dive/done).
5. **Never guess an identity** — the model writes around `{refs}`; names/links are swapped in from the
   registry deterministically (the established grounding discipline).
6. **Earn the voice** — calm, specific, first-person; no cheer; honesty is the tone.

**Cost model:** narrate stored judgment, never re-summarize raw data. One deep compose per day (morning,
Sonnet-tier via the shape router) + shape-gated segment re-reasons (Haiku-tier) during the day. User
actions NEVER call AI — instant strike/collapse, then a background re-reason so the next glance reads
authored prose. Everything logged to ai_usage_events (source `brief_narrative`).

## Slices

- **S1 — Composer + narrative store (server, no UI)** — `lib/briefing/compose.ts`:
  `composeBriefing(supabase, userId, inputs)` builds per-segment CANDIDATES deterministically (facts) from
  what the brief route already computed (atoms + entity weights/states, slipping, moving, counts, today's
  calendar), then ONE reasoning pass writes the segments — `{ lead, action, watchlist, pulse }`, each
  `{ text-with-{refs}, refs, sig }`. Prior briefing included (law 3). Stored in `profiles.home_brief.briefing`
  (read-merge-write, the bundleNames pattern — no migration). Shape-gated by a daySig (date + input sigs);
  composed in the brief route's `after()`; last-good always served.
- **S2 — Renderer** — `components/briefing/briefing-view.tsx`: prose with inline components ({ref} → name
  chip / hero card / unfold clause "▸ N more" that expands the existing DoRows / pulse → Portfolio).
  Replaces the Home greeting block + deck header + MovingTier. Strike-and-collapse on action.
- **S3 — Live re-reasons** — `POST /api/briefing/rereason` (segment-scoped, debounced, Haiku); arrival-driven
  shape-gating already rides the brief `after()`.
- **S4 — Revisit lead** — "since this morning: N new, one resolved ▸" (computed facts, phrased on shape change).
- **S5 — Qualitative smoke gates** — `scripts/smoke-briefing.ts`, cross-user, REAL AI: groundedness (every
  ref exists), restatement rate (sentence↔subject overlap), repeat rate (consecutive briefs), segment caps,
  quiet-day honesty. This class of check is what the screenshot-miss taught us to automate.

## Anti-list (unbuildable by design)
No per-item AI summaries at render · no scheduled regen when nothing changed · no unbounded lists · no
invented urgency · no new mode toggle (this IS the Home top).
