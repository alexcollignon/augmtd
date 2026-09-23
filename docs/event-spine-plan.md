# THE EVENT SPINE — the plan (Sep 23, 2026)

*Spec only. No code has been written for this arc. It follows the stabilization program
(`docs/stabilization-plan.md`), inherits its operating protocol (PART IV) and its owner-gated list,
and traces to `docs/experience-spec.md` (the seat table · law 9 "earned calm" · law 10 "truth before
presentation" · the machine). Laws are defined in `docs/laws-registry.md`; this doc proposes
additions and amendments, which enter the registry only through the admission rule.*

---

## EXECUTIVE SUMMARY (for the owner)

1. **Why Home is slow:** each open rebuilds everything from raw tables. On the heaviest account the "held quiet" count alone reads ~72 MB, and 96% of it is email bodies nobody sees.
2. **Why cost grows with the backlog:** timed sweeps rejudged 619 items in 24 h. About 108 items/day actually arrive.
3. **The queue:** a change becomes an event in a Postgres job table inside Supabase, so no new data processor. Events on the same object merge, retry, and show on the status board.
4. **The work index:** one small row per live work item, written only by today's state ladder. Home, the held list, project rooms and triage each read it in one query. **Target: Home under 300 ms.**
5. **Truth before speed:** a row whose inputs moved, or whose time boundary passed, is recomputed live before it is shown.
6. **Records get a lifecycle:** live work, archive, logs. Logs get daily rollups and a retention you choose. Email bodies stop being copied into work rows.
7. **The judge gets a report card:** your labelled items, a scorer per prompt or model change (≈€0.45 a run), accept/edit/discard rates per verb, and an "unsure" lane. When the judge is unsure, the item is shown to you, never hidden.
8. **Order:** a quick speed fix with no migration (days), then the queue, the index in shadow, the index live, events replacing the sweeps, the lifecycle. The eval runs alongside. Each phase is behind a flag.
9. **Your decisions:** PART G (queue choice, retention, ~2 h of labelling, two law amendments, phase order).

---

## PART 0 — WHAT WE MEASURED (read-only census, Sep 23)

Script: a scratchpad census (head counts plus capped samples, service role, zero writes) run
against the database `.env.local` points at: **8 profiles, 6 with mail**. The figures the owner
quoted from production (`ai_usage_events` ≈12k and `learning_signals` ≈11.5k on one account) come
from a different snapshot. **Re-run the same census on prod before sizing Phase 5.** Accounts are
anonymised: A has the most mail, B is second.

| Fact | Value | What it means |
|---|---|---|
| `inbox_items` pending / total | 4,701 / 7,667; account A 3,514 pending | the "working set" is mostly held mail |
| pending by `work_state` | noted 4,244 · decision 203 · prepared 148 · action 91 · noise 15 | ~95% of pending rows are held, never decked |
| **avg `source_data` bytes per pending row (A)** | **20.5 KB**; `html_body` + `body` = **96%** of bytes | the body is ALSO stored in `emails.body/html_body` (a second home) |
| held derivation on each Home open (`lib/deeds/held-members.ts` `countHeld`) | reads every pending row with the whole `source_data`, up to `HELD_POOL_MAX` 6,000 | account A: **~72 MB per Home open**; one 1,000-row page = **1.4 s** |
| brief deck pool (`app/api/home/brief/route.ts` `DECK_POOL_LIMIT`) | A: 210 rows × 16 KB = **3.3 MB** | plus the FYI pool, plus ~15 other reads |
| judgment rows rewritten in the last 24 h | **619** (of 1,541) | the judge's sig is day-keyed: open items are re-judged daily whether or not they moved |
| arrivals | emails 1,227/7 d · inbox items 756/7 d · commitments 85/7 d | real change is ~110 items/day |
| `ai_usage_events` | 64,818 total · 12,246 in 7 d (~1,750/day) · account A 39,345 | newest 1,000: `brain_synthesis` 70%, `task_preparation` 29% |
| `learning_signals` | 4,353 · types (newest 1,000): item_dismissed 85% · reply_sent 11% · action_taken 5% | `action_taken` carries THE OUTCOME LEDGER (`lib/prepare/outcome.ts`) |
| `item_plans` | 7,219 rows · 41 of 57 registered kinds present | top kinds below |
| `item_plans` top kinds (rows · avg bytes) | conversation_pair 1,987 · 243 — judgment 1,541 · 474 — fulfillment 759 · 412 — prep_outcome 632 · 132 — commitment 571 · 468 — verdict_resolve_roll 375 · 177 — conversation_cascade 239 — anticipation 226 · 169 — proof_of_life 195 · 88 — room_brief 166 · 1,097 | small table; the problem is **typing and indexability**, not size |
| `action_commits` | 0 rows on this database | the commit-door ledger is empty here; prod will differ |

The dev slow log agrees with this (`[home/brief] slow 9309ms — queries:1113 · context:2021 ·
assemble:5142`). `assemble` is where `heldCountsPromise`, `workStatesFor` and the entity-link walks
land.

---

## PART A — THE DURABLE QUEUE

### A.1 What exists today (the reverse doors are fire-and-forget)

| Door | Where | Shape today |
|---|---|---|
| mail → evidence | `lib/email-sync/sync-emails.ts:490` `openMailEvidenceDoor` | `void import(...).then(settleForEvent)` + `.catch(() => {})` |
| mail → commitments | `sync-emails.ts:1188/1249` | `void import('@/lib/commitments/extract')…` |
| mail → labels | `sync-emails.ts:1529/1937` | `void import('@/lib/inbox/rules/write-back')…`; label-sweep is the backstop |
| sync tail → recognition, person state, reactions | `sync-emails.ts:2211–2245` | inline, try/catch, non-fatal |
| calendar → evidence | `lib/calendar/sync-calendar.ts:239` | `void … settleForEvent` |
| transcript → evidence | `lib/integrations/meeting-bot/bot-manager.ts:346` | `void … settleForEvent` |
| deed → evidence | `lib/work/commit-door.ts` `settleDeedsSoon` | `after(fire)` or a floating promise |
| sweeps | `lib/work/sweep-fanout.ts` | cron → per-user POST to `/api/internal/sweeps/user` → claim in `item_plans` `sweep_claim` |
| re-prepare | `lib/prepare/requeue.ts` | a proto-queue: `prep_requeue` marker rows in `item_plans` |

Each door is correct when it runs, and **none of them is durable**. A failed or killed promise
leaves its work to the next 2 h / 6 h sweep, which walks the whole backlog to find the one row that
changed. The sweeps are therefore both the safety net and the main engine, and that is diagnosis (1).

### A.2 Options

| | **Supabase Queues (pgmq)** | **Plain Postgres job table + claim/lease** | **External (Inngest / QStash)** |
|---|---|---|---|
| Perimeter | inside Supabase | inside Supabase | **a new sub-processor.** Even with an EU region it goes in the DPA and the sub-processor table, and event metadata (user ids, object ids, timing) leaves the perimeter. Payloads could be limited to ids, but it is still a new processor and a new availability dependency |
| Durability, visibility timeout, retries | native (`vt`, `read_ct`, archive table) | built from our own idioms: `lease_until`, `attempts`, `not_before` | native, plus nice step functions |
| **Per-object coalescing** ("10 new messages on one thread = 1 judgment") | **not native.** Messages are append-only, so dedupe needs a sidecar table, which means building the plain table anyway | **native to the design**: a partial unique index on `(user_id, coalesce_key) WHERE state='pending'` plus `ON CONFLICT DO UPDATE` | debounce / idempotency keys (vendor-specific) |
| Per-tenant fairness | not native (FIFO per queue; one queue per tenant does not scale) | one SQL window function in the claim | concurrency keys (vendor-specific) |
| Priorities, delayed jobs | delay yes, priority no | both (columns) | both |
| Fits house idioms | new API surface (`pgmq_public.*` RPCs) | the claim idioms we already use: `claimCommit`, `claimSweepJob`, `claimSync`, `claimCatchUp`, the bulk-deed lease | new SDK plus a webhook route per function |
| Migration | enable the extension (owner, SQL editor) plus wrapper RPCs | one table, three RPCs, grants (owner, SQL editor) | none in the DB; new secrets, a new vendor contract |
| Cost | inside the Supabase plan | inside the Supabase plan | per-step pricing, plus DPA work |

**Recommendation: the plain Postgres job table.** Our queue has one requirement that shapes
everything else: coalescing by object. pgmq does not provide it, so choosing pgmq still means
building the plain table beside it. The claim/lease pattern is already how the house achieves
exactly-once (the commit door, sweep claims, bulk-deed leases), so this adds no new concept. An
external vendor is rejected on the sovereignty premise: no new processor without a stated reason,
and none of its features solves a problem we cannot solve in Postgres at our scale (10^2–10^4
accounts). **Swap criterion, stated in advance:** if sustained throughput passes ~200 events/s,
or claim latency p95 passes 200 ms, move the transport to pgmq behind the same `emitWorkEvent` /
`claimWorkEvents` interface. Callers would not change.

### A.3 The job model

**The table (migration `2026MMDD_work_events.sql`, applied manually by the owner):**

```sql
create table public.work_events (
  id            bigserial primary key,
  user_id       uuid not null,
  type          text not null,                 -- the EventType union (A.4)
  object_key    text,                          -- 'inbox:<id>' | 'commitment:<id>' | 'event:<id>' | 'transcript:<id>' | 'tool:<source>:<id>' | null (user scope)
  coalesce_key  text not null,                 -- one PENDING row per (user_id, coalesce_key)
  dedupe_key    text,                          -- emit idempotency across states (e.g. 'message_stored:<email id>')
  payload       jsonb not null default '{}',   -- IDS ONLY — never content (UNTRUSTED INPUT IS DATA; tier privacy)
  priority      smallint not null default 5,   -- 0 = user is waiting (deed, open) · 5 = arrival · 9 = backfill
  state         text not null default 'pending',  -- pending | running | done | dead | skipped
  not_before    timestamptz not null default now(),  -- delayed jobs = scheduled clock events (A.4)
  attempts      int not null default 0,
  lease_owner   text, lease_until timestamptz,
  coalesced     int not null default 0,        -- how many emits folded into this row
  last_error    text,
  created_at    timestamptz not null default now(), started_at timestamptz, finished_at timestamptz
);
create unique index work_events_one_pending on public.work_events (user_id, coalesce_key) where state = 'pending';
create unique index work_events_dedupe on public.work_events (user_id, dedupe_key) where dedupe_key is not null;
create index work_events_ready on public.work_events (priority, not_before) where state = 'pending';
create index work_events_leased on public.work_events (lease_until) where state = 'running';
alter table public.work_events enable row level security;   -- no user policies: service role only (PRIVILEGE INTEGRITY)
```

**Three RPCs (security definer, `execute` granted to `service_role` only):**

- `emit_work_event(user, type, object_key, coalesce_key, dedupe_key, payload, priority, not_before)`:
  an insert with `ON CONFLICT (user_id, coalesce_key) WHERE state='pending' DO UPDATE` that merges
  the payload's id lists, sets `coalesced += 1`, `priority = least(...)` and
  `not_before = least(...)`. A `dedupe_key` conflict does nothing, so an at-least-once sync that
  re-stores an email re-emits nothing. **An event on a key whose job is currently RUNNING creates a
  new pending row.** The only pending-row uniqueness is on the pending state, so a change that
  lands mid-handler is never lost.
- `claim_work_events(owner, max, per_user, lease_seconds)`: first reaps expired leases (back to
  `pending` with backoff, or `dead` at max attempts). Then it ranks ready rows with
  `row_number() over (partition by user_id order by priority, not_before)`, keeps `rn <= per_user`
  (**per-tenant fairness**: one account's 3,000-event backfill cannot starve another account's
  single deed), locks them `FOR UPDATE SKIP LOCKED`, marks them `running`, and returns them.
- `finish_work_event(id, owner, outcome, error)`: a conditional update (`WHERE lease_owner = owner
  AND state='running'`), which is THE CONDITIONAL CLAIM. `outcome` is `done | retry | dead |
  skipped`. `retry` sets `not_before = now() + least(30s × 4^(attempts-1), 2h)`.

**Semantics:**

| Property | Rule |
|---|---|
| Idempotency | handlers are already idempotent through their own keys: the judge's `sigOf` cache, the fulfillment/expiry caches, the commit door's key, the conditional closes in `apply-verdict`, the index writer's input-sig compare (B.4). The queue guarantees *at least once*; the handlers make that *effectively once*. |
| Retries | max 5 attempts; backoff 30 s → 2 min → 8 min → 32 min → 2 h. FAILURE HONESTY: an AI outage (`failure-honesty` law) retries and never caches. |
| Dead letter | `state='dead'`, kept 30 days with `last_error`. **Red** on the status board if any dead event in the last 24 h concerns a deed or an evidence settle. **Amber** for the rest. |
| Visibility | `lease_until` = the handler's budget + 60 s. A drainer killed at `maxDuration` releases its jobs through the reaper; nothing is ever wedged (the lesson from THE STALE CLAIM). |
| Budgets | per-handler `budgetMs`. Per-tenant daily AI ceiling (default €1.50/day, `tenant_configs` override) read from the daily usage rollup (C.4). Over the ceiling, AI-bearing jobs are deferred to the next UTC day with `last_error='budget'`, **counted on the board** (NO SILENT CAPS). Deeds and settles are never budget-deferred. |
| Ordering | none guaranteed across keys. Within a key, coalescing gives "latest state wins": handlers read the object's current truth, never the event's payload, as the fact. |
| Retention | `done`/`skipped` rows kept 14 days (the lag and throughput census), then deleted by the retention cron. |

### A.4 Event types

Every emit goes through ONE module, `lib/events/emit.ts` `emitWorkEvent(client, userId, ev)`, and
every handler is registered in ONE table, `lib/events/handlers.ts` `EVENT_HANDLERS` (the catalogue
law, same shape as `EVIDENCE_SOURCES`).

| Type | Emitted by (the one call site each) | Coalesce key | Handlers, in order | Prio |
|---|---|---|---|---|
| `message_stored` | the sync store path in `sync-emails.ts` (every path: push, pull, backfill, Sent pass), after the row is durable | `obj:inbox:<itemId>` | `extract_commitments` → `judge` → `evidence` (user/teammate-authored only: the existing `mailOpensReverseDoor` predicate) → `recognize` → `reactions` → `index` | 5 |
| `user_deed` | `recordCommitResult` (commit door), `/api/restore`, dismiss/park/done doors, the bulk deed pages, the change-card apply | `obj:<kind>:<id>` (bulk: `deed:<deedId>`) | `evidence` (the `deeds` row) → `outcome` (the two-way ledger write where not yet written) → `index` | 0 |
| `calendar_changed` | `lib/calendar/sync-calendar.ts` (the `upsertedEventIds`, after the complete-fetch prune) | `cal:<eventId>` | `evidence` → `recognize` → `already_booked` (the floor re-check on items linked to the attendees) → `index` for linked items | 5 |
| `transcript_ready` | `storeTranscriptAndGenerateWork` / `bot-manager.ts:346` | `obj:transcript:<id>` | `extract_commitments` (+ THE CONVERSATION DELTA) → `evidence` → `recognize` → `index` | 5 |
| `file_indexed` | the knowledge confirm/index door (`knowledge_files` ready) | `file:<fileId>` | `staging` (re-check awaiting_input items whose ask names an attachable thing; THE STAGING LAW decides) → `index` | 6 |
| `verdict_changed` | `judgeWork`, **only** when `(work, resolution, requires, options)` or the ground moved | `obj:<kind>:<id>` | `apply_verdict` (the one consequence module) → `prepare` (`prepareOneItem`, `lib/prepare/pass.ts:76`) → `index` | 3 |
| `artifact_changed` | every lane home write: `source_data.draft/nudge_draft/prepared_invite/prepared_forward`, `item_deliverables` insert/withdraw, ask turns (checklist) | `obj:<kind>:<id>` | `index` (plus `room_brief_stale`, which recomposes the room brief under its own sig) | 3 |
| `entity_changed` | recognition link writes, membership moves, track/untrack, merges (`absorbEntity`) | `ent:<entityId>` | `index` for members (project tag, room door) → `entity_state` (the sig-gated refresh) | 6 |
| `clock_due` | **written by the index writer** at a row's `valid_until` (B.3), plus anticipation fire times and commitment due dates | `clock:<kind>:<id>` | re-derive: `expiry` (LAW 2) when past due · `judge` when a `revisit.after` date arrives · `index` always | 4 |
| `tool_event` | a future source's sync. **The evidence source registry row gains `emits: true`**, and the one-row plug-in (`lib/evidence/sources.ts` header, step 3) becomes `emitWorkEvent({ type: 'tool_event', source })` instead of a floating `settleForEvent` | `tool:<source>:<objectId>` | `evidence` → `index` | 5 |
| `brief_stale` | the index writer, when a served-set member changes | `user:home` | `home_brief` (the AI synthesis that today rides the Home GET's `after()`) | 7 |

**The time rule (the key to removing the clock).** Every time-dependent predicate in the ladder
can compute *when it will next flip*. That covers `deriveState`'s 48 h staleness, `revisit.after`,
`inviteExpired`, a due date crossing midnight in the user's timezone, and graduation's
`GRADUATION_DAYS`. The index writer stores the earliest such instant as `valid_until` and emits a
`clock_due` event with `not_before = valid_until`. A clock sweep polls to discover that time
passed; this schedules the one moment it matters.

### A.5 How workers run on Vercel

- **The drainer**: `app/api/internal/events/drain/route.ts`. Bearer `AGENTOS_SECRET` (same as every
  internal dispatcher), `maxDuration = 300`. It loops `claim_work_events(owner, 20, 3, lease)` →
  runs the handlers → `finish_work_event` until it is empty or `deadline = start + 250 s`. It never
  starts a handler whose budget cannot fit before the deadline.
- **Concurrency cap**: an `event_drainers` slot table (K = 4 slots, each a conditional-update
  lease). A kicked drainer that cannot take a slot exits 202, because a running drainer will pick
  up its work. This replaces `DISPATCH_CONCURRENCY` as the platform-wide limit on simultaneous AI
  work.
- **The kick (seconds latency)**: `emitWorkEvent` schedules one `after()` POST to the drainer,
  debounced per instance (at most one kick per 2 s), using the idiom of `/api/internal/runs/kick`
  and `dispatchSweepJobs`. With no base URL or secret configured, events wait for the backstop,
  logged. They never run in the caller's request.
- **The backstop**: `vercel.json` gains `{ "path": "/api/internal/events/drain", "schedule": "* * * * *" }`
  (cron routes authenticate with `hasBearer(req, 'CRON_SECRET')`; the drainer accepts either
  secret). Worst-case latency when every kick fails is about 60 s plus the drain time.
- **No request handler drains synchronously**, the Home route included. This carries over THE
  CATCH-UP KICK's rule.

### A.6 Observability (on the platform status board, `lib/platform/status.ts`)

A new band, **"The spine"**:

- queue depth by type and priority; **oldest ready event age** (amber > 5 min, red > 30 min)
- lag p50/p95 (`created_at → finished_at`) per type over 24 h; the event → index p95
- dead letters in the last 24 h (deed and evidence types → **red**)
- drainer heartbeat (the last finished event; red if nothing has finished in 10 min while depth > 0)
- top 5 accounts by backlog; budget-deferred count per account
- coalescing ratio (emits ÷ rows): the direct measure of how much repeated work the spine avoids

### A.7 What moves off the clock, and what stays

| Current responsibility | Today | Moves to | Safety net that stays |
|---|---|---|---|
| judge every actionable item (`judgment-sweep`, 2 h, day-keyed sig) | re-judges open items daily | `message_stored` / `verdict`-invalidating events / `clock_due` at `revisit.after` | **nightly** (03:50 UTC) net that **enqueues** (never judges inline) any open object whose judgment is missing, under an older `JUDGE_VERSION`, or older than 7 days. The W8.6 not-judged lane becomes this net's population. |
| prepare (`draft-sweep`, 2 h) | walks the judged backlog | `verdict_changed` → `prepareOneItem`; ground moves arrive as `message_stored` → judge → `verdict_changed` or `artifact_changed` | nightly net enqueues `prep_requeue` markers as events (the `requeue.ts` proto-queue retires into the spine) |
| entity maintenance on the draft lane (fingerprints · calendar recognition · reflection · orphans) | 2-hourly per user | `entity_changed` / `calendar_changed` for recognition | **nightly** per user: fingerprints, reflection, orphans (cheap and sig-gated) |
| evidence settle + LAW 2 expiry (`commitments-sweep`, 6 h) | per-account walk | reverse doors become `message_stored`/`calendar_changed`/`transcript_ready`/`user_deed` events; expiry becomes `clock_due` at due + grace | **daily** evidence net (the per-account sweep, fed by only the objects that have new evidence since their last settle — `evidenceTier` already knows) |
| label write-back retry (`label-sweep`, 2 h) | backstop for fire-and-forget labels | a `label_writeback` handler on `message_stored` with queue retries | **daily** net over items missing `labeled` |
| Home-GET `after()` heals (`reconcileRepliedItems` every 10 min, cluster recompute, held-cache prime, anticipation pass, bundle naming, briefing compose) | tied to page opens | `message_stored` (reply-state reconcile is the Sent pass's own event), `brief_stale`, `clock_due` for anticipation | none needed; the Home GET does **no** heavy work at all |
| mail pull fallback (`fetch-emails`, 15 min) | ingest | **stays** (it is ingest, not work) | revisit its cadence once push reliability is measured on the board |
| calendar sync (hourly) | ingest | **stays**; emits `calendar_changed` | — |
| workflows dispatch (hourly), render-memory, renew-push, retention, status-alerts | scheduled by nature | **stay** | — |

After Phase 4 there are **three clock-driven jobs**: ingest (mail/calendar), the nightly net, and
the scheduled workflows. Every other piece of work is started by an event.

---

## PART B — THE WORK INDEX

### B.1 The row

Table `public.work_index`: one row per **live** work object. It is keyed `(user_id, object_key)`,
where `object_key` is `inbox:<id>` / `commitment:<id>` / `meeting_action:<id>` / `tool:<source>:<id>`.

| Column group | Columns | Source (the one reader it comes from) |
|---|---|---|
| identity + address | `object_kind`, `object_id`, `room_key`, `href` | `roomKeyForItem` / the one door (`lib/room/door.ts`); THE ADDRESS LAW: every surface links the same URL |
| the machine | `state` (WorkLifecycle), `primary`, `verdict_work`, `verdict_resolution`, `judged_at`, `judged_first_at`, `judge_version`, `confidence` (D.4), `moot_ask_keys` | `deriveState` via the batched reader (`workStatesFor` inputs) |
| prepared | `prepared_kind`, `prepared_by`, `prepared_at`, `prepared_title`, `send_ready` | `preparedStatesFor` (THE ONE PREPARED READER; `isLiveArtifact` already applied) |
| facts for words | `title_facts` (the deck's own sources: understanding ask / work_title / subject, stripped of deixis per LAW 3), `counterparty_name`, `counterparty_address`, `person_entity_id`, `due_date`, `sort_at` (last activity) | the same fields the brief route reads today, **without bodies** |
| project | `entity_id`, `project_tracked`, `project_name` | entity links against the tracked registry (THE ROW TAG) |
| seat + band | `deck_eligible`, `self_authored`, `proved_alive`, `fresh_until`, `held_class`, `band`, `quiet_since`, `not_judged` | `seatVerdict`, `classifyHeld`, `bandOf`, `provedAliveOf`, `deriveHeld` facts. **The rank itself is computed at read time** (`rankAttention` is pure and needs today's calendar adjacency) |
| truth stamps | `input_sig`, `index_version`, `derived_at`, **`valid_until`**, **`dirty_at`** | see B.3 |

**Words are not stored.** `whyNowOf`, `STATE_WORDS`, `whyHeldOf` and `plainDay` run at serve time
over the stored facts: pure, zero IO, microseconds. That keeps THE SERVED-WORDS LAW (LAW 3) intact:
the index stores the facts that words are made from, never the words.

Settled objects **leave** the index. A `settled_today` count comes from `resolved_at` for the day
ring (THE RESOLVED_AT LAW), and nothing else about settled work is indexed.

### B.2 One writer

`lib/work/index-writer.ts`:

- `deriveIndexRow(inputs): IndexRow`: **pure**. It calls `deriveState`, `seatVerdict`,
  `classifyHeld`, `bandOf` and the prepared reader's pure half (`liveFromSourceData`,
  `poolRowsToArtifacts`, `stampTruth`, `stampExpiry`), and it computes `valid_until` (A.4, the time
  rule). Unit-tested in `tests/unit/work-index.test.ts`.
- `refreshIndex(admin, userId, objectKeys[])`: gathers inputs through the **existing batched
  readers**: the `workStatesFor` reads plus the held-facts reads, body-free. It then upserts with a
  conditional: `WHERE work_index.input_sig IS DISTINCT FROM excluded.input_sig` (no write when
  nothing changed) and a monotonic guard on `derived_at` (an older derivation never overwrites a
  newer one). Objects no longer open are deleted.
- It is the **only** writer. It runs only as the `index` handler (and in the backfill script). No
  writer anywhere (judge, prepare, commit door, apply-verdict) reads `work_index`. **Decisions read
  live truth; only surfaces read the index.**

### B.3 How it stays true

1. **Dirty marking by the database, not by memory.** Triggers on the input tables (`inbox_items`,
   `commitments`, `item_plans` where `kind='judgment'`, `item_deliverables`, `room_turns` where the
   component is an `input_checklist`, `entity_links`) run one cheap statement:
   `update work_index set dirty_at = now() where user_id = NEW.user_id and object_key = <key>`.
   Every writer is caught, including repair scripts, `/api/restore` and SQL-editor fixes, so no
   writer can forget to emit. (Emission of the matching `artifact_changed`/`entity_changed` event
   stays in code. The trigger only guarantees that a missed emit can never be *served*.)
2. **The read verifies.** The Home query returns rows plus a `needs_live` flag
   (`dirty_at > derived_at OR valid_until <= now() OR index_version < current`). Rows flagged this
   way are **re-derived live, inline, bounded** before paint: at most 25, through `workStatesFor`,
   which costs about 4 queries whatever N is. Clean rows serve from the index. The first paint is
   always the live truth, so NO MUTATION AFTER PAINT holds, and a stale row can be *detected* but
   never *shown*.
3. **Self-heal.** Every `needs_live` row enqueues an `index` event (priority 0), so the next open
   finds it clean.
4. **Overflow is loud, never silent.** If `needs_live` exceeds the bound (for example the first
   open after an `index_version` bump), the route serves through **the current live path**, which
   stays in the code as the fallback. It logs `index_overflow` and enqueues a user-scope reindex.
   The fallback is a slower true page; it is never a faster false one.
5. **Version bumps.** `index_version` is a registered `*_VERSION` constant (THE ONE SIG). A bump
   makes rows `needs_live` at read time *and* enqueues a low-priority reindex per account. No
   stop-the-world migration.
6. **Realtime.** Home's `postgres_changes` subscriptions (`components/home/home-view.tsx:1840`,
   inbox_items + commitments) move to `work_index`. That means smaller payloads, and a bump fires
   only when something a surface shows actually changed. The client keeps `freezeForOpen` (rows
   under the cursor are not swapped in place, per THE ONE PRODUCTION DOOR precedence ruling #8).

### B.4 Reads (one indexed query each)

| Surface | Query | Index |
|---|---|---|
| Home deck + day frame | `select … from work_index where user_id=$1 and deck_eligible and band is null order by sort_at desc limit 200` + today's calendar (≤ 20 rows) → `rankAttention` at read | `(user_id, deck_eligible, sort_at desc) where band is null` |
| Held ledger (door counts + bands) | RPC `work_index_counts(user)` → `{band, class, n}`; the band pages `… where band=$2 order by sort_at desc limit 50 offset …` | `(user_id, band, held_class, sort_at desc)` |
| Project room lists | `… where entity_id=$1 and user_id=$2` | `(user_id, entity_id)` |
| Triage deck | `… where user_id=$1 and not_judged or state in (...)` | the band index plus a partial on `not_judged` |
| Room header state word | the row by `object_key` (the room door still runs `workStateOf` live; the index only speeds up lists) | PK |

**Home, the full server path after cutover:** profile (`home_brief` last-good text) + the index
deck query + counts RPC + today's calendar + at most 25 live re-derivations. Five round trips, all
indexed and body-free.

### B.5 Migration with a shadow-compare period

1. **Write-only (shadow).** Migration applied; `index` handler live; backfill
   `scripts/backfill-work-index.ts` (dry-run by default, `--apply --user|--all`, zero AI). Home still
   serves the live path.
2. **Parity census.** In the Home route's `after()` (reads only, sampled at 1 in 5 opens), compare
   the served live rows with the index rows: state, `verdict_work`, `prepared_kind`, band, class,
   project, and the **served top-5 set**. Diffs go to `console.warn` plus a census script
   `scripts/census-work-index-parity.ts` (zero AI, zero writes) that recomputes both on every
   active account.
3. **The gate, `smoke-work-index-parity` (tier-1 outcome gate):** over 7 consecutive days on every
   active account, **≥ 99.5% row agreement, 100% served-top-5 agreement, and zero rows where the
   index says open and live says settled** (the dangerous direction). Every diff class that is
   found gets fixed at the writer, never by widening the tolerance (HARDEN THE FIXTURE, NEVER WEAKEN
   THE GATE).
4. **Cutover per account** behind `WORK_INDEX_READ` (env list, then a `tenant_configs` flag). The
   owner's account goes first, then a walk (THE WALK DOCTRINE), then everyone. Rollback means
   turning the flag off, and the live path is unchanged.

### B.6 Targets

| Measure | Today (dev log) | Target |
|---|---|---|
| Home GET server time | 8–23 s (p50 ≈ 9 s) | **p50 < 300 ms, p95 < 600 ms** |
| Held ledger open | full-pool walk | p95 < 300 ms |
| Bytes read per Home open (account A) | ~75 MB | < 200 KB |
| Event → visible on Home | 0 s to 2 h (sweep) | p95 < 60 s (kicked), < 2 min (backstop) |
| Deed → its work settles | seconds (after()) or next 6 h sweep | p95 < 30 s, durable |

---

## PART C — THE LIFECYCLE

### C.1 Three classes, declared per table

| Class | Meaning | Tables | Hot-path rule |
|---|---|---|---|
| **Working set** | live work the product reasons about now | `work_index`; open `inbox_items` (status pending, not graduated), open `commitments`, live `item_deliverables`, un-archived ask turns | read only through the index or partial indexes |
| **Archive** | settled work kept for history, undo, recall, the room's "earlier (N)" | settled `inbox_items`/`commitments`, `emails`, `room_turns` (permanent record, per THE HISTORY DRAWER), `activity_events`, `action_commits` | never read on a request path except by id |
| **Logs** | append-only telemetry and ledgers | `ai_usage_events`, `learning_signals`, `work_events`, cache kinds in `item_plans` | read only through rollups beyond the raw window |

A table registry `lib/store/lifecycle.ts` (the same pattern as `ITEM_PLAN_REGISTRY`) names every
table's class, its raw retention, its rollup, and its readers. `smoke-lifecycle` fails a migration
that creates an unclassified table.

### C.2 The working-set bound and graduation (reusing existing laws, no new rules)

An object leaves the working set by one of the existing doors, now fired by events and `clock_due`
instead of sweeps:

| Door | Existing law | Trigger in the spine |
|---|---|---|
| settled (reply, delivered, done, dismissed) | EVIDENCE SETTLES · THE FULFILLMENT LAW · VERDICT MOVES THE POSTURE | `message_stored`/`user_deed`/`calendar_changed` → settle |
| expired | THE EXPIRY LAW (LAW 2) | `clock_due` at due + grace |
| parked | the judge's `revisit` or the person's park (Q9) | stays indexed with `state='parked'`, off the deck; `clock_due` at the date |
| quietly filed | Q3 graduation (`GRADUATION_DAYS` 10, `GRADUATING_CLASSES`, standing deadlines exempt) | `clock_due` at `quiet_since + 10 d`, per row. The daily graduation walk retires. |

**Declared bound:** ≤ 1,500 indexed live rows per account in steady state. It is reported on the
board when exceeded (NO SILENT CAPS). Measured: account A's 3,514 pending rows are about 95% held
mail. Graduation already exists but runs on a walk, so most of that tail is work graduation *would*
file and has not reached yet.

### C.3 Hot paths

1. **Bodies out of work rows.** `html_body` + `body` are 96% of `inbox_items.source_data` bytes
   and live a second time in `emails.body/html_body`: a ONE FACT, ONE HOME breach. Steps:
   (a) **Phase 0, no migration:** every listing read projects JSON paths
   (`source_data->understanding`, `->subject`, `->from`, `->from_address`, `->received_at`,
   `->proof_of_life`, `->draft`, …) instead of `source_data`. First targets:
   `lib/deeds/held-members.ts` (the 72 MB read), the brief's deck and FYI pools, `workStatesFor`'s
   inbox read. (b) **Phase 5:** a guarded sweep strips `body`/`html_body` from `source_data` on rows
   whose `emails` row holds them (dry-run default). Readers that need a body read `emails` by
   `source_id`, which the mail viewer already does.
2. **Partial indexes** (one migration): `inbox_items (user_id, last_activity_at desc) where
   status='pending'`, `commitments (user_id, due_date) where status='open'`, `item_plans (user_id,
   kind, updated_at desc)`, `room_turns (user_id, dedupe_key) where archived_at is null and
   component->>'key'='input_checklist'` (the machine's ask read, today `limit(200)`).
3. **THE HOT-PATH LAW** (new, E.2): a GET handler that renders a surface reads bounded, indexed,
   body-free rows; `fetchAllRows` belongs to writers, sweeps and censuses. It is enforced by a
   source gate over `app/api/**/route.ts` GET paths with a shrinking allowlist. Today's entries:
   `home/brief`, `home/timeline`, `entities/portfolio`, `knowledge/status`, `workflows/[id]`.

### C.4 Log rollups

- **`ai_usage_daily`** (day, user_id, company_id, source, provider, model, tier, task_type,
  workflow_id → calls, prompt_tokens, completion_tokens, cost_eur). The nightly upsert for day−1 is
  idempotent. Readers move to it: the status board (14 d) and `ai-operations-metrics` (180 d) read
  the rollup plus today's raw tail. **The workflow lifetime metric** (`app/api/workflows/[id]/metrics`,
  unbounded today, the caveat in `app/api/cron/retention/route.ts`) reads the rollup, so pruning
  raw rows no longer turns a lifetime total into a floor. The tenant AI ceiling (A.3) reads it too.
  Scale: ~1,750 raw rows/day today (≈640k/yr) versus a few dozen rollup rows/day.
- **`learning_signals` compaction.** `item_dismissed` (85%) and `reply_sent` go to a
  `learning_daily` rollup per (user, signal_type, sender class), and the raw rows stay for the raw
  window. **The outcome ledger** (`action_taken`, `ledger_v` 2) is not telemetry. It is the input to
  the decision eval (D.3), so it graduates to a typed table `prepared_outcomes` (verb, lane, door,
  outcome, counterparty class, age, judge_version) and keeps the longer window.
  `lib/context/context-service.ts` `processAllSignals` (the admin backfill that reads everything)
  is updated to read rollup plus raw.
- **`work_events`**: 14 days done, 30 days dead (A.3).

### C.5 Splitting `item_plans`: only where hot

At 7,219 rows the table is small. Splitting it is about typed columns and indexability, not size.
The proposal is deliberately narrow:

| Kind | Rows · avg B | Decision | Why |
|---|---|---|---|
| `judgment` | 1,541 · 474 | **→ typed table `work_judgments`** (object_key, verdict_work, resolution, confidence, judge_version, sig, ev_sig, verdict jsonb, judged_first_at, judged_at) | read in batch by every surface, the machine, the index writer and the eval. `verdict_work` / `judge_version` / `confidence` need real columns (the not-judged census, the eval, the abstain lane) |
| `conversation_pair` | 1,987 · 243 | stay; **retention 90 d** (a cache) | largest kind, recomputable |
| `fulfillment`, `expiry` | 759 / 58 | stay; prune when the object is settled > 30 d | caches keyed to an object |
| `prep_outcome` | 632 · 132 | stay (180 d, already set) | — |
| `commitment`/`email`/`meeting` plans | 571 / 152 / 16 | stay | the Identified-tasks plan; revisit if the panel retires |
| `anticipation`, `proof_of_life`, `reaction_fire`, `handoff_nudge` (tokens) | 226 / 195 / 8 / 1 | stay; prune **only** tokens whose fire key is in the past by > 30 d (a past meeting start cannot re-fire) | "never prune" becomes "never prune a token that could still fire" |
| `sweep_claim`, `*_sweep` markers, `prep_requeue` | small | **retire** with Phase 4 (the queue owns claims and rotation) | — |
| `room_brief` | 166 · 1,097 | stay | one per room, upsert |

Migration path for `work_judgments`: dual-write through `lib/store/item-plans.ts` (the door already
centralises every judgment write), backfill (zero AI), switch reads in the door, then stop the
`item_plans` write after one clean week. `smoke-typed-stores` pins it.

### C.6 Retention: options for the owner

Defaults marked **(proposed)**. Per-tenant override via `tenant_configs.retention`. Deletion on
account closure cascades to every class, including rollups keyed by `user_id` (GDPR Art. 17).

| Class | A · lean | **B · proposed** | C · regulated-long |
|---|---|---|---|
| `ai_usage_events` raw | 30 d | **60 d** | 200 d (today's setting) |
| `ai_usage_daily` rollup | 13 months | **contract term + 12 months** | 7 years |
| `learning_signals` raw (dismiss/reply) | 60 d | **90 d** | 180 d |
| `prepared_outcomes` (the eval's ledger) | 12 months | **24 months** | contract term |
| `work_events` done / dead | 7 d / 14 d | **14 d / 30 d** | 30 d / 90 d |
| `item_plans` caches | per-kind table above | **per-kind table above** | same |
| settled `inbox_items` + `emails` copies | 12 months after settle | **24 months** | contract term (the client's mailbox remains their system of record) |
| `action_commits` + `activity_events` (proof of human approval and undo) | 24 months | **contract term + 12 months** | 7 years |
| `room_turns` | permanent (the user's own record) | **permanent while the account lives** | same |

**Legal and contract notes** (for counsel and the DPA, not legal advice). GDPR storage limitation
and minimisation (Art. 5(1)(c)(e)) favour the lean side for copies of mail, because the client's
mailbox, not us, is the system of record for correspondence. Regulated clients (legal,
accounting) have their own record-keeping duties, but those attach to their systems of record. Our
duty is to state our retention per class in the DPA and honour it. The **approval ledger** is the
exception worth keeping longer: it proves that every send was a human click, which is a selling
point for regulated buyers. Cost rollups back invoices, but the invoice is the legal record, so the
rollup needs only the contract term plus a dispute window. The retention cron's double gate
(`?apply=1` + `RETENTION_APPLY=true`) stays.

---

## PART D — THE DECISION EVAL

### D.1 The golden set (data in the DB, never in the repo)

Table `eval_labels` (RLS on, service role only, superadmin UI):
`user_id, object_key, input_snapshot jsonb, input_sig, expected_verb, acceptable_verbs text[],
expected_resolution, expected_entity_id (or 'none'), source ('walk' | 'unsure_tap' | 'correction'),
labelled_at, note`.

- **`input_snapshot`** is the judge's assembled input at label time, so a replay judges the same
  facts the label was about. The live item keeps moving and would make scores drift. This is a
  deliberate second copy of content. It is justified as a frozen test fixture, stays inside the
  perimeter, is deleted with the account, and has a stated retention (the label's life). It never
  leaves the DB: scripts print aggregates and object keys only.
- **Where labels come from, cheapest first.** (1) **Owner walks**: a superadmin-only "label this"
  affordance on the room header, with the verb chips from `WORK_VERBS`, "right as judged" one tap,
  and a project picker. (2) **The unsure lane** (D.4): every tap there is a label. (3) **Human
  corrections** that already exist (CORRECTIONS STICK): a membership move gives a project label, a
  user's park gives a `none+revisit` label, and a user dismissal of an item the judge decked is a
  *candidate* label that the owner confirms, never auto-trusted.
- **Starting size: 150 items.** At least 10 per verb (8 verbs), at least 40 `none` including hard
  negatives (cold outreach that looks like a request, CC-seat asks, own-coworker mail), and at
  least 20 decked items the owner says should have been held. Sources: the owner's account, one
  pilot account (with that user's consent), and the probe host (`scripts/probe-user.ts`).
  **Owner time: about 2 hours** (≈45 s per item, in six sittings of 25).

### D.2 The scorer

`scripts/eval-judge.ts --version <JUDGE_VERSION> [--model <override>] [--limit N]`:

- replays `judgeWork` on each snapshot **through the factory with the label owner's tier** (TIER
  PRIVACY; no `getSystemClient`), using a **write-suppressing client**, the same device as
  `backfill-not-judged.ts`, so no judgment cache is touched
- reports verb accuracy (exact, and within `acceptable_verbs`), the confusion matrix, **false-none
  rate on actionable labels** (the silent-hide rate, the metric that matters most), resolution
  accuracy, and project accuracy
- writes one `eval_runs` row (version, model, tier, n, metrics jsonb, cost_eur, started_by) and
  prints aggregates only
- **cost bound**: 150 × ≈€0.003 ≈ **€0.45 per run** on standard. The script refuses to start when
  its estimate exceeds €5 without `--i-accept-cost` (the house cost rule).
- **THE EVAL GATE**: a `JUDGE_VERSION` bump or a judge model change ships only with an
  `eval_runs` row for the new version whose accuracy ≥ baseline − 2 pp **and** whose false-none
  rate ≤ baseline. It is registered as a live-ai gate, run by the orchestrator once per bump.
  `smoke-laws` checks that the row exists for the current constant.

### D.3 The live quality metric (the outcome loop, consumed at last)

From `prepared_outcomes` (C.4), per verb per week: **accepted · edited · discarded · done_elsewhere
· expired · superseded** rates, and the median age at outcome. On the status board:

- **done_elsewhere** high: we were right about the work and too slow or unused. That is a speed
  and reach signal.
- **discarded** high on one verb: the judge or the drafter is wrong on that verb. The eval's next
  labelling sitting targets that verb.
- **edited share** trend: the drafter's quality.

Amber thresholds start permissive (discarded > 40% on N ≥ 20) and are tightened by data. This
fulfils THE OUTCOME LOOP (LAW 7) *as measurement*. Feeding facts back into the judge stays behind
the W0.6 quarantine and precedence ruling #7 until `outcomeLedgerReady()`.

### D.4 The abstain path: a low-confidence none never silently hides work

Today the judge prompt says "CONSERVATIVE: unsure → none" (`lib/work/judge.ts:687`), so
uncertainty and "nothing to do" produce the same output, and a `none` with a disposition resolves
the item.

- The verdict gains `confidence: 'high' | 'low'` and, for `none`, a `none_kind`: `noise` ·
  `answered` · `expired` · `not_mine` · `unsure`. The prompt rule becomes "unsure → none with
  confidence low", and `JUDGE_VERSION` goes to 22 (behind the EVAL GATE, D.2).
- `lib/work/apply-verdict.ts`: a `none` with `confidence: 'low'` or `none_kind: 'unsure'` **never
  resolves, strips or settles**. The kind floor's structural nones are code-decided, so they are
  always `high`.
- **The held ledger gets a new class, `unsure`, in the WAITING band** (never `handled`, never
  graduating). Its words: "I'm not sure this needs you — one look". Three taps: *needs me* (becomes
  a label, then `judge` re-runs with the user's word as a fact) · *not mine* (a label, then files) ·
  *later* (a park). Every tap writes `eval_labels` (source `unsure_tap`). The eval grows in
  exactly the places where the judge is weakest.
- Budget: `unsure` rows count against nothing on the deck (THE DENSITY LAW holds). The waiting
  band's door shows their count, which is honest calm (law 9, inverse clause: "a real ask is never
  buried").

---

## PART E — LAWS: RETIRED, SIMPLIFIED, AMENDED, NEW

### E.1 Retired or simplified by A–C (registry ids)

| Law | Change | Why |
|---|---|---|
| `reach-law` (LAW 1) | **simplified**: "every object with a changed input is judged within one drain; reach is the queue's lag and dead-letter count" | reach becomes structural; the sweep census retires |
| `the-list-says-only-what-was-judged` (W8.6 not-judged lane) | **simplified**: the lane becomes the nightly net's population; its per-run caps and `leftBehind` move to the queue's budget accounting | new rows are judged on arrival, and only stragglers remain |
| `evidence-settles` | **strengthened wording**: "within one sync cycle" becomes "within one event drain (p95 < 2 min)" | the reverse doors become durable |
| `expiry-law` (LAW 2) | unchanged statement; trigger moves to `clock_due` | no 6 h latency |
| `attention-quality-laws` (Q3 graduation) | unchanged statement; trigger moves to `clock_due` per row | no daily walk |
| `time-budgets` | **simplified** for the Home: the Home GET schedules no heavy `after()` work at all; the clause survives for other routes | the heals become events |
| `stamped-cache-law` | **scope shrinks**: the instant-load LS hydrate is kept only as an offline and slow-network cushion | a sub-300 ms server paint makes the stale-cache dance mostly unnecessary |
| `no-silent-caps` | **simplified on request paths**: GET paths read bounded index queries (THE HOT-PATH LAW); the paging obligation stays with writers and nets | fewer sites to guard |
| tier-3 lessons: THE SWEEP ROTATION (least-recently-served), the fan-out claim window, label-sweep coverage repair, `SWEEP_CLAIM_INTERVAL` | **obsolete** after Phase 4, except the rotation, which survives only inside the nightly net | the queue owns fairness and claims |
| `prep_requeue` mechanism (`lib/prepare/requeue.ts`) | **retired into the spine** | it was a hand-built queue |

### E.2 Amended (owner calls, because they touch tier-1 wording)

- **`one-fact-one-home` (invariant 6).** "…a derived view never persists as a second truth"
  becomes "…a derived view never persists as a second truth; **a materialized reader** (the work
  index) may persist the one reader's output only with its input stamp, is written only by that
  reader, is never read by a writer or a decision, and is verified before paint."
- **`the-machine`** ("derived at read time … never a stored state") becomes "derived by the one
  ladder; materialized only by THE MATERIALIZED READER; a surface never paints a row whose inputs
  moved or whose `valid_until` passed."
- **Precedence ruling #13 (new): THE MATERIALIZED READER vs NO MUTATION AFTER PAINT.** "Verify
  before paint." A dirty or expired index row is re-derived live before the first paint (bounded),
  or the page serves through the live path. A background index refresh never swaps a painted row.
  It arrives as the realtime bump the client already treats with `freezeForOpen`.

### E.3 New laws (each with homes, collisions and a gate, per the admission rule)

| Law (tier) | Statement | Homes | Collides with → precedence | Gate (kind · cost) |
|---|---|---|---|---|
| **THE EVENT SPINE** (2) | Every change to a work object's inputs reaches its handlers through `emitWorkEvent`, coalesced per object and durable; no work lane runs on a clock except the declared nets, ingest and scheduled workflows. | `lib/events/*`, `app/api/internal/events/drain` | `exactly-once-deeds`: handlers still claim conditionally, and the queue is at-least-once by design. `human-in-the-loop`: no handler may fire a deed; handlers only judge, prepare, settle or index. | source gate: no `void import(...).then(settleForEvent…)` / floating doors outside `emit.ts` (shrinking allowlist) · zero-ai. Outcome census: lag p95, dead letters, coalescing ratio · zero-ai |
| **THE MATERIALIZED READER** (1, amends 5/6) | The work index is written only by `deriveIndexRow`; every row carries its input sig and `valid_until`; no writer or decision reads it; a dirty or expired row is re-derived live before paint. | `lib/work/index-writer.ts`, the triggers migration | ruling #13 above; `served-words-law`: the index stores facts, never words | pure: `tests/unit/work-index.test.ts` · zero-ai. **Outcome: `smoke-work-index-parity`** (B.5 thresholds) · zero-ai. Walk per release |
| **THE HOT-PATH LAW** (2) | A GET that renders a surface reads bounded, indexed, body-free rows; full listings belong to writers, nets and censuses. | `app/api/**` GET routes | `no-silent-caps`: bounds are declared and reported, never silent | source gate over GET handlers (shrinking allowlist) · zero-ai. Outcome: the slow-log census (Home p95) · zero-ai |
| **THE LIFECYCLE LAW** (2) | Every table has a declared class (working / archive / log), a retention, and, for logs, a rollup; a reader past the raw window reads the rollup. | `lib/store/lifecycle.ts`, `app/api/cron/retention` | `room_turns` stays permanent (THE HISTORY DRAWER wins); tokens that can still fire are never pruned | source gate: every `create table` in `supabase/migrations/` is classified · zero-ai |
| **THE EVAL GATE** (2) | A judge prompt or model change ships only with an eval run on the golden set within tolerance and with no rise in false-none. | `scripts/eval-judge.ts`, `eval_runs` | `the-one-sig`: a version bump is the trigger | registry check that an `eval_runs` row exists for `JUDGE_VERSION` · live-ai (orchestrator) |
| **THE ABSTAIN FLOOR** (2) | A low-confidence or `unsure` none never resolves, strips or hides; it waits in the `unsure` class until a person or a later high-confidence verdict decides. | `lib/work/apply-verdict.ts`, `lib/home/attention.ts` (`classifyHeld`) | `trichotomy-law`: unsure counts as ASKED. `verdict-moves-posture`: only a high-confidence none moves posture. `kind-floor`: structural nones are always high. | pure test on apply-verdict · zero-ai. Outcome census: zero low-confidence nones resolved · zero-ai |

---

## PART F — PHASES

Every phase: behind a flag, reversible, board green, the one live suite it touches, and a walk if a
surface changed. Migrations are applied manually by the owner, and **code works before the
migration lands** (table-existence checks: a missing table means the flag reads off).

### P0 · THE QUICK SNAP (days, no migration): owner value first

- JSON-path projection on the hot listings: `held-members.ts`, the brief's deck and FYI pools,
  `workStatesFor`'s inbox read. No `body`/`html_body` on any Home read.
- The Home GET's heavy `after()` heals are rate-limited per account per 30 min, down from per open
  (`reconcileRepliedItems`, cluster recompute). The anticipation pass and held-cache prime stay in
  `after()` until P4.
- A `HOME_TIMING` census script over the slow log.
- **Acceptance:** on account A, bytes per Home open drop from ~75 MB to < 5 MB; Home p50 < 3 s
  (estimate: the held pool's ~4 × 1.4 s pages collapse; verify with the slow log, never claim it
  unmeasured); `smoke-deck-truth` and `smoke-waiting-truth` unchanged; a walk.
- **Cost:** zero AI; engineering ≈ 1 day. **Risk:** a projection that omits a field a floor reads,
  which a census shows as a deck diff. Mitigation: a parity check on served payloads before and
  after.

### P1 · THE QUEUE (≈1 week)

- Migration: `work_events` + the 3 RPCs + `event_drainers`. Code: `lib/events/emit.ts`,
  `handlers.ts`, the drain route, the minute cron, the status-board band.
- The first handlers are **the existing reverse doors** (mail/calendar/transcript/deed evidence,
  commitment extraction, label write-back, reactions). Each `void …` door becomes an emit. The
  sweeps are untouched and remain the net.
- Flag `EVENT_SPINE=off|shadow|on` (shadow: emit and drain but also run the old door, and compare
  settle outcomes).
- **Acceptance:** dead letters 0 over 72 h; lag p95 < 60 s; settle parity with the old doors ≥ 99%
  (`census-evidence-reach` numbers equal or higher); `smoke-events` (new): the claim is
  exactly-once under 8 concurrent drainers, coalescing, dedupe, reaper, per-user fairness. Pure and
  probe-DB, zero AI.
- **Cost:** infra about +45k cron invocations/month plus kicks, within Vercel Pro's included usage.
  Short function time (the drainer runs only when there is work). DB: roughly ≤ 5k event rows/day
  at today's scale. AI: none new (the same handlers, run once instead of possibly twice).

### P2 · THE INDEX, SHADOW (≈1–1.5 weeks)

- Migration: `work_index` + partial indexes + dirty triggers + `work_index_counts`.
- `index-writer.ts`, the `index`/`clock_due` handlers, `backfill-work-index.ts` (dry-run by
  default), the parity census in `after()`, `smoke-work-index-parity`.
- **Acceptance:** B.5's gate green for 7 days on every active account. **Cost:** zero AI; DB ≈
  1 row per live object (~500 B), about 5k rows today. **Risk:** trigger overhead on hot writes
  (one indexed update per write); measured in the sync route timing and rolled back by dropping the
  triggers.

### P3 · CUTOVER READS (≈1 week), the snappiness milestone

- Home, held, project-room lists and triage read the index (B.4), with the live path as the
  overflow fallback. Realtime moves to `work_index`.
- **Acceptance:** Home server p50 < 300 ms, p95 < 600 ms over 3 days; parity sampling continues;
  the full owner walk (Home, held, a project room, triage, a deed, and the deed's row leaving the
  deck within 60 s). **Rollback:** the `WORK_INDEX_READ` flag.

### P4 · EVENTS REPLACE THE SWEEPS (≈1.5 weeks)

- judge / prepare / expiry / graduation / labels / anticipation on events and `clock_due`
  (A.7); the crons shrink to the nightly nets; `prep_requeue` and sweep claims retire.
- **Acceptance:** judge reach ≥ the sweep era (the W8.6 census); commitments nominated ≥ the
  `census-evidence-reach` baseline; **judgment AI calls per day fall** (target: ≤ 2 × arrivals,
  against about 5.6 × today) with no fall in deck truth. Each lane's flag can independently
  re-enable its 2 h cron.
- **Cost:** AI **drops**. Today's day-keyed re-judging is the largest clock cost (the stabilization
  plan estimated ~€2–3/day at full reach). Expected saving 50–70% of judgment spend; it will be
  measured, never assumed.

### P5 · THE LIFECYCLE (≈1 week, plus owner retention call)

- `ai_usage_daily`, `learning_daily`, `prepared_outcomes`, `work_judgments` (dual-write, then
  cutover), `lib/store/lifecycle.ts` + `smoke-lifecycle`, per-kind `item_plans` retention, the
  body-strip sweep (dry-run by default). The retention cron applies the chosen option (C.6).
- **Acceptance:** status board and AI-operations numbers equal from rollup and raw for the overlap
  window; the workflow lifetime metric no longer undercounts; retention dry-run reviewed by the
  owner before `--apply`.

### P6 · THE EVAL + ABSTAIN (starts in parallel with P1; labelling is owner time, not engineering)

- `eval_labels`/`eval_runs`, the superadmin label affordance, `eval-judge.ts`, the per-verb outcome
  band on the board, then the abstain path (JUDGE_VERSION 22) once a baseline run exists.
- **Acceptance:** baseline run recorded on 150 labels; JUDGE_VERSION 22 passes THE EVAL GATE; the
  unsure class renders in WAITING with its three taps (walked); zero low-confidence nones resolved
  (census).
- **Cost:** ≈ €0.45 per eval run; one baseline plus one per bump. Engineering ≈ 1 week. Owner
  ≈ 2 hours of labelling.

**Total:** roughly 6–7 engineering weeks with the protocol's three parallel implementers on
disjoint fences (P0 → P1 → P2 → P3 in sequence; P6 alongside; P4/P5 after P3). New infra cost:
none outside the existing Supabase and Vercel plans. Net AI cost is expected to go **down**.

### Risks

| Risk | Mitigation |
|---|---|
| Event storm on a first sync or backfill (thousands of `message_stored`) | priority 9 for backfill emits; per-user fairness in the claim; the first-look bootstrap keeps its own path; coalescing |
| A handler that is not truly idempotent | every handler maps to an existing sig-keyed or conditional door; `smoke-events` replays each handler twice and asserts one effect |
| Index drift | dirty triggers + `valid_until` + verify-before-paint + parity census; the live path stays as the fallback |
| Trigger overhead on sync writes | one indexed update per write; measured; the triggers are droppable (the read verifies via `input_sig` anyway, just more slowly) |
| Law churn confusing agents | E.1/E.2 land in the registry in the same commit as the code that changes them (the admission rule) |
| Migration sequencing (manual) | each phase's code detects its table and reads the flag as off until it exists |
| A cron-minute drainer on Vercel failing silently | the drainer heartbeat is red on the board; the kick path is independent of the cron |

---

## PART G — WHAT THE OWNER MUST DECIDE

1. **Queue choice.** A plain Postgres job table (recommended), or pgmq, or an external vendor
   (requires a stated sovereignty reason and a DPA update).
2. **Two tier-1 wording amendments** (E.2): ONE FACT, ONE HOME and THE MACHINE admit a
   materialized reader under verify-before-paint (precedence ruling #13).
3. **Retention option per class** (C.6: A lean / **B proposed** / C regulated-long), and whether
   tenants may override it in `tenant_configs`. Counsel confirms the DPA wording.
4. **Stripping stored bodies** from `inbox_items.source_data` (C.3 step b, a guarded sweep): yes or
   no, and when.
5. **Labelling time.** About 2 hours for the first 150 labels. Also: which second account may
   contribute labels (with that user's consent), and whether the superadmin label affordance may
   ship on the room header.
6. **The abstain lane's wording and seat** ("I'm not sure this needs you — one look" in WAITING).
7. **Per-tenant daily AI ceiling default** (proposed €1.50/day) and what happens at the ceiling
   (proposed: defer AI work to the next day, deeds and settles never deferred, shown on the board).
8. **Phase order.** Snappiness first (P0 → P3) as proposed, or the sweep replacement (P4) earlier
   for the cost win.
9. **Prod census.** Run the read-only census on production before P5 sizing (the numbers above come
   from the `.env.local` database).
