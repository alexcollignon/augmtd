# The Living Daily Brief — product direction

The Home evolves from *"a smart inbox of label-driven cards"* into *"a chief of staff who briefs you
and runs your day with you."* One dated, living, AI-written daily brief you **read** and **execute**
from — with delegation to the AI coworkers as a first-class action.

## Why (the problems this resolves)
- **"Where do I look / where do I start"** — a written brief has natural flow + hierarchy (most important
  first), which stacked cards-by-label never will.
- **Brittle label-stitching** — today the *code* builds the UI from classifications (needs_reply → box,
  cc_only → box). Instead, ONE AI reasons over the full grounded context and writes the brief; the labels
  become *inputs/hints to the AI*, not the *structure of the screen*. Relevance is judged in understanding,
  not a routing rule. (This is the "general system, reasoning in the synthesis" direction, taken to its end.)
- **Freshness/relevance misses** — an AI with across-the-board context judges what matters holistically.

## The model
1. **Readable + executable.** A narrative with **inline, grounded action affordances**: read
   *"Madalena needs the refund by July 10 —"* and right there: **[Send draft] · [Done] · [Hand to Clara]**,
   anchored to the real item id. Read and run the day from one surface. Grounding is sacred — every action
   maps to a real id (the `[Rn]/[Kn]` tag scheme), never AI-invented. The AI writes the story; the system
   guarantees the buttons are real.
2. **The AI owns assembly + ordering** — stop pre-bucketing by label in the route; feed the synthesis the
   whole grounded picture and let it decide what leads, what's secondary, what's noise.
3. **Dated + living.** One brief **per day**, dated. **Today's is live** (regenerates/updates as mail
   arrives + as you act); at day's end it **freezes** and tomorrow's opens. You get a **ledger you can
   scroll back through** (journal/standup model) AND a living today. The dated ledger is also what the
   coworkers reference and what gives a sense of momentum.
4. **Coworker-ready command surface.** For each thing that needs you: **do now** (reply/done),
   **schedule** (task), or **hand off** (to a coworker). Todos/commitments/handoffs flow *out of* the brief.

## UI direction (decided)
**Our own — a single living daily document, not a Serif-style gallery of briefs to select.** How a human
works: they open their day and want THE one thing that matters now, readable, then act — not to pick which
brief to read. So:
- **Today's brief is front-and-center, open on landing.** Zero friction to "where do I start."
- **History is a quiet timeline you scroll back into** (yesterday is just *up/back*, continuous like a
  journal/feed) — not a grid of cards to choose from.
- Skimmable (bold/heads for the key items) but flowing; actions inline; check things off as you read.
- Built on the `components/ui` kit — same design language, refined; not AI-slop.

## Caveats
- Grounding stays sacred (real ids, no invented tasks).
- Structured enough to tap, flowing enough to read — a design craft, not a given.
- One rich pass per day + incremental updates, cached per-day — not an AI call per glance.
- **Garbage-in still applies** → the upstream freshness fix (below) is the prerequisite; the AI can only
  reason over what the data shows.

## Sequence
1. **#1 — Upstream freshness (thread re-surfacing).** TRUST FIRST. When a new message arrives in an existing
   thread, the item must (a) bump its freshness/activity time and (b) **re-classify** (a fresh reply to a
   "noise" thread often makes it active/needs-you again); and confirm every inbound message
   creates/updates an item. Diagnosis that motivated this: alex's *"Calling For An Urgent Meeting"* is
   stored as a `06-22` `noise` item despite a reply **today at 10:17** — the reply never re-surfaced it; and
   the *"Follow up | Fidelidade" (12:19 today)* isn't in the DB at all. The unified context is *complete*
   but points at **stale thread state** — that's the real bug behind "the Home feels not updated."
2. **#2 — Synthesis owns assembly + ordering** (stop label-bucketing; AI writes brief + order).
3. **#3 — Executable inline actions** (grounded), including **hand-to-coworker**.
4. **#4 — Dated / living brief + history timeline** (per-day doc; today live, past frozen).

Foundation already in place: `lib/home/brief-context.ts` (unified context) + `lib/home/synthesize-brief.ts`
(grounded synthesis) + the keep-an-eye-on tier. This arc reshapes the *output* into the living dated brief
and fixes the *input* (freshness) underneath.
