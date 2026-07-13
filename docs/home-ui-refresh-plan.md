# Home UI refresh plan

**Status:** planned (no code yet). On `dev`. A visual/coherence pass over the Home — no data-model or routing changes; the spine, brief synthesis, curation, and lifecycle all stay exactly as they are. This is purely how the Home *reads*.

## The principle (locked)
**Same visual = same meaning.** Different *concepts* may (and should) have different components, as long as each reads as intentional and shares the design system's tokens. The bugs today are (a) the same concept rendered differently, and (b) a component that looks like a different design kit.

- **To-dos** (things you owe) → ONE row component, regardless of whether the source is an email reply, a commitment, or an action notice.
- **Projects** (In-motion) → a DISTINCT component (they're a different unit — ongoing initiatives, not single tasks), but rebuilt from our tokens so it clearly reads as "the project view of the same system," not a stray pill kit.
- **Ambient** (everything else) → one dense single-line footer.

## Current state (what's on screen)
- `HeaderCounts` KPI strip: `7 to reply · 6 on your plate · 14 waiting · 12 tracked · 161 filtered` — duplicates section counts + a vanity metric.
- `InitiativeStrip` "IN MOTION" — rounded-full **pills**, horizontal marquee. The odd-kit-out.
- `DigestList`/`DigestReply` "WHAT NEEDS YOU" — editorial hairline **list** (replies).
- `ActionNoticesCard` "WORTH ACTING ON" — **card list** (action notices).
- `ExpandableRows`+`CommitmentSideRow` "YOUR NEXT MOVES" — 3-col **grid of chunky cards** (commitments). ← the visual rupture.
- `AmbientBar` "AROUND YOU" — sticky footer, currently wraps to **two lines**, 7 buckets.
- Four different expand idioms (inline "Show N more" link, grid "Show N more", ambient upward-expand, chip panel).

## Phases (impact-first; smoke/QA after each; nothing merged until the user validates visually)

### P1 — Unified "Do" row (kills the grid rupture) ⭐ highest impact
Merge WHAT NEEDS YOU + WORTH ACTING ON + YOUR NEXT MOVES into ONE prioritized list under a single header ("What needs you"), every entry rendered by ONE `DoRow` component. A small **type icon** (heroicons, not ASCII) carries the source distinction that used to be a whole section:
- `EnvelopeIcon` reply · `CheckCircleIcon` commitment (you owe) · `BellAlertIcon` action notice — each in its tone (indigo / neutral / amber).
Ordering: overdue/dated first, then the synthesis order. The ✦ "start here" accent stays on row 1. Keep the inline ✓ / ✕ / → triage + the deep-dive on row click. Commitments keep "You owe X" + the initiative tag on line 2.

```
 ✉  Jaden · Reply to the Apekey.ai sales outreach          ✦  Jul 10   ✓ ✕ →
     Apekey.ai sales outreach
 ─────────────────────────────────────────────────────────────────────────
 ◎  Process the refund & share the details with Madalena    OVERDUE   ✓ ✕ →
     You owe Youssef · ↳ Jean-Marie pilot
 ─────────────────────────────────────────────────────────────────────────
 ⚠  Verify your account — a payment failed                   Jul 7    ✓ ✕ →
     from Stripe · action needed
```
(vs today: an editorial list, THEN a separate 3-col card grid, THEN another card list — three looks for one meaning.)

### P2 — In-motion → project TILES (distinct-but-coherent)
Replace the pill marquee with a horizontal row of small **project tiles** built from our tokens (`Card`, state dot, shared type scale). A tile says "project" at a glance and carries what a pill can't: the next move.

```
 YOUR PROJECTS                                                          21 ▸
 ┌────────────────────────┐ ┌────────────────────────┐ ┌───────────────────┐
 │ ● Jean-Marie pilot     │ │ ● Fidelidade        📁 │ │ ● Zero to 100     │
 │   Needs attention · 4  │ │   Active · 2           │ │   Active · 3      │
 │   Next: reply to Jaden │ │   Next: send the deck  │ │   Next: —         │
 └────────────────────────┘ └────────────────────────┘ └───────────────────┘
   (● state colour · 📁 = tracked project · count = open items · Next = top action)
```
(vs today: `● Jean-Marie pilot 4   ● Enterprise Tech… 1   ● Fidelidade 1 …` rounded pills.)
Horizontal scroll stays (measured-overflow marquee we just fixed); the chip-expand actions (Track / Not relevant / Open in Projects) move onto the tile's hover/expand — same behavior, better home.

### P3 — Plain-language labels
- "In motion" → **Your projects**
- "What needs you" → keep (it tests well)
- "Around you" → **Also happening** (or "For reference")
- "Ball in your court" → **Waiting on others** (current phrase is an idiom AND reads backwards)
- "For your awareness" → **Just so you know**
- "Worth acting on" → folds into "What needs you" (P1), no longer its own label

### P4 — One-line terminal footer (Bloomberg-dense, our easing)
Collapse "Around you" to a single horizontal strip; segments hairline-separated, tabular numerals, hover-highlight, click → the existing upward expand. Never wraps (horizontal scroll if truly needed).

```
 ● Today 3   ·   Team 7   ·   Watch 2   ·   Waiting 7   ·   FYI 10   ·   Newsletters 3   ·   Handled 24h
```

### P5 — One expander idiom everywhere
Every "reveal more" uses the SAME affordance + motion (the smooth `grid-rows` `Collapse` + "Show N more ⌄ / See less ⌃"). Replace the four current variants (inline link, grid link, ambient upward, chip panel — the last stays a panel since it's a detail surface, not a "more" reveal).

### P6 — Header strip + ring legend (cleanup)
- KPI strip: **DROP it** (decided) — counts live on the sections; removes the duplication + the vanity "161 filtered".
- The day-cleared ring needs a one-word legend ("cleared" / "N of M done today") so "13 · open for you" isn't cryptic.

## Non-goals / guardrails
- No change to the spine, brief synthesis, curation, lifecycle, or any API — this is presentation only.
- Keep the animation-consistency rules (RiseIn mount, `transition-*` tokens, pause-on-hover, reduced-motion).
- No real names anywhere (Acme/Sam in any placeholder/mock).
- Manual QA per phase (the Home is streaming/stateful — not smoke-testable); user validates visually before merge.

## Sequence
P1 (unify Do-zone) → P3 (rename, trivial, do alongside) → P2 (project tiles) → P4 (footer) → P5 (expanders) → P6 (header/ring). P1 is the one that removes the "looks broken" feeling; the rest is coherence polish.
