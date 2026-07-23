# "JUST WORKS" — the alignment arc (July 21)

**The diagnosis (one problem, five costumes):** the substrate is strong (recognition, ledger, preparation,
routing) but every surface leaks a DIFFERENT amount of machinery, renders a DIFFERENT object, in a
DIFFERENT vocabulary — deck ← brief route, Timeline ← ledger, Projects ← portfolio, deep-dive ← item_plans.
The same piece of work looks different everywhere you meet it; the deep-dive shows the engine's internal
steps (owners/states/Run) instead of the outcome; duplicates surface (one obligation → an email atom AND
its extracted commitment); and the brief route runs 76–129 SECONDS. Result: something simple reads as
complex — the product ADDS cognitive cost, the opposite of its premise.

**THE END STATE (one sentence):** one object model (the ledger item) · one line grammar everywhere (the
WorkCard row) · outcome-first details (draft in the composer, gaps as one plain suggestion, ONE steer
input) · coworkers as BYLINES not buttons (invisible routing, visible attribution, conversational
override) · machinery invisible · everything under ~1s. Four lenses, one object — recognition across
pages is what "just works" feels like.

**Locked design rules (from this arc's lessons):**
- The plan engine SURVIVES as substrate (preparation/coworkers run on it) but users never see steps.
- DEPENDENCY HONESTY: a send/commit step can never be "ready" while a producing step before it is open.
- A visible-step misfire ("Note Léa → Upload a file") is a grader bug — file-request grading only for
  steps that genuinely consume a document.
- Attribution everywhere prepared work appears ("✦ Sofia") — the staff feeling. Management stays /workers.
- The steer input is the correction channel: text → regenerate the outcome + write the fact into the
  entity's memory (learning, not just editing).
- Same visual = same meaning ACROSS PAGES, not just within one.

---

## P0 — THE PERF EMERGENCY (nothing feels alive at 100s) — ✅ SHIPPED (July 21)

**The real diagnosis (profiled, not the suspects list):** the GET-path phases totalled only ~6.4s
(reconcile 0.7s · outbound 2s · clusters 3.4s · rules/context <0.5s) — the 100s was a COMPOUND STORM:
(1) the anti-regen-storm guard didn't guard CONCURRENCY — 5+ stacked polls (mount/focus/90s/realtime,
no client dedup) each read the stale cache before any persisted, so EACH kicked its own full AI tail;
(2) that tail included a blanket `refreshEntityStates` (dozens of entity syntheses = minutes of AI);
(3) `noteItemAction` + sync null-busted `home_brief` on every action/mail so the cache was NEVER warm;
(4) the basic/enriched persists wrote a fresh blob that silently WIPED `bundleNames` + `briefing` —
re-firing those AI passes every sig change. Result: dozens of concurrent AI calls → 429 backoff →
every AI-dependent route (item plan 30s, resolve-file 28s) crawled too.

**Shipped fixes:**
- **Single-flight AI tail** (brief route `after()`): re-reads `generated_at` — only the request whose
  basic-persist stamp survived runs the synthesis; losers exit free.
- **`refreshEntityStates` OUT of the tail** → the 2-hourly draft-sweep cron (catch-all only;
  per-entity refresh already fires on `noteItemAction`/`reconcileEntities`/sync hooks).
- **No more null-busts**: the sig derives from live counts + freshest timestamps, so status changes
  invalidate NATURALLY. `noteItemAction`/sync/reactivate busts removed; the three writes the sig can't
  see (restore, entity move/rename) use `softBustBrief` (`lib/home/bust-brief.ts` — clears ONLY the
  sig, keeps last-good + sibling caches).
- **Persists preserve siblings**: basic persist spreads the cached blob; enriched persist is
  read-merge-write — `aux`/`bundleNames`/`briefing` survive every write.
- **`aux` side-cache in `home_brief`**: reconcile throttled to 10 min (stamp); clusters + outbound
  served last-good (15-min TTL, recomputed in `after()`; synchronous only on first-ever load).
- **Client in-flight dedup** (`home-view.tsx` `loadInFlightRef`): one brief request at a time.
- **Watchdog**: per-phase marks, one `[home/brief] slow …` log line when the GET path exceeds 2.5s.
- Smoke: `scripts/smoke-perf.ts` — WARM path <3s (measured ~0.9–1.2s both users), COLD extras <10s
  (~6s, background except first-ever). GATES PASS.
- **Deferred into P1 (deliberate)**: the `GET /api/items/[id]/view` aggregate — the outcome revamp
  defines what the deep-dive needs; the 30s item calls were storm victims (lazy classification-tier
  AI, ~2s healthy), re-measure after this ships.

## P1 — THE DEEP-DIVE OUTCOME REVAMP (the payoff surface) — ✅ SHIPPED (July 21)

**What shipped (against the spec below):**
- **NO step panel** — all four deep-dive variants (email / meeting / commitment / follow-up) are ONE
  centered column; the TasksPanel/WhatThisTakes/stepper/OwnerMenu machinery (~2,200 lines) is deleted.
  The plan engine survives as substrate (preparation, gap derivation, delegation).
- **The ONE outcome read** — `GET /api/items/view` (prepared + gap + entity + invite affordance; NO AI,
  reads the cached plan only). Client: `useItemView` (instant-load + bg refresh). `/api/items/pool` and
  the orphaned panel routes (run / resolve-file / use-file / attach / delegate) deleted with their
  now-unreferenced engine files (assemble-step-workflow, resolve-file-step, run-step).
- **Draft in the composer + byline** — "Your reply · ✦ drafted by <coworker>" (or "draft prepared").
- **The gap line** — `lib/home/item-gaps.ts` `deriveGap`: ONE plain suggestion from the first unmet
  producing input (awaiting_input's own ask, or the open [You] step before a send). Grounded-or-absent.
- **The steer input** — `POST /api/items/steer`: one classification call splits the note into durable
  FACTS (→ the linked entity's `rules`, deduped/capped — learning, not just editing), an optional
  SUMMON ("have Max research X" → a real `runDelegation`, prepare+report), and the guidance itself →
  the draft/nudge REGENERATED in place. Confirmation line reports what actually happened.
- **One action bar** — Reply · Dismiss ▾ (already handled / no longer relevant) · Forward. The
  five-button palette died. Send lives only in the composer; the reply step flips done SERVER-side in
  the send-reply route.
- **Dependency honesty** — `isSendBlocked`: a send/commit step can never be presented ready while an
  earlier producing step is open (the screenshot bug is a smoke regression test); the contextual
  "✦ Review invite" affordance honors it.
- **File-request grader fixed** — a "Note …" step can never demand an upload; requires a consuming
  verb + a NAMED document noun (the generic Path-B over-recognizer removed).
- Smoke: `scripts/smoke-deep-dive.ts` — 21/21 cross-user, incl. LIVE steer (fact→entity rules + draft
  regenerated, snapshot-restored). Build + perf gates still green.

**Original spec:**

- **Layout**: thread + composer with the prepared draft ALREADY IN IT (byline chip when a coworker
  produced it). NO step panel. Right rail (or above composer) reduces to at most:
  1. **The gap line** — when preparation is incomplete, ONE plain suggestion authored from the plan
     engine's unmet inputs: "I drafted the reply, but I don't have your pricing for 7–8 seats — tell
     me or point me to it and I'll complete it." (grounded-or-absent; never a step list)
  2. **The steer input** — "Add context or corrections…" → POST /api/items/[id]/steer: regenerates the
     draft with the user's text AND writes durable facts to the entity memory (+ optional summon:
     "have Max research X" routes a delegation).
  3. **Provenance** — "from: Tuesday's meeting · 📁 Soboplac" (already built, keeps its place).
- **One action bar**: Send · Edit · Dismiss (Send only when a draft exists; approve-gate unchanged).
  The five-button bar and every panel-duplicated CTA die.
- **The engine goes dark but honest**: `item_plans` keeps powering preparation; add the DEPENDENCY rule
  (send-capability steps blocked until producing steps resolve) + fix the file-request grader (only
  steps consuming a document may ask for one). The gap line is DERIVED from unmet producing steps.
- Smoke: `smoke-deep-dive.ts` — cross-user: prepared item → draft in composer + byline; missing-input
  item → exactly one gap line, no step artifacts; steer text → draft regenerated + entity ledger gained
  the fact; dependency: no send-ready while producer open (the exact screenshot bug as a regression test).

## P1.5a — RECOGNITION TRUST: anti-fragmentation (✅ SHIPPED July 21)

**The scenario class (from real data): ONE deal arriving as many facets — meetings, separate threads,
NEW people from the same company — fragmented into 3 entities, with Friday's meeting invisible.**
Four structural gaps found + fixed (all agnostic — per-user derivation, no literals):
- **Identity tokens** (`recognize.ts`): a person is EVERY form they arrive in — diacritic-FOLDED name
  ("Léa"→"lea", was mangled to "la"), full email, and "@domain" company token (free providers
  excluded). `personKey` makes matching era-proof across normalizations. Rarity-weighting makes an
  internal everywhere-domain non-distinctive automatically; a rare external domain force-recalls the
  deal for a NEW teammate. Judge prompt learned the same-company principle. Sources carry
  "Name <email>" so no form is lost; `reconcile.peopleOf` recomputes multi-form fingerprints.
- **Live calendar recognition** (`hooks.ts` `shadowRecognizeCalendar`): calendar events had NO live
  hook (bootstrap-only) — new meetings never entered any ledger. Wired into the sync tail + the
  2-hourly cron. Verified live: the missing Friday meeting joined its deal.
- **Reflection actually runs** (draft-sweep cron): it had NO trigger in production (0 verdicts ever).
  Now 2-hourly per user, after a fingerprint refresh, with: shared-rare-domain pairs FORCE-shortlisted
  and sorted FIRST (facet-founded duplicates embed far apart); evidence = ALL link kinds with content
  snippets + DATES + the entity's judged state (was inbox-titles-only — starved the judge); DEEP-shape
  judge with MAJORITY-OF-3 on shared-identity pairs (single temperature-0 samples flipped on borderline
  pairs and wrongly-remembered 'separate' blocked healing); `REFLECT_PROMPT_VERSION` in the pair-sig
  (evidence upgrades re-judge — the alignment-cache lesson); merge NAMING prefers the deal-shaped name
  over a channel-shaped one regardless of structural keeper. Plus `archiveOrphanEntities` (untracked,
  0 links, >3 days).
- **Proven cross-user** (`scripts/smoke-recognition-trust.ts`, 19/19): pure identity/recall/channel
  gates + live healing on both users. The real fragmented deal converged to ONE entity (email +
  3 threads + 2 calendar events + meeting + 4 commitments), channel name demoted to aliases; every
  genuinely-distinct pair stayed separate. E2E 14/14 + recognition-integrity 0/162 still green.

## P1.5b — THE CONVERSATIONAL RAIL — ✅ SHIPPED (July 22)

The deep-dive is TWO-COLUMN again — but the right rail is a COLLEAGUE, not a panel:
- **`components/home/item-rail.tsx`** — chat-shaped: the opening narration is the entity's OWN judged
  state (zero AI at render — the brain already authored it) + who-owes lines; "Also on this" renders
  every sibling as a live CHIP (✉ other threads → jump, 📅 meetings, 📄 files) — the "this deal has 2
  other threads" awareness, straight from the healed entity graph; the gap line rides the same channel;
  "Next: <move>" offers a matching COWORKER as a person (avatar + "can take this →" = one-tap
  delegation via steer). ONE composer: "Ask, correct, or hand off…".
- **Steer became the ONE conversational endpoint**: the classifier now also detects a QUESTION →
  answered grounded from the deal's memory (the project-brain ask, [L#]/[F#] refs → chips) — a pure
  question never touches the draft. `meeting` kind supported (memory + summon + answers; no draft).
- **The confusing "About this" card is DEAD** — `relationship-context.tsx` + its heavy
  `/api/items/[id]/context` route deleted; the rail (fed by the ONE `/api/items/view` read, now
  carrying entity state + siblings) replaced them. No rail-less regression: an unlinked item keeps the
  inline gap + steer row, single column.
- **P1.5c latency shipped with it**: the composer is TYPABLE AT PAINT (mounts empty, "✦ drafting…"
  byline, the prepared draft seeds in when ready ONLY while untouched — the user's words always win);
  Send no longer gated on draft loading.
- Smoke: `scripts/smoke-rail.ts` — 8/8 cross-user (narration source present, siblings readable,
  grounded ref-carrying answers on both accounts, question/correction intent split). Deep-dive 21/21 +
  perf gates still green.

## P2 — CROSS-TYPE DEDUP — ✅ SHIPPED (July 22)

One obligation surfaces ONCE. `lib/home/dedupe-deck.ts` (`isDupOfVisible` / `foldDuplicateCommitments`,
built on the exported `isNearDuplicate` idiom): an OPEN commitment extracted from an email/meeting the
deck ALSO shows as an actionable row FOLDS — structural tie (source_id / thread / meeting id) +
moderate text overlap (0.45), or near-identical wording alone across sources (0.65). The item is the
resolving surface; nothing is deleted. Wired in TWO places reading the same helper: the brief route
(filters `commits` at load, so every lane/count/sig/synthesis input downstream agrees) and
`buildWorkItems` (the Timeline agrees with the deck). Deterministic, zero AI.
Smoke: `scripts/smoke-deck-dedup.ts` — 7/7 cross-user; the invariant "zero visible cross-type dupes
after the fold" holds on real data (user A: 3 folded of 18; user B: 19 folded of 47 — the "respond to
the message" commitments shadowing their own reply cards). Perf + deep-dive gates still green.
(Write-time near-dup guarding + the cleanup script already exist from July 7; display dedup per lane
via `dedupByDescription` unchanged.)

## P3 — ONE ROW EVERYWHERE — ◐ PARTIAL (July 22): WorkRow shipped; deck-reads-ledger deferred

Shipped: **`components/work/work-row.tsx`** — the ONE row grammar extracted from the deck's DoRow with
its whole support kit (useExit/useCommitmentAct/EffortDate/InitiativeTag/prefetchItem/DO_META/fmtDue);
home-view imports it (`WorkRow as DoRow`, zero behavior change) and the **Timeline stations now render
actionable work through the SAME component** (live ✓/✕ + prefetch on the Timeline for the first time;
context records — events/meeting notes/deliverables/history — keep the compact card, they're opened not
acted on). `workItemToRow` adapts the spine's WorkItem. Sparkle glyphs (✦/SparklesIcon) + folder emoji
swept from the deep-dive, rail, and Home rows per the UI rule; the rail restyled to the app's ONE
chat-panel idiom (`components/shared/chat-sidebar.tsx` language: gutter+white card, h-10 header,
neutral-100 user bubbles, avatar+plain-text assistant rows, bouncing dots, rounded-2xl composer).
**Deferred to a focused pass:** the deck's atoms deriving from `buildWorkItems` (the brief route as an
ENRICHER) — it rewrites the trust-hardened membership assembly and needs the parity smoke as its gate;
and the entity Work-board rows (their API returns a bespoke board shape, unify when the portfolio reads
the spine).

- The deck's atoms derive from `buildWorkItems` (the ONE ledger) — the brief route becomes an ENRICHER
  (asks/angles/bundling/prose) over ledger items instead of assembling its own candidates. This closes
  audit gap #4 and makes the parity smoke test the real UI.
- `WorkRow` (the DoRow line) extracted into `components/work/work-row.tsx` and REUSED: the Projects
  detail work list + the Timeline station rows render the SAME component (laid out by entity / by time).
  Kill the per-surface row variants. Gantt keeps its dots (a chart, not a list) but its click-through
  opens the same object.
- Smoke: the Madalena-parity smoke now runs against the DECK's own data path (finally testing what the
  user sees); a cross-surface assertion — the same item id renders the same title/tokens on all lenses.

## P4 — CONTENT DISCIPLINE — ✅ SHIPPED (July 22)

- **Verb-first asks**: the understanding now carries `ask` — the ONE thing to DO as an imperative
  phrase (≤8 words, only for relevance reply/action; coerced + null-guarded in `item-understanding.ts`);
  `computeUnderstanding` authors it, the brief route's action-notice line PREFERS it over the raw
  subject ("Fix the failing payment", not the mail header), and the synthesis's mustRespond "ask" is
  now explicitly required to be imperative. Backfill-light ran for ALL 4 users
  (`scripts/backfill-visible-asks.ts` — visible actionable items only, capped 40/user): 135 recomputed,
  119 verb-first asks landed. New mail picks the field up in `processEmail` naturally.
- **Mechanical sweep**: `isAutomatedWho` folded into `lib/inbox/automated.ts` (the spine's blockedOn
  guard — one module owns "is this a machine?"); `hooks/use-live-refresh.ts` (focus + visibility +
  interval-while-visible, callback-in-ref) adopted by all SIX hand-rolled sites (Home, Timeline, Gantt,
  AI Operations, daily report, Drive); `lib/utils/format-date.ts` (fmtMonthDay/fmtDateTime/
  fmtWeekdayDate) replaces the four private date wrappers (work-row, item-rail, item-detail).
All gates green after: build, deep-dive 21/21, dedup 7/7, perf.

**Order: P0 → P1 → P2 → P3 → P4.** P0 is unconditional first (it poisons every impression and every
demo). P1 is the visible transformation. P2 is quick trust. P3 is the structural finish. P4 is polish.
**Cross-user smokes per phase; the bar-owner's account (c723) validates P1/P2; nothing irreversible ever
fires without approve; no real names in code/prompts.**

---

# P7 — GROUNDED EVERYWHERE + THE ONE ROOM — ◐ P7a + P7b + P7c-c1 SHIPPED (July 22)

**Shipped:**
- **P7a** — read tools (get_emails / search_knowledge_base / get_meeting_context) exposed to the
  chief-of-staff slice + wired into the converse loop (the chat GOES AND LOOKS); the VIEWING-ANCHOR
  law (`viewingExcerpt` in converse — the open item's from/subject/attachments/body rides EVERY
  grounding path; `answerEntityQuestion` gained `opts.viewing`); ledger email lines carry a content
  gist + attachment note (states regenerated, voice/arbiter gates 20/20); [L#] markers stripped from
  displayed prose; commitment chips near-dup folded. `smoke-grounding.ts` 5/5 — and the ORIGINAL
  failure re-asked live now answers: "Yes — Léa sent the catalog... 'vous trouverez en pièce jointe
  notre catalogue avec les tarifs'... though the attachment itself isn't visible." Outlook
  attachment-capture gap NOTED as its own follow-up (real data loss).
- **P7b** — `lib/work-items/states.ts` owns both vocabularies (ITEM facts: todo/waiting/in_progress/
  done/dismissed + overdue overlay; PROJECT judgment: momentum + lifecycle) with display tokens; the
  three verbatim momentum maps (home-view, portfolio, entity-detail) + the Gantt STATUS palette now
  import it.
- **P7c-c1** — the conversation is PER-DEAL (module store keyed by entity: navigating a deal's
  artifacts keeps the chat); the rail's "Also on this" became the grouped ROOM INDEX (Overview door →
  `/?view=projects&entity=<id>`, honored by the portfolio; Conversations / Meetings+Follow-ups /
  Files groups).

- **P7c-c2/c3 — THE ROOM (July 22)** — ONE work surface, two doors. `lib/entities/room-view.ts`
  `buildRoomView` is THE ONE builder of the rail's narration data (entity + curated siblings),
  shared by `/api/items/view` (item door, current thread marked) and the new
  `GET /api/entities/[id]/room` (project door). `components/entities/entity-room.tsx` = the room:
  focused artifact left (Overview · Work · Timeline — entity-detail's content, Goals/Rules folded
  into Overview), THE ONE `ItemRail` right in ENTITY scope (steer + 📎 ingest accept kind 'entity';
  converse runs entity-scoped). The rail's per-deal chat store keys by entity id, so a conversation
  started on an email CONTINUES in the room and back. Artifact paints first (LS-cached detail);
  the rail hydrates after. DELETED: entity-detail.tsx, EntityAsk + TypedAnswer, the
  `/api/entities/[id]/ask` route (died into the one chat). Projects portfolio + Timeline Gantt route
  into the room. Gate: `scripts/smoke-room.ts` 15/15 (structural + live cross-user, incl. grounded
  room chat).

## The original P7 plan

**The triggering failure:** asked "did they send their catalog?" while the catalogue email was OPEN
ON SCREEN, the chat said "no catalog yet" — grounded honestly on a TITLE-ONLY ledger, with no way to
go look, and blind to the viewed document. The user's expectation is the right spec: "I thought it
could have access to everything." Plus two structural calls made together: the item deep-dive and the
project focus page CONVERGE into one surface (the ROOM), and item/project STATES get one owned
vocabulary. The projection lesson, written down: every recurring bug here was a consumer reasoning
over a lossy projection whose contract didn't cover its need — silently.

## P7a — RETRIEVAL-CAPABLE GROUNDING (trust; the agnostic fix)
- **Read tools join the chief-of-staff slice** (registry exposure only — the tools exist): get_emails,
  search_knowledge_base/read_document, get_meeting_context. The conversation core's loop can now GO
  LOOK — open the thread, search files, read the transcript — like a coworker already can. "Access to
  everything" becomes true by construction: anything ingested is reachable through the ONE registry
  from any chat surface; no question class can be starved again.
- **The VIEWING-ANCHOR law (structural):** in item scope, the open item's subject + body excerpt is
  ALWAYS in the grounding (question path, correction path, agent loop). The system must be physically
  unable to contradict the document on the user's screen.
- **Projection floor:** `assembleLedger` email lines carry a body gist + an attachment note — every
  ledger consumer (state synthesis, entity ask, loop grounding) inherits. Sig is content-hashed →
  states regenerate through the normal path.
- Small: strip [L#]/[F#] markers from displayed chat prose (chips remain); near-dup fold on the
  rail's commitment chips; INVESTIGATE the Outlook attachment-capture gap (the catalogue PDF never
  entered the system — data loss no reasoning can fix).
- Smoke: the contradiction fixture — a question whose answer lives ONLY in the viewed item's body /
  a retrievable thread answers correctly, cross-user.

## P7b — ONE STATES MODULE (stop the palette drift)
- Two levels, one direction, written down where code reads it: ITEM states are FACTS
  (todo/waiting/done/dismissed/overdue — mechanical, user actions + reconcilers); PROJECT states are
  JUDGMENT (momentum active/needs_you/waiting/gone_quiet/stalled + lifecycle active/done/archived +
  priority — synthesized from members, never hand-edited).
- `lib/work-items/states.ts` owns both vocabularies + display tokens (label/dot/text colors); the
  Home momentum map, the portfolio's, and the Gantt's status palette import it. Same dot = same
  meaning on Home, Timeline, Projects, deep-dive, meetings.

## P7c — THE ROOM (deep-dive ∪ project focus = ONE surface)
- **One work surface, two doors:** artifact INDEX (Overview · Conversations · Meetings · Files ·
  Follow-ups) + the FOCUSED ARTIFACT + the ONE chat (converse core), persistent per deal. From
  Projects → opens on Overview (today's entity-detail content). From the Home deck → the same room,
  that artifact focused, draft in composer. A loose item (no deal) → same component, degraded
  gracefully. The execution grammar is identical through both doors.
- **Guardrails:** triage speed is sacred (the focused artifact paints first; index/chat hydrate
  after); meetings EDITING stays in the Meetings surface (the room shows notes read-only + a link).
- **What dies:** entity-detail as a standalone page (Overview + Gantt become room artifacts),
  EntityAsk (dies into the one chat), the duplicated context renderings. Projects keeps the portfolio
  grid; clicking a project opens the room. Incremental: (c1) per-DEAL chat persistence + the grouped
  index in the rail; (c2) Overview-as-artifact + Projects routes to the room; (c3) entity-detail
  deleted.

**Order: P7a → P7b → P7c(c1 → c2 → c3).** Cross-user smokes per phase; all prior gates stay green;
approve-before-commit untouched.

---

# P6 — ONE BRAIN, ONE MOUTH, ONE HAND — ◐ P6a + P6b-core SHIPPED (July 22)

**Shipped:**
- **P6a (the arbiter)** — `next_move.covers` in the state synthesis (`STATE_PROMPT_VERSION=3`; numbered
  ledger citations → refs, restricted to foldable members inbox/commit); bundleStates carries plain
  ids; the deck renders covered members as EVIDENCE rows (WorkRow `evidence` variant — muted, keeps
  ✓/✕); `coveredIds` helper in agenda. All states regenerated; `smoke-voice.ts` 20/20 (192/205 moves
  arbitrate, 0 invalid citations). Found + fixed en route: maxTokens 500 truncated big-deal JSON →
  silent stale states (now 900 + a warn); a temp-0 stubborn banned phrase → SELF-CORRECTING retry at
  the source + `MACHINERY_REGISTER` shared between synthesis and smoke (one definition); the smoke
  self-heals sig-matched stale violations.
- **P6b (registry + core)** — item-actions are REAL registry tools (`lib/tools/item-actions.ts`:
  resolve_inbox_item/resolve_commitment/find_file/remember_fact — the inbox complete/dismiss routes
  are now THIN callers of the same executors); `CAPABILITY_MAP` gained `exposure` +
  `capabilitiesFor(surface)` (chief_of_staff slice holds ONLY reversible tools — structural
  approve-before-commit; personal doables are chief-only, a coworker never resolves your inbox);
  **`lib/converse`** = THE conversation core (fast-path classify → registry dispatch for the 80%;
  bounded agent LOOP over the chief slice for composite turns; question → grounded entity ask;
  correction → remember+rework; delegate → the real engine); `/api/items/steer` is a thin wrapper;
  the rail renders the uniform turn (say/refs/files/applied). `smoke-converse.ts` 9/9 cross-user
  (live "dismiss this" via registry + restore, file-finding, grounded answers, 3 structural safety
  gates). All prior gates re-green.

**Remaining in P6:** Home-ask + entity-ask rewired onto the core (they still run their own paths);
P6c the room; P6d report-ref voice; P6e 📎 upload on the rail.

## The original P6 plan

**The diagnosis (user review after P5):** the words are human now, but (1) three reasoners emit three
phrasings of ONE action per deal (per-item ask · entity next-move · extracted commitment) and nobody
arbitrates; (2) the chat LOOKS like an actuator but only handles question/correction/delegate — not
send/dismiss/done/find-file/attach/schedule; (3) navigating between a deal's items remounts the whole
deep-dive (leaving the room instead of swapping the artifact); (4) the report/briefing renderer still
breaks grammar with raw ref labels and uses CHANNEL names ("X x Y - AI Chat") where the deal's name
belongs; (5) the rail chat has no files (📎/KB search). **The architectural law for this arc, set by
the user: every brain/action change lives at the SOURCE — one module — so every surface (rail chat,
Home chat, entity chat, report, future) is an easy wire, never a per-screen reimplementation.**

## P6a — ONE DEAL, ONE ASK (the arbiter lives in the brain source)
- `lib/entities/state.ts` — the state synthesis (which already reads the WHOLE ledger) additionally
  SENTENCES its members: output `next_move.covers: [ledger refs]` — the member items (emails,
  commitments) whose resolution IS this next move. One more field from the same call; no new pass.
- Consumers read it, never re-reason: the deck bundle renders covered members as EVIDENCE rows (no
  parallel CTA — one actionable line per deal, the next move; members keep their ✓/✕ but lose
  competing button-language); the rail's "Next:" and the report's per-deal line are the same field.
- Smoke (cross-user): every bundle with a next_move renders AT MOST ONE call-to-action; covered
  members demoted but none lost; a member NOT covered (a genuinely separate obligation in the same
  deal) keeps its own ask.

## P6b — THE ONE CONVERSATION CORE (REVISED July 22: agent-over-registry, not router-plus-executor)
**Why revised:** a single-shot intent router over N registered intents is a CLOSED WORLD — real turns
compose ("push the meeting and let them know"), reason ("why did you draft it this way?"), and
synthesize; a rigid router makes the chat dumber than a plain LLM with tools, and a bespoke
`lib/converse` dispatcher would be a THIRD execution style beside the coworker agent loop and the
workflow step engine. The registry stays the one truth; the chat becomes an AGENT over it.
- **One registry, for real:** the item-actions become REAL TOOLS in `lib/tools`
  (`complete_item`, `dismiss_item`, `send_reply`, `send_nudge`, `find_file`, `attach_file`,
  `delegate_to_coworker`, `remember_fact`) — endpoint logic extracted into callable executors, not
  reimplemented. Capability metadata lives ON the registry rows: `irreversible` (→ the executor
  PREPARES and returns an approval payload instead of committing — enforced at the registry layer, so
  NO agent — chat, coworker, workflow — can bypass approve-before-commit), `feature` (workspace gate),
  and NEW `exposure` (which surfaces/agents may hold the tool — the chief-of-staff chat may dismiss
  your inbox items; a coworker may not). `CAPABILITY_MAP` becomes this metadata layer, not a parallel
  vocabulary.
- **The conversation core = a scoped AGENT over that registry**, reusing the existing chat-loop
  machinery (the coworker loop pattern) with the chief-of-staff exposure slice + the entity/item scope
  in context. It composes multi-step turns, reasons, and calls `find_file` mid-answer — because that
  is what an agent loop does.
- **The 80% fast-path:** simple command turns ("dismiss this", "mark done", "have Max research X")
  route via ONE cheap classification + direct tool dispatch (~1 small call); only composite/open turns
  escalate to the loop. Budget-honest by construction.
- Rewires (thin): `/api/items/steer` → the core with item scope (behavior superset); the Home ask +
  entity ask → the same core with global/entity scope — every chat surface gains actions +
  file-finding with zero surface-local logic. "Let Y handle it" = handing the same registry slice to
  a coworker; the brain's next-move can later name a capability id — one vocabulary end to end.
- Smoke: command fixture set (each command class executes via the right tool, cross-user live);
  dismiss→restore roundtrip; STRUCTURAL assert: every `irreversible` registry row's executor returns
  an approval payload (no commit path); exposure filtering (a tool outside the surface's slice is
  never callable).

## P6c — THE ROOM (a deal is a place; items are artifacts in it)
- The rail (incl. its chat thread) is keyed by ENTITY, not item: navigating between a deal's siblings
  swaps only the left artifact pane; the rail persists (state + conversation), the anchor line updates
  to the new item. Leaving the deal (Home, other deal) releases it.
- Narrator style: drop the per-message avatar icon — plain indented paragraphs (user call).
- Smoke: navigation within a deal preserves the chat turns; across deals resets.

## P6d — VOICE COMPLETION (the report/briefing renderer) — ✅ SHIPPED (July 22)
SHIPPED: `displayWho`/`channelish` exported laws in `lib/briefing/compose.ts` (person ≻ deal name, never a
channel/meeting label); brief route feeds the REAL commitment counterparty (nullable) instead of the
`counterparty || sourceLabel` display fallback; grammar-safe-ref prose law in the compose prompt;
BRIEFING_PROMPT_VERSION 7→8 (legacy briefings recompose on next load). Gate: `scripts/smoke-briefing-refs.ts` 8/8
(law + e2e fixture compose + stored-briefing self-heal check).
- At the composer/renderer source: refs must render as the DEAL's name (never a meeting/channel
  title) and sit grammatically in the sentence (the "from X x Y - AI Chat still waits…" class dies).
  Prose law added to the compose prompt + label resolution fixed where refs resolve (entity name ≻
  meeting title), so every consumer of the briefing/report inherits it.
- Smoke: composed prose contains no " x "-pattern channel labels; no sentence starts with a bare ref.

## P6e — FILES IN THE CHAT — ✅ SHIPPED (July 22)
SHIPPED: 📎 on the rail composer → `POST /api/items/ingest` (extract → `item_deliverables` file entry →
satisfies a live awaiting_input attachment step, gap line clears). The resolver's `pool` source became a REAL
registry source (reads item_deliverables by token overlap when no caller candidates) — so `find_file` sees
ingested files from the rail AND the Home chat. Live roundtrip proven (upload → "do we have X?" → found via pool).
- 📎 on the rail composer → the EXISTING ingest funnel (content-hash, entity-linked at ingest) — the
  file is immediately part of the deal's memory; `find_file` intent already routes via the core, so
  "where's the deck?" works in the rail AND the Home chat with zero extra wiring.
- Smoke: upload → ask-about-it roundtrip on a real account.

**Order: P6a → P6b → P6c → P6d → P6e.** a is small and kills the visible triple-phrasing confusion;
b is the arc's heart; c/d/e complete the feel. Cross-user smokes per phase; all existing gates stay
green; approve-before-commit is never weakened; no real names in code/prompts.

---

# P5 — THE VOICE + ANCHORING ARC — ✅ SHIPPED (July 22; all four phases, cross-user gated)

**Shipped:** P5a `STATE_PROMPT_VERSION=2` voice rewrite in `lib/entities/state.ts` — all 227 active
states regenerated for the 4 users through the sig-gated path (`scripts/smoke-voice.ts` 16/16: zero
machinery-register summaries, zero telegrams, imperative next-moves; e.g. "Ankita at Emeritus is
waiting for you to invoice the full amount. Nothing's moved in 21 days."). P5b anchor + curation:
`/api/items/view` returns `anchor{who,ask,prepared}` (the rail opens with THIS item, assembled
deterministically), sibling chips curated via the now-shared `isCalendarSystemSubject` +
`isAutomatedSender` (moved to `lib/inbox/automated.ts`; brief route imports it), commitments render as
chips, who-owes folds to one line and yields to next-move, gap only from a FRESH plan (the stale
"upload the X" class dead). P5c: deck-level near-dup fold in `buildAgenda` (client-safe twin of
isNearDuplicate — same-sender + 0.8 overlap), PeekRow gained the hover ✓/✕ every species has (incl.
deal ✕ via session dismiss); slipping deals were already entity-deduped server-side. P5d: the
deep-dive is the inbox's card-on-gutter shell (both variants), the action palette sits ABOVE the
thread. Gates after: voice 16/16 · rail 12/12 · deep-dive 21/21 · dedup 7/7 · perf · build.

## The original plan (for reference)

**The diagnosis (user review of the shipped P0–P4):** the substrate is right but three content sources
speak in the SYSTEM'S BOOKKEEPING register, and the rail narrates the entity generically instead of
the open item. Symptoms, each traced: "team prepared for nudge / no completion signal yet" (the
entity-state synthesis describing its own machinery — infects the rail opening, the Home deal lines,
the hero lead); the rail shows the same project text on every item of a deal and never mentions what
you opened ("makes it harder to think" = the user does the joining); sibling chips are uncurated
(3 calendar-acceptance emails, 4 LinkedIn notification emails as chips); a stale plan's "upload the
Note" leaks as the gap line; the Home mixes three species again (expanded bundle / opaque deal-status
cards / item rows) with literal duplicate rows and lost ✓/✕ on peeks + deal cards; the deep-dive's
left pane is flat/flush while inbox is rounded-card-on-gutter; the action bar hides below the fold.
**The verdict shared with the user: don't redesign the container again — fix the three content
sources and unify the species. The card/row grammar (the Madalena list form) stays.**

## P5a — VOICE: the entity-state synthesis gets the briefing's laws (the biggest lever — one prompt,
every surface)
- Rewrite the state-synthesis prompt (`lib/entities/state.ts`): speak about the MATTER as a sharp
  colleague — real people and things, 2nd person for the user's work; ≤2 sentences for `summary`;
  say-less-than-you-know; NEVER the machinery register (banned class: "prepared for nudge",
  "no completion signal", "communication overdue", "awaiting deliverables"-bureaucratese, any
  description of what THIS SYSTEM did). `next_move.title` = imperative + concrete.
- `STATE_PROMPT_VERSION` threaded into the state sig (the alignment-cache lesson: a prompt-driven
  cache invalidates on the prompt too) → every state regenerates through the existing sig-gated paths
  (cron sweep + noteItemAction); a one-shot cross-user backfill script forces the visible ones now.
- Consumers fixed for free: rail opening, Home deal-card second lines, hero bundle lead, portfolio.
- Smoke (voice gate): regenerated states across users contain NO banned-register terms; each summary
  names a real person/thing; ≤2 sentences.

## P5b — ANCHOR: the rail leads with THIS item (and curates the deal around it)
- `/api/items/view` returns an `anchor`: the open item's verb-first ask (understanding.ask), who it's
  from, what's prepared (draft + byline). The rail's OPENING message is assembled deterministically
  from it: line 1 = "«who» is asking you to «ask» — I drafted the reply below." (grounded-or-absent
  per part); line 2 = the deal's P5a-voiced state, ONE line; who-owes folds into at most one line and
  is dropped when next_move already covers it.
- CURATED siblings: exclude automated/system mail (`isAutomatedSender` + calendar-system subjects +
  acceptance prefixes) from thread chips; cap 3; open commitments render as chips (→ their deep-dives)
  instead of the owe-text stack; files unchanged.
- Gap line only from a FRESH plan (reuse the item-plan freshness rule: suppressed when the item's
  last_activity_at outruns the plan) — kills the stale "upload the Note" class.
- "Next:" renders only when it adds something line 1 and the gap didn't already say.
- Smoke: rail anchor mentions the open item's ask; sibling chips contain zero automated/acceptance
  mail, cross-user.

## P5c — HOME: one grammar, every row acts
- A project appears ONCE: a GROUP row (same visual family as WorkRow) with the P5a-voiced state as its
  second line, its own hover controls (dismiss=mute · open), and — when it holds actionable members —
  the same expand-to-items the hero bundle has, at ANY deck position (kills the opaque-status-card
  species). Hero and non-hero differ only by emphasis.
- PeekRow gets the same hover ✓/✕ as full rows (secondary items act without promoting).
- Deck-level near-dup fold for inbox rows (the twin "Property inquiry response received"): reuse
  `isNearDuplicate` over who+ask among visible rows, keep the newest.
- Guarantee: hero bundle vs. list rows dedupe by entity id (one project, one presence).
- Smoke: zero duplicate visible rows; every visible row/group exposes an act path (done/dismiss/open).

## P5d — CHROME: the deep-dive matches the inbox shell + actions above the fold
- Main column becomes a rounded-2xl white card on the neutral-50 gutter (the inbox reading-pane
  pattern); gutters/gaps symmetric with the rail card.
- The action palette (Reply · Dismiss ▾ · Forward) moves to the TOP of the thread area (visible
  without scrolling on any email length); the composer stays docked.

**Order: P5a → P5b → P5c → P5d** (voice first — it feeds b and c; chrome last). Cross-user smokes per
phase; no real names in code/prompts; the existing gates (perf, deep-dive, dedup, rail, trust) must
stay green after each phase.
