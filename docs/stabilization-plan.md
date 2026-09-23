# THE STABILIZATION PROGRAM — the constitution (Sep 22, 2026)

**Why this program exists.** A full-day audit (code review of the last four commits, seven owner
screenshots, nine read-only investigations on live data, a market refresh, and four architecture
reviews) reached one verdict: **the vision and the domain design are right; the build underneath is
not yet stable, scalable, or enforced.** The proactive loop leaks at every stage
(notice → judge → prepare → show → act → learn), two security holes are critical, ~14 declared laws
are broken on live data while their suites are green, and nine context assemblers each re-derive
"the state of X" differently.

**THE STANDING SENTENCE: the product stays in sync with what the user actually did, across every
source, says one true thing per fact, and never acts or leaks without the human.**

**THE EVOLUTION CLAUSE.** No rewrite. Every change lands on an existing module (named below). The
organs that survive byte-identical: the entity registry, the commit door, the one production door,
the machine ladder (`deriveState`), the locked frame, the human-in-the-loop law.

**THE AGNOSTIC CLAUSE (inherited).** Mechanisms derive from the user's own corpus at runtime. A fix
that names one account's data is a repair script, never a law. No real names in code, prompts, or
docs.

---

## PART I — THE ROOT CAUSES (every symptom traces here)

| # | Root cause | Evidence (Sep 22) |
|---|---|---|
| R1 | **Many readers per object** | three definitions of "prepared" (`lib/room/grounding.ts:82` never reads the pool; `lib/prepare/read.ts` badge vs `getPrepared`); Home-ask builds its own world (`lib/home/ask.ts:157`) outside the judge; open-commitment status sets differ in three places; deck chip (`app/api/home/brief/route.ts:709`) vs room reader disagree |
| R2 | **Facts written in several homes** | commitment + inbox mirror (931 pending, 195 outliving settled commitments); entity `next_move` vs room-brief MOVE vs verdict; `person_state` beside person entities; coworker `memory_text` stores client facts in whoever heard them |
| R3 | **One-source settlement, cron-shaped reach** | settlement listens to same-thread replies only; 342/544 open you_owe commitments and 267/684 open actionable inbox items have later evidence the user acted (meeting held, email on another thread, transcript); judge reach 38% inbox / 16% commitments (`lib/cron/sweep-users.ts:21` silently capped at 1000 rows); serial per-user cron loops |
| R4 | **Version-constant caches + whole-blob rewrites** | 24 hand-bumped `*_VERSION` keys; judge sig omits `entity.sig`; `item_plans` = 36 kinds, no retention; `profiles.home_brief` rewritten by five racing writers |
| R5 | **Enforcement by prose and regex** | 0 unit tests; `smoke-threads` 609 gates with zero DB queries; ~20–32% of 258 normative laws gateless; heavy `after()` on routes with no `maxDuration`; laws break at SEAMS a single-file regex cannot see |

---

## PART II — THE INVARIANTS (the only laws that carry an outcome gate)

The Map Arc harvest found 462 law-like names (258 normative). Governance moves to three tiers:

**Tier 1 — INVARIANTS (≈14).** Each has an outcome census on data with a threshold (deck-truth is the
template) AND is walked in the browser per release.

1. **HUMAN IN THE LOOP** — no send/post/book without an explicit click; settlement (a state change)
   is logged + undoable; every tool-bearing lane that reads untrusted input cannot change task
   recipients, instructions, memory, or schedules without a confirm card.
2. **UNTRUSTED INPUT IS DATA** — inbound content is marked as data in every prompt; markers/cards are
   parsed only from our own tools' results.
3. **RENDER SAFETY** — no untrusted or model-authored HTML executes or fetches remote resources before
   an explicit user action.
4. **PRIVILEGE INTEGRITY** — no user can write a privilege column (`is_super_admin`, roles, company
   membership) through RLS.
5. **ONE READER PER OBJECT** — every surface reading the state of an item/commitment/project/run goes
   through its one reader.
6. **ONE FACT, ONE HOME** — no mirrored rows; derived views never persist as a second truth.
7. **EVIDENCE SETTLES** — a later deed by the user on any source (mail any thread, calendar, meeting,
   chat) is nominated against open work within one sync cycle.
8. **A CLAIM RENDERS** — nothing (chip, brief, narration) claims prepared work that no surface renders.
9. **EXACTLY-ONCE DEEDS** — every external side effect goes through the commit door; every state
   transition is a conditional claim; a correction is a new deed, never a swallowed duplicate.
10. **NO SILENT CAPS** — every full-listing read pages; every budgeted loop reports what it left behind.
11. **NO MUTATION AFTER PAINT + THE ADDRESS LAW** — the first paint is the truth; every thread owns a URL
    that survives refresh.
12. **TIER PRIVACY** — user content only reaches the tier's perimeter (existing gates).
13. **EXCERPT HONESTY** — enforced by structure (`packContext`), not by a site list.
14. **TIME TRUTH** — no served claim is false about time (past slots, expired windows, wrong year).

**Tier 2 — DOMAIN LAWS.** Must have at least a pure-function unit test.
**Tier 3 — LESSONS.** Recorded, no gate obligation.

Every new law must name the laws it collides with and its precedence before it enters the registry.
Known precedence calls to settle in W1.4: NO-MUTATION vs a late brief (→ compose before paint);
ONE CLAIM PER ROW vs OPEN ASK OUTRANKS STAGED SEND vs A CLAIM RENDERS; HUMAN-IN-THE-LOOP scope vs
auto-settle (→ settle is allowed, logged, undoable); EXCERPT HONESTY vs raw `.slice`; ADDRESS vs
FRESH FLOOR; COMMIT DOOR idempotency vs revisable answers.

---

## PART III — THE WAVES

Each wave: scope · file fence · model · acceptance. "Board" = `tsc` + unit tests + zero-AI suites;
"live" = the one live suite the wave touches, run by the orchestrator once per wave.

### PHASE 0 — STOP-SHIP (security + deed correctness). Target: days.

**W0.1 RENDER SAFETY** · Opus · fence: `components/inbox/thread-messages.tsx`,
`app/inbox/inbox-page-client.tsx`, `lib/prepare/email-card.ts`, `components/thread/thread-cards.tsx`
(email body only), `components/inbox/compose-panel.tsx`, `work-detail-inline.tsx`, `next.config.ts`.
- Inbound HTML renders in a sandboxed iframe (`srcdoc`, `sandbox` NEVER carries `allow-scripts`;
  `allow-same-origin` is permitted only because scripts are off, so the parent can auto-size — the
  gate forbids the pair; remote images load automatically — owner call, Sep 22).
- Model-authored draft HTML passes an allowlist sanitizer before any render or editor mount, and
  carries no remote resources (no remote `src`, no event handlers, no forms).
- CSP: drop retired hosts (together, fireworks); plan removal of `'unsafe-eval'`.
- Accept: fixture emails (inline handler, remote image, form, meta refresh) render inert — zero-AI
  gate + browser walk.

**W0.2 PRIVILEGE INTEGRITY** · Opus · fence: new migration + `scripts/smoke-privilege.ts`.
- Owner runs the live check first (SQL in PART V).
- Trigger (or column-level revoke) so `is_super_admin` (and any role/membership column found by the
  census) cannot be changed by `authenticated`; census every RLS UPDATE policy for privileged columns.
- Accept: an anon-key update attempt on the probe host is refused (live, cheap, no AI).

**W0.3 UNTRUSTED-INPUT LANES** · design Fable · build Opus · fence: `lib/work/agentos-bridge.ts`,
`lib/tools/worker-tasks.ts`, `app/api/internal/agentos/*`, `lib/converse/index.ts` (tool defs only),
`lib/tools/fetch-url.ts`, `rss-feed.ts`, `browser-fetch.ts`, cron/internal auth helpers.
- Marker/card parsing only for results of our own producing tools (allowlist by tool name).
- `update_task` recipient/destination changes, `delete_task`, `share_task`, `steer_standing_task`,
  `remember_fact` from tool-bearing lanes → a confirm card (prepared, never applied).
- SSRF: resolve DNS, reject private/link-local/IPv6-loopback/encoded IPs, manual redirects re-checked.
- Secrets fail closed (`CRON_SECRET`/`AGENTOS_SECRET` unset → 401).
- Accept: forged-marker fixture renders no card; injected "repoint the task" text yields a confirm
  card, not a change; SSRF fixture table refused.

**W0.4 DEED CORRECTNESS** · Opus · fence: `components/workflows/input-supply-form.tsx`,
`app/api/workflows/runs/[id]/resume/route.ts`, `app/api/events/[id]/deed/route.ts`,
`lib/calendar/event-writes.ts`, `components/home/event-card.tsx`, send routes
(`send-coworker-email`, `commitments/[id]/nudge`, `inbox/[id]/send-reply`, `compose/send`).
- Supply resolves (never rejects) the run; resume = conditional claim on `status='awaiting_approval'`.
- Event deed key includes the event's current response/start (a re-answer is a new deed); the note
  is delivered or not offered; Outlook recurrence targets the occurrence; reschedule preserves the
  attendee list/optional flags/all-day shape.
- Every send route claims through the commit door.
- Accept: double-click fixtures send once; supply resumes; accept→decline→accept lands.

**W0.5 TIME BUDGETS** · Sonnet · fence: every route with `after()` and no `maxDuration`;
`app/api/home/brief/route.ts` after-block ordering; `lib/home/anticipation.ts` claim ordering.
- `maxDuration` wherever `after()` does AI work; anticipation claims AFTER work; `home_brief` sub-keys
  written via one merge helper (jsonb_set RPC) — no whole-blob rewrites.
- Accept: source gate "no after()-AI without maxDuration"; race fixture preserves both keys.

**W0.6 OUTCOME QUARANTINE** · Sonnet · fence: `lib/prepare/outcome-facts.ts` consumers.
- Pause outcome-facts injection (flag) until the two-way ledger (W3.2) exists.
- Accept: judge/drafter prompts carry no outcome facts; sig unaffected.

**W0.7 TRANSPORT (ops)** · orchestrator + owner · AgentOS/compute/bot behind TLS (Caddy already on
the box), secrets rotated, `google-auth.json` and the example-file key removed from git + rotated.

### PHASE 1 — FOUNDATIONS (before any new feature arc)

**W1.1 THE TEST PYRAMID** · Sonnet · Vitest + unit tests for the pure law functions (`deriveState`,
`timesInText`/`dateStatedInText`/`localNow`, weekday floor incl. "may", `topMessageOf`,
`namesOverlap`, `normalizeTriggers`, `placeRubric`, `validateFrame`, `computeThreadReplyState`,
`clipForPrompt`). `npm test` zero-AI, runs every wave.

**W1.2 TOOLING** · Sonnet · `eslint.config.mjs` + ESLint CLI; `tsconfig` excludes `scratchpad/` and
`scripts/tmp-*`; `SMOKE_LIVE=0` switch; one `npm run board` (tsc + test + zero-AI suites).

**W1.3 SCHEMA TRUTH** · Opus · migration runner (Supabase CLI or a `schema_migrations` table) +
generated DB types; reconcile the three pending manual migrations. Owner applies to prod.

**W1.4 THE LAWS REGISTRY** · Fable · `docs/laws-registry.md` + `.json` from the Sep 22 draft; the three
tiers; precedence table; gate kind (source/pure/outcome/walk) + cost class per gate;
`scripts/smoke-laws.ts` meta-gate (registry↔suite both directions; Tier-1 fails on source-only gates).

**W1.5 DOCS** · Sonnet · CLAUDE.md slimmed to < 15 KB (commands · architecture index · law index ·
pointers); arc history → `docs/history/`; one `docs/ARCHITECTURE.md` module map; superseded plan docs
marked archived; roadmap updated to point here; memory index corrected (tiers, roles, retired pieces).

**W1.6 SHARED PRIMITIVES + NO SILENT CAPS** · Sonnet · `lib/core/` (email address · automated senders ·
role labels · open statuses) with a "no local definition" gate; delete the duplicate `useLiveRefresh`;
page every full listing (`sweep-users`, `entities/people`, commitments sweep, brief commitments,
AI-operations metrics, status board) through `fetchAllRows`.

### PHASE 2 — ONE TRUTH

**W2.1 ONE PREPARED READER** · Fable core + Opus conform · `lib/prepare/read.ts` gains
`preparedState(item)` (source_data + pool, kind-true: commitment invites are `invite`, stale/past
artifacts excluded); consumed by `lib/room/grounding.ts`, the deck chip, the machine, the room, Home-ask;
commitment rooms mount their artifacts (`item-detail.tsx` CommitmentDetail rail) incl. the invite card
from the pool row; `readAmbientArtifact` covers commitments; the `prep:` anchor key unified.

**W2.2 ONE USER GROUNDING** · Fable · `assembleUserGrounding` (user-scope twin of
`assembleRoomGrounding`, judged rows only) replaces the ask world block, `renderWorldContext`, and the
brief-context duplication.

**W2.3 RETIRE THE MIRRORS** · Fable design + Opus · commitments stop writing inbox mirrors; the deck,
spine, and judge read commitments directly; guarded repair sweep archives the 931 mirrors (dry-run
default, owner applies).

**W2.4 THE MEMORY LADDER API** · Fable · `fileFact(fact, {scope})` → project (via recognition) · user
(`intake-memory` merge) · coworker-method; `extractAgentMemory` routes through it; `worker_instructions`
splits into `method` + `feedback[]` (feedback never truncates the method); memory caps keep the head.

**W2.5 DEPENDENCY-KEYED CACHES** · Opus · one `sigOf({version, deps})` helper + one `VERSIONS`
registry; the judge's sig includes `entity.sig`; source gate: every AI cache carries a version.

**W2.6 TYPED STORES + DEMOLITION** · Opus · `lib/store/item-plans.ts` (kind union + zod per kind +
retention/pruner); `home_brief` sub-blobs → keyed rows; demolish `person_state` writes,
`initiative-clusters`, the string-matched initiative in `renderBrainContext`.

**W2.7 THE CONTEXT BUDGET** · Opus · `packContext(sections, budget)` beside `clip-for-prompt.ts`;
assemblers migrate off raw `.slice`; the excerpt-law gate becomes "no raw slice in an assembler".

### PHASE 3 — THE HEARTBEAT

**W3.1 EVIDENCE SETTLES** · Fable core + Opus · `lib/work/evidence-nominator.ts` — zero-AI, bounded,
subscribed at email sync (any thread), calendar sync, transcript arrival, chat deeds, plus the sweeps;
evidence rides the judge/fulfillment as facts AND the sig; fulfillment takes multiple candidates; a
held/booked meeting counts as `delivered` for scheduling-type obligations; settle through the existing
consequence modules (`resolved_reason: 'evidence:<type>'`, stamped at the evidence's own time,
activity-logged, undoable); `unclear`/failure changes nothing.

**W3.2 THE TWO-WAY OUTCOME LEDGER** · Opus · log accepted/edited at every send door (incl. the stage
send), external replies and evidence-settles as "done elsewhere"; then un-pause LAW 7 with balanced
classes and the min-N floor.

**W3.3 REACH** · Opus · per-user fan-out through the kick route (no serial 300s loops); commitments
enter the prep pass; proof-of-life re-queues kept-alive items to prep; anticipation bounded (no
long-overdue fires), records its outcome, retries.

**W3.4 EXTRACTION TRUTH** · Opus · stated windows → `due_date`; the user never their own counterparty;
CC-bystander obligations; meeting-insights today-anchor; duplicate collapse; free-slot proposals honor
the stated window and never propose the past; `[commit:<uuid>]` refs stripped.

**W3.5 THE ROOM'S FIRST PAINT** · Fable design + Opus · the composed brief is available at first paint
(compose on the server path with last-good fallback); a single fallback voice; the MOVE yields to any
mounted card; the header speaks one claim; pinned lines one tone (threads clause 5).

**W3.6 DECK CARDS WITH CONTEXT** · Opus · commitment rows carry the source object (thread or meeting),
the verdict's reason, and the prepared artifact; the raw ask as title; one receipt; avatar never from
the title.

**W3.7 ROOM SPEED** · Sonnet · `items/view` parallelized, duplicate `getPrepared` removed, hover
prefetch, stale-while-revalidate paint, one thread fetch, turns keyed once; memoized card pointers.

### PHASE 4 — CONFORMANCE, SCALE, THEN INNOVATION

**W4.1 SURFACE CONFORMANCE** · Opus · address law (chats keep a real URL); bespoke Send surfaces fold
into the one email card; legacy chat panels onto `ThreadTimeline`; spinners → avatar status; composed
DM greeting; composer IME/a11y.
**W4.2 AGENTOS PARITY** · Opus · Python tool schemas generated from the TS registry + contract test;
scripted box redeploy.
**W4.3 SCALE** · Sonnet · cron fan-out everywhere, label-sweep wall-clock guard, retention jobs
(`ai_usage_events`, `item_plans`, `learning_signals`), status-board index.
**W4.4 AGNOSTIC + LOCALE** · Sonnet · client strings to config; locale coverage plan for the
deterministic floors beyond EN/PT/DE/FR.
**W4.5 INNOVATION (spec-first, only on a green board)** · anticipation chains; a learned notification
budget; the injection floor remainder + the trust page (claim only what is tested); MCP consume →
expose (read-only brain) → govern (external agents through the commit door).

---

## PART IV — THE OPERATING PROTOCOL

**Roles.** The orchestrator (Opus 5.5, this session) owns plan, briefs, file fences, every diff review,
the board, live suites once per wave, browser walks, and the owner report. Implementers never commit.

**Model routing.**
| Model | Use for |
|---|---|
| Fable 5.1 | cross-seam cores and design calls (W0.3 design, W1.4, W2.1–W2.4, W3.1, W3.5) |
| Opus 5.5 | surgical implementation against a written brief |
| Sonnet 5 | mechanical consolidation, tests, tooling, docs, perf plumbing |
| Haiku 4.5 | read-only censuses, grep verification, fixture tables |

**The brief (every agent gets all of these).** Goal · the invariant/law it serves · file fence (may
touch / may read / must not touch) · the design in bullet form · acceptance gates · cost rule (zero-AI
suites + the one live suite the change touches; no full live board) · data rule (no prod writes;
repair scripts dry-run by default) · report format (diff summary, gates run with output, open risks).

**Parallelism.** At most three implementers at once, on disjoint fences. Hot shared files
(`item-detail.tsx`, `item-rail.tsx`, `home-view.tsx`, `home-ask.tsx`, `lib/converse/index.ts`,
`app/api/home/brief/route.ts`) are owned by one agent at a time. Risky refactors run in a worktree.

**The loop (per wave).** brief → implement → orchestrator reads the full diff → board → targeted live
suite → browser walk if a surface changed → fix-back to the same agent → wave report to the owner →
**owner validates and says commit** → the orchestrator commits (≤ ~30 files per commit where possible).

**Owner-gated, always.** commits and pushes · prod migrations · `--apply` on repair sweeps ·
deploys and box redeploys · any change to live client workflows.

**Cost.** Zero-AI by default; live suites once per wave; a stated estimate before any live run over
~€5.

---

## PART V — OWNER CALLS

**Decided (Sep 22):**
- Inbound email remote images LOAD AUTOMATICALLY (owner call). Render safety still holds: inbound HTML
  never executes script and never shares our origin. Model-authored HTML (drafts) carries no remote
  resources at all — that channel is ours to close.
- Confirm cards: YES for task recipient/destination, delete/share task, standing-task instructions and
  remembered facts arriving from any tool-bearing lane.
- Scope + cadence: run the WHOLE program; everything stays UNCOMMITTED until the owner validates.
- Start: Phase 0 immediately.

**Still open:**

1. Run the privilege check in the Supabase SQL editor:
   ```sql
   select grantee, privilege_type from information_schema.column_privileges
    where table_schema='public' and table_name='profiles' and column_name='is_super_admin';
   select tgname from pg_trigger where tgrelid='public.profiles'::regclass and not tgisinternal;
   ```
2. Walk account + browser automation on the local dev server.
3. Direction approval for retiring the commitment mirrors (W2.3) — built behind a dry-run sweep either way.
4. Live-AI spend ceiling per wave.
5. Prod-side steps (always owner-run): migrations, `--apply` sweeps, deploys, box redeploys, secret rotation.

---

## PART VI — PROGRESS (Sep 22–23, all UNCOMMITTED on dev, awaiting the owner's walk + word)

Every wave below was built by a fenced implementer, diff-reviewed by the orchestrator, and left
`npm run board` green (typecheck · Vitest unit tests · every zero-AI suite · smoke-threads 733/733).

| Wave | Delivered | Gate |
|---|---|---|
| W0.1 | inbound mail in a scripts-off sandboxed srcdoc iframe; ONE draft/signature sanitizer at every sink; CSP drops retired hosts | smoke-render-safety |
| W0.2 | trigger guarding `profiles.is_super_admin` + `company_id` (service role / no-JWT sessions only) | smoke-privilege |
| W0.3a | markers parse only from their producing tools; `safe-fetch` (DNS-pinned, redirect re-check) for fetch/rss/browser; secrets fail closed (`hasBearer`) | smoke-untrusted-input |
| W0.3b/c | CONFIRM CARDS: task recipient/delete/share/run, standing instructions, remembered facts, Slack posts — prepared, applied only through `/api/changes/[id]/apply` (exactly-once) | smoke-confirm-cards |
| W0.4 | supply resumes (never rejects); resume = conditional claim; event deed key carries current state; reschedule patches time only; Outlook series guard; notes only where delivered; every send route through the commit door; stale-claim release | smoke-deeds-exactly-once |
| W0.5 | `maxDuration` on every after()-AI route; anticipation claims after work; atomic `home_brief` merge (RPC + fallback) | smoke-time-budgets |
| W0.6 | outcome facts quarantined (flag off) | smoke-outcome-quarantine |
| W1.1/1.2 | Vitest + unit tests on the pure law functions; ESLint flat config; `npm run board` | tests/unit |
| W1.4 | `docs/laws-registry.{json,md}` — 3 tiers, precedence table, admission rule; `smoke-laws` meta-gate | smoke-laws |
| W1.5 | CLAUDE.md 222 KB → 8.5 KB; `docs/ARCHITECTURE.md`; `docs/README.md`; arc history archived | — |
| W1.6/1.6b | `lib/core/*` primitives; ~25 silent caps paged or bounded-explicit; tool-executor clips declared | smoke-core-primitives, smoke-excerpt-law |
| W2.1 | ONE prepared reader (`preparedState`) — commitment invites/nudges render, expired never "ready", anchor keys unified | smoke-prepared-reader |
| W2.2 | ONE user grounding — chat reads the deck's judged inventory | smoke-user-grounding |
| W2.3 | commitment inbox MIRRORS retired (no writer, one exclusion, dry-run archive repair) | smoke-mirrors-retired |
| W2.4 | memory ladder: `fileFact` one writer; client facts → project, never the coworker; method never truncated | smoke-memory-ladder |
| W2.5 | `sigOf` + versions registry; the judge sees LATER EVIDENCE + entity sig | smoke-sigs |
| W2.7 | `packContext`; prompt assemblers declare every cut (calendar slots / KB files survive) | smoke-excerpt-law |
| W3.1 | EVIDENCE SETTLES — nominator over sent mail (any thread), calendar, transcripts → fulfillment judge → undoable settle | smoke-evidence-settles |
| W3.2 | two-way outcome ledger (accepted/edited/discarded/done_elsewhere/expired/superseded); flag stays off until `outcomeLedgerReady` | smoke-outcome-ledger |
| W3.3 | per-user sweep fan-out; commitment prep lane; proof-of-life re-queue; anticipation window | smoke-reach-fanout |
| W3.4a | meeting today-anchor; stated windows → due_date; self-as-counterparty; CC-seat tightened; duplicates; "may"; deed refs stripped | smoke-extraction-truth |
| W3.5 | composed brief at first paint (else last-good + APPEND); MOVE yields to any card; sole-artifact binding; moot asks by code; one tone | smoke-room-first-paint |
| W3.6 | deck cards carry founding context, reason, project, prepared kind; one receipt; no title-letter avatar | smoke-deck-context |
| W3.7 | briefs warmed before the click (deck + hover), paint budget 1.2 s, ~6 round trips, one thread/turns fetch | smoke-room-speed |
| W4.1a/b | address law (`?chat=` survives refresh); one Send on the deck; working face not spinners; composed-not-templated DM greeting; three legacy chat panels on the kit | smoke-surface-conformance |
| W4.2 | AgentOS parity contract + `scripts/deploy-agentos.sh` (dry-run default); tasks-route feature gate | smoke-agentos-parity |
| W4.3 | label-sweep/sync-calendar guards; retention cron (double-gated dry-run); usage index | smoke-scale |
| W4.4 | client strings → config; real names scrubbed from comments; `docs/locale-coverage.md` | smoke-agnostic |
| W5a | TRUTH OF PREPARED CONTENT (owner walk Sep 23): a proposed slot never behind the clock nor outside the item's STATED WINDOW (the pass confines the calendar fallback to the ONE window parser; `proposedFrom` provenance — the card says "inside what they stated" only when code verified it); prepared words never claim an undone deed (`lib/prepare/truth.ts` floor at THE ONE READER → `falseClaim`/`outsideWindow` never live, never `ready`; the evaluator + the paste-pack producer refuse; drafters carry the rule); the room grounding board carries each item's LATER EVIDENCE (ROOM_BRIEF_VERSION 15); dry-run sweeps `sweep-invite-windows.ts` (census: 13 stored invites, 4 outside window, 4 past) + `sweep-false-completion-claims.ts` (542 open you_owe · 10 text artifacts · 1 false claim) | smoke-prepared-truth · smoke-prepared-reader D9/D10 · tests/unit/prepared-truth.test.ts |
| W5b | walk fixes: one HTML-entity decoder at every excerpt seam; list-mail notices never drafted (notice law reads the header); held list folds same-sender/subject rows + honest footer; `?view=held` paints the lens from the server | smoke-deck-display |
| W5c | a withdrawn (stale/outside-window/false-claim) artifact is never "fresh", re-prepares, and leaves the brief's transcript; brief digest hashes liveness (ROOM_BRIEF_VERSION 16); moot asks naming our own artifacts; invite cards mount only from a live invite; the commitment door renders its decision card | smoke-prepared-truth |
| W7.2 | ONE OBJECT, ONE DOOR (owner walk Sep 23 — a commitment's door spoke an untracked machine container's agenda): every door speaks for the object in its title — item doors compose ITEM-FIRST under their own key whatever they're linked to (`lib/room/door.ts`; `roomKeyForItem` reads no link; the grounding's item scope never widens; the warm/action/membership/converse seams follow), the entity rides voiceless as ONE connection line, a MOVE/object card/bound card renders only for an object the door owns (the commitment's source is served, never the move target), recognize-on-open merges only the connection mid-visit; the project door + the deck's room-door law untouched; turns under entity keys stay as the entity door's record | smoke-one-door |
| W7.3 | ONE STAGE, NO INTERNAL TEXT, TRUE ADDRESSEES (owner walk Sep 23 — a meeting-born commitment's door): the commitment's message is THE ONE EmailCard in the conversation (the email host's new compose lane — `/api/compose/draft` fill, `/api/compose/send` commit; the split-stage ComposePanel retired from this door; the stage is a parked gate's alone; the source reads in the drawer); no component renders the judge's `verdict.reason` (decision questions = the brief's own title, else the item's words) and the "should cover" checklist reads only extractor clauses (`motionClausesOf`); ONE addressee ladder (`lib/prepare/addressee.ts`: counterparty → source email's other party → meeting attendees minus the user → the project's one external person; several = suggestions, none = the card asks) stamped by every commitment drafter, and THE ONE READER withdraws a draft addressed to the user / not the counterparty (`misaddressed`) so the re-prepare trip replaces it; a meeting-born commitment's source object is its meeting (the kit's `source` kind); `commitments.source_id` (an emails row) mapped through one read (`lib/commitments/source.ts`) — recognition's structural parent for email-born commitments resolves again. Dry-run ledger: `scripts/repair-misaddressed-drafts.ts` | smoke-one-stage · tests/unit/true-addressees.test.ts |
| W7.5 | IDENTITY HYGIENE (W7.3's open finding — the owner's self person entity carried a client contact's name + address): THE SELF IS CODE-OWNED (`lib/entities/self.ts` `deriveSelfIdentity` — login + connected addresses + profile name + only the display names of mail FROM an owned address; an address is never learned from mail; `is_from_user` is a folder fact and a forwarded meeting request keeps its organizer in `from` — that one row was the poison); ensure REPLACES the alias set through ONE pure plan (`planSelfRepair`), adopts only a PURE self row, restores a foreign person that was adopted as self; THE MERGE GUARD (`refusesSelfMerge` in absorbEntity — every merge door — + the person brain never writes self); the addressee law + the commitment writer read the derivation, never the stored row; THE ONE ACCENT FOLD in `lib/projects/identity.ts` `norm` (W7.3's local fold retired); the held ledger / triage deck reads the ONE READER's live verdict (`liveFromSourceData` — addressee floor + truth floors + the activity approximation). Dry-run: `scripts/repair-self-identity.ts` | smoke-identity · tests/unit/identity-hygiene.test.ts |
| W7.6 | AUTHORED, NOT FILED (W7.5's finding — the Sent-folder sync stamped `is_from_user = true` on everything in Sent Items; a forwarded meeting request keeps its CLIENT organizer in `from`, and every reader treats the flag as "the user wrote this"): THE AUTHORSHIP LAW (`lib/email-sync/authorship.ts` `authorshipOf`/`authorshipStamp`) — authored = from ∈ owned (login + connected mailboxes + provider-reported send-as via `lib/email-sync/send-as.ts`: Gmail sendAs primary/accepted, Graph proxyAddresses; a delegate sending AS the user is recorded `sent_by_delegate`) OR sender ∈ owned on a non-calendar message (ON BEHALF OF a principal — the user DID send it; `sent_on_behalf_of`); a relayed calendar item (eventMessage / text/calendar) with a foreign organizer is never authored; filed-in-Sent survives only as `metadata.filed_in_sent`. ONE stamp at every sync path (backfill · main insert — initial, recovery, both push doors, fast path · the Sent pass, which now also keeps the parser metadata it used to erase); both parsers carry the transmitting sender (Gmail `Sender:`, Graph `sender` via the ONE `OUTLOOK_MESSAGE_SELECT`); no reader tests the folder. THE ONE RESTORE FLIP extracted (`lib/activity/reopen.ts`, `/api/restore` + repairs share it). Dry-run: `scripts/repair-authorship.ts` — census (20 users): 7,979 is_from_user rows · 1 misattributed (the forwarded invite) · 0 held back · 0 closes caused | smoke-authorship · tests/unit/authorship.test.ts |
| W8.1 | EVIDENCE FROM EVERYWHERE (owner, Sep 23 — users act on their own side, in other tools; read-only census: a TEAMMATE's delivery on a client thread was ignored because evidence counted only `user|counterparty`; bare-name meeting counterparties could never be nominated (address-only matching — recordings carry no attendees); evidence types were a hard-coded union with bespoke pool code): THE EVIDENCE SOURCE REGISTRY (`lib/evidence/sources.ts` + `types.ts`) — rows mail · calendar · transcript · deeds (the commit-door ledger `action_commits`), each emitting ONE `EvidenceEvent {source, type, deed, actor, participants, objects, title}`, feature-gated by the workspace map (TOOL_FEATURE key; an unreadable map never switches a row off); `email_sends` (no recipients), workflow deliverables (no counterparty link) and Slack/Drive (nothing stored per message/file) are stated as skipped, and the header documents the one-row plug-in. THE ONE MATCHER (`lib/evidence/match.ts`, pure) keys on PERSON IDENTITY (every alias + person id) and OBJECT links (thread · calendar event · house ref · entity membership, entity-only hits capped at one slot per type); cancelled events and declined attendees never count. THE ACTOR LADDER (`lib/evidence/actor.ts` `actorRole`: user > counterparty > teammate > unknown; teammates = active company members + the user's corporate domain, public providers never). IDENTITY (`lib/evidence/identity.ts`): counterparty → registry person (alias · accent-folded exact name) → thread sender → the meeting's OWN attendee list (own → linked event → the ONE event the recording sat inside, `sameAttendee`, exactly one). The nominator/settle/sweep keep their names and ride the registry (`SETTLE_MATCH` on every settle door; the views — judge/grounding — keep the legacy view by default); the reverse door runs the SAME matcher over the trigger. A teammate's piece reaches the fulfillment judge with the actor stated (THE TEAMMATE CLAUSE, only when present; law 5 kept — legacy lines byte-identical) and closes stamped `evidence:teammate`, narrated "Sam sent it Sep 3". Census (`scripts/census-evidence-reach.ts`, zero AI/writes): commitments nominatable 521 → 567 of 786, inbox 276 → 302 of 693 (gained: teammate 35 · identity 11 · entity 26; lost 0); the owner's "call …" commitment already nominated its Sep 14 held meeting — it is open because its stored verdict predates law 5 (re-judged on the next evidence pass), not for want of nomination | smoke-evidence-sources · tests/unit/evidence-sources.test.ts · ⟲ smoke-evidence-settles / smoke-prepared-truth D4 / smoke-promise P33 re-pointed |
| W8.2 | ONE CONVERSATION, ONE LIVE ITEM (owner census Sep 23 — one client thread held ~20 open commitments accumulated message by message; one person under two name forms; one row under a bare address; one due before its own source email): THE CONVERSATION DELTA (`lib/work/conversation-delta.ts`) — at the ONE call site (`writeCommitments`, mail + meeting; an empty extraction still reaches it) one classification-tier pass reads the conversation's open items (thread · a meeting's calendar series; ≤20, the rest reported) against the message's OWN words: keep · update (stated due only, never before the message) · superseded_by · delivered (a NOMINATION into the fulfillment judge — only a judged delivery closes, only when the debtor wrote it) · moot, and new · duplicate_of per candidate; every non-keep quotes the message (code-checked); settles are conditional flips + reversible activity rows; failure keeps everything. EXTRACTION TRUTH in the writer: due before its source → null (a title naming that past date → no commitment); `foldCounterparty` (registry + the conversation's forms: accents, short surnames, bare addresses). Repair: `scripts/repair-conversation-hoard.ts` (zero-AI part: name folds + due floor; the delta pass only with `--judge`). Owner-account dry run: 74 live · 12 name variants · 1 due before source · 7 groups ≥2 (55 passes on the top three). Platform: 117 groups / 486 rows / 1,031 passes ≈ €4–6 for `--judge --all` | smoke-conversation-delta · tests/unit/conversation-delta.test.ts |
| W8.3 | THE LIST SAYS ONLY WHAT WAS JUDGED (owner walk Sep 23 — "When you're ready" claimed "84 real things … all alive" over rows never judged: a sign-in code, a login alert, a payment-past-due notice, July golf days, carried in by a July-era understanding): the held reader reads WHICH items were judged at all from its one judgment read (`neverJudged` / `judgedCurrent`, three-valued) — a deck-eligible row with no verdict files as **Not yet judged** (handled; its why says so plainly, a passed stated date in plain words; the judgment arrives through the item door's existing judge-on-open or the sweep — no new AI budget), never brought forward, never "real"; a STALE understanding (no `mailKind`, pre-M1) never qualifies work on its own; THE KIND FLOOR (`lib/work/kind-floor.ts`) — cold_outreach/newsletter owe nothing until the user wrote into the thread, notification/receipt nothing without you_owe — runs in the judge before AI (JUDGE_VERSION 21) and at serve time for older-law verdicts; ONE COUNT (bands serve whole to a declared bound of 500; the deck owns and SETTLES its own stack to the account; a short footer names its bound); bulk verbs speak the group truth ("Archive the newest 200 of 1,223" + the card's scope line; the 200-item deed cap stays — a deed, not a migration); plain dates (`plainDay`); the triage card lost the judge's reason (the deck context no longer carries it) and reads the item's OWN source first; the brief's FYI pool is a declared 7-day window read whole (`fetchAllRows`, bound 2,000, reported) instead of `.limit(200)`. Census (read-time, ZERO writes): reference account waiting 62 → 22, urgent 13 → 2, 36 not-judged, 4 pitches to bulk; all accounts 362 → 137 (151 unvisited · 33 passed-date · 27 stale · 14 kind-floored). Dry-run ledger: `scripts/repair-stale-waiting.ts` (writes nothing) | smoke-waiting-truth · tests/unit/waiting-truth.test.ts |
| W8.4 | THE ROOM SPEAKS TRUE AND FAST (owner walk + dev logs, Sep 23): THE NAME TEST — the third-person refusal fires only when the name denotes the SPEAKER (`narratesSpeakerInThirdPerson`: a known person's full name / a `<Capitalized> <Seat>` name token is someone else — a colleague whose surname was the seat's given name was refused on every open), and a refused or fully-degraded composition is REMEMBERED for its sig (`refusedSig`, last-good kept) so it is never re-bought per open (an AI failure/503 is not cached; last-good serves); THE FALLBACK LADDER (`lib/room/opening-fallback.ts`) — the item's own ask in a colleague's words or nothing, never the "standalone" membership claim nor the "This needs you to <title>" template; ONE CARD, ONE DOOR — the rail's source card "Thread →" opens the host's drawer on email + commitment doors (the reply card's door), the project room keeps it in-room; NO INTERNAL TEXT — the prepare-now reason (it carries the judge's reasoning) is spoken as `prepareNoneLine`, no raw ISO dates in the rail / drawer history; SPEED — the item view NEVER awaits a compose (last-good at once, compose under after(), the one late re-check APPENDS; supersedes W3.5 (a)'s budget wait: ~1s off every open), a hover warm (`?warm=1`) is ZERO-AI and an open joining it kicks the budgeted warm door once (`lib/room/open-kicks.ts`), the deep-dive's re-checks are pure reads, POST /api/items/plan is one flight per (user, kind, item) with a stated memo (PATCH forgets; an unpersisted fallback held 10 min), the thread door runs rules · thread · invite in ONE wave and no longer writes the module-global rules (a cross-request race). Remaining plan-POST source: the Home's pre-gen (`components/home/home-view.tsx`, outside this fence) re-fires per Home remount — now absorbed by the server flight | smoke-room-voice · smoke-one-door K · tests/unit/room-voice.test.ts |
| W8.5 | THE W8.4 LEFTOVERS (found outside W8.4's fence): the Home's plan pre-gen fires AT MOST ONCE PER ITEM PER SESSION — the dedup moved from a per-mount ref (reset on every Home remount: 3–6 plan POSTs per navigation) to a module-level memo in `components/home/home-view.tsx` keyed `kind:id` → the row's staleness stamp (receivedAt / dueDate; a moved stamp is the one reason to warm again, a hard reload is a new session); THE PROJECT DOOR NEVER WAITS — `GET /api/entities/[id]/room` serves LAST-GOOD (older version allowed, flagged) read beside the room-view read and runs the joinCompose-wrapped `ensureRoomBrief` ONLY under after() (the W8.4 item-view law; supersedes W3.5 (a)'s budget wait on this door), pending = nothing current painted; `?warm=1` schedules no compose; the entity room's ONE late re-check is a pure read (`?warm=1`, 6.5s — the item door's window) that APPENDS. Open: `briefBeforePaint` (lib/room/brief.ts) now has no caller (smoke-room-first-paint A1 still pins it); the project-room hover warm (lib/room/warm-room.ts) still asks the door plainly, so it keeps warming the brief under after() | smoke-room-voice I1–I7 · ⟲ smoke-room-first-paint A6 / smoke-one-door D1 re-pointed |
| W8.6 | THE LIST DRAINS (W8.3's two gaps): (1) NOTHING DRAINED "Not yet judged" — the general judgment walk reaches only the spine's actionable candidates, and held rows are held precisely because the spine skips them. THE NOT-JUDGED LANE (`lib/work/judgment-sweep.ts` `runNotJudgedLane` / pure `planNotJudgedLane`) rides every per-user judgment pass under its OWN slice (45s, skipped-and-said when the budget is too small), before the walk and even when the spine is empty: population = the held set's deck-eligible rows with no CURRENT-version verdict (never judged, or a work verdict under an older JUDGE_VERSION — the same `deriveHeld` facts) + spine candidates never judged at all; order = THE KIND FLOOR FIRST (zero AI — the judge's own floor answers before any model), then open rows newest first (never-judged before stale-version), then past-dated rows (one cheap classification call each); a past-due COMMITMENT is left to LAW 2's expiry lane and counted; stated caps 200 floor disposals + 40 AI-possible judgments per user per run, the remainder COUNTED (`notJudged.leftBehind`, cron JSON + per-user stamp); the EXISTING `judgeWork` + `applyVerdictConsequences`, idempotent through the day-keyed sig (a judged row leaves the population; a failure is never cached). Guarded one-shot `scripts/backfill-not-judged.ts` (dry run through a write-suppressing client; `--apply --user/--all --limit N` takes the cron's judgment claim — NOT RUN). Dry run Sep 23: 5 accounts, 804 unjudged rows (636 never judged · 168 stale-version; 14 kind-floor disposals, 724 open, 65 past-dated, 1 past-due commitment to LAW 2); AI cost ≈ €0.37 for one `--limit 40` pass, ≈ €2.37 for the whole backlog (upper bound, €0.003/judgment) — the cron alone drains it in ~8 runs. (2) BULK DEEDS STOPPED AT 200 — archive/trash now act on the WHOLE group to a stated safety bound (`MAX_DEED_ITEMS` 5,000; `deedBoundFor` — unsubscribe keeps one page: external links, per sender; expire one page: a judged pass each), committed in PAGES of 200 through THE ONE commit door: first claim on committedAt null, every later run by a lease + cursor compare-and-set, progress persisted after every page (lease-guarded, through the store door), a stopped run resumes (the card calls the same door while the cursor advances, then offers "Continue"), per member only a PENDING row is acted on (a re-walked page recognises its own finished work); ONE activity record per deed (`bulk_deed`, updated in place; `bulk_unsubscribe` carries no Undo) that `/api/restore` reverses AS ONE (`undoBulkDeed` → `reopenInboxItems`, the batch flip, exactly once on `undoneAt`); the preview reads one page of mailbox targets and reports the rest. Label: "Archive all 1,223" (past the bound: "the newest 5,000 of 6,200"). Fence edge: `components/home/held-quiet.tsx` one line (the label's cap → `deedBoundFor(verb)`), `lib/deeds/words.ts`, `lib/activity/{restore,reopen}.ts` | smoke-held-drain (36) · ⟲ smoke-deeds BD1.3/BD1.5/BD1.10/BD4.1/BD4.4/BD7.14/WD1.6 · smoke-waiting-truth F5 · smoke-typed-stores allowlist 4 → 3 (shrank) re-pointed |
| W8.7 | EVIDENCE FROM EVERYWHERE — THE FOUR REMAINING HOOKS (W8.1's follow-up): (1) THE SYNC MAIL DOOR — `lib/email-sync/sync-emails.ts` `openMailEvidenceDoor`, ONE helper and ONE call site on the sync path, fires the reverse door for mail the user AUTHORED and, new, for INBOUND mail a TEAMMATE sent (the ladder via `lib/evidence/sources.ts` `mailOpensReverseDoor` → `mailEventOf` → `actorRole`, never re-derived; the actor context loads once per sync, lazily; recent-only 7d; placed after the user branch's resolve-on-reply so that order is kept; void, non-fatal, at-least-once safe through the conditional closes + evidence-keyed judgment cache). (2) THE COMMIT DOOR SETTLES AT ONCE — `recordCommitResult` (the ONE place results record) selects the recorded row and hands a DEED (the `deeds` row's own `deedEventOf` decides; failed/unrecorded/internal verbs never) to `settleForEvent({ type: 'deed', ids })` in `after()` (else floats) — a send made in AUGMTD closes its matching work within seconds, not at the next sweep. (3) THE JUDGE AND THE ROOM SEE THE SAME EVIDENCE — `lib/work/judge.ts` and `lib/room/grounding.ts` match with SETTLE_MATCH; `laterEvidenceBlock` gains SENT BY A TEAMMATE ("a teammate (<name>) sent …") and DONE BY THE USER THROUGH AUGMTD sections (legacy sections byte-identical), `evidenceLinesOf` the matching lines, `BOARD_EVIDENCE_RULE` a teammate clause; `deedWords` is the one deed-vocabulary renderer. VERSIONS: ROOM_BRIEF_VERSION 17 → 18 (the board rule's text changed and the board digest only counts lines — a room at the line cap would not have recomposed); JUDGE_VERSION NOT bumped (THE RULE, lib/core/versions.ts: the new sections are FACTS that render only when a teammate/deed piece is present, and the evidence set already rides the judgment sig as a dep — `evidenceSig` — so exactly the affected items re-judge, never the whole corpus). (4) OWNER DECISION — calendar + transcript rows are gated on their DATA (`feature: null`: no connected calendar → no rows; no recordings → none), never on the `meetings` UI-module flag; THE GATING RULE in the registry header: a feature gates a row only when it means "this source is not collected" (email off → no mail row; sovereign/email-off workspaces have no calendar rows, so nothing changes there) | smoke-evidence-sources W1–W10 (R4 ⟲ RE-POINTED: meetings off gates nothing, email off gates mail) · tests/unit/evidence-sources.test.ts (gating test ⟲ RE-POINTED + W8.7 cases) |

### OWNER STEPS (in order, after validating + committing)
1. **Migrations** (SQL editor): `20260922_privilege_integrity.sql` (run the check SQL in its header before/after), `20260922b_merge_home_brief.sql`, `20260922c_usage_created_at_index.sql`; plus the three older pending ones.
2. **Deploy** Vercel. Then **redeploy the AgentOS box**: `scripts/deploy-agentos.sh` (dry run) → `--apply`.
3. **Repair sweeps** (each: dry run → `--apply --all`): `sweep-retire-mirrors.ts`, `sweep-stated-windows.ts`, `sweep-self-counterparty.ts`, `sweep-cc-seat.ts --days 365`, `sweep-duplicate-commitments.ts`, optional `backfill-outcome-ledger.ts`; W5a: `sweep-invite-windows.ts` (files out-of-window / past invites so the pass re-prepares inside the window) + `sweep-false-completion-claims.ts` (files the false pack so the pass re-drafts under the completion floor) — the reader already hides both classes without the sweep; `--apply` only clears the ledger. W7.3: `repair-misaddressed-drafts.ts` (dry run lists misaddressed + unaddressed commitment drafts; `--apply` files only the misaddressed rows as `superseded:addressee` — the reader already hides them). W7.5: `repair-self-identity.ts` (dry run censuses every user's self rows; `--apply --yes` rewrites self aliases to the derivation, restores the adopted foreign person, archives zero-link duplicate self rows — ensureSelfEntity applies the same plan on the next pass anyway). W7.6: `repair-authorship.ts` (dry run lists per user the stored is_from_user rows the author law says are NOT the user's — held back: rows of a disconnected mailbox, rows whose from name is the user's own (a likely unreported alias; `--include-possible-aliases`) — and the 'replied'/'evidence:email' closes they caused; `--apply --yes` flips them to is_from_user=false + filed_in_sent; add `--reopen` to also reopen those closes through THE ONE restore flip. Census Sep 23: 1 row, 0 closes). Run it AFTER the deploy (the sync now stamps correctly; the repair only heals history). W8.2: `repair-conversation-hoard.ts` (dry run = zero AI: counterparty name variants folded to the canonical form + dues earlier than their source nulled, and a census/estimate of the hoard pass; `--apply --yes` writes that zero-AI part; `--judge` runs THE SAME conversation delta over each thread group oldest→newest — ≈ €4–6 for `--all`, orchestrator-run — and `--judge --apply --yes` settles it: superseded/moot/duplicates dismissed reversibly, delivered only through the fulfillment judge). Run AFTER the deploy (the write path now runs the delta). W8.6: `backfill-not-judged.ts` (dry run = zero AI, zero writes: per account the not-judged lane's population + an AI cost estimate; `--apply --all|--user <id> [--limit N]` runs THE SAME lane with the cron's claim — ≈ €2.37 for the whole backlog, orchestrator-run; optional, the cron drains it on its own).
4. **Secrets**: rotate `AGENTOS_SECRET` / `MEETING_BOT_SECRET` and move box services behind TLS (W0.7); remove `infra/meeting-bot/google-auth.json` from git history + rotate; rotate the key found in `.env.local.example`.
5. **After ~1 week**: `outcomeLedgerReady()` → set `OUTCOME_FACTS_ENABLED=true` when ready. Watch `ai_usage_events` for the new judge reach (~€2–3/day at full reach) and room warming.
6. **Decisions still open**: retention `RETENTION_APPLY` (lifetime workflow cost becomes a floor after 200 d); the DM greeting (composed-once in Clara's voice vs the faceless line); `SWEEP_FANOUT_MAX_USERS` if spend needs a throttle.
