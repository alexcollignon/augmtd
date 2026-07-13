# Home "one brain" + calm pass — plan

**Why.** The Home has good intelligence but two problems the user surfaced: (1) it *reads* as two disconnected
computations — "In motion" and "Projects/suggestions" diverge (Galp is a suggested project but never shows in
In-motion), because they cluster from different inputs and different gates; (2) it still feels busy, and the
new expand/collapse interactions are inconsistent + one-way. This pass makes the system feel like **ONE brain**
(a single source of truth for "what am I working on") and finishes the calm/composition work.

## The locked model (agreed with the user)

Two sections answer two different questions, from ONE source:

- **"What needs you"** = the **actions** — every reply / to-do / commitment / outreach, in one prioritized
  list. Nothing is ever pulled out into a project card, so **an action can never be missed.** Project-bound
  actions keep their `↳ {initiative}` tag.
- **"In motion"** = the active **initiatives** — each shown by **state**, NOT a re-listing of its actions and
  NOT gated on having one. State carries the action-vs-awareness signal:
  - action-needed (`3 to do` / `needs attention`) → **emphasized, sorted first**
  - waiting (ball in their court) → mid
  - awareness (`nothing needed · last meeting Jul 10`, e.g. Galp) → **muted, sorted last**
  A chip → drills to the project (the Projects lens), it does not re-list the actions on the Home.

So: glance the *projects* (does this need me?) in In-motion; *do* from the complete action list in What-needs-you.
Two granularities of the same truth — the project-level state points you down to the item-level list. No
duplication anxiety, nothing missed, one source.

## One source of truth

Today the divergence exists ONLY because two code paths cluster differently:
- Home In-motion → `buildInitiativeClusters` (email + commitments, **no calendar**) + gated on an actionable item.
- Projects/suggestions → `suggestProjects` (email + commitments + **calendar** + outbound).

→ Fix: a single **`lib/projects/active-initiatives.ts`** `getActiveInitiatives(userId)` — the one "what am I
working on" builder (email + commitments + calendar + outbound, one clustering, one set of rules). It returns
per initiative: `{ key, label, total, state, actions[], lastActivityAt, projectId|null, members }`. **Both** the
Home In-motion and the Projects lens read it. Fix clustering once → both benefit → Galp appears everywhere by
construction, no divergence to maintain.

## Phases (each shippable + smoke-tested on ≥2 tenants)

**A — One source (`getActiveInitiatives`).**
- New `lib/projects/active-initiatives.ts`, reusing `buildInitiativeMap` / `computeEventUnderstanding` /
  `resolveOutboundAwaiting` / `computeProjectStatus`-style state. Includes calendar.
- `suggestProjects` (cluster.ts) refactored to derive from it (suggestions = active initiatives not yet a
  project, with attachable member refs). Home reads it too.
- **Cache it** (it's on the hot polled path + includes calendar): a `profiles.active_initiatives_cache` keyed
  by a content sig, same pattern as `outbound_cache` / `home_brief`. Non-fatal.
- Smoke: Home set == Projects set (no more "in one not the other"); Galp present in both.

**B — Reframe In-motion (state, all initiatives, no pull-out).**
- `app/api/home/brief/route.ts` + `components/home/home-view.tsx`: In-motion renders ALL active initiatives
  from the source as state chips (emphasized/action-first, muted/awareness-last), drill-to-project on click.
- **Remove the pull-out**: `groupedReplyIds/groupedCardIds/groupedCommitIds/groupedWaitingIds` +
  `looseReplies/looseCards/looseCommitments/looseWaiting` — "What needs you" / "Your next moves" / the waiting
  lane show the COMPLETE set again (project actions included, tagged). Delete `ProjectGroupCard`'s action-list
  role; In-motion becomes state-only (+ drill).
- Smoke: every action appears in the list; In-motion shows Galp (awareness) + Jean-Marie (action-needed).

**C — Smooth expand/collapse + "see less" (consistency).**
- One shared smooth height animation (the `Collapsible` `grid-rows-[0fr]→[1fr]` + opacity pattern) applied to
  EVERY expandable: the NOW-list "N more", the ambient-bar chip expand, the In-motion drill, any card fold.
- Every expand is a **toggle**: `N more ⌄` ↔ `See less ⌃`. Ambient bar / strip already single-open; add the
  smooth height + collapse affordance. Honors the animation-consistency memory (reuse tokens, pause ambient
  motion on hover, `prefers-reduced-motion`).

**D — Composition pass (the "overall layout" work).**
- **Ambient bar not buried**: make it **sticky** (pinned, always reachable) OR move it up under the header KPI
  — decide from the live feel; single column stays but the bar never hides at the bottom of a long page.
- Unify **widths + vertical rhythm + spacing scale** across the settled zones; tune the centered column; the
  header ↔ body relationship.
- **Delete dead code**: `StartHere` / `StartHereReplyBody` / `StartHerePriorityBody` / `TodayAtAGlance` /
  `Collapsible` (if unused after C) + the leftover `ready`/`StartHereData` types.

## Invariants (locked)
1. **One source** for "active initiatives" — Home + Projects both read it; never two clusterers.
2. **Every action is in the action list** — never only inside a project card. Nothing missed.
3. **In-motion = initiatives by state**, action-needed emphasized/first, awareness muted/last — not an action re-list.
4. Calendar + outbound folded into the one source (Galp-class initiatives surface everywhere).
5. Smooth, consistent, toggleable expand/collapse; ambient motion pauses on hover + honors reduced-motion.
6. Ambient bar always reachable (sticky/repositioned), never buried.
7. Additive + reversible; verified on ≥2 tenants each phase; nothing committed without explicit instruction.

## Sequencing note
A→B are the "one brain" fix (the coherence the user is asking for). C is the consistency polish. D is the
dedicated composition/layout pass (the "overall layout needs improvements" work) — done last, once the zones'
shapes are settled, so it's tuned against the real final composition, not a moving target.
