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

### OWNER STEPS (in order, after validating + committing)
1. **Migrations** (SQL editor): `20260922_privilege_integrity.sql` (run the check SQL in its header before/after), `20260922b_merge_home_brief.sql`, `20260922c_usage_created_at_index.sql`; plus the three older pending ones.
2. **Deploy** Vercel. Then **redeploy the AgentOS box**: `scripts/deploy-agentos.sh` (dry run) → `--apply`.
3. **Repair sweeps** (each: dry run → `--apply --all`): `sweep-retire-mirrors.ts`, `sweep-stated-windows.ts`, `sweep-self-counterparty.ts`, `sweep-cc-seat.ts --days 365`, `sweep-duplicate-commitments.ts`, optional `backfill-outcome-ledger.ts`; W5a: `sweep-invite-windows.ts` (files out-of-window / past invites so the pass re-prepares inside the window) + `sweep-false-completion-claims.ts` (files the false pack so the pass re-drafts under the completion floor) — the reader already hides both classes without the sweep; `--apply` only clears the ledger.
4. **Secrets**: rotate `AGENTOS_SECRET` / `MEETING_BOT_SECRET` and move box services behind TLS (W0.7); remove `infra/meeting-bot/google-auth.json` from git history + rotate; rotate the key found in `.env.local.example`.
5. **After ~1 week**: `outcomeLedgerReady()` → set `OUTCOME_FACTS_ENABLED=true` when ready. Watch `ai_usage_events` for the new judge reach (~€2–3/day at full reach) and room warming.
6. **Decisions still open**: retention `RETENTION_APPLY` (lifetime workflow cost becomes a floor after 200 d); the DM greeting (composed-once in Clara's voice vs the faceless line); `SWEEP_FANOUT_MAX_USERS` if spend needs a throttle.
