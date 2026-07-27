# THE ONE ROOM — chat-centered execution, one page for all work (July 2026)

The presentation rebuild that makes the SURFACE as unified as the brain already is. Supersedes the
per-kind deep-dive layouts (email / commitment / follow-up / meeting) and the project room's panel
stack as SEPARATE page shapes — they all become ONE page. Builds directly ON the judged-room engine
(docs/judged-room-plan.md — judge, component registry, pool, versions, evaluator): nothing decided
there changes; only WHERE things render changes.

**The problem (user-verified on real screens):** each work type opens a different-looking page.
The email is a document page, the commitment another, the notice a near-empty one, the project a
dashboard. The chat is sometimes a rail, sometimes absent. Five hand-rolled layouts share a brain
but not a body — the user re-learns the page on every open.

**The model we adopt (Claude's IA, applied to our domain — and the ChatGPT/Claude habit users
already have):**
1. **The conversation is the universal center.** Every open — loose item, project item, the
   project itself — lands on the SAME page: a chat with the chief of staff.
2. **The supporting panel is the only thing that varies** — it says what this conversation is
   ANCHORED to, never reshapes the page.
3. **The project page is a launcher, not a chat** (ask-input on top, context at right, the
   project's work below) — but entering any piece of work is the one room again.

**The inversion:** today the artifact is the center and the chat is a rail. The one room flips it —
the CHAT is the center; the judged artifact MOUNTS in the work panel beside it (Claude-artifact
style). Scape's insight survives whole: the system still mounts the right component, prefilled;
it mounts it as the conversation's artifact, not as a page the chat decorates.

**The stream is component-bearing, not text-only (locked amendment).** A turn can CARRY a
component — the conversation is a rich stream (Claude renders tool cards, artifact previews, and
confirms inline; Scape mounts the decision and the suggested attachment in the flow). What decides
inline vs. side-panel is NOT the work type — it is the component's **interaction class**, encoded
ONCE in the registry (`surface: 'inline' | 'stage'`):
- **inline** — resolved in a glance/tap, renders inside a turn: the decision card, invite/forward
  previews, file accept/✕ chips, proposed-task Accept/Reject, the quoted ask, tool-progress chips,
  and ARTIFACT CARDS ("Draft ready — open · Send") with the commit line right on them.
- **stage** — worked IN, opens in the side panel FROM its inline card: the reply/chase composer
  (editing), a document under review, the full message thread. Hot-swaps on rework (J3).
The commit line may sit on both the inline card (one-tap approve) and the stage (approve after
editing) — same gate, same executor. Heterogeneity lives in the STREAM (each turn shows what its
moment needs); consistency lives in the constant anatomy. The side panel is therefore **the stage
when something is open, the context strip otherwise** — never a permanent component dock.

**THE ROOM IS A GROUP CHANNEL (locked model).** The mental model is a working channel anchored to
one body of work, whose other members are your staff. Participants: the user, the chief of staff
(the ANCHOR VOICE — narrates outside events, proposes moves, routes what the user says), and the
coworkers who touch the work (ATTRIBUTED CONTRIBUTORS — "Clara: drafted the reply, v2" with the
artifact card; Max's research lands as his turn + document card). Two disciplines keep it from
becoming theater:
1. **Every turn is an EVENT, never chatter.** A turn exists only when something real happened or
   is genuinely needed: prepared / delivered / sent / evaluator-flagged / blocked on an input only
   the user has (the awaiting-input ask). No simulated agent banter, no status theater — the
   say-less-than-you-know law applies to the room as it does to the briefing.
2. **One orchestrator.** The user talks to the room; `converse` interprets and routes. Coworkers
   report in and can be @-mentioned, but agents never negotiate with each other in front of the
   user. That is what keeps a multi-contributor room readable.
Rich coworker back-and-forth ("position this against their Q3 budget or the pilot scope?") is a
LATER depth — the durable stream is its container; we do not fake it with generated chatter first.
This model is also why the future "project channel in Slack" is cheap: the room IS that channel,
in-app first; durable turns are the projection source for outside delivery (Slack DM/email
report-backs) later.

**WHERE EVERYTHING SHOWS (the coherence test).** New source → recognized into a room. New
capability (tool, integration action, future MCP tool) → a registry row the judge/converse can
pick, shown as inline chips/cards in the stream. New act → a turn behind the same gate.
Proactivity = the ENGINE WRITES TURNS while the user is away (prepare narrations, report-backs,
send confirmations, evaluator flags — and, next arc, time-triggered nudges), and the Home
aggregates which rooms need you. If something ever needs a new page or a per-surface classifier
to exist, the model is broken.

---

## THE GROUNDING LAW (unchanged, now enforced by construction)

Surfaces MOUNT; they never infer. Every consequence flows from the existing single sources:
- **What the work is** → `judgeWork` (ONE cached verdict; registry-read components).
- **What's prepared** → `getPrepared` (the ONE pool reader; versions are ledger).
- **What the words do** → `converse` (the ONE conversation core; steer/rework/commands/delegate).
- **What this belongs to** → entity recognition (`recognizeItem` + `entity_links`).
- **Who could execute** → the roster (`loadRoster` via the judge's executor).

Adding a work type = a registry row + an artifact component. Adding an anchor type = one panel
variant. ZERO new pages, zero per-surface reasoning. That is "scalable the right way."

---

## THE ANATOMY (one page, always)

```
┌────────────────────────────────────────────┬───────────────────────────┐
│  ← back · {anchor name} · [Track]          │  THE STAGE / CONTEXT      │
│                                            │                           │
│  THE CONVERSATION (a rich stream)          │  STAGE (when open):       │
│                                            │   the workspace — reply/  │
│  CoS: "Jean-Marie is asking you to send    │   chase composer (draft + │
│   pricing for 7–8 seats." [ask quote]      │   attachment chip + Send),│
│  CoS: [Draft ready — Clara · open · Send]  │   document review, full   │
│  CoS: [decision card: 1/2/3, decline last] │   thread. Opened FROM an  │
│  you: "make it firmer on timeline"         │   inline card; hot-swaps  │
│  CoS: "Reworked — v2." [Draft v2 · Send]   │   on rework.              │
│  CoS: "Sent. Logged on Soboplac."          │  CONTEXT STRIP (else):    │
│  [ Ask, correct, or hand off…      📎 ➤ ]  │   per-anchor (below)      │
└────────────────────────────────────────────┴───────────────────────────┘
```

- **The conversation (center) — a component-bearing stream.** Durable (see R1), narrated by the
  brain: the opening turn is the anchor line (who · ask · what's prepared) composed from facts —
  the current rail's narration idiom, promoted to the page. Turns carry INLINE components per the
  registry's `surface` class (decision card, artifact cards with the commit line, invite/forward
  previews, accept/✕ chips, Accept/Reject proposals, quoted asks, report-backs); every mention is
  a live chip. ONE composer = `converse` — steer, correction (rework → new pool version), command,
  question, hand-off. The shared chat idiom (chat-sidebar visual language) — user bubbles right,
  plain narrator paragraphs left, typing dots.
- **The stage (side panel, when open).** The workspace class of the judged component, opened from
  its inline card and PREFILLED from the pool: `reply_composer` = message context + composer
  (draft + resolved attachment chip) + Send; `document` = DeliverableFocus; `chase` = the nudge
  composer; the full message thread (compact `ThreadMessages` — history folded, capped body,
  "Show full message"). The approve gate is unchanged wherever it renders (inline card or stage —
  same gate, same executor). A chat rework hot-swaps the staged artifact (J3).
- **The context strip (side panel, when nothing is staged; collapsible beneath the stage
  otherwise).** The ONLY thing that varies:
  - **Loose item** → source line (from/when), "connects to X · Track" or the founding chip,
    related work chips. Minimal.
  - **Project** → the compact strip: next move · tasks (+proposed Accept/Reject) · goals/rules ·
    schedule · files · activity. (Today's room disclosures, compacted into the strip.)
  - **Item in a project** → the SAME project strip, this item focused; sibling chips navigate
    within the room (the conversation persists — it's the deal's).
- **Narrow screens:** the work panel becomes a slide-over sheet; the conversation is the page.

**The project page (the launcher, NOT the room):** header (name · status · next move) → ask-input
(seeds the project's conversation) → the work list (tasks/board rows; opening one enters the one
room focused on it) → right panel: goals/rules · files · schedule · activity. Claude's project
page, in our domain. Entering the conversation or any work row → the one room.

**NOTHING IS LOST — the project's full inventory (locked guarantee).** The rebuild changes where
things render, never what the project holds. Every content type the entity room carries today has
a named home, each reachable in ≤2 taps, and the parity gate for this is explicit (R5):

| today (entity room)              | in the one-room model                                        |
|---|---|
| Tasks board (todo/waiting/done) + proposed Accept/Reject | the launcher's work list + the context strip's tasks section; proposals also surface as inline Accept/Reject turns |
| Next move + status brief         | the launcher header + the room conversation's opening narration |
| Conversations (email threads)    | work-list rows → the one room with the thread on the stage    |
| Meetings (notes, action items)   | work-list rows → the room (notes card staged; proposals inline) |
| Files & docs                     | the launcher right panel + context strip; chips in the stream; previews staged |
| Schedule / Gantt / Timeline      | launcher tabs (the existing entity-detail Gantt/Timeline, unchanged) |
| Activity / history               | the launcher right panel; sends and outcomes ALSO land as turns in the durable conversation (the room is its own history) |
| Goals / Rules (inline-editable)  | the launcher right panel + context strip (same editing)       |
| Status / category / rename / share | the launcher header menu (unchanged)                       |

---

## R1 — DURABLE CONVERSATIONS (the riskiest new piece, built first)

The rail's chat today is a module-level in-memory store (`_dealTurns`) — it evaporates on reload.
If chat is the center it must persist.

- **Table `room_turns`** (migration, apply manually): `id uuid pk`, `user_id`, `room_key text`
  (the entity id for deal rooms; `inbox:<id>` / `commitment:<id>` / `meeting:<id>` for loose
  anchors — same convention as `item_plans.entity_id`), `role text` ('user'|'system'),
  `text`, `refs jsonb` (chips), `component jsonb null` (a turn CAN carry an inline component —
  `{key: <registry key or inline-card type>, refId?, state?}` — so decision cards, artifact cards,
  and proposals are as durable as the words; the stream renderer resolves it against the
  registry), `author jsonb null` (attribution for coworker turns — `{kind:'coworker', id, name,
  role}`; null = the chief of staff for 'system' turns — the group-channel model needs turns to
  carry WHO), `dedupe_key text null` (the keyed-turn idiom — an upsert on
  `(user_id, room_key, dedupe_key)` replaces the prior turn, preserving `pushDealTurn` semantics),
  `created_at`. Owner-RLS. Index `(user_id, room_key, created_at)`.
- **Room key resolution = the entity link**: an item WITH an entity converses in the DEAL's room
  (today's behavior, kept — navigating between a deal's artifacts keeps one conversation); a loose
  item converses under its own key. When a loose item later joins a project, its old turns stay
  under the item key (honest history; no migration of words).
- **`pushDealTurn` → `pushRoomTurn`**: same signature + window event for live updates, now writing
  the table (fire-and-forget, non-fatal) with the in-memory store as the render cache. Send
  report-backs, prepare narrations, CTA continuations all ride it unchanged.
- **THE ENGINE NARRATES (server-side writers):** the ambient acts gain durable turns — the prepare
  pass ("Clara drafted the reply", authored), delegation report-backs (`report-back.ts` writes the
  room turn alongside the coworker thread), send/execute confirmations, evaluator flags, and
  awaiting-input asks. This is what makes proactivity VISIBLE: opening a room shows what happened
  since you left, as a colleague's thread that moved — not a silent badge. (Time-triggered nudges,
  next arc, reuse this exact channel.)
- **Retention/size**: load the last 50 turns; older on scroll. No AI anywhere in this slice.
- **Gates:** a turn survives reload (live); keyed dedupe still replaces (live); the deal's
  conversation is shared across its artifacts (live); loose item keys separate (structural).

## R2 — THE ROOM SHELL + ARTIFACT PLANE

- **`components/room/one-room.tsx`** — the ONE page: `<OneRoom anchor={{kind, id}}>` where kind ∈
  `email | commitment | followup | meeting | entity`. Renders: conversation (center, R1-backed) +
  work panel (artifact + context strip). Both existing doors route into it: `/item/[id]?kind=…`
  and the Projects lens' room open — the routes and deep-link/modal behavior DO NOT change.
- **The registry gains `surface: 'inline' | 'stage'`** per component row — the ONE place the
  interaction class lives (message_only→inline quote card · decision→inline · invite/forward→
  inline · send_file→stage w/ inline chip · reply_composer/chase→stage · document→stage). The
  judge is untouched — it still picks the component; the class only says WHERE it renders.
- **TWO render halves, ONE registry**: the **stream renderer** (inline components inside turns —
  DecisionCard, artifact cards with the commit line, invite/forward previews, accept/✕ chips,
  Accept/Reject proposals) and the **stage** (the workspace panel opened from an inline card —
  reply composer + prepared attachment chip + send path + steer re-seed, DeliverableFocus, nudge
  composer, the full thread, MotionChecklist inside its one composer). All prefilled from
  `getPrepared`; verdict from `/api/items/judge` (cached). The verdict-outranks-relevance seed
  guard and the composer-touched guard move with the composer.
- **The action bar** (Reply · Dismiss ▾ · Forward · Done) rides the work panel header — the
  palette's freedom preserved, one place.
- **Kill list (as each anchor migrates):** the bespoke bodies of `EmailDetail` /
  `CommitmentDetail` / `FollowUpDetail` / `MeetingDetail`, `DeepDiveShell`'s two-column layout,
  `ItemRail` as a separate component (its narration + composer + chips become the room's
  conversation), the entity room's focused-`ItemDetail` embed (the room IS the page now).
  The **Inbox mail client stays untouched** — it is the mail tool, not the execution surface.
- **Gates:** one page serves all five anchors (structural — no per-kind layout branches outside
  the artifact switch + context strip); the Scape order lives in the artifact (message card
  capped, history folded); approve gates unchanged (send/book/share fire the existing executors);
  parity matrix re-run (J5 gates ported).

## R3 — ANCHOR CONTEXT STRIPS + THE PROJECT LAUNCHER

- **Context strip variants** (`components/room/context-strip.tsx`): loose (source + track/found +
  related) · project (next move · tasks w/ Accept/Reject · goals/rules · schedule · files ·
  activity — compact, disclosure-style) · item-in-project (project strip, item focused, sibling
  nav). Data via the existing `buildRoomView` — no new reads.
- **The project launcher** (`components/room/project-page.tsx`, replaces the entity room's first
  paint): header + ask-input (seeds the room conversation and enters it) + work list + right
  panel. Status/category/rename/share menu preserved. The Gantt/Timeline stay as the entity
  detail's tabs, reachable from the launcher.
- **Gates:** tracked/untracked/loose parity (same room, only the strip differs — structural);
  the launcher's ask lands in the SAME durable conversation the room shows (live); board row →
  room focused → back keeps the conversation (live).

## R4 — PROJECTS: HUMAN-CREATED ONLY, BRAIN-PROPOSED MEMBERSHIP

Creation is human; recognition stays on and makes creation instant.

- **No auto-founded projects, no founding suggestion cards.** Kill the portfolio's "suggested
  project" founding surfaces. Creation paths that remain (all human): "New project" (portfolio),
  the founding chip on a loose item, `create_project` in chat, "Track" on a recognized-untracked
  entity (tracking IS creation of the visible project — the entity already exists).
- **Recognition keeps running underneath** (unchanged): every item links to its entity regardless
  of tracked status. Untracked entities stay INVISIBLE as projects (quiet "connects to X · Track"
  context only — the T4 boundary, now the only way the brain shows a grouping it hasn't been
  told to track).
- **Creation proposes members**: on create/track, the entity's existing links ARE the member
  proposal — "I've been seeing this: N emails, M meetings, K commitments look like they belong.
  Include them?" One confirm in the room conversation (accept-all or per-item). Powered by what
  recognition already stored — zero new AI.
- **Ongoing membership = the three tiers**: confident recognition auto-attaches (prepared);
  uncertain → a quiet suggestion row in the project strip (one-click, from
  `suggestProjectMembership`-class logic on entity evidence); manual attach/detach always wins
  and LOCKS (`entity_links.locked` / `via='user'` — already built).
- **Gates:** no code path creates a tracked entity without a user act (structural); create-from-
  item proposes the entity's existing members (live); a locked manual detach never re-attaches
  (existing reconcile gates re-run).

## R5 — POLISH + PARITY SWEEP

- Home rows (`ready`, "See Clara's work →") deep-link into the room with the artifact mounted —
  approve is the only remaining act (J4's promise, now on the one page).
- The full parity matrix as live gates on the ONE room (ports J5): loose / in-project / project /
  meeting (notes + Accept/Reject) / commitment-chase / deliverable-review / decision-only /
  schedule / multi-ask / honest-none — each row from real data across the four users, vacuous-pass
  named honestly.
- **The inventory gate (the NOTHING-IS-LOST table above, verified live per user):** every project
  content type — tasks, proposals, conversations, meetings, files/docs, schedule/Gantt/Timeline,
  activity, goals/rules, status controls — reachable from the launcher/room in ≤2 taps, asserted
  against a real tracked project for each user before any old surface is deleted.
- Real-names sweep; regression battery; `npm run build`.

---

## Order, doctrine, scope

**R1 → R2 → R3 → R4 → R5.** Durable conversation first (everything sits on it), then the shell,
then the variants, then the projecthood simplification. `scripts/smoke-one-room.ts` grows per
slice; the full battery (work-loop, work-surface, workbench, orchestrated-loop, tasks, room,
judged-room) re-runs every slice; smoke across all four users as we go.

Doctrine holds and tightens: one judgment with memory in view; registries make capability
additive; the conversation core is the only interpreter of words; structural floors before AI;
`none` always legal; the approve gate never weakens; every outcome re-enters the ledger. The UI
is a mount layer — if a surface needs to "figure something out," that logic belongs in the brain,
not the page.

**Not in scope (the next arcs — all made easier by this one):** inbound two-way (Slack/email
replies to coworkers), time-triggered proactivity (writes into the same room turns), rich
coworker back-and-forth/deliberation in the stream (the container exists first, the substance
grows into it), the Slack channel projection of a room, earned-autonomy gate movement,
team-shared entities, MCP tool onboarding (registry rows when it comes — zero surface work),
mobile apps. A durable, attributed conversation is the delivery channel every one of these needs.

**Risk honestly stated:** this is the third structural pass over the execution surface. It is the
first whose presentation MATCHES the one-brain architecture (one page mounting one brain) rather
than adding shape. Lock this spec before building; changes to the anatomy mid-build go through
this doc first.

---

## PROGRESS (July 25) — R1 CODE COMPLETE (smoke-one-room 7/8; live gates BLOCKED on the manual migration)

- **`supabase/migrations/20260725_room_turns.sql`** (⚠️ APPLY MANUALLY — the live gates and all
  durable-chat behavior wait on it): owner-RLS, keyed-dedupe partial index, `component` (the
  R2-ready inline-component payload) + `author` (coworker attribution) columns.
- **`lib/room/turns.ts`** — the ONE turns module: `writeRoomTurn` (dedupe replaces), `readRoomTurns`,
  `roomKeyForItem` (entity room when linked, `<kind>:<id>` loose fallback). Non-fatal by design —
  degrades to the in-memory store pre-migration.
- **`/api/room/turns`** GET/POST — the client API; the client can never set `author` (coworker
  attribution is server-path-only).
- **The rail persists + hydrates**: every conversational write goes through `addTurn`/`persistTurn`
  (fire-and-forget POST); mounts hydrate from GET (server story wins unless the local session is
  ahead); `pushDealTurn` writes durable rows; the room key uses the ONE convention. Author renders
  as a small avatar+name label on coworker turns.
- **THE ENGINE NARRATES**: `prepareOneItem` → `narratePrepare` (a successful ambient prepare writes
  an authored, `prep:`-deduped turn into the item's room); `runDelegation` writes the coworker's
  report-back as their authored turn in the room (`delegate:`-deduped) alongside the coworker
  thread. Zero AI in either.
- Fixture hardening while smoking across users: the orchestrated-loop O3 live fixture now skips
  automated senders (an idealista no-reply was correctly REFUSED by the T3 floor — the engine
  working, not a failure); smoke-room c2 updated to the new key convention. Battery green:
  judged-room 34/34 · work-loop 44/44 · work-surface 44/44 · workbench 39/39 · orchestrated-loop
  39/39 · tasks 72/72 · room 15/15 · build clean.
- **Migration APPLIED (user-confirmed) — R1 live gates 20/20 across users A, B, personal:**
  roundtrip survives reload, keyed dedupe replaces, coworker attribution survives, a linked item
  converses in its ENTITY's room, an unlinked one in its own loose room.

## PROGRESS (July 25, later) — R2 CORE SHIPPED (smoke-one-room 27/27)

- **THE INVERSION is live in both doors.** `DeepDiveShell`: the CONVERSATION is the center
  (flex-1); the work is the STAGE beside it (lg:w-[52%], min 460 / max 760). The entity room
  inverts identically (conversation `order-first`, artifact/launcher card `order-last`). Narrow
  screens keep the STAGE (the workspace you act on); the conversation returns at lg.
- **Registry carries the interaction class**: `surface: 'inline' | 'stage'` per component +
  `surfaceOf()` — decision/invite/forward/message_only inline; reply_composer/chase/document/
  send_file stage. Decided once, never per-surface.
- **The stream is component-bearing**: `ItemRail` gained `decision` (the shared DecisionCard
  INLINE in the conversation — steer-wired, decline last) and `artifact` (the staged workspace's
  inline handle: "Reply drafted — ready to review · by Clara · Open · Send" with the commit line
  ON the card — same `send()` gate as the stage). The stage keeps the decision only when no rail
  carries it (view loading / embedded in the entity room, whose own rail doesn't hold this item's
  verdict).
- **Loose items get the conversation** — `railView` no longer gated on an entity (the rail
  handles a null entity: item-anchored narration + founding chip); the room key falls back to
  `<kind>:<id>`.
- Battery green: one-room 27/27 · judged-room 34/34 · work-loop 44/44 · work-surface 44/44 ·
  workbench 39/39 · orchestrated-loop 39/39 · tasks 72/72 · room 15/15 · build clean · names sweep
  clean.
- **QUEUED (R2 polish → R3):** the narrow-screen stage sheet; extracting the shell to
  `components/room/` as the named OneRoom contract; R3 context strips + the project launcher;
  then R4 human-only projects.

## PROGRESS (July 25, cont.) — R2 POLISH + R3 SHIPPED (smoke-one-room 32/32)

- **THE ONE SHELL extracted** — `components/room/room-shell.tsx` `RoomShell({conversation, stage,
  full})`: BOTH doors (the deep-dive's `DeepDiveShell` and the project room) now mount the SAME
  component — the anatomy structurally cannot fork again. The room's modals ride inside its stage.
- **THE CONTEXT STRIP** — `components/room/context-strip.tsx`: per-anchor context made SPATIAL
  (collapsed at the stage's foot): the project door ("In <name>" / "Connects to <name> · N
  related"), sibling thread/meeting/commitment/file chips, and the founding affordance for loose
  items. Mounted on the email/followup/commitment stages; hidden when embedded (the room IS the
  project context).
- **The conversation slimmed to NARRATIVE** — the room index (chips) + founding UI moved OUT of
  the rail's stream into the strip; the rail keeps the opening narration, the gap, the next-move
  proposal, the inline decision/artifact cards, and the chat. Navigation is spatial, events are
  conversational — never repeated across planes.
- Gate updates that FOLLOWED the move (never weakened): judged-room J5 parity + work-surface T4
  now assert the strip ("Connects to"/founding chip) instead of the rail. Battery green:
  one-room 32/32 · judged-room 34/34 · work-loop 44/44 · work-surface 44/44 · workbench 39/39 ·
  orchestrated-loop 39/39 · tasks 72/72 · room 15/15 · build clean.
- **QUEUED:** R4 (projects human-created only + membership proposals) · R5 (parity + the
  NOTHING-IS-LOST inventory sweep) · narrow-screen stage sheet.

## PROGRESS (July 26) — R4 SHIPPED (smoke-one-room 37/37)

- **No ambient path tracks** (verified structurally): `tracked: true` is written ONLY by the three
  user-invoked paths — `POST /api/entities` (New project / founding chip), `PATCH action:'track'`,
  and the chat `create_project` tool. Recognition/reflection/hooks never set it (they already
  didn't — now gated so it stays true).
- **The portfolio pushes NO project suggestions.** The Suggested tier (SuggestRow / "Accept all" /
  "These look like your projects") is REMOVED; everything untracked — whatever its judged scope —
  folds quietly into "smaller things". The discovery path is the item's context strip
  ("Connects to X · Track"), never a container pushed at the user. Group-shaping moved to
  creation: the New-project modal's "+ Add work" picker (the ONE shared AddItemPicker).
- **Creation/tracking NARRATES the member proposal** — `lib/entities/founding.ts`
  `narrateFounding` (ONE module, three callers): on found/track, the entity's EXISTING links are
  counted (zero AI — recognition already stored them) and narrated as a durable keyed room turn:
  "Started X — I've been seeing this already: N emails, M tasks connect. They're in." /
  honest-zero when nothing connects. `POST /api/entities` returns the counts (`members`).
- **Live-proven** (personal account): founding an entity with 2 pre-existing links narrated
  "1 email, 1 task connect"; re-founding REPLACED the keyed turn (no stutter).
- The middle membership tier (uncertain → suggestion rows INSIDE a project's room) and manual
  lock (`via='user'`/locked) are UNCHANGED — the three tiers hold: confident auto-attach ·
  in-room suggestion · manual-and-locked.
- Three smoke-tasks gates asserting the removed SuggestRow internals were updated to the R4
  reality (shaping at creation; no suggestion expansion). Battery green: one-room 37/37 ·
  judged-room 34/34 · work-loop 44/44 · work-surface 44/44 · workbench 39/39 · orchestrated-loop
  39/39 · tasks 72/72 · room 15/15 · build clean.
- **QUEUED:** R5 (the parity matrix + the NOTHING-IS-LOST inventory sweep, live per user) ·
  narrow-screen stage sheet.

## PROGRESS (July 26) — R5 SHIPPED · THE ARC IS COMPLETE (smoke-one-room 52/52)

- **The inventory gate, live:** the launcher structurally renders every content section (Tasks ·
  Meetings · Schedule · Conversations · Files & docs · Activity disclosures + Goals/Rules +
  status controls — each one tap from first paint); against real data, user A's most-linked
  tracked project serves 5 links across 4 kinds + a 4-event ledger. Users B/C/personal are
  HONESTLY vacuous — they have no tracked projects yet, which is exactly R4's human-created-only
  model working (their untracked context: 56/76/5 entities waiting to be tracked from the strip).
- **The parity matrix, live per user (Rene resolved at runtime, never hardcoded):** matrix
  coverage counts named per user (untracked-context / chase / deliverables / open items); the
  one-conversation law verified on each user's REAL data (a linked item's room key === its
  deal's); Home rows deep-link into the room (`/item` hrefs from the spine, cached-verdict mount).
- Full battery green: one-room 52/52 · judged-room 34/34 · work-loop 44/44 · work-surface 44/44 ·
  workbench 39/39 · orchestrated-loop 39/39 · tasks 72/72 · room 15/15 · build clean · names sweep
  clean.
- **Remaining polish (not blocking):** the narrow-screen stage sheet (today: stage keeps the page
  below lg, conversation returns at lg); turn-component rendering from `room_turns.component`
  (the payload is stored and R2's inline components render live — historical component turns
  re-render as text+chips only); the project launcher's ask-input top placement (the room
  composer already serves it).

## PROGRESS (July 26, cont.) — THE LABEL FLIP SHIPPED (smoke-label-flip 15/15, unit table 17/17)

Kind × Posture — two orthogonal label dimensions, ONE resolver (`lib/inbox/rules/write-back.ts`):
- **KIND** (identity, stable): Receipt · Newsletter · Notification · Calendar · Cold outreach ·
  Customer · Team · Personal. `resolveKind` precedence: `source_data.kind_override` (user/rule
  correction) → reasoned `understanding.mailKind` → structural fallback (legacy rule taxonomy +
  bulk/noise headers) → null (no label — grounded-or-absent).
- **POSTURE** (lifecycle): Needs reply · To do · Waiting on → Done. `postureFor` — a label only
  while the thread needs the user; FYI/Notifications/Marketing/Meeting postures RETIRED as labels
  (identity is the kind's job; the reconciler still strips them from old threads). The reconciler
  swaps POSTURE only — kind labels are structurally untouchable (separate map).
- **`writeBackLabels`** applies the pair at all three write sites (sync fast-path, sync classified,
  label-sweep — the sweep is the completeness backstop with full source_data). Rules gained the
  `set_kind` override channel (typed; resolver honors `kind_override`; the AI batch-match stamping
  of it is DEFERRED — needs rule identity in the match payload).
- **Backfill widened** (`scripts/backfill-mail-kind.ts`): now also stamps items with NO
  understanding at all (fast-pathed mail — 268/300 of user A's pending backlog). Routing-inert by
  construction: `coerceUnderstanding` requires role+relevance, so a `{mailKind}`-only object never
  reaches routing; only the label resolver reads the raw field. Ran for user A: 120/120 stamped
  (74 newsletter · 31 notification · 10 cold outreach · 2 customer · 2 calendar · 1 receipt).
- **SIMULATED IMPACT (real data, three users):** identity gained where the old label was a fake
  FYI/Marketing/Notifications posture — A: 134, B: 85, C: 177 of 300 recent pending each; both
  dimensions on real correspondence: 19/38/53; needs_reply-but-bulk-kind conflicts the drafter
  gate now saves: 8/0/1. **Judgment probes:** a receipt and a newsletter judge NONE via the
  structural floor (zero AI); a customer ask judges reply/reply_composer. **Proactivity
  precision:** reply-classed items the kind gates from ambient drafting — A: 21/70 (30%),
  B: 5/105 (5%), C: 2/74 (3%) — junk-directed drafts that now never fire.
- Fixture hardening: the judged-room reply fixture now skips already-answered threads (the shared
  `computeThreadReplyState`, imported) — the floor firing on an answered thread is the engine
  being right. Battery green: label-flip 15/15 · one-room 52/52 · judged-room 34/34 · work-loop
  44/44 · work-surface 44/44 · workbench 39/39 · orchestrated-loop 39/39 · tasks 72/72 · room
  15/15 · build clean.
- **Deploy-gated remainder:** fresh mail gets kinds at sync only after dev→main→deploy; then run
  the widened backfill for all users + let the sweep re-label the backlog. Rules-UI field for
  `set_kind` + dropping the "AUGMTD/" prefix are later polish.

## PROGRESS (July 26, cont.) — THE PROMISE FIXES + THE PROMISE GATES (smoke-promise 22/22)

User-verified failures on real screens → seven fixes, then a NEW gate suite that asserts the
PRODUCT'S PROMISE (outcomes on real accounts), not plumbing. The lesson that created it:
mechanism gates passed while a password reset carried a drafted reply.

1. **The judge is the ONLY gate to preparation.** The spine fast-paths (kind='reply'→draft,
   waiting→nudge) BYPASSED the judge — the Zaask class. Deleted; every prepare branch flows
   through the cached verdict; the on-demand deep-dive draft route consults it too
   (`skipped:'judged_none'`).
2. **One obligation = one task.** The extractor REPHRASES, so no text floor can recognize a
   structurally-tied pair — a you_owe commitment tied to a live actionable row's thread now folds
   UNCONDITIONALLY (awaiting keeps floors). Load-bearing guard: `isVisibleObligationRow` (ONE
   shared predicate, fold + gate) — a commitment never folds behind an FYI row the user can't see.
3. **The surface never shows-then-retracts; a click always answers.** Composer starts CLOSED,
   verdict-first mount with a localStorage-cached verdict hydrating pre-paint; choosing a decision
   option lands the choice as a USER turn + the steer's answer as the response turn (both DecisionCard
   mounts).
4. **Correction is first-class.** The untracked "connects to X" chip gains ✕ (a LOCKED refusal —
   recognition honors it, live-proven); the picker gains "Start a new project…" (create+attach in
   one motion — the "this is actually EG Bank" flow); chat paths already existed.
5. **Registry hygiene + one project definition.** Recognition NEVER founds from noise (kind-aware
   via the ONE resolver — receipt/newsletter/notification/automated may join, never found);
   `scripts/archive-noise-entities.ts` archived 20 noise entities for user A (dry-run for others —
   Rene's one candidate touches a real client); Timeline lanes are TRACKED-only (the
   judged-untracked fallback deleted).
6. **Language mirrors the concrete text** (fresh body detection outranks a stale understanding —
   the English-ask-Portuguese-draft bug); **engine turns carry their item chip** (a shared deal
   room is never ambiguous — the "stale memory" read).
7. **`scripts/smoke-promise.ts`** — the standing outcome gates, per user (A/B/C/personal, Rene
   runtime-resolved): P1 zero drafts on noise (live scan) · P2 judge-only gate (+ a notification
   probe through the WHOLE engine → none) · P3 no duplicate obligation pairs (live, spine) · P4
   noise never founds (live probe, registry unchanged) · P5 one project definition · P6 label
   truth on 200 real rows/user (kind=identity, posture=lifecycle, RULES OUTRANK) · P7 corrections
   stick (locked refusal honored on re-recognition) · P8 no show-then-retract, clicks answer,
   turns carry chips, language mirrors. 22/22.

Fixture lessons (the gates followed the engine, never weakened): prepare fixtures must pick
JUDGE-approved reply items; a draft backdate MOVES the judge's cache sig (the pool includes the
draft) → re-judge after it; a spine-automated item refusing to draft is the floor working.
Battery: promise 22/22 · label-flip 15/15 · one-room 52/52 · judged-room 34/34 · work-loop 44/44 ·
work-surface 44/44 · workbench 39/39 · orchestrated-loop 39/39 · tasks 72/72 · room 15/15 · build
clean.

## PROGRESS (July 26, night) — THE SENSE FIXES: the judgment moves the posture (promise 42/42)

The experience audit (reading real items as the user would) found four systemic sense-failures.
All fixed IN THE BRAIN or its one consequence path — no surface heuristics:

1. **TIME IS IN THE JUDGMENT.** `judgeWork` carries TODAY + the item's last activity and returns a
   machine-actionable `resolution` disposition on none verdicts: 'expired' (the thing already
   happened — acting is pointless) / 'answered' (settled in the thread). The quality bar is gated
   BOTH ways live: a past-event ask → expired; an overdue unpaid invoice → still live work. The
   DAY rides the cache sig (a verdict is a function of now — at most one re-judgment/item/day).
2. **THE VERDICT MOVES THE POSTURE** — `lib/work/apply-verdict.ts`, ONE consequence module wired
   at the ambient pass AND the serving edge (/api/items/judge — read-time reconcile precedent):
   dispositioned none → resolve (logged, undoable, narrated with the item chip); prepared
   artifacts that CONTRADICT the verdict strip (a reply draft on a non-reply verdict, a nudge on
   a non-chase), with their narration turns retracted. Backlog sweep
   (`scripts/sweep-verdict-consequences.ts`, guarded): 19 moot/settled items resolved across the
   four accounts — incl. every screenshot offender (the 18-day-old bootcamp access ask, the
   confirmed-meeting "reply", the passed Thursday visit).
3. **PREPARED WORK IS A DELIVERABLE.** The evaluator gained the deliverable-shape rule
   (deliberation/meta-monologue is the author thinking, not the thing a colleague hands over — an
   honest one-line ask IS acceptable); `runDelegation` now runs the SAME evaluator with ONE capped
   retry — a still-failing output is NOT stored and the report-back states the problem honestly.
   Pool purge removed the pre-floor monologues + the self-addressed PT nudge.
4. **ONE LAW / ONE LANGUAGE EVERYWHERE.** The ownership notice law folded into the SPINE's no-move
   flag (deck and Timeline can never disagree — P12 leak-scan green on real accounts); the nudge
   generator gained the language mirror (`mirrorText` = the counterparty's own last words, both
   branches — kills the PT-nudge-to-English-counterparty class).

Plus the correction batch: membership changes RE-HOME the item's engine turns (the conversation
follows the correction), "Clear conversation" on the room (turns are narration, not memory — the
brain is untouched), a `membership-changed` broadcast so chip/rail/strip can never disagree, and
ambient delegations narrate WHY ("…Nothing goes out without you.").

Judge hardening from live flakes: the COMPONENT now DERIVES from the registry (strict 1:1 — the
model's component half produced real drift like chase/reply_composer); an awaiting commitment
carries the chase prior; probe personas are distinct (shared probe senders accumulate person-state
that contaminates judgments — a real find). JUDGE_VERSION → 4.

**Known-until-deploy:** prod's OLD draft-sweep cron re-drafts noise items into the shared DB every
~2h (P1 catches it; re-strip applied). The permanent fix is the dev→main→deploy step.
Battery: promise 42/42 · label-flip 15/15 · one-room 52/52 · judged-room 34/34 · work-loop 42/44→
(fixtures judge-gated) · work-surface 45/45 · workbench 39/39 · orchestrated-loop 39/39 · tasks
72/72 · room 15/15 · build clean.

## PROGRESS (July 27) — THE FIRST SYNC + USER-CREATED-ONLY EVERYWHERE + HISTORY (promise 50/50)

- **CREATION-TIME RECOGNITION → THE FOUNDING PROPOSAL (the "first sync" — in the room, never a
  popup).** The iScore lesson: creation adopted only on EXACT name match, so "iScore" founded an
  empty shell while the brain held "iScore AI Training Program". Now `proposeFoundingAdoptions`
  (lib/entities/founding.ts) runs deterministic name/alias token-subset recognition over existing
  entities (company-token guarded), counting members across BOTH memories (entity links + the
  label-era `initiative` strings — pre-backfill entities carry state with zero links); the
  proposal lands as a DURABLE confirmable turn (`founding-proposal` component payload → the rail's
  numbered idiom) and `/api/entities/adopt` confirms: THE ONE absorb mechanic + label-era members
  linked (never stolen from another entity) + the turn updates/deletes as options are taken. The
  New-project modal slimmed to name+description ("+ Add work" removed — seeding lives in the room
  + chat). Chat-drivable throughout.
- **USER-CREATED ONLY, EVERY SURFACE (locked harder than R4):** the portfolio renders TRACKED only
  (smaller-things fold REMOVED — untracked entities are invisible as projects everywhere;
  recognition keeps running; discovery = the item strip + the founding proposal); the deck's
  By-project groups only under tracked names (brief serves `trackedProjects`; label-era initiative
  strings fold to "No project"); Timeline item tags + lanes tracked-only (+ stale client cache
  keys bumped: aug-timeline-v3, aug-timeline-gantt-v2). `scripts/merge-duplicate-entities.ts`
  folds near-name untracked twins INTO tracked projects (aliases transfer → future recognition
  lands right); applied for user A's iScore shells.
- **CONVERSATION HISTORY (Claude-style):** migration `20260727c_room_turns_archived.sql`
  (⚠️ APPLY MANUALLY — pre-migration Clear degrades to delete, History lists empty). "Clear" =
  ARCHIVE (a session boundary, never a deletion); History ⌄ lists sessions (date · count · first
  line); selecting one is read-only with "Back to current"; the composer hides while viewing.
- **THE ONE GATE closed for real:** the legacy rule-based auto-draft loop in the draft-sweep CRON
  called `generateReplyDraft` directly (the "Emeritus reminder re-drafts itself" recurrence — NOT
  prod-skew; an ungated path in current code) — now judge-gated; the on-open commitment nudge
  route judge-gated too (chase only). Found+fixed: `entity_links` has NO `id` column (selects
  silently errored → zero counts). P10 heals-then-asserts via THE consequence module (a
  fixture-judged verdict was never SERVED).
- Gates: P13 (user-created-only on every surface) + P14 (founding proposes known work — live
  probe; durable confirmable turn; adoption mechanics; history) → **promise 50/50** · one-room
  52/52 · work-surface 45/45 · tasks 72/72 · full battery green · build clean. Five gates updated
  to the new design truth (Add-work/smaller-things assertions retired WITH the features).
- **Known-until-next-deploy:** prod still runs yesterday's cron (ungated legacy loop) — P1
  offenders regenerate every ~2h until this batch ships; stripped again locally.
