# THE LIVING HOME — agenda spine, action events, graceful projection

**The gap (July 20):** we built the memory (One Brain) and the surfaces (deck, ring, brief, Ask chat), but
not the **reactive loop between them**. Actions flow *down* to rows (`status='dismissed'`), never *up* into
the brain; brain updates flow *down* on a timer (daySig recompose found by the next poll), never as events.
Observed symptoms: the ring said 8, the deck showed 5 rows, "done today" said 12 of 20; the brief led with a
different item than the deck's hero; the prose kept arguing for an item the user had already cleared; the
Ask chat could recommend something dismissed seconds earlier.

**The principle:** ONE derived agenda everything projects from; user actions are first-class brain events;
projections (prose, counts, chat) degrade gracefully per-action and re-author quietly afterwards.

**Verified root causes (from code, not guessed):**
- `assembleLedger` (`lib/entities/state.ts`) sigs the ledger as `length:newest-at` — resolving an item
  changes NO line count and NO timestamp, so `refreshEntityState` skips: **the brain structurally cannot
  notice a user action.** Also the inbox lines don't carry resolution status at all.
- Ring/deck/brief/Ask each compute their own count/pick: ring = atom sum (route ~1109 + client ~1936), deck
  = bundled rows, brief lead = the model's own pick over `actions`, Ask = a fresh DB snapshot. Nothing
  shares an ordering, so disagreement is structural.
- "done today" counts every sent email + auto-resolutions (`repliesSentRes`, known-loose) → reads inflated.
- Action endpoints (`inbox/[id]/dismiss|complete`, `commitments/[id]` PATCH, send-reply, restore) commit the
  row write but never touch `work_entities` or `profiles.home_brief`.
- The brief recompose runs in `after()` gated on daySig; the client discovers it on the next poll (5–90s).
  `markActed` suppresses the self-action realtime refetch (correctly), but nothing schedules a follow-up.

---

## S1 — THE AGENDA SPINE (coherence: one number, one first thing)

*The confusing part. Fix the disagreement structurally, not count-by-count.*

- `lib/home/agenda.ts` — a PURE derivation `buildAgenda(brief, actedIds)` → `{ entries, rows, atoms, first }`:
  the ordered deck entries (bundles + singles, post-bundling, post-acted-filter), `rows` = what's visibly
  listed, `atoms` = underlying item count, `first` = the hero. Extracted from the inline deck assembly in
  `home-view.tsx` (the `doItems`/`bundleDoItems`/`sortEntries` block) so it's importable, testable, and the
  ONE ordering.
- **Ring = the agenda.** `DayClearedRing` shows `rows` (what the user can see), tooltip carries `atoms` when
  they differ ("5 to do · 8 items inside"). The header count, the section Label count, and the ring can no
  longer diverge — they all read the same object.
- **"Done today" honesty.** Count ONLY real user-driven resolutions: inbox `source_data.resolution_reason`
  / commitments `resolved_reason` in the user-action set (complete/dismiss/send/reply-resolution) — drop the
  bare "any sent email today" count (`repliesSentRes`) and system auto-resolutions from the ring number
  (they stay in the Activity log + "Handled for you", which is their honest home).
- **Prose lead == deck hero.** The brief compose inputs (`brief/route.ts` ~1332) get `actions` ALREADY in
  agenda order + an explicit `first` hint; `compose.ts` lead rule says: anchor the "start with" on the FIRST
  action candidate (it may argue for a different one only by naming it via its ref — never silently
  diverge). The deck hero and the opening sentence then point at the same thing by construction.
- Smoke: `scripts/smoke-agenda-coherence.ts` — for each user: ring rows == rendered entries; done-today ==
  count of user-actioned resolutions; compose lead references the agenda's first (or an explicit ref).

## S2 — ACTION EVENTS (the brain hears you)

- `lib/entities/on-action.ts` — `noteItemAction(supabase, userId, { itemKind, itemId, action })`:
  1. look up the item's `entity_links` row → its entity (skip if none/refusal);
  2. `refreshEntityState(supabase, userId, entityId, { force: true })` — ONE entity, cheap, reasoned;
  3. bust `profiles.home_brief` (the invariant: any write changing what the Home derives busts the cache).
  Fired via `after()` from ALL action paths: inbox dismiss/complete/send-reply, commitments PATCH,
  `/api/restore`, delegate. Non-fatal everywhere.
- **Ledger honesty** (`assembleLedger`): inbox lines carry resolution (`(handled)` / `(dismissed)`) like
  commitments already do; the sig becomes a small content hash over the line texts (not `length:newest`) so
  a status flip counts as change even without `force`.
- **Learning stays reasoned, not a weight table:** the state-synthesis prompt already judges priority; now
  the ledger SHOWS dismissals/completions, so "he keeps dismissing these" can lower `priority.weight` and
  "he replied" can flip `whoOwes` — through the same ONE reasoned pass, no new mechanism.
- Smoke: `scripts/smoke-action-events.ts` — act on a linked item (controlled) → entity `sig` changed, state
  re-synthesized (whoOwes/next_move reflect it), `home_brief` null; restore reverses; unlinked item = no-op.

## ═══ THE DAILY-REPORT ARC (July 20 — supersedes S3; S2/S4/S5 renumbered below) ═══

**The bar (user-set):** a colleague's externally-generated Slack daily summary — "Wins today / New tasks
(each `Task — Priority — due — blocker`) / Open questions (each with WHO + status)" — is the target QUALITY:
one typographic system, readable top-to-bottom in 30s, project names as inline anchors, dependency awareness
("blocked on <person>"). Our Home has the data but SEVEN visual idioms (DoRow/BundleGroup/PriorityCard/
DealCard/PeekRow/lenses/ambient) where that summary has one — "all over the place, hard to understand."

**The diagnosis:** that summary isn't a better UI, it's a better MODEL — it sits on a managed TASK LEDGER
(title/project/priority/due/status/blocked-on) while our Home sits on emails-that-need-replies. And we
currently have TWO spines — `lib/work-items/model.ts` (`buildWorkItems` → Timeline) and `lib/home/agenda.ts`
(→ Home) — the ledger must UNIFY them into ONE, never become a third.

**THE END GOAL:** the Home is a chief-of-staff's daily report over ONE work ledger — every line live
(click → deep-dive, act inline), the same ledger projected as Timeline (by date), Projects (by entity),
Chat (conversationally; the report IS turn-0), deep-dive (one line opened); every action updates
ledger → brain → all projections gracefully. Slack/email delivery is a LATER projection of the same report
(explicitly not first — reproduce the feel in-product first).

**Wins / Open questions — universal, not personal to that colleague's system:** every day has three tenses
(what moved / what needs you / what's unresolved). Only the SOURCING is personal — meetings for her; replies
sent, commitments closed, deals advanced for an email-only user. Rules: grounded-only + auto-hide when empty
(never manufactured cheer — calm voice, "Done today"/"Moved forward" not "Wins 🎉"); Open questions are
STRUCTURAL (reply-state + counterparty + age, whoOwes), never AI-invented.

### L1 — THE LEDGER (one spine)
- `lib/work-items/` becomes the ONE ledger: extend `WorkItem` with the report's task-ness — reasoned
  `priority` (entity weight + due, pin-overridable later), `status`, `blockedOn` (STRUCTURAL first: the
  awaiting counterparty / whoOwes name; reasoned later), `entity` (id+name from entity_links, not label).
- `lib/home/agenda.ts` keeps ONLY presentation grouping (bundling/lenses/hero) but consumes ledger tasks;
  the brief route + Home stop hand-mapping atoms separately from Timeline's.
- New-and-unsorted: entities founded in the last ~7 days with no user engagement → a `triage` cue.
- Smoke: `smoke-ledger.ts` — cross-user: one build serves Home + Timeline shapes identically; counts match
  the agenda smoke's invariants; blockedOn only ever a real counterparty string.

### L2 — ACTION EVENTS (unchanged from S2 above — the brain hears you)
- `noteItemAction` + ledger-honest `assembleLedger` (content-hash sig, resolution status on lines) +
  cache bust; fired from all action endpoints. Prerequisite for an honest "Done today".

### L3 — THE REPORT (the Home becomes the daily report)
- Sections, in order: **lead prose** (composer, over the ledger; morning = the plan / evening = the recap
  framing by local time) → **Done today** (resolved tasks + sent replies + meeting outcomes, narrated with
  substance, auto-hide) → **Needs you** (ledger tasks in ONE line grammar: `Task — {entity} — priority —
  due — blocked on X`, one act idiom: open/done/dismiss/draft) → **Open questions** (who + status + age) →
  **New & unsorted** (triage) → quiet tail (FYI/newsletters counts).
- DEMOLITION (no loose ends): DoRow, BundleGroup, PriorityCard, DealCard, PeekRow, hero/peek deck,
  DoSortToggle lenses, AmbientStrip (already-unrendered dead code) — deleted, their lanes explicitly
  re-homed in the report or retired. The ring STAYS as the one progress emblem, reading the ledger.
  `item_plans` steps are explicitly the deep-dive EXPANSION of a ledger task, never a parallel list.
- `compose.ts` reworked to narrate lead + wins + questions over ledger facts (refs-only discipline holds).
- Smoke: `smoke-report.ts` — cross-user incl. the email-only user (c723c2f2, no meetings — the
  generalization test): every section grounded, empty lanes absent, line grammar refs resolve, no invented
  wins/urgency; discipline gates still green.

### L4 — CHAT = THE REPORT'S CONVERSATION (was S4)
- Report = turn-0 (replaces the flat brief there); `acted:[]` awareness; per-day thread persistence;
  the local no-AI proactive turn ("Handled — next is {ref}"). Chat ACTIONS (capability map) remain phase-2.

### L5 — POLISH (was S3-graceful + S5)
- Acted clause collapse + cross-fade on recompose; post-action follow-up refetch (~4s/15s); later the
  `profiles`-row realtime push (replica-identity gotcha documented above).

**Order:** L1 → L2 → L3 → L4 → L5.
**Invariants carried forward:** identity via refs only (never authored); membership deterministic, AI only
enriches; grounded-or-silent sections; no real names anywhere in code/prompts; cross-user smokes before
"done"; every phase ships its demolition list (no stale idioms left behind).
