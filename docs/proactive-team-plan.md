# THE PROACTIVE TEAM — the judge gets hands, the asks get a life, the work arrives done (July 2026)

The arc after the Judged Room / One Room / Promise era. Those arcs built the SENIOR half — one
brain, one judgment, one consequence module, one room that narrates. This arc closes the gap the
July-28 audit named: **the judge's vocabulary is wider than the engine's hands.** The verdict can
say `schedule`, `forward`, `decide`, `produce` — the ambient pass can only draft replies, nudge,
narrowly doc-send, and delegate twice per sweep. Most judged work ends in "showing the message,"
so a strong brain reads as a basic product.

**The end state this arc points at:** work arrives finished, and the user's job is judgment. The
Home is prepared artifacts awaiting a decision + a batched ask + a narrated "while you were away."
The loop, completed: sense (every surface, one adapter each) → recognize (the entity brain) →
judge (one verdict, including *wait until*) → act (prepare / do / ask, full verb space, ONE commit
door) → learn (every correction logged). The user sits at exactly one point: the commit door.

**The grounding laws (non-negotiable, from the standing doctrine):**
1. **The judge stays the ONLY gate.** Nothing prepares, executes, or asks except downstream of a
   verdict. New abilities widen what a verdict can CAUSE, never bypass it.
2. **ONE registry.** `lib/work/surface-registry.ts` (components, JUDGE_VERSION) and
   `lib/home/capability-map.ts` (tools, PLAN_VERSION) merge into one capability registry. The
   judge derives from it, the pass dispatches from it, the UI mounts from it. Adding an ability =
   one row. Two registries was itself the bandaid.
3. **Everything feeds the brain.** Every action, correction, and outcome lands as ledger events /
   learning signals so `refreshEntityState` and the judge see it next pass. No surface-local state,
   no heuristic side-channels.
4. **Failure is a first-class disposition.** "Could not judge/prepare" is stored and surfaced
   distinctly from "nothing to do" — never a confident-looking fallback.
5. Existing laws hold everywhere: deliverable resolution before drafting, artifact truth, the
   evaluator floor, asks never block, precedence chains never ANDs, reasoned not keyword, promise
   gates assert outcomes on served accounts and are never weakened.

**Explicitly DEFERRED (decided July 28 — not fluff-cut by accident, cut on purpose):**
- Briefing-as-editor rework (the full curation-verdict architecture). Only the R3 decoupling ships now.
- Roster-as-data / vertical coworker packs — until a real vertical demand exists.
- Autonomy ladder (per-capability graduation) — needs R1's accept/edit/discard data to exist first.
  Building it today = graduating trust on zero evidence.
- Learning SYNTHESIS from corrections (voice/rules updates) — R1 collects the data now; the
  synthesis is its own arc.
- KB/Drive documents as work SOURCES (retrieval stays) — after W4 proves the adapter pattern earns.
- Outcome/ROI dashboards, cross-user shared rooms.

---

## W1 — THE MARRIAGE: one registry, every verb has hands

The verdict → full execution engine. The judged-room era built the principled gate; the
task-workflows era (S1–S5) built the rich execution surface (tools, `item_deliverables` pool,
file resolution, coworker steps, prepared-action cards). They never met. Join them.

- **Merge the registries.** One module (grow `lib/work/surface-registry.ts`; retire
  `lib/home/capability-map.ts` as a separate authority): each row =
  `{ work verb, component, gate, executor default, tool binding, irreversible, feature, surface }`.
  ONE version constant feeds the judge sig AND plan caches (JUDGE_VERSION absorbs PLAN_VERSION's
  job). The classifier-prompt derivation (`renderCapabilitySet`) reads the merged registry.
- **`prepareOneItem` becomes a registry dispatcher** (`lib/prepare/pass.ts`), not a four-branch
  switch. Verdict → registry row → prepare via the bound tool/coworker, through the SAME laws:
  `resolveRequirements` first, artifact truth on every drafter/producer, the CoS evaluator with
  the capped revision. New branches, all from EXISTING parts:
  - `schedule` → a prepared editable invite (`lib/tools/send-calendar-invite.ts` +
    `InvitePreviewCard`), gate `book`.
  - `forward` → a prepared forward (`lib/tools/forward-email.ts` + `ForwardPreviewCard`),
    literal-email-only recipients, gate `send`.
  - `produce`/`document` for a USER executor → routes through the deliverable pool exactly as the
    coworker path does; no more silent `{did:'none'}` fall-through (pass.ts:127).
  - `decide` → the options land as the decision card artifact (already mounted; the pass just
    stops skipping it).
- **Irreversible acts always stop at prepared-with-approval.** The prepare→execute gate is the
  pattern; W5 makes it the only door.
- **Gates (structural):** a parity smoke over the registry — every verb the judge can emit has a
  preparation path; a verb without one is a BUILD error, not a silent none. No type→component
  mapping outside the registry. **Live (probe host + real accounts):** a scheduling ask judges
  `schedule` and a real editable invite is prepared ambient; a "can you send this to X" judges
  `forward` with a prepared forward; a produce-for-user verdict yields a pool deliverable.

## W2 — THE HONEST SWEEP: budgeted throughput, one quality bar, visible failure

A team that quietly does eight small things per two hours feels absent. And an AI outage that
renders as "showing the message" is a lie the product tells.

- **Kill the legacy rule loop** in `app/api/cron/draft-sweep/route.ts` (:74-80) — the last door
  writing drafts with no evaluator, no artifact truth, no attribution. One path: the pass.
- **Budgeted sweep replaces fixed caps** (TOP_N 8 / 5 nudges / DELEGATE_CAP 2 / ~18 items):
  work the judged backlog ordered by entity `priority.weight` until a per-user time/token budget
  is spent. **Log what was left** (the no-silent-caps doctrine, applied to the product). The
  budget is the cost-governance surface — per-tier numbers, read from tenant config, joined to
  `ai_usage_events` reporting. No per-user parallelism heroics yet; just honest ordering + honest
  truncation.
- **Failure as a disposition.** `judgeWork` (judge.ts:248), `resolveRequirements`
  (requirements.ts:143), and the evaluator tail stop catch-all-ing to confident defaults: the
  cached verdict stores `ok | failed`; a `failed` item renders "not judged yet," never
  judged-none; the deck and the room read the same truth. Cache-WRITE failures log to the same
  channel (today they silently cause daily re-judging). Telemetry rides the existing
  `logAIUsage`-style non-fatal pattern.
- **Gates:** P-gate — "failed-to-judge is NEVER rendered as judged-none" (fixture: a forced AI
  error → the item shows unjudged, not resolved/none). Throughput assertion on the probe host
  (the sweep clears a seeded backlog in priority order and logs the remainder). Zero drafts
  bypass the evaluator (extend P11).

## W3 — ASKS WITH A LIFE: the team asks like a colleague

The entire "ask for necessary info, then do it" leg. Today an ask is one silent turn in a room
the user may never reopen.

- **Ask state on the checklist turn:** `asked_at` + `state: open | answered | superseded |
  proceeded | lapsed`. No timers-as-policy: the judge (already time-aware, already re-judging
  daily) sees open asks' AGE as a fact in its prompt and REASONS — re-raise, escalate to the
  deck, or propose proceed-with-gaps. Reasoned, never a cron heuristic.
- **One global "Waiting on you" surface:** a Home rail block + a deck entry when the judge
  escalates — fed by ONE query over open asks across all rooms. Asks stop being room-local.
- **"Go ahead with what's available" works on ENGINE asks** too (item-rail.tsx:562 currently
  gates on `t.author?.name` — coworker asks only). Same one-conversation-core route.
- **Fix the supersession inconsistency:** `requirements.ts:122`'s coworker-supersedes lookup must
  filter `archived_at` (pass.ts:292 already does) — an archived ask can never suppress or block
  anything. Falls out of the state model.
- **Gates (extend P17/P18):** an open ask is visible outside its room; an archived/lapsed ask
  never blocks or suppresses; proceed-with-gaps produces an honest partial deliverable through
  the existing work-with-what-you-have contract.

## W4 — DELIBERATE TIME: the `revisit` disposition + forward-looking intake

What flips the system from reactive to deliberate. A team's core skill is knowing when to come
back.

- **`revisit { after, reason }` joins the verdict schema** alongside `expired`/`answered` —
  judged, not a snooze button. A revisit-dispositioned item leaves the deck with its reason
  narrated as a turn, and re-enters the judged pool at its date (the sig already keys on the day;
  the pool assembly adds due-revisits). The reason↔work coherence rule extends to it.
- **Calendar-forward:** tomorrow/this-week meetings become judged items via an
  `itemFromCalendar`-style adapter (`lib/entities/sources.ts`) — the judge decides `produce`
  (prep brief) or none; the pass prepares the brief through W1's registry. `nextPrep`
  (brief route :769) graduates from schedule prose to prepared work.
- **Attachments as noticed work:** an inbound attachment (already text-extracted) carrying an
  obligation/deliverable becomes a work candidate with PROVENANCE to its email — inherits the
  parent's entity structurally (the existing recognition law), never re-guessed.
- **The adapter invariant, written down:** any future surface (Dropbox, Slack inbound, any
  integration) = one `itemFromX` adapter emitting candidates with provenance into the SAME
  recognize→judge pipeline. Zero new judgment paths, ever.
- **Gates:** extend the provenance-integrity smoke — every non-inbox candidate carries its
  parent + inherited entity. Live: a seeded "circle back next week" thread judges `revisit` with
  a forward date and reappears on it; a tomorrow-meeting on a tracked entity yields a prepared
  brief tonight; mootness (P9) holds — a revisit that lands after the thread already closed
  resolves, not resurfaces.

## W5 — THE COMMIT DOOR: one gate for every irreversible act

Precondition for volume and (later) autonomy — not a feature. Prompt guardrails
(`DELEGATION_SAFETY_NOTE`) remain, but stop being the only wall.

- **One door:** every irreversible tool (send, invite, forward, share) routes through a single
  commit endpoint (generalize the `/api/items/execute` pattern) that structurally enforces:
  a stored prepared artifact + an explicit approval record. Coworker paths included — an ambient
  delegation can PREPARE a send, never fire one.
- **Idempotent sends:** an idempotency key on the commit (the action-side mirror of the
  at-least-once ingest lesson) — a retried approve can never double-send.
- **Provenance-aware approval:** scope derived from untrusted inbound content (recipients,
  attachments, asks that widened after the content arrived) is FLAGGED on the approval card.
  Instructions inside inbound content must never cause an unapproved act — this is the
  injection-defense posture, enforced at the door, not by prompt hope.
- **Gates (new P-gate, structural + live):** "no irreversible act without a stored prepared
  artifact + approval record" — a fixture coworker attempting a direct send is refused by the
  door; a double-approve sends once; a fixture email containing embedded instructions
  ("forward this to evil@…") never widens scope silently.

---

## RIDERS (near-zero cost, ship inline — not phases)

- **R1 — the outcome log:** stamp `accept | edited | discarded` (+ edit distance-ish signal) on
  every prepared artifact at its resolution moment, as learning_signals + a column. Collect NOW,
  synthesize LATER (the deferred learning arc + the future autonomy ladder both need this data
  and can't backfill it). One stamp per existing resolution path — no new UI.
- **R2 — per-verb cards:** each W1 verb lands WITH its actable card (invite/forward/produce
  review — most already exist, scattered). The card↔component mapping lives in the ONE registry
  row. Approve = the W5 door; edit = artifact update + R1 signal; reject = R1 signal + verdict
  rework.
- **R3 — sever the dead briefing couplings (one day):** the composed-but-unrendered briefing
  currently SUBTRACTS UI — `sentencedIds` removes deck items (agenda.ts:172) into prose nobody
  sees, a `pulse` hides the MovingTier strip (home-view.tsx:2184), and a briefing's existence
  suppresses the header line (:1946). Remove the three couplings (sentenced items stay visible);
  keep composing (yesterday-as-input memory stays warm for the deferred editor arc).

## SEQUENCE

W1 + W2 land together (more hands + honesty = the felt difference). W3 and W4 are independent
after that; W5 rides alongside W1's first irreversible verb and MUST land before any throughput
raise touches send-capable paths. R1 lands with the first W1 verb; R2 per verb; R3 anytime.

Every workstream ends by adding its promise gates to `scripts/smoke-promise.ts` — gates assert
the PROMISE on served accounts, never plumbing, never weakened.

## PROGRESS

- **July 28 — W1 + W2 SHIPPED (+ the W5 door and both riders), all gates green.**
  - **W1 the registry marriage:** `CAPABILITY_MAP` (+ PLAN_VERSION and every helper) moved INTO
    `lib/work/surface-registry.ts`; `lib/home/capability-map.ts` is a re-export shim (zero importer
    churn). Each component row carries its `capability` binding; `WORK_VERBS` is the ONE verb list
    (judge imports it); `registryParity()` states the law mechanically. New verb **`forward`**
    (component `forward`, gate `send`) + a schedule-vs-reply rule in the judge prompt →
    **JUDGE_VERSION 8**. `prepareOneItem` dispatches the full verb space: `schedule` →
    `prepareInviteDraft` (grounded via `buildItemContext` + `prepareCalendarInvite`, stored
    `source_data.prepared_invite`, pool row for commitments), `forward` → `prepareForwardDraft`
    (literal-email-only recipients; the forwarded body is never duplicated into source_data),
    `produce` with no named coworker → the drafting assistant (never a silent none). Serving edges:
    `prepareAction` serves the AMBIENT stored artifact first (fresh <24h, unsent); the prepare route
    takes `actionType:'calendar_invite'`; the deep-dive mounts Review-invite/Review-forward from the
    VERDICT (not only plan steps). Artifact hygiene extended (a verdict change strips
    prepared_invite/prepared_forward).
  - **W2 the honest sweep:** the legacy rule loop in `draft-sweep` is DELETED (its auto_draft master
    gate moved into the pass, silencing only the ambient reply lane); `runPreparationPass` walks
    three lanes through ONE `prepareOneItem` call site in ENTITY-PRIORITY order under a per-user
    time budget (route sizes it from user count; `leftBehind` counted + logged + returned). The
    pass's second router (batch `routeTasks`) is retired — judgeWork carries the executor half; the
    chip's single-title `routeTasks` stays. **Failure honesty:** `WorkVerdict.failed` — an AI outage
    is marked, NEVER cached, never resolves/strips (apply-verdict guard), never prepares;
    `resolveRequirements` failure emits a nothing-is-staged truth block; the evaluator's outage path
    flags instead of silently passing.
  - **W5 the commit door:** `lib/work/commit-door.ts` (claim → fire → record; failure releases;
    duplicate returns the prior result) + `supabase/migrations/20260728_action_commits.sql`
    (ledger = the approval record; **APPLIED** — verified live) wired into `/api/items/execute`
    for invite + forward; ambient artifacts stamp `sent_at` on commit.
  - **R1 the outcome log:** `lib/prepare/outcome.ts` (`logPreparedOutcome` + `estimateEditShare`)
    wired at three doors — send-reply (accepted/edited + edit share), execute (invite/forward
    accepted/edited vs the prepared artifact), and the ONE inbox resolver (unsent prepared work →
    discarded). Collect-only, as planned.
  - **Gates:** smoke-promise **87/87** across user A/B/C + the probe host — new **P21** (registry
    parity + live: a send-me-the-invite ask judges `schedule` and ambient-prepares a grounded
    invite with only the evidenced attendee; a forward ask judges `forward` and prepares with only
    the literal address; nothing sends), **P22** (failure marked/never cached; live: a failed
    verdict pushed through apply-verdict moves nothing — draft survives), **P23** (door-only
    commits; live: two concurrent claims on one key admit exactly one). Sibling suites updated to
    the superseding laws (never weakened): orchestrated-loop 39/39 (O2→W1 one judge; O4→W2
    flag-not-silent-pass), work-loop 43/43, tasks 72/72 (+ the Probe-Errands fixture revives after
    the orphan sweep rightly archives it), projecthood 31/31 (three era-drift gates updated to P13
    law). `tsc --noEmit` clean.
  - ~~**Next:** W3 and W4~~ — shipped same day, below.

- **July 28 (later) — W3 + W4 SHIPPED, all gates green (promise 97/97).**
  - **W3 asks with a life:** ONE lifecycle stamp — `component.state.proceeded` on checklist turns.
    `/api/room/asks` = the GLOBAL ASK LEDGER (GET: every open live ask across rooms; POST proceed:
    stamps + writes the visible go-ahead turn + re-runs the one preparation engine in after()).
    The Home leads its ambient bar with **"Needs your input"** (`components/home/waiting-on-you.tsx`
    — the room's own checklist grammar, age, Open →, go-ahead). The rail's go-ahead now exists on
    ENGINE asks too (deterministic POST; the coworker path keeps the conversation core).
    `resolveRequirements` honors proceeded (reports it, never re-posts — the turn stays as the
    record); the pass's produce-user block lifts on proceeded; the delegation envelope carries the
    standing "do NOT ask again" instruction; the JUDGE sees the open ask as a fact (age + items —
    waiting-on-the-user is never mootness). Lapsed/escalation timers deliberately NOT built —
    visible aging on the global surface is the escalation; the judge reasons over ask age daily.
  - **W4 deliberate time:** `WorkVerdict.revisit {after, reason}` — none-only, structurally
    future-date-coerced; the deck demotes it as a plain none; **PARKED SERVE** re-serves the verdict
    without AI until its date (same non-day sig facts); on/after the date the prior anchor forces a
    fresh live re-judgment; apply-verdict NARRATES the set-aside (keyed turn, never resolves).
    Meeting-prep briefs now NARRATE into the deal room (a brief nobody is told about is a brief
    nobody reads); the Home prep card stays dead by prior design (briefs live in deal rooms).
    **Attachments-as-work-candidates DEFERRED with reasons** (see the deferred list): the common
    case violates P3 (the obligation lives in the email; a second candidate = a duplicate task);
    the adapter invariant stands for when a real attachment-only class shows up.
  - **TWO REAL TRUST BUGS found by the new gates and fixed structurally (JUDGE_VERSION 10):**
    (1) the for-Friday misfire — a weaker tier computed a FUTURE weekday as past and auto-dismissed
    live work → the STRUCTURAL TIME FLOOR (a today-or-later `understanding.deadline` strips an
    expired disposition; the brain's extracted date outranks model arithmetic); (2) the
    hallucinated-expiry class — "expired" on an UNDATED ask (the model even emitted expired while
    its own reason said "not expired") → **`expired_on` coherence law**: the model must NAME the
    stated date that passed; CODE does the arithmetic (parse + `< today`) or the disposition is
    rejected. Same doctrine as the component half: the model supplies judgment, the
    registry/calendar supply facts.
  - **Gates:** P24 (an ask is never room-local and never a dead end — the real resolution engine
    drives the lifecycle live: global discoverability → proceed lifts + truth keeps naming gaps →
    never re-posted) + P25 (revisit live: a stated reconnect-after date parks without resolving,
    narrated, holds on re-judgment; a due-today ask is never parked; a future-deadline ask can
    never judge expired). smoke-promise **97/97**; work-loop 43/43; orchestrated-loop 39/39;
    judged-room 34/34. NB: probe fixtures must use VALID understanding roles
    (`addressed|one_of_many|bystander` — `role:'primary'` silently nulls the whole understanding).

- **July 28 (evening) — W6 TRUST & QA SHIPPED, all gates green (promise 108/108).** Born from three
  live screenshots on the user's real account: a cross-client PDF staged as another deal's
  "Individual Report" (+ the same file staged THREE times on a second item), a coworker handing the
  principal his own truncated report, and a who-asks-whom inversion (deferred, see next arcs).
  - **THE STAGING LAW** (`lib/prepare/requirements.ts`): (1) PROVENANCE GATES CANDIDACY — auto-stage
    only the item's own pool material or a same-entity file; a global-KB/drive hit on a loose item
    is NEVER staged (it becomes a named "might be this — confirm" suggestion in the ask: Prepared →
    Suggested, applied to attachments); (2) EVIDENCE IS SHOWN AND CODE-CHECKED — the pick quotes the
    proving phrase, code verifies the quote exists in the candidate's own text (the expired_on
    pattern generalized); (3) ONE FILE, ONE LABEL — duplicate matches all reject; (4) 0.7 stage bar.
    `pickArtifacts` is the exported, testable decision layer; `verifyArtifactMatch` is the ONE
    evidence-quoting verifier at both doc-send doors (cross-entity rejected structurally). The pick
    now grounds in the item's OWN WORDS (email excerpt), not a 140-char title.
  - **Chip dedup** (`lib/prepare/read.ts`): identical artifacts collapse to one. **Truncation floor**
    (`lib/prepare/evaluate.ts`): a mid-sentence cutoff is caught mechanically (revise → the capped
    regeneration completes it; a coworker never hands over their own truncation).
  - **THE FAILED-PAYMENTS CLASS** (found by the re-run gates ON the real account): a Stripe
    `failed-payments+acct_…` dunning notice judged work=reply and drafted a letter to a robot —
    the localpart + "payment to X was unsuccessful" phrasing dodged BOTH automated-sender pattern
    lists. Fixed three-deep: patterns (+`payments`, +"was unsuccessful", both copies), the
    **SENDER FLOOR** in the judge (an automated sender can never judge reply/chase —
    **JUDGE_VERSION 11**), and the deck's judgedNoneIds demotion now respects the notice law
    (a you_owe action notice outranks a judged-none — the eb510b1 precedence chain extended).
  - **Cleanup**: `scripts/sweep-staged-provenance.ts` (guarded) removed 19 unlawful stagings across
    2 real accounts (incl. a stranger's research proposal staged as an "individual report").
  - **Gates**: P26 (the DECOY is never staged — the exact shipped bug as a permanent fixture;
    same-deal artifact stages WITH code-verified evidence; one-file-one-label; mechanical
    truncation catch; ZERO provenance violations on every live account — standing) + P2b (dunning
    never judges reply/chase; deck demotion respects the notice law). smoke-promise **108/108**;
    work-loop 43/43 · orchestrated-loop 39/39 · judged-room 34/34 · label-flip 20/20.
  - **QA doctrine locked**: every trust bug becomes a permanent decoy fixture; the probe host
    carries adversarial furniture; consequential picks quote evidence code can check; the real
    accounts get standing outcome scans (P26's per-user zero-violations gate is the template).

- **July 28 (night) — T-CLASS (the clock) + R-CLASS (the client map) SHIPPED, promise 116/116.**
  Born from two live screenshots: a "be at the meeting room at 12:30 PM tomorrow" item still on the
  plate at 20:34 the day OF (time frozen at write-time), and an "STC Bahrain" email filed under
  "Arcapita AI Assessment" (the same Emeritus partner people broker both engagements).
  - **T-class — THE BRAIN HAS A CLOCK** (`lib/utils/user-time.ts` — user tz from their own calendar,
    the brief's law shared): the judge reasons at the USER'S local day+hour (**JUDGE_VERSION 12**);
    same-day expiry needs a code-verified `expired_time` stated in the item's own text and already
    behind the user's clock (the counter-probe proved the law: the model tried to expire a
    future-time event and CODE rejected it); the judgment sig gains the event-boundary bit (re-judge
    the pass after the event, not at midnight); **THE DEIXIS LAW** — extraction resolves relative
    day-words to absolutes anchored to the SOURCE'S OWN date (prompt + the lexical-detect/reasoned-
    rewrite scrubber `resolveDeixisInDescriptions`; `receivedAt` threaded through sync); entity-state
    prose bans day-words + treats pre-today ledger events as past (STATE_PROMPT_VERSION 5) + its sig
    gains the passed-calendar-events count. Backfill `scripts/sweep-deictic-titles.ts` (ran for
    Alex: 9 titles fixed incl. the Galp one).
  - **R-class — THE BRAIN HAS A CLIENT MAP**: same people ≠ same deal (the channel-contact law).
    The recognition judge extracts `named_engagement`; the **NAMED-SUBJECT VETO** (code-side
    distinctive-token check against the entity's IDENTITY — name+aliases, deliberately NEVER its
    summary: an over-merged summary absorbs the intruder's own words and validates the very
    contamination) converts a people-matched attach into founding the named work. The **THREAD-DRIFT
    GUARD** applies the same law at the zero-AI structural door (deterministic fast path; one cheap
    read only when the item never mentions its inherited entity). Suggestion plausibility floor in
    `pickArtifacts` (a "maybe this?" must itself be plausible or stay silent). Repair
    `scripts/sweep-recognition-subjects.ts`; the live STC item now correctly founds "STC Bahrain"
    with the full veto reasoning in the link record.
  - **Gates**: P27 (past-time same-day expires · ahead-time never · deixis rewrite code-checked) +
    P28 (partner-people/different-client founds, same-client still attaches, distinctive-token
    unit) + pinned strings updated to the superseding laws. smoke-promise **116/116**; work-loop
    43/43 · orchestrated 39/39 · judged-room 34/34 · recognition-integrity 0/166 violations.
    Known pre-existing: one-brain-e2e 13/14 ("every connected user has memory" — two half-finished
    signups with no connections). ⚠️ Until this deploys, the PROD 2-hourly cron still stages under
    the old law — `sweep-staged-provenance.ts` re-cleans; P26's live scan holds it honest.

- **July 29 (morning) — THE ROOM'S GRAMMAR (UX arc, part 1) SHIPPED, promise 121/121.** Born from
  three live screenshots: a coworker bubble speaking about itself in the third person ("Max is
  on…"), a mid-word truncation glued to boilerplate, one artifact narrated twice with two Send
  buttons, and the drafted reply buried below a 34-message thread.
  - **THE ONE-NARRATOR LAW** (write-time, `RoomTurn.author` doc is the contract): narration is the
    chief of staff's voice — `author` ABSENT ("Clara drafted…", "Max is on…" are the narrator
    talking); a coworker's name/avatar appears ONLY on their own first-person speech (report-backs,
    asks — delegate.ts, unchanged). `narratePrepare` + meeting-prep narration fixed; 71 legacy
    authored-narration turns healed by key (`prep:%`), never by content-matching.
  - **THREE GRAMMARS, DERIVED STRUCTURALLY** (item-rail): user bubble · coworker bubble (system +
    author) · muted EVENT LINE (system, no author, no inline affordance — the Slack/Linear grammar:
    status visible, never shouting). Component turns (checklists, founding, decisions) keep their
    prominent renders (P17: conversation events WITH affordances). A `prep:*`/`meeting-prep:*`
    narration FOLDS entirely when its artifact card is on the rail (one artifact, one live element)
    — folding keys on the exposed `dedupe_key`, structural, never text-matching.
  - **ONE COMMIT LINE**: the rail's artifact card lost its Send — it POINTS (Open →) at the stage,
    whose composer holds the only commit (O5 applied to the rail; one-room R2 gate updated to the
    superseding law). **THE SCAPE ORDER on the stage**: the composer moved to directly beneath the
    message card (message → mounted work → commit) — prepared work is never below the fold.
  - **`clip()`** (lib/room/turns.ts): word-boundary truncation + ellipsis for all narration; turns
    read stably ordered (created_at, id) and expose `key`.
  - **Gates**: P29 (one-narrator write-sites · structural three-grammar + fold · one commit line ·
    Scape order · clip unit). promise **121/121**; judged-room 34/34 · one-room 52/52 · room 15/15 ·
    work-loop 43/43. NB the recurring pattern: P1/P26 keep getting re-poisoned by the DEPLOYED old
    cron between local sweeps (noise drafts stamped 19:27–20:49 Jul 28, AIR re-staged 00:24/02:22
    Jul 29) — **deploy is the only remaining fix for the live surface**.
  - Part 2 (queued): the pinned controls strip exploration + the CTA consolidation on the stage
    (single lead action from the verdict; resolve/dismiss demoted to one quiet row) — with the
    left/right reasoning, after this deploys.

- **July 29 (afternoon) — THE HOME ASK SECTION: TRIED AND USER-REJECTED (design law locked).**
  The W3 ledger surfaced as full-width cards above the deck; the user rejected it on sight, and
  they were right twice over: (1) **the Home is ONE curated deck** — a stacked ask section is a
  second competing work-list; (2) every ask's item already IS a deck row, so the section
  DUPLICATED obligations (the show-twice class P3 forbids). Reverted (892e3a8); P24 pins the
  rejected section out. **The approved direction: an ask is a STATE OF ITS DECK ROW** — a small
  "needs your input" chip on the affected row (ranking-aware), the checklist stays in the room;
  `/api/room/asks` + `WaitingOnYou` remain the data spine. Plus the observed systemic sibling:
  **artifact-level ask dedup** — three items missing the same presentation must yield ONE ask
  (the one-obligation law applied to asks). Both queued for part 2, to be built together.

- **NEXT ARCS (user-directed, July 28):**
  - **Who-asks-whom grounding** (from screenshot 3): quoted headers inside forwarded bodies invert
    the counterparty ("Madalena is asking you" when Isabel asked Madalena); ground ask-extraction
    on the latest real inbound sender, exclude quoted-header text, person-brain sanity check on
    direction. Slots into the understanding layer.
  - **The work-surface UX pass** — what lives in the LEFT (conversation) panel vs the RIGHT
    (stage); lean into inline components/selectors (the Claude/Scape idiom) wherever they fit, but
    ALWAYS placed by reasoning (the registry's `surface: inline|stage` is the seam — decided once
    per component, never per-surface). Do after the engine arcs settle.
  - **The roster arc** — from real cross-user work patterns, decide which coworkers (individual +
    vertical stacks), capabilities, tools, and integrations are needed to cover most of the work
    the judge sees. The outcome log (R1) + judged-verb distribution are the evidence base.
