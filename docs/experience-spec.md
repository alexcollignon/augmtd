# The Experience Spec — what AUGMTD is supposed to feel like

*The constitution. Every surface change, engine law, and copy decision must trace to a clause
here. If an edit doesn't serve one, question the edit. (Aug 2, 2026 — written after the
fragmentation correction; supersedes nothing, anchors everything.)*

## The one sentence

**It feels like a team of competent humans with your full context took over your work — you
manage; they notice, prepare, ask only when truly blocked, and show finished work for sign-off.**

Corollaries that decide edits:
- A competent human never asks you for something they were already told or could look up.
- A competent human never repeats yesterday's ask after the work resolved.
- A competent human says *one* current thing, not a log of everything they ever said.
- You should be able to act from what they say alone — without opening the source material.

## Each surface owns ONE seat

| Surface | Its job — and nothing else |
|---|---|
| **Home** | "What does my attention buy right now?" — the curated deck + the day's shape. Never a firehose, never a second copy of a room. |
| **Room · left panel** | **The working conversation with the team about THIS work.** One living brief (position · the one ask · one CTA row), history folded beneath. Execution happens here: approvals, go-aheads, corrections, hand-offs. |
| **Room · right panel** | **The filed truth.** Header (name · state dot · one summary line), intent (Goals/Rules), and the inventory behind ONE tab bar: Tasks · Schedule · Conversations · Files · Activity. Nothing on the right asks for anything. |
| **The stage (artifact view)** | Where prepared work is reviewed and the ONLY place a Send/commit lives. |
| **Mailbox / calendar** | Untouched sources. We label honestly; we never reorganize their world. |

## The laws that keep it feeling human

1. **One fact, one home.** A next move, a debt, a deadline lives in exactly one place (the left
   brief). The right pane inventories; it never re-narrates.
2. **The brief is derived, not remembered.** The room opens with a recomputed position — clear
   the history and it re-briefs; return tomorrow and it re-briefs. Turns are audit, not truth.
3. **Asks live and die with their work.** An ask exists only while its verdict/commitment is
   open (supersession on resolution), and one artifact = one ask across all items that need it.
4. **Speak consequence, not inventory.** "Attach the report or point me to it and I'll send it
   to Shweta today" — why + what happens next. Never a bare labeled checklist.
5. **Deltas, not events.** "Since you were here: Clara drafted the reply; Shweta confirmed
   Sunday" — one line, not N narration fragments at equal weight.
6. **Never restate the settled.** Resolved work is spoken once as done, then folds forever.
7. **Affordances live in the brief's one CTA row** (and the stage's one commit). No trailing
   suggestion pills, no duplicate chips, no second Send anywhere.
8. **The word is the deed.** Names and mentions ARE the links. No pill that repeats the sentence
   above it.
9. **Earned calm.** When nothing needs the user, say so plainly — never invent urgency, never
   pad with activity. (And the inverse: a real ask is never buried below ambient noise.)
10. **Truth before presentation.** A surface never renders a claim the engine can't back right
    now (no show-then-retract, no stale-cache paint of resolved work, no "nothing connects yet"
    beside a full inventory).

## The acceptance tests (ask these of any screen, any change)

- Can the user decide and act from the brief alone, without scrolling or opening sources?
- Does any fact appear twice on screen? (If yes, one of the copies is in the wrong seat.)
- Is anything being asked that the system already knows or was already given?
- Does anything on screen refer to work that has already resolved as if it were open?
- If the user cleared everything and came back, would the room still tell them the truth?
- Would a competent human colleague produce this exact message/screen? If not, what would they
  say instead — build that.

## Standing build path (traces for the current arc)

1. Ask supersession + artifact-level dedup → law 3. *(shipped Aug 2)*
2. The living brief + folded history + pill removal (left panel) → laws 1, 2, 4, 5, 6, 7, 8. *(shipped Aug 2)*
3. Right-pane tab split; next-move/watch-outs/debts move left → laws 1, and the seat table. *(shipped Aug 2)*
4. The room-door law — a project item opens its project room from every surface; deep-links survive
   the middleware hop → the seat table. *(shipped Aug 3)*
5. The one-voice brief on every door (authored, never assembled) + the summoned stage (the composer
   raised by the user, one Send, right pane asks nothing) → laws 2, 4, 5, 7, and the stage seat.
   *(shipped Aug 3 — email + follow-up; commitment/meeting overlays queued)*
6. The conversational room — clicks are utterances: the verb strip on the stage (verbs only with
   their object), the exchange grammar (offer → pick → acknowledge → land, reply as reference),
   artifact cards at the stream's now edge, the excerpt-honesty law. *(shipped Aug 4 — exchange
   generalization to invite/forward/decide queued)*
7. Home ask-state chips on deck rows (queued) → Home's seat ("what does attention buy").
