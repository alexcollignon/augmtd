# THE COMPONENT MAP (Sep 22, 2026 — inventory at `8f8d1f8`)

What renders a work object inside a conversation or work surface — what is LIVE, what exists only
in the dev preview (`/dev/thread-preview`), where one object wears several renderings, and the
direction agreed with the owner. Code-grounded (a read-only inventory, 262 tool reads); update it
when a kind goes live or a fork converges. Companion to `docs/roadmap.md`.

---

## 1 · THE THREAD KIT — twelve card kinds, seven live

The kit (`components/thread/*`) is presentational by construction: it fetches nothing, every deed is
a host callback, an action with no handler renders as plain text. Mounted by THREE hosts only:
`home-ask.tsx` (Home chat AND the live coworker DM), `item-rail.tsx` (item room AND project room),
and the dev harness. The triage deck, Home deck, workflows, meetings, inbox and documents surfaces
do not use the kit at all.

| Kind | Status | Where it is produced | Persists |
|---|---|---|---|
| `email` | **LIVE** — Home chat · DM · item room · project room | `components/home/email-card.tsx` (three lanes: item / coworker / standalone) | yes (`email_draft_card`) |
| `invite` | **LIVE** — Home chat · DM · item room (+6 stage seats) | `components/home/invite-card.tsx` | yes (`invite_card`) |
| `bulk` | **LIVE** — Home chat · held-quiet ledger | `components/home/bulk-deed-card.tsx` | pointer only (never a stale "pending") |
| `doc` | **LIVE** — Home chat · DM | `home-ask.tsx` + `lib/documents/doc-card.ts` | pointer → re-read |
| `deliverable` | **LIVE** — Home chat · item/project room | `home-ask.tsx`, `item-rail.tsx` | derived |
| `source` (the object card) | **LIVE, rooms only** | `components/room/source-object.tsx` → `item-rail.tsx` | derived at read |
| `custom` | LIVE, heavily (the wrapper the bespoke cards ride in) | all hosts | — |
| `approval` | **LIVE** (W3-A, Sep 22) — item/project room · commitment deep-dive | `components/home/approval-card.tsx` | derived (the run is the truth) |
| `input` | **LIVE** (W3-A, Sep 22) — item/project room ×3 seats · commitment deep-dive | `components/home/input-card.tsx` (engine ask · input station) | derived |
| `decision` | **LIVE** (W3-C, Sep 22) — item room · project room | `components/home/decision-card.tsx` (the judged multi-option decision) | derived at read |
| `forward` | **LIVE** (W3-C, Sep 22) — item room · the deep-dive's two forward seats | `components/home/forward-card.tsx` | derived (prepare re-reads) |
| `frame` | **LIVE** (W4-A, Sep 22) — Home chat · DM | `home-ask.tsx` composes THE ONE RENDERER (`components/frames/frame-card.tsx`) inside the kit card | pointer → re-read |
| `proposal` | **LIVE** (W4-A, Sep 22) — item room · project room | `item-rail.tsx` — THE ROOM'S MOVE, board-validated | derived at read |
| ~~`routine`~~ | **RETIRED** (W4-A, Sep 22) | — | — |

Every kind the kit owns is now CONSTRUCTED by at least one product file — the inverse of T37.1,
gated as smoke-threads **T38.1**. Avatar states `needs_you` and `blocked` still have no live
producer. (`approval` and `input` left the preview-only list on Sep 22 — W3-A, §2a below;
`decision` and `forward` with W3-C, §2b; `frame`, `proposal` and `routine` with W4-A, §2c.)

⚠️ `components/workers/tabs/worker-chat-tab.tsx` — the most complete kit port in the repo — is
UNREACHABLE (its routes are pure redirects). The live coworker DM is `home-ask.tsx`'s DM mode, which
renders prose as `AnimatedAnswer`: tool chips and KB citation chips are not reachable in the product
today. ~35 dead files (~4,000 lines) still carry live `fetch` handlers.

---

## 2 · ONE OBJECT, SEVERAL RENDERINGS (the convergence list, by how often users hit it)

1. ~~**The ask / input checklist**~~ — **CONVERGED (W3-A, Sep 22 — see §2a).** 4 copies → the kit
   `input` card through `components/home/input-card.tsx`.
2. ~~**The approval gate**~~ — **CONVERGED (W3-A, Sep 22 — see §2a).** 5 copies, 5 vocabularies →
   the kit `approval` card through `components/home/approval-card.tsx`, on ONE `GateOutcome`.
3. **The email thread / source excerpt** — kit `source` is canonical but reaches one surface;
   `ThreadMessages`, the triage card's own tail and `EmailListCard` each redraw a thread (two read
   the very same `GET /api/inbox/<id>/thread` door).
4. **`MeetingProposalCard` → kit `invite`** — near-total field parity.
5. ~~**The workflow draft card's ledger fork**~~ — **CONVERGED (W3-B, Sep 22).** The fork is deleted;
   `workflows-ledger.tsx` mounts the shared `WorkflowDraftCard` with `surface="ledger"`, so the ⧉
   subprocess and `case` wording, the receipt and the idempotence token reach that surface too. Both
   confirm doors (Confirm → active, Adjust in Studio → draft) build their body with one
   `buildConfirmBody`/`CONFIRM_FIELDS` allowlist — no `...draft` spread forwards model-invented keys
   to a write door, and a zero-AI gate proves the allowlist is a SUPERSET of everything
   `POST /api/workflows` reads (smoke-relay door 5; smoke-compute CS2/PA5 re-pointed off the dead
   `worker-chat-tab.tsx` onto the live mounts).
6. **Two live send doors for one email object** — `chat-artifact-panel.tsx` `EmailPreview` beside
   `EmailCard`.
7. ~~**`DecisionCard`**~~ — **CONVERGED (W3-C, Sep 22 — see §2b).** The hand-drawn
   `components/work/decision-card.tsx` is deleted; the kit `decision` kind renders it and
   `components/home/decision-card.tsx` owns the steer door (the deed was hand-copied in two
   callers). It gained an armed second step, a settled state and an honest error line.
8. ~~**`ForwardPreviewCard`**~~ — **CONVERGED (W3-C, Sep 22 — see §2b).** The kit `forward` kind
   behind `components/home/forward-card.tsx`; the prepared-forward artifact row now MOUNTS it
   instead of degrading to "Open →". Its local recipients editor (the fourth) and its own HTML
   thread rendering are gone — the shared people chips and the `source` card's one rendering.
9. **The bulk deed in the documents library** — re-derives the honest-subset law without the stored
   preview, the undo note or the posture tail.
10. Four hand-copies of the project picker; ~~a fourth recipients-chip editor~~ (died with item 8 —
    every people field now reaches the one typeahead through `components/home/people-chips`);
    three `GateChip`s with two prop shapes; two unrelated hooks both named `useLiveRefresh`.

---

## 2c · THE W4-A CONVERGENCE (Sep 22 — THE PREVIEW IS THE PRODUCT)

Owner: *"in dev/threads I'd like to have the up to date working components, if that means retiring
the sketches and including the actual ones and using them where they should be used, so be it."*

T37 proved the catalogue shows every kind the kit OWNS; it could not say whether the PRODUCT ever
builds one. The inverse gate (**T38.1**) was written first, and its initial red list was exactly the
three preview-only kinds: `routine`, `frame`, `proposal`.

| | before | after |
|---|---|---|
| **`routine`** | a sketch with no producer | **RETIRED** from the union, `THREAD_CARD_KINDS`, the switch and the catalogue. A standing responsibility is ALREADY rendered twice, honestly: its **standing-spec proposal card** (`lib/work/standing-spec.ts` → the rail's own card, the ONE Confirm) and the **`collection` card** (the list of them). A third drawing of one object was the fork this arc removes |
| **`frame`** | the kit card was a fixture; the product shipped a generic `deliverable` pointer whose only word for itself was "frame", with THE ONE RENDERER one click away in the side panel — plus a second hand-drawn inline render in the retired `chat-message.tsx` | the kit `frame` kind IS the rendering: `home-ask.tsx` mounts `components/frames/frame-card.tsx` as `preview`, so the living thing renders IN the thread. With a preview the kit adds NO second header (the renderer's own carries the title, the `live` word and the `✓ computed in code` provenance chip); without one it degrades to the handle idiom. The redundant chat-side render is deleted; the gallery, the `/frames/[id]` address, the version picker and Share (Current only) are untouched |
| **`proposal`** | THE ROOM'S MOVE was a bare `ThreadAction` in the pinned bubble's action row, with the object it was the deed for printed as a loose sentence one line above — the last room object with no kind of its own | the kit `proposal` kind, seated in the pinned opening. Every clause is preserved: the target is model-picked and CODE-VALIDATED against the board, an unvalidated move renders its WORDS with no door, the demoted move still speaks as the CoS's offer SENTENCE (never a button), the click ladder is unchanged, and THE MOVE still YIELDS to a rendered decision. It gained ONE DEED ONE OBJECT (the merged artifact rides IN the card) and a `busy` state |

**ONE SANDBOX, FOREVER.** The kit COMPOSES the frame renderer, it never draws one: `<iframe … sandbox>`
exists in exactly one file in the repo and `allow-same-origin` in no sandbox attribute anywhere
(T38.2, beside smoke-frames S1).

**THE OFFERS' SEAT STAYS EMPTY BY LAW.** `ProposalCard` carries `offers[{label, say}]` + `onSay`, and
the kit sends a chip's `say` and nothing else — but the room passes none (owner, Sep 14: *"I think I
had told you to remove the chips here too"*). The door is wired, the seat is deliberately empty; the
catalogue is where that state can be seen. Gates: T38.1–T38.5, with T3.3 · T3.4 · T6.4 · T6.5 ·
T22.10 · T22.11 · T22.14 · T24.9 · T29.4 · T37.1 re-pointed onto the new seats (never weakened —
T22.14 is strictly stronger: the rail now pushes ZERO action rows).

---

## 2b · THE W3-C CONVERGENCE (Sep 22 — the decision and the forward)

The last two interactive room objects with no kind of their own. Both followed the W3-A pattern
exactly: the kit renders, ONE host owns the door, and every state the old component could express
survives in the contract.

| | before | after |
|---|---|---|
| **the decision** | `components/work/decision-card.tsx` (kit-less), mounted by the rail; the steer fetch, its `{option, tradeoff, why}` contract and its fallback sentence hand-typed in BOTH `item-detail.tsx` and `entity-room.tsx` | kit kind `decision` + `components/home/decision-card.tsx`; the callers keep only `onChosen` (seat the word) and `onResolved` (apply the draft / narrate). `ReportedDecision` now carries `itemKind`/`itemId` — the lane the deed answers on, rather than a guess from the mount's surroundings |
| **the forward** | a local `ForwardPreviewCard` inside `item-detail.tsx` with a private `RecipientChips`, a `dangerouslySetInnerHTML` body, and an artifact row that said "Open →" | kit kind `forward` + `components/home/forward-card.tsx`; the shared `AttendeeChips`, the message folded into the `source` card through `SourceObjectMount`, and the artifact row mounting the card |

**WHAT THE KIT GAINED.** `AnswerableState` now covers THREE kinds (the decision is a question put
to the reader like the gate and the ask). The decision arms then confirms (the event card's
two-step — a decision spends real work downstream), settles in place with "Chosen: …", and a 409 is
a FACT, not a rollback. The forward's Send arms and confirms, carries no Send at all without a
recipient, and keeps only its receipt once spent.

**ONE VOCABULARY EACH**: `DECISION_WORDS` and `FORWARD_WORDS`, in their hosts. Doors unchanged:
`/api/items/steer` (the decision's own resolve door, with THE FORWARD-MOTION LAW's contract built
once) and `/api/items/prepare` → `/api/items/execute` (the commit door). Gates: smoke-threads T36
(13), with T6.12 · T24.9 · T32.7 · T35.1 re-pointed, plus J2 (smoke-judged-room), R2 · R11
(smoke-one-room) and TR2 · AK1 · SQ7 (smoke-compute / smoke-quality).

---

## 2a · THE W3-A CENSUS (Sep 22 — the inventory taken before the convergence)

Read at `8f8d1f8`, before any code moved. Two objects, eight live renderings, five state vocabularies.

### THE ASK / INPUT (two shapes wearing one word)

An "ask" is really TWO objects that the copies never distinguished by name:
**THE ENGINE ASK** (a `room_turns` component turn, `component.key = 'input_checklist'`, answered by
`/api/room/asks` `{action:'proceed'}` or by attaching/answering in the room) and
**THE INPUT STATION** (a parked workflow run's `input` step, answered by
`/api/workflows/runs/[id]/resume` `{input:{text|kbFileId|pin}}` and `…/supply-upload`).

| # | File:line | Shape | Doors it fires | State words |
|---|---|---|---|---|
| A1 | `components/home/item-rail.tsx:934` `checklistBlock` + `:970` `proceedChip` — mounted at THREE seats (`:1264` folded under the pinned brief · `:1315` a coworker's ask in the stream · `:1512` the lifted-ask bubble) | engine ask | `/api/room/asks` proceed (`proceedEngineAsk` `:982`) · the room's ingest funnel (`fileRef` → attach) · composer prefill ("Point me to it") · for a COWORKER's ask, a spoken `send(...)` utterance | `proceeded` boolean only — no vocabulary |
| A2 | `components/home/waiting-on-you.tsx:59–93` (the Home ambient "Needs your input" list) | engine ask | `/api/room/asks` proceed (its OWN fetch, `:48`) | `gone` set — no vocabulary |
| A3 | `components/home/item-detail.tsx:2985` `InputStationCard` | station | mounts the shared `InputSupplyForm` → resume `{input}` / `{approve:false}` / supply-upload | `sent: 'supplied' \| 'held'` + `settled` + `settledWord` |
| A4 | `components/workflows/process-drawer.tsx:552` (station in the numbered walk) and `:677` (the park the list can't name) | station | the same shared `InputSupplyForm` | `decided: 'approved' \| 'rejected' \| 'supplied'` |

Already shared: the LAW (`lib/room/go-ahead.ts` `askAllowsGoAhead`/`goAheadLabel`, A1+A2) and the
DEED (`components/workflows/input-supply-form.tsx`, A3+A4). Only the SHELL forks — four times.

#### THE TYPE-IT DOOR (W4-B, Sep 22 — the engine ask gains a third door)

Both of the engine ask's doors sent the reader hunting for a FILE (Attach · Point me to it), and
most of what an ask is missing is a FACT — a reference, an IBAN, an amount, an address. Owner:
*"banking details for example could just be typed if IBAN only? … typing short info easier than
finding attachment, but keeping options open."*

The doors moved ONTO THE ROW (`AskRowDoors` on `components/thread/ask-rows.tsx`, forwarded through
`InputCard.rowDoors`), because one ask can be missing two different KINDS of thing. **All three
doors are on every row, always**; only their ORDER moves, by the deterministic four-language word
table `askItemShape` in `lib/room/go-ahead.ts` (a `fact` leads with Type it, a `document` with
Attach). One new door — `POST /api/room/asks {action:'supply', label, text}`, fired only through
`lib/deeds/gate-doors.ts` `supplyAskText`, zero AI, **fail-closed on a label the ask does not
carry**. The typed fact stages as that requirement's HAVE under the ONE key (`lib/prepare/supply.ts`
`requireTaskId` — the `require:<label>` spelling that had been hand-written in three files), so
`artifactTruth`, the judge route's staged-count and the D3 re-open cannot tell a typed fact from a
file the resolver found. The ask settles through the ONE shared covers-aware `settleAsksForItem`,
and the work re-opens through the ONE `reopenAfterSupply` the rail's attach funnel now also calls.
A line already typed in the composer is OFFERED ("Use this as X ✓") and never consumed — THE
ASK-DIRECTION FLOOR in the other direction: our ask, their words, their click.
Gates: smoke-threads T39 (14), with T13.12 · T13.13 · T30.13 · T35.5 · T35.26 re-pointed (dated).

### THE APPROVAL GATE

| # | File:line | Surface | Doors | State words |
|---|---|---|---|---|
| G1 | `components/home/item-rail.tsx:1369–1409` | item/project room stream | `/api/workflows/runs/[id]/resume` `{approve}` (its own inline fetch ×2) | `decided: 'approved' \| 'rejected' \| undefined`; chips "✓ approved — delivering" / "held back" / "waiting on you" |
| G2 | `components/home/item-detail.tsx:3069–3230` `HandoffDecisionCard` | the commitment deep-dive (the handoff email's deep link) | resume `{approve}` + `/api/workflows/runs/[id]/comments` for the note + `GET /api/workflows/[id]/runs/[runId]` for receipts | `settled: 'approved' \| 'held'` + a separate `decided` boolean + `decidedWord` |
| G3 | `components/workflows/process-drawer.tsx:504–651` (the station card in the numbered walk) | the process drawer | resume via `decide()` `:308` | `status: 'done' \| 'waiting' \| 'upcoming'` × `decided: 'approved' \| 'rejected' \| 'supplied'` |
| G4 | `components/workflows/process-drawer.tsx:661–694` (the generic park card) | the same drawer — a SECOND copy in the SAME file, whose comment admits the two "are edited in lockstep" | the same `decide()` | the same |
| G5 | `app/(main)/dev/thread-preview/preview-client.tsx:367` | the harness | none (`noop`) | none |

Already shared by G3+G4 only: `GateStandingLine` / `GateAsk` / `GateObject` — all three PRIVATE to
`process-drawer.tsx`, so G1 and G2 redraw the standing line, the ask and the object by hand.
`GATE_WORDS` (`lib/workflows/process-state.ts:69`) is the one gate-KIND table and is read by G3/G4,
the ledger and the deep-dive — but NOT by G1/G2.

Not in this census: `components/inbox/meeting-proposal-card.tsx:25`'s `CardState`
(`idle|sending|sent|error`) is an INVITE send-receipt, a different object (map §2 item 4), and
`components/work/decision-card.tsx` is the judged multi-option DECISION (map §2 item 7) — neither
is a run gate. Both stay out.

### WHAT THE KIT COULD AND COULD NOT EXPRESS (before this wave)

`ApprovalCard` had: `title · preview · approve · open · reject`. It could NOT express: the gate-kind
word · the provenance line · a SETTLED/in-flight state (it only ever renders a live gate) · the
reject note · a markdown preview (its `preview` is `whitespace-pre-wrap` text, so the pilot's tables
would arrive as a wall) · the ran-N-of-M standing line · an honest error line · a receipts footer.

`InputCard` had: `ask · onAttach · onPaste · onPickFile · onProceed`. It could NOT express: the
CHECKLIST ROWS (the concrete missing items — the whole point of the engine ask) · the station's
paste|pin|attach supply form · the "already in this run" trail · a settled state · an error line.

Both were also stateless by construction — so "the next gate arms" (a fresh park at a LATER station
clearing the decision state, CLAUDE.md's Sep 1 pilot wave (a)) had nowhere to live.

### WHAT LANDED (the convergence)

ONE VOCABULARY: `GateOutcome` + `GATE_OUTCOME_WORDS` in `lib/workflows/process-state.ts`, beside
`GATE_WORDS`. `'held'`, the bare `decided` booleans and every hand-typed chip word are gone.
ONE DEED MODULE: `lib/deeds/gate-doors.ts` — `resumeRun` (every approve/reject/supply) and
`proceedAsk` (every go-ahead), the only client callers of those two routes.
ONE SHARED PIECE SET: `components/workflows/gate-pieces.tsx` — `GateStandingLine` · `GateAsk` ·
`GateObject` · `GateOutcomeChip` · `AskRows`, imported by the kit's hosts AND by the drawer.
TWO HOSTS: `components/home/approval-card.tsx` and `components/home/input-card.tsx`.

---

NOT convergence targets (genuinely bespoke): the popover primitive, `FiledDrawer`, `RoomShell`, the
recording recovery banner, the triage verb frame, `RunRecordDrawer`, the Activity undo, the library's
folder rail. A library page and a keyboarded deck are not threads — share DEED MODULES there, not
mounted kit cards.

---

## 3 · PROSE-ONLY TODAY — and how cheap a card is

Users ask these constantly and always get text. In 9 of 11 cases a fully typed row array — usually
with the `id`, often the `href` — is a local variable a few lines above the `.map().join('\n')` that
destroys it. Three structured-result precedents already ship (`find_file` → `ConverseTurn.files`,
`get_worker_document` → `{content, artifact}`, `buildKBContext` → `fileGroups`).

| The question | Tool | Typed rows already in hand |
|---|---|---|
| "what workflows do I have" | `list_tasks` | `{id, name, status, trigger{type,cron,label}, last_run_at, agent_id}` + owner names |
| "status of workflow X" | `get_task` | the whole config: steps, doors, inputs, fire limit, output |
| "find the document about X" | `search_knowledge_base` | `{fileId, filename, summary, similarity, topCitation, chunks}` |
| "what did I record last week" | `get_meeting_context` | `{id, title, start_time, duration, summary, action_items, attendees}` (`id` selected, never printed) |
| "what's on tomorrow" | `check_calendar` | `ScheduleWindow{tz, days[{dayStr, weekday, busy[]}]}` + free `slots` + freshness — a PURE renderer over a pure struct: the cheapest card in the repo |
| "what needs a reply" | `get_emails` | `{id, fromName, subject, snippet, createdAt, section}` |
| "what do I owe" | Home question path | `{id, description, counterparty, direction, due_date}` + href |
| "what did my coworker produce" | `find_team_work` / `list_worker_documents` | `{artifactId, title, type, taskName, threadId, age}` |
| "show me my projects" | **no chief tool exists** | portfolio route has `{id, name, state, next_move, priority}` |
| "who is X" | **no tool** | person entities `{name, state}`; the registry match discards the `id` it holds |

---

## 4 · VERBS PER OBJECT (what a card could offer today)

The commit door (`lib/work/commit-door.ts`) has exactly THREE live call sites: `/api/emails/send`,
`/api/invites/send`, `/api/items/execute`. Reversibility (`lib/activity/restore.ts`) covers eight
activity types; sends are never reversible. ⚠️ `work_parked` (Later) is called undoable in its route
header but is not in the restore map.

**CALENDAR EVENTS — precisely.** Provider write code EXISTS for: create/send invite, RSVP
(`lib/calendar/rsvp.ts` — accept / tentative / decline, Google + Graph), reschedule/update and
cancel/delete (`lib/calendar/invite-sender.ts`). Scopes already grant write access. But RSVP, update
and cancel are **UI-button-only**: no registry row, no chat tool, no activity log, no commit-door
claim — and the judge's verb space has only `schedule`, so it has no vocabulary for "respond to this
invite". **Do NOT exist anywhere**: propose a new time to an organizer · live free/busy
(`freebusy` / `findMeetingTimes` / `getSchedule`) — availability is read from the locally synced
table only.

Other gaps: cancel a single workflow run · rename a file or document · discard a draft server-side ·
any person verb · any chat verb for frames, meetings or postures · a chief `list_projects`.

---

## 5 · KNOWN LEAKS — model-facing text reaching the user

**The class** (`lib/converse/index.ts` ~1745): the command fast-path serves `dispatchCommand().say`
AS the user-visible answer and persists it, guarded only by an OPT-OUT set of four tool names
(`RAW_CONTEXT_READS`). Any new read tool leaks by default. Live instances: `list_tasks` (uuids + the
instruction line "Refer to tasks by NAME…" — shipped Sep 21, owner-found) · `get_task` (a full
internal pipeline dump: step ids, raw prompts, config JSON) · `run_task` / `set_tasks_status` /
name-resolution misses (raw Postgres errors; every task name dumped) · `run_compute` (model
instructions, env-var NAMES, tool names, raw stderr) · `read_action_history` (a model instruction +
internal event slugs).
**Second instance**: the AgentOS bridge's `summarizeToolResult` ships the first raw line of any
executor string as the tool chip, and persists it. The native DM loop hand-curates its summaries —
the two coworker lanes disagree over the same executors.
**Markers**: `===GATE_VERDICT===` can ship inside a delivered artifact when no draft body follows
the sentinel (`execute-step.ts` ~693); `[[artifact:…]]`-family markers are never stripped from the
model's own prose on the AgentOS bridge.

---

## 6 · THE DIRECTION (owner + orchestrator, Sep 21–22)

**THE PRESENTATION LAW — a tool result is DATA, never the answer.** Executors return
`{rows | object, modelText}`; the kit renders the structured half; the model writes at most the
framing sentence. `modelText` reaches a `role:'tool'` message and nowhere else. This kills the leak
class structurally (section 5) and is what makes every card below cheap (section 3). Gate: no
dispatch branch may return an executor's string as `say`; the opt-OUT set becomes opt-IN.

**ONE COLLECTION CARD, not N bespoke lists.** One kit kind — typed rows: name · status chip · one
meta line · a door · at most two row verbs. Row types land as registry rows + a row renderer:
workflows (Pause/Resume · Run now), documents (Open · Pin to this chat), recordings (Open notes ·
Ask about it), calendar days/events, projects, coworker deliverables, commitments. Works in Home
chat, DMs and rooms alike because it is a kit kind. Read-only where a verb makes no sense.

**THE EVENT CARD** — a single calendar event as an object card: when · who · where/join · conflict
fact · the verbs valid for ITS state. Requires lifting RSVP / reschedule / cancel into registry rows
with chat doors, activity logging and the commit door (section 4), and building the two verbs that
do not exist (propose-new-time, live free/busy) only if wanted.

**REASONED SELECTION, DETERMINISTIC RENDERING (the "gen UI" rule).** The model never generates UI.
CODE computes the verbs valid for this object in this state (pending invite → Accept · Decline ·
Propose another time; a conflict → Reschedule; tomorrow's meeting → Prep me). The model REASONS about
which ≤3 to lead with and fills their arguments; an invented verb renders nothing (the MOVE-ref
validation idiom). Code owns facts (times come from the day table / free-slot math). Irreversible
verbs pass the commit door and the user's click; reversible ones act with a receipt + undo; "Run now"
confirms (a run can spend money and send mail). The selection caches under a sig, so the same object
in the same state wears the same buttons on every load; AI failure falls back to the deterministic
default order.

**CONVERGENCE RIDES ALONG**: bring the five preview-only kinds to life by porting their hand-drawn
equivalents (section 2, items 1–2 first), so the preview stops promising more than the product.
— DONE (W4-A, Sep 22, §2c): the last three are live or retired, and **T38.1** is the standing
inverse gate that keeps it true (every kind the contract declares is built by a product file).

### Proposed wave order
0. **The leak fix** (section 5) — small, visible today: opt-IN presentation + the bridge summary.
1. **THE PRESENTATION LAW + the collection card** with three row types: workflows · documents ·
   recordings (+ `check_calendar`'s day view — the cheapest).
2. **The event card + calendar verbs as registry rows** (RSVP · reschedule · cancel through chat
   doors, logged, commit-door'd) + reasoned selection v1 on events.
3. **Converge `input` and `approval`** (8 hand-drawn copies → 2 kit kinds) — DONE (W3-A, §2a);
   then the workflow-draft fork (correctness); `DecisionCard` → a kit kind and forward as a card —
   DONE (W3-C, §2b); `frame` · `proposal` · `routine` — DONE (W4-A, §2c).
4. Retire the dead chains (~35 files) after reading `worker-chat-tab.tsx` for anything worth keeping.
