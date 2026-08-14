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
7. The one system — one grounding (`assembleRoomGrounding`), one responder (brief · THE MOVE ·
   offers), surfaces as views; the parallel panel authors died; the MOVE is board-validated and
   offers are utterances → laws 1, 7, 10, and the whole "team took over" sentence. *(shipped Aug 5)*
8. Home ask-state chips on deck rows (queued) → Home's seat ("what does attention buy").

## PART — THE MACHINE (Aug 13, the skeleton the organs hang on)

Everything above describes organs: the judge, the lanes, the door, the editor. This part is the
skeleton: an explicit lifecycle every actionable item moves through, ONE renderer every door
consumes, and one home per deliverable kind. The failures this corrects were all one failure —
surfaces conformed to each other instead of to a machine (a decision card left on one door,
right on another; a menu click answered with a question; a reply materialized as a document).

### The work-item lifecycle (derived at read time — never a new table)

`unjudged` → `preparing` → { `ready` · `awaiting_input` · `awaiting_decision` } → `enacting`
→ `awaiting_approval` → `committed` → `settled` (and `parked` from any judged state).

- **unjudged** — spotted, no verdict. May deck; claims nothing. A judgment older than the
  staleness floor (48h) with nothing landed and nobody asked derives BACK to unjudged — the
  machine claims nothing rather than parading an old verdict as activity (the René find:
  "preparing" stood for 17 days on a real account).
- **preparing** — judged actionable; no preparation landed yet AND no ask stands. Transient
  (one pass cycle); renders as honest "in motion", never as bare work.
- **ready** — prepared work exists for the judged verb. The primary is reviewing the artifact.
- **awaiting_input** — an honest ask stands, OR a staged send is missing what the send door
  requires (a timeless invite, a recipientless forward — a Send primary that cannot fire is a
  lie). The primary is supplying (checklist / the artifact's stated gap).
- **awaiting_decision** — a decide verdict with its decision material: the prepared brief OR
  the verdict's own validated options (the door and the machine read the SAME material, by
  construction — they can never disagree about whether a decision stands).
- **enacting** — a structured action fired; its consequence is being produced. Seconds, visibly.
- **awaiting_approval** — a send-shaped, fireable artifact is staged AND no ask stands. The
  primary is Send (the commit door). **The open ask outranks the staged send**: while the
  system itself says inputs are missing, the primary is supplying them, never sending work
  with known holes — the draft stays reachable on the door.
- **committed** — sent/booked, awaiting settle. **settled** — closed; renders nowhere active.

**Transitions are buttons; conversations are text.** decide(option) · supply/go-ahead ·
approve/send · revise(instruction) · park(date) · dismiss/done. A structured action NEVER
routes through the free-text brain and NEVER answers with a question — it advances the state
and the next state renders. Free text in the composer goes to the brain (converse). An
invalid transition does not render.

### The placement table (ONE renderer; doors render the plan, never assemble)

CONVERSATION (left) = dialogue + every exchange component. STAGE (right) = filed truth (the
message, the files) + staged send-shaped artifacts. Chrome differs per door; placement never.

| component | pane | seat |
|---|---|---|
| brief (the editor's opening) | conversation | first, always |
| decision card | conversation | directly under the brief when awaiting_decision — never the stage, never duplicated as chips on other cards |
| ask checklist | conversation | under the brief (the editor reconciles decision+ask coexistence) |
| MOVE + offers | conversation | after components; offers suppressed while a decision card is primary |
| document artifact cards | conversation (card) | the FILE opens on the stage |
| reply / nudge / forward / invite drafts | stage composer | Send lives there; the conversation references, never embeds |
| item verbs (Reply · Forward · More) | stage CTA row | unchanged |

Doors — deep-dive `/item/<id>`, project room (embedded item), Home chat inline — consume the
SAME plan. A component that renders left on one door renders left on all of them.

### Lane homes (kind → home, enforced at materialization)

reply/nudge → `source_data.draft`/`nudge_draft` (the composer) · invite → `prepared_invite` ·
forward → `prepared_forward` · document/spreadsheet/deck → artifact (pool/stage) · decision →
the decision brief (its card) · ask → `input_checklist`. A reply NEVER materializes as a
document; the enactment of a decision on an email lands in the draft lane, ready to send.

### The walked-journey law

A change to any component or transition is DONE only when walked — clicked through to its
outcome — at every door in the table. Render inspection is not verification.

### The containers law (Aug 13 — sessions follow the relationship, not the chat-app habit)

Dialogue can be ephemeral; **the work record never is**. Three containers, three rules:

- **A coworker is a person → ONE continuous thread** (the Slack model). No sessions, no history
  popover; scroll-back is the history; date dividers are the only separator. The relationship
  persists; memory lives on the agent, not the thread.
- **A room is a place → the living state + one continuous record.** The brief/cards/machine
  states are derived and always current — there is no "new session" of reality. The conversation
  beneath is the continuous work record, compressed by time-folding only. Per-topic threads
  within a project exist STRUCTURALLY as item rooms — never as user-managed chat containers.
- **The chief chat is a scratchpad → sessions.** Conversations there are genuinely disposable
  (the chief's durable output lives in the deck, the rooms, the machine); fresh on landing,
  recents behind explicit doors (the fresh floor).

### The ground law (Aug 13 — prepared work expires with its ground; the surface speaks the present)

The failure it ends (found live, the Stratto room): a counterparty moved a demo from Monday to
Thursday; the room kept offering the Monday reply draft and the Monday invite as "ready to
review", an old prep narration kept giving Monday instructions, and the brief contradicted
itself about whether a reply was owed. The verdict never changed ("reply" before, "reply"
after) — so no amount of re-judging could catch it. **The verdict can stay identical while the
content beneath it goes stale.** Only a structural watermark catches that.

> **Every prepared thing records the ground it was prepared from. When the ground moves, the
> work is superseded — structurally, not by opinion. The surface speaks the present; change is
> one delta line in the team's voice; the past folds, never deletes.**

- **The watermark.** Every prepared artifact — reply draft, nudge, invite, forward, pool
  deliverable, decision brief — stamps `prepared_from` (the newest inbound message at prep
  time) when written. One helper, every lane home.
- **Stale is derived, never stored.** The one reader compares each artifact's ground to the
  item's actual newest inbound at read time. Ground moved → the artifact is stale: the machine
  treats it as not-prepared (state walks back to `preparing`), no surface offers it as current,
  and no Send primary can fire a dead plan. Conservative by construction: no resolvable ground
  → never stale (churn costs less trust than a wrong flag, but a false "current" costs more).
- **Supersession re-prepares.** The pass's lane freshness guards are ground-aware: fresh by
  clock but stale by ground → re-prepare from the new reality; the old version files into the
  version chain (reachable, invisible). Same mechanic as supply-reopens-the-work — an inbound
  message is the counterparty's supply.
- **The delta is ONE line.** A ground-move re-preparation narrates exactly once, in the room's
  event grammar, naming who moved it and what was updated ("New message from Carson moved
  this — reply and invite updated"). Deduped per ground change; never a replay of the old work.
- **Whether the user had acted decides the ceremony.** Prepared-but-never-committed work
  supersedes without ceremony (the user has no attachment to work they never saw). COMMITTED
  work (they sent it) is theirs: the record keeps their send, and the delta acknowledges it
  before presenting the fresh preparation. Work open under their cursor is never mutated
  silently.
- **Narration expires with the brief.** Engine narration authored before the brief's current
  composition folds under "earlier (N)" on every door — the brief IS the digest of that
  history; old instructions never stand beside a newer brief as live guidance.
- **The editor owns the one claim about what's owed.** The compose pass sees the machine state
  and the newest inbound; a headline and body that disagree about whether a reply is owed is a
  compose-time build error, not a shippable brief.
- **The standing check.** No new clock: the ground check rides the doors where reality is
  already read — the READ side (every getPrepared derives staleness live, so no surface can
  serve a superseded artifact as current, ever), the deep-dive/room OPEN (a served-stale view
  fires re-preparation in the background; the next poll shows fresh work), the room-door
  recompose (the brief sig carries the ground — a new inbound recomposes the opening), and
  the preparation pass (re-prepares stale lanes under its budget, recorded, never silent).
  Inbound sync feeds all of these through last_activity and reactivation — the trip needs no
  new sync surgery.
