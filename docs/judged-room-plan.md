# THE JUDGED ROOM — the brain mounts the work; coworkers or you execute; one commit line (July 2026)

The W slice of docs/work-surface-plan.md, planned in full. The Home is closed; this arc is the
PROACTIVITY PAYOFF: work arrives prepared, the room opens ON the prepared thing, approving is the
only remaining act. The Scape patterns (message card + mounted work components + suggested
attachments + the numbered decision) are absorbed THROUGH our brain — never a type→component map.

**The grounding law (the user's one requirement, enforced everywhere):** every consequence flows
from THE ONE WORK JUDGMENT, and that judgment reasons only over what the BRAIN already holds — the
entity's state/ledger/next-move, the person brain, the understanding (relevance/ownership/mailKind),
the deliverable pool, and the roster. No surface infers anything locally; no second judge agrees by
luck. The verdict is cached ON the item (sig on activity) so the surface, the ambient pass, and the
narration all read the SAME decision.

**The loop this arc completes:**
judge → prepare (the pass, toward the judged component) → evaluate (the CoS reviewer) → present
(the mounted component, prefilled) → approve (the ONE gate) → deliver (send/book/share via existing
executors) → report (ledger + activity + report-back) → the brain re-synthesizes.

---

## J1 — THE ONE WORK JUDGMENT (`lib/work/judge.ts` `judgeWork`)

- **Input (all brain reads, assembled not re-derived):** the item's grounding (`buildItemContext` /
  the room-view), its entity's `state` + `next_move` + goals/rules, the counterparty's person state,
  the understanding (`relevance`, `ownership`, `mailKind`, `deadline`, `ask`), what's already in
  the pool (`getPrepared` — the judge must KNOW work exists), and the ROSTER (`loadRoster`).
- **Output (structured schema, classification tier, conservative):**
  `{ work: 'reply'|'decide'|'produce'|'send_file'|'schedule'|'chase'|'none',
     component: <a registry key>, executor: {kind:'coworker'|'user'|'system', id?},
     gate: 'send'|'book'|'share'|null, options?: [{label, act}...], reason }`.
  `none` is always legal (awareness → message card + chat, no fake work). `options` exist only for
  `decide` (the numbered card, decline always last).
- **Structural floor first:** a reply-state already answered → none; automated sender → never
  `reply`; ownership `none` + notice shape → none (the H4 law reused, not re-implemented — ONE
  helper). The AI judges only what structure can't.
- **Cache:** on the item (`item_plans`-style sig keyed to `last_activity_at` + pool sig +
  JUDGE_VERSION) — re-judged only when the thread or the pool moved. The room read costs zero AI on
  repeat loads.
- **Absorbs the router:** `suggestWorkerForMove`/`routeTasks` become the executor half of this
  verdict — the pass and the room stop asking two different judges. (routeTasks remains the
  internal engine; judgeWork is the ONE caller surfaces use.)
- **Gates:** structural — no type→component mapping anywhere; the verdict schema validates; H4's
  helper is imported, not duplicated. Live (4 users): a real needs-reply judges
  `reply/reply_composer` with an executor; a yes-no thread judges `decide` with ≥2 options +
  decline; an awareness notice judges `none`; the verdict is cached (second call, zero AI).

## J2 — THE COMPONENT REGISTRY (`lib/work/surface-registry.ts`) + the mounted plane

- **The registry (third registry invariant):** one row per component —
  `{ key, gate, feature }` with client mounts resolved in ONE switch inside the plane component
  (client components can't live in a lib registry; the switch is the render half, the registry is
  the contract the judge reads). Initial rows, ALL from existing parts:
  `message_only` (none) · `reply_composer` (ReplyEditor + the prepared draft) · `decision` (the
  numbered options card — generalizing the rail's O5 idiom into the plane) · `document`
  (DeliverableFocus) · `send_file` (composer + the resolver's attachment chip, accept/✕) ·
  `invite` (InvitePreviewCard) · `forward` (ForwardPreviewCard) · `chase` (nudge composer).
- **The plane (`components/work/work-surface.tsx`):** ONE component used by BOTH the room's
  focused view and the `/item` deep-dive:
  1. the RELEVANT message as a clean card (sender · to · body) with history COLLAPSED behind
     "show N earlier" (the full mail client stays in the Inbox — that's its job);
  2. beneath it, the judged component MOUNTS, PREFILLED from the pool (the prepared draft in the
     composer, the resolved file as the attachment chip, the invite ready);
  3. the commit line: ONE primary action named by the gate (Send · Book · Share), the approve gate
     unchanged. The G steps (one motion's checklist) render inside the composer context, not as
     siblings.
- **Multi-ask motion:** one commitment-with-steps mounts ONE composer whose checklist is the steps
  — never N surfaces for one motion.
- **Gates:** structural — one plane serves both doors; the mount switch is the only place
  components resolve; prefill comes from `getPrepared` (never regenerated on open). Live: the
  Spartak reply opens with the draft IN the composer; a doc-send case shows the attachment chip.

## J3 — CHAT-REWORK (closes B5): the conversation edits the mounted artifact

- A rail turn while a component is mounted carries the focus (`{component, refId}`) into the
  converse steer; the rework capability writes a NEW pool version (never mutates history) and the
  mounted component hot-swaps to it. Draft re-seed (`onDraft`) generalizes to every component that
  holds content (composer, document, chase).
- The evaluator reviews reworks like ambient work (same `evaluateDeliverable`, same annotations).
- **Gates:** live — "tighten the intro" on a mounted deliverable lands a new pool version, the old
  one retained; the composer re-seeds; the review verdict rides the new version.

## J4 — THE DELIVERY LOOP (proactivity's payoff)

- **"ready" opens ON the work:** a Home row's ready token deep-links so the plane mounts the
  judged component PREFILLED — approve is the only remaining act. (The judge ran at prepare time;
  the pass stores the verdict with the deliverable, so open-time is a read.)
- **The pass prepares TOWARD the judged component** — one verdict drives both: `prepareOneItem`
  reads the same `judgeWork` verdict (reply→draft, produce→delegate to the verdict's executor,
  send_file→resolve+draft, schedule→invite, chase→nudge). The ambient work and the surface can
  never disagree about what the item needs.
- **After approve:** the existing executors fire (send-reply / compose send / invite execute /
  coworker email); `resolved_at` stamps; the label reconciles; the LEDGER hears it; the entity
  re-synthesizes; the report-back lands in the room's conversation ("Sent — Jean-Marie has the
  pricing"), not just the coworker thread.
- **Gates:** live end-to-end on a fixture: prepare → ready → open (component prefilled, zero AI) →
  approve → the send fires through the existing gate → ledger + activity + state refresh carry it.

## J5 — THE SCENARIO MATRIX as parity gates (nothing forgotten)

One shell everywhere: conversation · artifact · context. The matrix each gate proves per user:

| scenario | context panel | plane behavior |
|---|---|---|
| tracked project | full panel (tasks/goals/schedule/status) | judged component per focused work |
| recognized, untracked | quiet "connects to X · Track" (T4) | same judged plane |
| loose item | none; founding chip | same judged plane |
| meeting | linked project's panel | notes card + Accept/Reject proposals (built) |
| commitment, no thread | its deal's panel | `chase` composer |
| coworker deliverable | its deal | `document` + J3 rework |
| decision-only | any | `decision` card, decline last |
| schedule | any | `invite` card |
| multi-ask motion | any | ONE composer + the steps checklist |
| nothing to do | any | `message_only` + chat (the honest none) |

- **Gates:** a live sweep instantiating each row from real data (vacuous-pass with the reason when
  a user has no instance); the shell renders identically minus the panel across
  tracked/untracked/loose (structural).

---

## Order, doctrine, scope

**J1 → J2 → J4 → J3 → J5** (the delivery loop before rework — proactivity is the point; rework
polishes it). `scripts/smoke-judged-room.ts` grows per slice + the full regression battery, all
four users, every slice.

Doctrine holds: one judgment with memory in view (never per-surface inference); registries make
capability additive; structural floors before AI; `none` always legal; the approve gate never
weakens; every outcome re-enters the ledger so the brain gets smarter from its own deliveries.

**Not in scope:** inbound two-way, 5D capability slices (they land later as registry rows +
roster tools the judge reads for free), multi-coworker rooms, mobile.

---

## PROGRESS (July 25, later) — J1–J5 ALL SHIPPED (smoke-judged-room 32/32)

- **J2 visual — the Scape order is live in the ONE plane** (`ItemDetail`, embedded by the room and
  the `/item` door alike). The deep-dive reads: action bar → **the message as ONE clean card**
  (`ThreadMessages compact` — ALL history behind "Show N earlier", the latest body height-capped
  with an overflow-gated "Show full message") → the judged work MOUNTED INLINE (DecisionCard /
  composer prefilled / invite / forward / PreparedLead) → one Send. **The bottom dock is gone** in
  both the email and follow-up deep-dives. The commitment deep-dive **mounts from THE verdict**
  (chase/reply → composer open with the judge's reason as the lead line; the old "Draft email →"
  button is just the toggle). Rail cleanup: a deal next-move that ECHOES the item's anchor ask is
  skipped (mechanical token-overlap dedup — plumbing, not judgment).
- **J3 — reworks are VERSIONS.** The converse correction path retains the prior draft as a pool row
  and lands the new body as the next version (`metadata.version_of` rows are ledger-only — the ONE
  reader skips them; `sd.draft` stays the serving pointer). Reworks run through the SAME
  `evaluateDeliverable` review as ambient work (annotation stored when not pass). The router prompt
  now names the draft-instruction route (it was falling into `open` → agent loop, silently skipping
  the rework path).
- **J5 — the parity matrix as gates.** Live: a scheduling ask judged `schedule/invite` organically.
  Structural: one plane both doors (the room embeds ItemDetail, no second thread renderer);
  tracked/untracked/loose same shell (project chrome vs "Around this" vs founding chip); meeting
  proposals gate through Accept/Reject; **multi-ask motion = ONE composer + the steps checklist**
  (`/api/items/view` serves the motion plan's steps for commitments; `MotionChecklist` ticks
  persist via the plan PATCH). Per-user coverage sweep reports which rows real data instantiates.
- Regression battery green: work-loop 44/44 · work-surface 44/44 · workbench 39/39 ·
  orchestrated-loop 39/39 · tasks 72/72 · room 15/15 · build clean.

### Follow-up hardening pass (same day — smoke-judged-room 34/34)
- **send_file mounts PREFILLED**: the resolver's file (on the prepared reply artifact) auto-attaches
  as the STANDARD composer chip via the same `/api/kb/attachment` path the KB picker uses — ✕
  removes it, a one-shot ref means removal sticks. A `send_file` verdict also OPENS the composer
  (the chip lives inside it).
- **work↔component coherence is STRUCTURAL** (`componentForWork` in the registry): the model picks
  the WORK; a drifted component half (a live `chase/message_only` was caught by the gates) is
  coerced from the registry — never left to luck. JUDGE_VERSION 1→2 (cached verdicts
  self-invalidate).
- **The verdict outranks the thread's raw relevance in the seed race**: the verdict is cached
  (fast) while the thread fetch is slow — without a guard the slower fetch overwrote the judged
  mount. `verdictSeededRef` makes the judgment the durable seed; the user's own toggle still wins.

## PRIOR PROGRESS (July 25) — J1 SHIPPED · J2 core SHIPPED · J4 core SHIPPED (smoke-judged-room 16/16)

- **J1 — `judgeWork` live.** The H4 law extracted to `lib/inbox/notice-demotion.ts` (ONE module,
  brief route + judge import it). Structural floors (answered thread, ownership-none notice) →
  none with zero AI; the one reasoned call reads deal state + person state + understanding + pool
  + roster and picks from the REGISTRY (`lib/work/surface-registry.ts`, 8 components + gateOf +
  JUDGE_VERSION); verdict cached on `item_plans` kind 'judgment' (sig = activity + pool + version).
  Live: user B's real item judged decide ORGANICALLY; the synthetic either-way ask → decide with
  2 options; an awaiting commitment → chase; verdicts cached identically on re-judge.
- **J2 core.** `GET /api/items/judge` serves the verdict; the email deep-dive MOUNTS from it —
  composer auto-opens only on `reply`, `none` leads with Dismiss, and `decide` mounts the shared
  `components/work/decision-card.tsx` (numbered routes, judge's reason as context, decline always
  last; choosing speaks through steer and a returned draft re-seeds the composer).
- **J4 core.** `prepareOneItem`'s routing tail now reads THE SAME judged verdict (send_file →
  docsend, chase → nudge, produce → the verdict's coworker, reply → draft) — ambient work and the
  surface can never disagree. A successful send REPORTS BACK into the deal's conversation
  (keyed `sent:` turn).
- **QUEUED:** J3 (chat-rework → new pool versions), J2 polish (message-card visual with collapsed
  history; invite/send_file/forward mounts surfaced from their prepared artifacts), J5 (the full
  parity matrix as live gates). Regression green: work-loop 44/44 · work-surface 44/44 ·
  workbench 39/39 · tasks 72/72 · orchestrated-loop 39/39.
