# THE WORK LOOP — visible, reliable, closed (July 2026)

**The decision this plan implements:** the proactive side must *work and be felt* before we add
capabilities (5D slice 2 — Google Docs write / Dropbox — is PAUSED behind this arc). The machinery
exists — Preparation Pass, coworker routing, report-backs, prepared tokens — but it is ambient,
invisible, and fails silently at the exact moment of contact (the next-move CTA). This arc makes
every task live in a legible loop:

```
identified → (preparing) → prepared — approve here → done / delegated → reported back
```

**Doctrine (unchanged, restated because every slice touches it):**
- Judgment is REASONED (the shape classifier); facts are structural (does a draft exist, who is the
  counterparty); narration composed deterministically FROM facts is plumbing and allowed.
- Approve-before-commit is never weakened — preparation never sends anything.
- Task owners are HUMANS. Work-state is about what the *system* has prepared, never an assignee.
- One source of truth: one routing brain, one preparation engine, one state derivation — no surface
  keeps a private copy.
- No new tables. Every state in this plan derives from facts that already persist
  (`item_deliverables`, `source_data.draft`, delegation attribution, report-backs).

---

## The diagnosed failures (July 24 screenshots, all reproduced in code)

1. **The CTA narrates a hope, twice.** `entity-room.tsx` `openHref` pushes a static line
   ("…if there's a draft it's below…") without checking whether a draft exists — and the board row
   it just focused ALREADY carries `prepared`/`preparedRef`, so the fact is sitting in client
   state unread. `pushDealTurn` (item-rail.tsx:58) appends blindly → re-clicks duplicate the line.
2. **The routing brain has regex twins.** `coworkerForMove` (item-rail.tsx) and an inline copy
   (entity-room.tsx ~515) suggest a coworker via keyword regex — "Prepare and send onboarding kit"
   matches nothing → no chip, dead end. Meanwhile the REASONED router already exists and is prod
   (`classifyTaskShapes` in lib/prepare/pass.ts). Two heuristic copies of a judgment the doctrine
   says must be reasoned, drifting from the one real brain.
3. **Preparation is cron-only and invisible.** `runPreparationPass` fires from `draft-sweep`
   every 2h. There is no "prepare this now", no "preparing…" state, no announcement when a draft
   lands. The user cannot cause or see the system working.
4. **"Waiting on Alex" — self-waiting.** The spine guards `blockedOn` against self
   (model.ts:357 `isSelf`) but the item's `state` stays `'waiting'` and `who` stays the user's own
   name; the room's TaskList groups waiting rows by raw `w.who` → "WAITING ON ALEX" where Alex IS
   the user. Structurally impossible; must heal at the spine, not the surface.
5. **The room ⋯ menu reads dead.** The four category options carry no section header and no
   current-selection indicator (the portfolio Row menu already highlights `e.category === c` — the
   room's copy drifted); "Share a status update" wraps to two lines.

---

## W1 — Structural heals first (trust, small)

**W1a · self-waiting flip (spine).** In `buildWorkItems`' ledger pass (model.ts, where `blockedOn`
is guarded): a `waiting` item whose `who` is the user themself is structurally YOUR task —
flip `state` to `'todo'`, clear `who`-as-counterparty semantics. (A fact-check, not judgment:
you cannot be blocked on yourself.) All surfaces heal at once — room, agenda, timeline, pass.
Also: the room's TaskList waiting groups key on the *guarded* `blockedOn` (carried on the slim
board row via the detail route), never raw `who` — one derivation, no surface-local guard.
Optional read-only sweep script to count surviving self-counterparty commitments across the 4 users
(extraction already has a backstop; this measures the legacy tail).

**W1b · ⋯ menu polish (room).** "Category" section header; active option gets the SAME
`e.category === c` highlight + check the portfolio Row menu uses; menu width bumped so
"Share a status update" is one line. Pure presentation.

## W2 — ONE reasoned router (kill the regex twins)

- Delete `coworkerForMove` (item-rail.tsx) and the inline copy (entity-room.tsx). The suggestion
  becomes a **served fact**: `/api/entities/[id]/detail` (and the room route) classify the next
  move + top open tasks through `classifyTaskShapes` → `SHAPE_TO_ROLE` and return
  `suggestedRole`/`suggestedWorker` per row + for the next move. One cheap classification call,
  **cached on the entity** (keyed by a sig of the classified titles — same sig-gating idiom as
  entity state) so repeat loads cost nothing.
- Client surfaces (room chip, rail chip) render what the server judged — no client-side matching
  of any kind. "No confident shape → no chip" stays (conservative), but now it's the judge being
  conservative, not a regex being blind.

## W3 — Truth at the commit line (grounded CTA + narration)

- `openHref`'s narration is COMPOSED FROM FACTS already on the focused board row:
  - draft/deliverable exists → "There's a draft ready below — send it as-is or tell me what to
    change." (and the focus opens with the draft visible)
  - nothing prepared → "Nothing's prepared here yet." + two real affordances rendered as tappable
    actions in the rail turn: **Draft it now** (→ W4's prepare-now) and, when W2 served a
    suggestion, **Hand to {Coworker}** (existing steer path).
  - meeting/task variants keep their lines but drop hedging they can't verify.
- `pushDealTurn` gains an optional `key`: pushing the same key twice replaces/skips instead of
  appending — re-clicking a CTA can never duplicate the conversation.
- Deterministic composition from structural facts = plumbing (doctrine-clean). The rail turn's
  action chips reuse the existing turn-rendering path (no new chat idiom).

## W4 — On-demand preparation ("Prepare this")

- Refactor `lib/prepare/pass.ts`: extract **`prepareOneItem(admin, userId, w, opts)`** from the
  pass's three loops (reply draft / nudge / coworker delegation by shape). `runPreparationPass`
  becomes a walker over the same function — cron and on-demand share ONE engine.
- `POST /api/items/prepare-now` `{kind, id}` → resolves the spine row → `prepareOneItem` inline
  (maxDuration sized for one draft or one delegation dispatch). Never sends; delegation keeps the
  prepare-and-hand-back guardrail.
- UI: the task row (and the CTA fallback from W3) get **Prepare** → in-flight "Preparing…" state
  on the row → on completion the prepared token appears and a grounded rail turn lands
  ("Drafted — it's on the task."). Failure states honest ("Couldn't prepare this — {reason}").

## W5 — Visible work-state (one derivation, all surfaces)

- One derived per-task field on the board/spine row: `work: 'none' | 'preparing' | 'prepared' |
  'delegated' | 'reported'`, computed server-side in ONE place (the board mapper the detail route
  uses; the agenda reads the same) from existing facts:
  - `prepared` — pool deliverable / `source_data.draft` exists (today's token, formalized)
  - `delegated` — hand-off attribution exists with no report-back yet
  - `reported` — the coworker's report-back/deliverable landed
  - `preparing` — client-transient only (W4 in-flight); never persisted
- Surfaces render the SAME vocabulary: room TaskList ("Sofia is on it" / "drafted" /
  "Sofia prepared this — view"), the Home deck rows, the agenda. No per-surface derivation,
  no new table, no assignee column — this is "what has the system done for this task", the human
  still owns it.
- Report-backs become visible where the work lives: a `reported` row's token opens the deliverable
  (existing preview modal), closing the loop in the room instead of only in the coworker's thread.

## W6 — Gates (`scripts/smoke-work-loop.ts`, added to the permanent suite)

- **Structural:** no `research|analy` routing regex anywhere in components/; `pushDealTurn`
  dedups by key; `prepareOneItem` is imported by BOTH the cron pass and the prepare-now route;
  TaskList groups by `blockedOn`; the spine flips self-waiting to todo; room menu highlights the
  active category.
- **Live (all four users):** zero waiting-on-self rows across every user's spine; a real reply
  item through prepare-now lands a draft (idempotent second call skips); `classifyTaskShapes`
  over each user's real next moves returns a role or an honest `other` (never throws, never a
  hallucinated role); a delegated item surfaces `delegated` then `reported` after report-back
  (fixture user); board `work` states match pool reality 1:1.

---

## Order & scope

`W1 → W2 → W3 → W4 → W5 → W6` (W6 grows alongside each slice, gate-per-slice).
W1 ships alone first (trust bug + polish, no dependencies). W3 depends on W2 (the fallback offer
needs the served suggestion). W4 depends on the pass refactor only. W5 formalizes what W3/W4
started rendering.

**Not in scope:** any new capability (5D slice 2/3 stay paused), migrations, kanban/assignee
anything, auto-send of any kind, inbound two-way (still the next arc after this one).

---

## STATUS (July 24) — W1–W5 SHIPPED, gates green

`scripts/smoke-work-loop.ts` **44/44** across all four users · `smoke-preparation` 6/6 (gate made
time-honest) · regression: `smoke-tasks` 72/72, `smoke-room` 15/15, `smoke-agenda-coherence` 22/22.
Delivered exactly as planned, plus:
- The router's live verdicts confirmed the design: "Prepare and send onboarding kit to Spartak" →
  Sofia (content_manager) — the exact case the deleted regex missed; human-only moves stay chip-less.
- W5 landed as the honest reduction: `runDelegation` is synchronous, so there is no durable
  "delegated-in-flight" state — the durable states are prepared(by whom)/none, "Preparing…" is
  client-transient (W4's in-flight row), and the room now derives prepared via THE ONE reader
  (`lib/prepare/read.ts` `preparedBadge`), closing the invisible-nudge gap.
- The routing cache rides `next_move` (`suggestedRole`+`roleSig`) — synthesis rewrites next_move
  wholesale, so a new move re-judges by construction.
