# The Threads Constitution — one surface, faces, five words

*The constitution of THE THREADS ARC (Sep 5, 2026). It reassigns SEATS from
`docs/experience-spec.md`; it does not repeal its laws — the ten laws, the acceptance tests,
and THE MACHINE all survive and are cited below where a seat moves. Every surface change in
this arc must trace to a clause here. Benchmark context: Grok Bot (xAI, Aug 2026) proved the
form factor — a messaging app where agents are contacts, work returns to the thread only when
blocked or done, and the avatar is the status indicator. We adopt the form; we keep the organs
they don't have (the judge, the one brain, the commit door, the multi-user spine, sovereignty).
The strategy sentence: **the iMessage form factor, on top of the brain and the governance —
"Grok Bot for companies."***

## The one deciding law

**Everything the system does arrives as a message in a thread, from a face.**

Every future capability must answer "what does it look like as a message in a thread?" before
it ships. A capability that cannot answer becomes a panel — and panels are how the old room
became a mess. (Corollary of experience-spec laws 5 "deltas, not events" and 8 "the word is
the deed", applied to topology.)

## The five primitives (the whole user-facing vocabulary)

**Team · Threads · Projects · Routines · Documents.**

(Surface label: the "Routines" primitive is LABELLED **"Workflows"** in the interface — owner
call, Sep 8. The primitive name stays "Routines" in this plan; only the rendered word changed.)

Asks, verdicts, gates, stations, runs, briefs, frames, judgments, entities, atoms — all remain
real underneath and NONE is a word the interface teaches. (A "frame" renders as a document
card that happens to be interactive; a "gate" renders as a coworker asking for approval.)
Adding a tool, an integration, a coworker, an artifact kind, or a workflow capability must not
add a word to this list.

## The topology — three thread kinds, ONE component

| Thread | With whom | Its mind (grounding) | Today's ancestor |
|---|---|---|---|
| **The Home thread** | The CoS | Cross-project: the whole judged day. The ONLY cross-project view. | Home chat + the deck |
| **Coworker DM** | One coworker | User-global + any project reachable by recognition, always cited | Worker chat threads |
| **Project thread** | The team, about THIS work | That project's brain + user-global. Nothing else, structurally. | The entity room |

ONE thread component renders all three (timeline · header · composer · drawer). A thread kind
is configuration, never a fork. The three existing chat surfaces (Home chat panel, coworker
DM, room rail) port ONTO this component and their bespoke renderers retire.

Loose items keep `/item/<id>` and their room IS a thread of the same component (a loose room
is a project room with less to file — the July law, unchanged).

ONE OBJECT, ONE DOOR (stabilization W7.2, Sep 23 — `docs/laws-registry.md` `one-object-one-door`): a
loose room converses and composes under the ITEM's own key whatever it is linked to. A link is a
fact about the item, never a new address for its conversation — recognition of an untracked
entity stays the quiet "connects to … Track" suggestion; only the TRACKED project's own door
speaks the project agenda. The one mind per room reads THIS room's object; the item door's chat
never grounds on a container the panel does not show.

## ONE AGENDA PER ROOM (born of the owner's Sep 7 walk — "components floating around")

**Nothing STANDS in a room unless the pinned brief speaks it, or it dies.** The live failure:
the brief spoke meeting links while an unacknowledged coworker ask stood beneath it, a
recognition proposal floated unanswered for days, and composer chips duplicated the CTA —
four organs, four agendas. Enforcement is code, not hope:
- OFFERS NEVER DUPLICATE THE MOVE (law 7, token-checked at the serving seam).
- A STANDING PROPOSAL AGES INTO THE DRAWER: a membership/bring-in proposal may speak once
  when fresh; unanswered past 48h it is inventory and lives with the drawer's membership
  review — never a permanent timeline squatter.
- THE COHERENCE RULE SEES EVERY ASK: coworker checklist asks join the brief's grounding and
  its sig — a kept ask is acknowledged in the brief's own words, always.
- **THE TEST IS WHETHER THE PINNED SEAT SPEAKS, NOT WHETHER A BRIEF COMPOSED** (amended Sep 14,
  owner: *"not sure you're walking the changes through projects AND single loose task items"*).
  The fold used to require a COMPOSED brief — and a room whose pinned seat speaks through the
  PRE-COMPOSE fallback (the anchor line + a "Next: …" CTA) therefore showed exactly the double this
  law exists to kill: a pinned move and, below it, an ask card with its own answer row. Measured on
  the live account the day of the amendment: **64 of the 70 rooms carrying a live ask** were in that
  state (15 loose doors, 49 project doors) — the flaw was never loose-door-specific, it was
  condition-specific. A folded ask brings its own sentence when no brief names the gap. Gate T22.10.

## The calm Home's ranking + the sidebar's grammar (Sep 7 walk laws)

- **OVERDUE-NESS IS NOT IMPORTANCE**: whispers rank people-facing work by the judge's order
  (overdue floats within that band); automated/admin notices sink and get at most ONE
  whisper — a chore never outranks a person.
- **EVERY WHISPER HOVER SHOWS A VERB** (at least "Open →") — a hover that reveals nothing is
  a dead affordance.
- **THE SIDEBAR LISTS PLACES, NEVER SESSIONS — AND THE TEAM IS ONE ROW** (owner, Sep 7
  night, superseding the per-coworker rows of the same day): projects capped by attention,
  chat sessions at most a short tail, session titles never as primary rows — and the
  coworkers are ONE compact "Your team" row (the facepile, faces wearing the avatar-status
  grammar, expanding to the per-coworker DM doors). The roster never becomes N nav rows: at
  ten coworkers a per-coworker list is bloat, and the CoS-routing thesis means users mostly
  talk to threads while specialists surface contextually.

## SPEECH IS COMPOSED, NEVER TEMPLATED (owner, Sep 7 night)

"I don't want bolted deterministic fixes — I want this reasoned and thought of, otherwise
it's hardly replicable across users in different scenarios." The law: **anything that wears
a face and speaks sentences is AUTHORED by the brain over judged facts** — the brief, the
CoS sentence, an ask's speech, a report-back. Deterministic text is lawful only as (a)
chrome and labels (counts, receipts, state words, urgency words — vocabulary, not speech),
and (b) the FLOOR beneath a composed pass (failure never blanks, never blocks — but the
floor is a fallback, never the primary). Every composed speech ships with the house
harness: cheap tier · code-checked against its own facts (the evidence-law idiom) ·
composed once at authoring, never per render · non-fatal everywhere.

## THE PROJECT'S MIND SPEAKS FIRST (the owner's "an AI per project", Sep 7)

The AI-per-project already exists (the project brain · the one grounding · the one responder).
What makes it FELT is presence — three social behaviors, all deterministic:
- **It raises its hand**: a project's sidebar row badges when its room holds live non-user
  turns newer than the owner's read marker (item_plans kind `room_read` — one writer, stamped
  when the room is served). No marker or nothing new → no badge, ever.
- **It speaks first on reopen**: one appended "Since you were here — …" event line beneath
  the pinned brief, digesting what landed since the marker (deterministic, ≤3 clips, one
  line — deltas, not events). Never on a first visit.
- **Only the meaningful interrupts**: the badge counts curated room turns (narrations +
  coworker speech), never raw items; the interrupt inherits the fold's discipline.

## THE CARD CONTRACT — interactive cards are the mind's utterances (owner, Sep 7 night)

The thread's next evolution: the common deliverables arrive as FILLED, EDITABLE, ACTIONABLE
components — the card IS the workspace; the stage survives for the deep 20%. The old
components (`InvitePreviewCard`, `EmailDraftCard`, the doc card) are DONORS of mechanics
(edit fields, send flows, commit-door wiring), never the design — they retire the wave their
successor ships. Three laws bind every card kind, present and future:

1. **FILLED FROM THE ONE GROUNDING.** A card's facts (attendees, recipients, times, register,
   language) read the same room grounding the brief reads — a card and the pinned brief
   structurally cannot disagree. Item-local scraps never fill a card field the grounding
   contradicts.
2. **OPTIONS ARE REASONED, THEN CODE-VALIDATED — AND THEY LIVE IN THE CARD.** (Owner, Sep 8:
   "not a fan of those pills below the components — make it selector-like, like Claude/
   ChatGPT.") A card's options render as THE IN-CARD SELECTOR: a contained list of
   full-width option rows inside the card (label + muted annotation, hover row, the open
   "type/suggest another…" row last), or as variant TABS on the card's top edge — never
   loose pills scattered beneath the card. The commit row stays the card's bottom edge.
   Options themselves come from
   the mind's reasoning over the room (stated constraints, real calendar slots, the
   reply-directions organ) — and every option is code-checked against its source before it
   may render (a slot nobody stated and the calendar can't confirm never appears; a
   direction must ground in the room's own words). GROUNDED DIRECTION-VARIANTS over generic
   tone-tabs — "confirm + propose Thursday" beats "friendlier". Variants beyond the first
   generate lazily on selection, cached.
3. **THE CARD'S WORDS ARE COMPOSED; ITS COMMIT IS THE DOOR.** The intro line is the mind
   speaking (the speech-is-composed law, floored); the card renders filled ONLY from
   genuinely prepared data (machine `ready`) — missing facts ask plainly, never render
   empty fields (truth before presentation); and every Send routes through the one commit
   door — the card moves WHERE you approve, never WHETHER.

Per-kind contracts (what each card MAY read · MAY offer · MUST refuse):
- **invite**: reads room people + the thread's stated time constraints + the user's served
  calendar; offers the stated/derived slots (≤2) + "suggest another…"; refuses to render a
  time nobody stated and the propose tier didn't ground, or an attendee outside the room's
  people without the user's word.
- **email_draft**: reads the thread's present (topMessageOf law) + the room grounding +
  voice; offers direction-variants from reply-directions (+ a quiet tone tweak); the raw
  thread lives behind a tab/stage door; refuses recipients not literally evidenced.
- **doc_draft**: reads the room's files + brief + the one production door's artifact;
  offers open/send/revise chips grounded in the room; refuses claims beyond its sources.

**EVERY THREAD, EVERY PRODUCER (owner, Sep 8):** a card kind is the ONE rendering of its
deliverable kind — in all four thread kinds (Home · coworker DM · project · item room, which
share the one timeline by construction) AND from every producer: the proactive pass, a
workflow run, a delegation, and A PLAIN PROMPT. "Draft a reply to Sam" typed into any
composer routes through the SAME preparer as the proactive path and lands the SAME card —
a prompted deliverable that arrives as prose-with-a-link where a card exists is a build
error (gate it: one card per kind, no second rendering anywhere). The grounding adapts per
thread under the memory ladder — same card, the right mind.

Adding a card kind = one grammar-table row + one contract entry here + one kit component —
frames, compute, and tasks follow the same three laws when their turn comes.

## The tier law — capability shapes content, never topology

Checked against the live registry (Sep 5): **most populated workspaces run module-light** —
3 of 5 with real members have `email: OFF` (two also `meetings: OFF`). Module-light is the
MAJORITY pilot configuration, so it is a first-class resident of this design, never a degraded
mode.

- **The topology is constant across every workspace configuration.** Threads, faces, the
  drawer, the five primitives exist on every tier. A module flag (email · meetings · drive ·
  agents · studio) gates WHICH CARD KINDS can arrive, which composer verbs exist, which drawer
  tabs and quiet nav links render — never whether the surface exists.
- **The message-grammar table carries the feature column.** Each card kind declares its
  required module (the TOOL_FEATURE pattern, one map): reply/inbox cards ← email; meeting
  cards ← meetings; file/knowledge cards ← drive; routine cards ← studio; the specialist
  roster ← agents. Adding a module = new card kinds + map rows; the thread component never
  changes.
- **The CoS is not a module.** The platform's voice exists on every configuration — the
  `agents` flag gates the SPECIALIST roster, never the seat (see the identity law).
- **Email-off is the proof case, and it's already half-built**: the sovereign day-one (the
  team-present card, Clara's DM intake, the poverty-gated context lane) IS the threads model
  avant la lettre — it becomes the Home thread's natural opening with zero reframing. On a
  module-light workspace the attention card draws from what exists (routine gates, handoffs,
  meetings where on, stated tasks, intake) and EARNED CALM does the rest — fewer sources is
  a quieter colleague, never an emptier dashboard.
- **The sovereign copy law generalizes**: no card, chip, empty state, or CoS utterance may
  reference a module the workspace lacks (a chip is a claim — the existing law, now applied
  to speech). Gate: the P4 wave adds a feature-matrix assertion to smoke-threads (each
  card kind's producer consults the feature map).
- `ai_tier` (standard/bedrock/client-endpoint) shapes routing only — invisible to topology,
  as today.

## The identity law — one CoS, per-room mind

- **One CoS identity** platform-wide: one name, one face, in the Home thread and in every
  project thread. Never a minted persona per project.
- **The CoS is a SEAT, not a hardcoded name** (RATIFIED by the owner, Sep 6):
  a role on the worker registry that one coworker holds — **Clara by default** (she is already
  the proto-CoS: the sovereign intake greeter, the weekly-priorities voice, "your assistant").
  Every engine voice (deck, deltas, briefs, narration) binds to the seat-holder, so a
  workspace with a custom or re-branded roster reseats without code (the agnostic doctrine),
  and a missing seat-holder reseats deterministically — the voice is NEVER faceless. Faceless
  is what exists today, and it is the root of the illegibility this arc kills.
- **The mind is scoped by the thread, not the speaker.** In a project thread the CoS (and any
  coworker) loads: that project's brain + user-global. Other projects' CONTENT is absent from
  the prompt — contamination is structurally impossible, not prompt-discouraged.
- **User-global is not "other projects."** The user's own calendar, commitments, load, voice,
  and preferences reach every room ("you can't take Thursday 2pm — you're committed
  elsewhere" is competence, not a leak). Another deal's pricing is a leak.
- **Cross-project reach is explicit and cited.** "Like we did for X" fetches X deliberately
  and the reply names the source ("from the X room: …"). Ambiguity refuses by listing.
  (The R-class channel-contact law, one layer up.)
- The moment a thread has more than one human (handoffs, shared projects), scoping is access
  control, not just relevance: the grounding respects who can read the room.

## The responder ladder (deterministic — never a judgment call about WHO)

1. **@mention** → that coworker answers, grounded in the thread's mind. The mention IS the
   routing.
2. **Unaddressed** → the CoS. It answers directly, or **visibly delegates** ("I'll have Clara
   draft that") — the specialist's report-back lands in the SAME thread, attributed to them,
   with their face. Routing is performed on camera; it is the chief-of-staff job, not plumbing
   to hide.
3. A structured action (button) never routes through the free-text brain and never answers
   with a question — THE MACHINE's transition law, unchanged.

This gives the novice path (just type — something competent always answers in context, the
Claude/ChatGPT expectation) and the expert path (@name) with zero new concepts.

## The memory ladder (knowledge decoupled from identity)

| Layer | Holds | Home | Reaches |
|---|---|---|---|
| **User-global** | Who you are: voice, preferences, calendar, commitments, how-you-work | context_profiles + user memory | Every thread |
| **Project** | The work's facts: people, dates, state, files, ledger | The project's brain (`work_entities` + links — already built) | Its own thread; elsewhere only explicit-and-cited |
| **Coworker-method** | How to work with you: standing instructions, role feedback | Coworker memory | That coworker, everywhere |

**Facts file to the brain, never to whoever heard them.** A project fact stated in any thread
lands in that project's entity (recognition — already built); a user fact lands user-global; a
"Clara, always CC me" lands coworker-method. One write ladder, one home per fact (law 1
applied to memory). This is the structural answer to Grok Bot's owned-by-the-bot memory,
which forces its users to clone agents for context isolation: **few faces × many scoped
brains.** Coworkers are the relationship layer; contexts are the enforcement layer.

## The thread anatomy

**Header** — name · state dot · faces (participants/coworkers active here) · the drawer
handle. ONE quiet line of chrome. No prose. Nothing in the header asks.

**The pinned brief** — the room's composed opening (today's `lib/room/brief.ts` product) is
the PINNED FIRST MESSAGE: position · the one ask · one CTA row, spoken once, wearing the CoS
face. It is derived-not-remembered (law 2) and it updates by the no-mutation law below. The
right-pane re-narration seat is ABOLISHED — there is no second brief anywhere.

**The timeline** — heterogeneous by design (the Grok transcript model, which we independently
built): user bubbles · coworker bubbles (face + name on first of a run; Slack grouping) ·
muted event lines (system, no author, no affordance) · inline CARDS. The three-grammar
structural derivation in item-rail survives as the component's core.

**THE STREAM SHOWS THE PRESENT — THE RECORD IS FILED** (owner, Sep 14, said twice: *"the 'earlier'
things I'm not sure it makes sense… I'm not sure where to fit it or what value it brings but looks
odd"*). History no longer FOLDS in the timeline; it LEAVES it. The "earlier (N)" handle is repealed
and deleted (variant, renderer and producers — a mechanism nothing can reach is how a repealed law
comes back by accident), and the room's past is a read-only **History** section in the drawer, at
every door. What is PRESENT keeps its seat by the existing rules — the pinned opening, a live ask, a
card, the coalesced delta, the last turns of the exchange; the archival laws that decide WHAT is
history (the brief watermark, dead asks, orphan preps, aged anticipations/proposals) are untouched.
Gates: smoke-threads T3.7, T6.13, T29.5, T29.6 · smoke-one-room R5b.

**Cards — the message grammar for every organ.** Each engine organ delivers as exactly one
card kind; this table is the seat map of the arc:

| Organ (internal) | Arrives as | Buttons on the card |
|---|---|---|
| Judged actionable item | The CoS: one line of consequence + the item card | Open · the judged verb |
| Prepared work (reply/forward/doc) | Coworker message: "ready for you" + artifact card | Open → the stage (the ONLY Send, unchanged) |
| Prepared **invite** (shipped Sep 8 — the first interactive card) | Coworker message + the FILLED invite card: date tile · attendees · agenda · the in-card selector | Edit in place · pick a grounded slot · **Send invite** (through the same commit door) |
| Approval gate / guardrail hold | The owning coworker asking, draft preview in-card | Approve · Reject · Open |
| Input station / engine ask | Coworker ask + the supply form in-card (paste · pin · attach) | Supply · Go ahead with what's available |
| Workflow run (scheduled) | The OWNING coworker's delivery message in its thread | Open deliverable |
| Workflow run (event-fired, parked) | Same, as an ask (the attention wave re-aimed at threads) | Approve · Reject |
| Delegation / heavy work / sandbox job | Working-avatar state + sparse progress lines; then the deliverable card | Open |
| Frame | Document card with live mini-preview | Open → side panel (the Claude idiom, unchanged) |
| Handoff | A message TO the assignee in the thread they can read | Approve · Reject · Open |
| Ground move / delta | One appended CoS line ("Since you were here: …") | (links are the words) |
| Standing-task proposal | The spec card, unchanged | Confirm |

No organ gets a second delivery surface. The workflows ledger, run drawer, and deep-dive
survive as the ROUTINE's own record (reached from the card's Open), not as attention surfaces.

**The composer** — one grammar everywhere: text · @mention · attach · the project chip.
Chips-as-utterances survive (clicks are words).

**THE DRAWER IS ONE COMPONENT** (owner, Sep 14: *"the component is different across projects, loose
items… now we're screwed as you have to double or triple the maintenance work. very sloppy."*). The
pane — the overlay law, the three ways out, the reduced-motion floor, the reader's own draggable
width — is written ONCE (`components/room/filed-drawer.tsx`) and every room door mounts it; a
door's variance is DATA (its sections), never a second pane. THE GENERAL LAW: **a law that must hold
at two doors lives once, and a gate counts the implementations** — behaviour gates assert at the one
seat, T29 asserts the count. Same for the agenda (the shared rail) and the record (one reporter, one
renderer). A change that lands at one door only is the class this section exists to kill.

**The drawer** — the filed truth, summoned: slides over from the header handle. Tabs:
Tasks · Schedule · Meetings · Files · Activity (+ Goals/Rules when set). Counts are counted,
never subtracted (the sum law). Nothing in the drawer asks for anything; empty sections are
ABSENT, not scaffolded ("+ Add a goal" on an empty pane is the pane asking — outlawed). The
drawer never re-narrates: inventory only.

## The avatar status grammar (replaces most loading chrome)

The coworker face IS the status indicator: **still** = idle · **animated** = working (their
delegation/run/sandbox job is live) · **badge** = needs you. Hover names the current step in
one line, for reassurance. We render neither spinner-dots nor tool-call narration in the
timeline (sparse progress lines at meaningful moments only). Motion respects
reduced-motion. The bar is the Grok reviewers' "the motion design is s-tier" — this is a
polish seat, resourced as such.

## The address law

Every thread owns a real URL, and rendering a surface whose address says otherwise is
outlawed. `/project/<id>` (project threads) · `/item/<id>` (loose rooms, unchanged) ·
`/t/<id>` reserved for chat threads as they unify. Legacy query addresses redirect. Back
returns where you came from (the back-link primitive). Refresh and deep-link are honest
everywhere.

## The no-mutation law

**A served surface never changes in place while the reader is looking at it.** Composed prose
(briefs, summaries), inventory counts, and verdict-bearing chrome are frozen for the open
view; a recompute lands on the NEXT open, or arrives as an APPENDED message ("Update: Sam
confirmed Wednesday"). Allowed live behavior, exhaustively: appending new timeline items;
filling a skeleton that never showed content; streaming an in-flight reply; explicitly-live
run status the user is watching (the drawer's "step N/M"); changes the user's own action just
caused. The dashboard-mutates-under-you class becomes structurally impossible: threads
append; only appends are live.

## The Home thread's seat — THE CALM HOME (RATIFIED Sep 7, supersedes the attention-card form)

Home = one speaker, everything else whispering (`HomeCalm.dc.html` is the frozen board).
The page: the date + greeting · **the composer as the page's single focal point** ·
**three-to-five WHISPERED LINES** · one quiet door ("Everything else · N →" — the full deck
lives behind it, never dies) with the day's handled count resting beside it.

- **THE DENSITY LAW** (AMENDED — OWNER CALL, Sep 13: *"in home, this feels too much, remove"*
  and *"lets also remove the chips"*): the resting Home is **greeting · ≤5 whispers · 1
  composer · the door**. NO prose and NO chips: the CoS's one sentence (with her face) and
  the standing suggestion row over the composer — "Add a task… · Plan my week · What's
  slipping? · What did I miss?" — are both RETIRED. A furnished account already has its day
  in the whispers; a sentence about the day and a menu of openers were two more things to
  read on a page whose whole claim is that there is little to read. Urgency stays a WORD in a
  line, never chrome (no red labels, no counts shouting, no borders on the whispers). The
  sovereign day-one chips are a DIFFERENT feature and survive — an empty corporate account
  has no work to whisper, so they are its only visible door. Gates: smoke-threads T8.2,
  T8.16, T8.13b · smoke-workbench B3a/B3b · smoke-compute F4.
- **THE RECEIPT GRAMMAR**: every whispered line carries a DONE-NESS word in quiet indigo —
  "reply ready" · "drafted" · "ready to send" — receipts only a system that already worked
  can print. An imperative line with no receipt is ChatGPT's grammar, not ours. The verb
  appears on hover; the tap ships prepared work, never starts a prompt.
- **Earned calm's inverse stands — RE-SEATED ON THE FOLD** (Sep 13): a genuine ask is never
  buried by the calm. It used to be enforced in prose (the sentence's first clause named the
  fire, and a composed lead that buried one yielded to the deterministic builder). With the
  sentence retired, the law lives where the eye actually lands: **the fire takes a seat.**
- **A NAMED FIRE IS A SEATED FIRE** (owner walk, Sep 8 — the lead said "Four things are overdue"
  over five whispers showing none of the four). Overdue rows take whisper seats FIRST, in every
  lane, and the one-chore cap yields to them (an overdue payment notice is a fire, not a chore —
  the Sep 7 band law governs only the calm). Past five fires the door holds the overflow, and the
  door's own order puts fires first, so nothing is stranded. The disagreement class this law was
  born from is now structurally impossible: **the fold is the only thing that speaks about fires
  at all** — one pass over the pool, one surface. Gates: smoke-threads T8.1a/T8.1b, T19.1*,
  T19.3b, T19.4*. (The sentence-side gates — T8.1c, T8.4, T8.5, T8.5b, T8.6, T8.13a, T19.2*,
  T19.3/3a — retired Sep 13 WITH the claim they checked; T8.16 proves the path is deleted, not
  left as a corpse.)
- **THE HOME HAS ONE ROW GRAMMAR, AND THE DOOR EXPANDS IN PLACE** (owner walk, Sep 8 — "this is
  awful, looks bad and not aligned with the new design at all"). The legacy deck beneath the calm
  Home — the "What needs you N" header, the Tasks/By-project toggle, the boxed overdue cards, the
  day ring's second seat and the This-week rail — is RETIRED, not restyled. "Everything else · N →"
  expands the remainder AS WHISPERS, sorted by one stated order: fires · asks (the machine waiting
  on you) · due today · dated ahead, nearest first · the deck's own judged order. A fact with
  another home never earns a second seat here (the calendar's home is the meetings surface; the
  handled count's home is beside the door). Gates: T8.12, T8.12a, T19.4.
- **THE HOME PAINTS FIRST** (owner walk, Sep 8 — "Home loads very slowly"). A SELF-HEAL IS NOT A
  READ (the replied-items reconcile — an unbounded serial walk with a reasoned judgment inside —
  ran awaited on the brief route; it belongs in `after()`, and a heal stamps itself only after it
  ran). THE PAINT WAITS ON ONE ANSWER (an ambient lane never rides the brief's flight; an
  empty state waits for the lane it counts, or it claims-then-retracts). ONE FACT, ONE FETCH (the
  CoS seat was fetched once per mount, three times per Home). And the skeleton stands in the
  page's own shape — the facts the client already holds (the date, the greeting) paint at once;
  only the claims wait. Gates: T21.
- The judgment layer (judge, dedupe, one-claim-per-row) is UNCHANGED — the calm form is a
  quieter render plus the pick-the-five judgment, which is precisely a chief of staff's job.
- **The comparison thesis** (owner-settled): looking like the category's cleanest member is
  the plan; differentiation is IDENTITY + EVIDENCE (the faced sentence, the receipts, the
  visible team, standing state), never layout novelty.

The sidebar lists conversations (threads), not modules — the frozen boards' form, owner-
confirmed Sep 7: Home + needs-you badge · CONVERSATIONS (project threads with state dots and
unread badges, coworker DMs with faces and the working state) · "All conversations →" ·
quiet module links at the bottom (Routines · Inbox · Meetings · Documents, feature-gated) ·
the team facepile. Badges are honest or absent — a badge with no real needs-you behind it is
a lying door.

## What survives byte-identical (the organs)

The judge and THE MACHINE's lifecycle · the one grounding and one responder ·
recognition/entity memory · the commit door and human-in-the-loop law · the workflows engine,
gates, stations, subprocess, cases · materialize (the one production door) · the frames
validator/series/shares · the sandbox · sync and classification · the sovereign tier ·
platform admin. This arc is chrome topology + delivery form. "Conform on the chrome,
differentiate on the brain" — the chrome to conform to has now been demonstrated at scale.

## Visual language (the mockups are the spec)

The frozen design canvas of this arc is the acceptance test for Phases 2–4. Principles the
canvas must embody: one type scale (the ui-kit tokens) · calm density (a thread breathes;
cards are quiet until hovered) · faces everywhere speech happens, never on chrome · motion
budget spent on avatars and card arrival, nowhere else · light/dark honest.

## Phases and gates

- **P0** — this document + the design canvas. Freeze on the owner's word.
- **P1** — mechanical debts (design-independent): the address law · the no-mutation law · the
  one-voice sweep (second brief dies, empty scaffolding dies). Gate: `smoke-threads.ts` is
  born (address + no-mutation assertions) and grows every phase after.
- **P2** — the one thread component; the three chat surfaces port onto it, feature-parity
  gated per port.
- **P3** — the room collapse (right pane → header + drawer; pinned brief) + the responder
  ladder wired, with the scoping gate: a cross-project decoy fact planted on the probe host
  must NEVER surface in another project's thread.
- **P4** — every organ delivers as its card (the table above); the attention card; avatar
  states; nav reduction.
- **P5** — retire + redirect old surfaces; the full pre-handover browser walk; the owner walk.

Execution mode: Fable orchestrates and reviews every diff; Opus agents build to surgical
briefs; live pilots (the weekly AHK briefings above all) must keep working through every
intermediate commit — strangler pattern, no big bang. New laws ship with their gates in the
same change. Nothing merges without the owner's walk.

## Acceptance tests (ask of any screen in this arc)

- Is there anything on screen that did not arrive as a message, a card, or the drawer?
- Do two places state the same fact? (One of them is the wrong seat.)
- Did anything the user is looking at change without arriving as an append?
- Does the URL name what is on screen?
- Is any empty section asking to be filled?
- Cover the avatar column: can you still tell who did what? (If yes, attribution is decorative
  — fix the voice, not the icon.)
- Could a first-day user, knowing only "message your team," reach everything? Could an expert,
  @mentioning, go faster?

## THE OPENING CONTRACT — SPEAK · SHOW · OFFER (Sep 19, owner walk of six screenshots)

Born from one evening walk that found the same hole on three surfaces: the room asserted
conclusions whose OBJECTS were nowhere on screen ("Nothing is attached to review — ask me to pull
it together" on a decision whose object IS the inquiry email; "Clara drafted a reply below" with
nothing below; an Emeritus ask with no reminder of what was asked). The owner's two constraints are
the law's shape: ONE rendering per object kind on EVERY surface (consistency = reliability), and
every fix lands class-wide — CoS/Home chat, coworker DM, deal room, item deep-dive alike.

1. **THE ONE OBJECT CARD.** Every SOURCE object has exactly one rendering, keyed by kind in the
   thread kit beside the deliverable cards (the card-contract doctrine extended from deliverables
   to sources): an email → its tail excerpt (topMessageOf, the one clipper, the honest marker) +
   attachment chips that open the existing viewer; a meeting → its excerpt; a document → its chip.
   A surface never authors its own excerpt markup — it mounts the kit card or shows nothing.
2. **THE OPENING IS SPEAK → SHOW → OFFER.** One bubble that speaks (one move, no restatement, no
   dangling references, never the counterparty's name twice), the object card that shows, the deed
   component that offers. No ask, decision, or brief serves without its object in reach. "Ask me to
   pull it together" is dead copy — the machine pulls it, always.
3. **A CLAIM RENDERS OR IT DOES NOT COMPOSE.** "…drafted a reply below" survives only when the
   served payload actually mounts that deliverable (the MOVE-ref validation idiom, extended to
   prose claims about renderable work). The composer speaks in the FIRST person — a coworker never
   narrates themself in the third.
4. **THE SEAT LAW REACHES OBLIGATIONS.** A request addressed To: a third party, with the user in
   CC, never lands as the user's debt (`you_owe`) and never composes as "X is asking YOU" — unless
   the body names the user directly. The fact (`is_cc_only`, the to/cc lists) has been stamped at
   sync since July 8; the commitments lane now has to READ it. Found live: a counterparty asked the ADDRESSEE for
   the addressee's CV; the user, in CC, was served "You owe <the sender>" plus a checklist requesting
   the user's own CV.
5. **KIT-SIDE RENDER DISCIPLINE.** Consecutive same-author bubbles share ONE face+name header (the
   DM panel's grouping rule, moved into the kit so every surface inherits it); one type scale per
   bubble — hierarchy by spacing, never per-paragraph size/color; the opener never stands as a
   second greeter beside a pinned brief.

### THE OPENING CONTRACT — PROGRESS (Sep 19, three Opus waves + orchestrator walk, ALL GREEN)

- **Wave A · THE SEAT LAW**: predicate beside the fact (recipient-role.ts `seatStripsObligation`,
  positive-evidence-only + naming exception); extractor drops CC-seat `you_owe` rows; judge rule +
  JUDGE_VERSION 20; the quoted-chain clipper gained the Apple-Mail/new-Outlook header cut (a quoted
  "…for you and alex" was defeating the naming exception); `sweep-cc-seat` dry-found 20 false debts
  on the owner account (CV row among them) — owner applies. Gates P35 (147/149: the two reds are
  the live backlog scans, red BY DESIGN until the sweep runs).
- **Wave B · THE ONE OBJECT CARD**: `components/thread/source-object-card.tsx` (kind-keyed) +
  `lib/inbox/thread-door.ts` = THE ONE client thread reader (deck's inline copy deleted); mounted at
  decision card (`objectNode` — "ask me to pull it together" is dead) · pinned opening · lifted ask,
  one seat at a time; grouping (a pinned opening joins its speaker's run) + the dangling-"·" fix in
  the ONE timeline renderer; one type scale in the pinned bubble. T32 (14 gates).
- **Wave C · VOICE + CLAIMS + COMPOSITION**: the defective lines were authored in TWO places — the
  v-composer AND a lawless client stitch in item-rail (`anchorLine`: "Clara drafted a reply below",
  "X is asking you to decide"). New `lib/room/opening-discipline.ts` (dropRestatements ·
  stripDanglingRefs phrase-level · nameOncePerSentence, subject position deliberately untouched);
  ROOM_BRIEF_VERSION 14 (prepared rows now IN the components list; absence stated as a fact;
  third-person refusal to last-good); machine-framed asks attributed to us ("From X — this needs
  you to decide…"); "drafted below" renders only while the card mounts; opener folds to the bare
  question (nothing when the brief already asks); the object card mounts ABOVE the EmailCard
  (`showsSource` opt-in suppression). SQ21 (19 gates) + T30.3c/T32.10b/c.
- **Suite repairs found on the way (the cap class, twice, inside gates)**: smoke-one-room's pilot
  discovery scan silently served PostgREST's 1000-row page (and `like` can't match a uuid) — the
  pilot user's ENTIRE live matrix had gone vacuous; resolved via the auth listing → 94/94 with the
  matrix rows running again. AK1 re-pointed to the chat-lane clock's wrapper. R9's version-range
  pin → a floor. Real-name fixture in smoke-work-surface → generic.
- **Walked (Sep 19 morning)**: deck clean of the CV false debt (JUDGE 20 re-judged it out pre-sweep);
  cold-inquiry door = SPEAK/SHOW/OFFER exactly (our-frame ask line, object card with honest clip marker
  + PDF chip + Thread door, options); the pilot room's v14 brief absorbed the sent reply, one Clara run, opener
  folded, one connected offer; Home-chat lane instant + grouped.
- Board: threads 609/609 · quality 291/291 · one-room 94/94 · attention 362/362 · compute 156/156 ·
  work-surface 52/52 · promise 147/149 (sweep-gated) · tsc clean.
- **Queued follow-ups**: the deck reply-lane "who — ask" join lacks never-say-twice ("<Name Surname> —
  Review <Name>'s application…" walked live); meeting/document source-kind host mounts (payload
  plumbing); DM/Home-chat producer seats for the object card (no inbox id on those payloads);
  `awaiting` rows on a bystander seat (owner call — wider than debt); ONE-MOVE is prompt-only.
