# THE ONE SURFACE — direction doc (Aug 5, 2026 · DRAFT for review, nothing committed to build)

The strategic arc after the conversational room: the compute ceiling, the execution convergence,
the surface collapse, and frames. Written after reviewing the agent-workspace wave (Cloudflare OS,
Dust frames) against our thesis. The conclusion of that review, stated once: **the agent loop is
commoditizing; the brain is not.** Our moat is judged state + entity memory + prepared work + the
trust laws — every move in this doc concentrates the product onto that layer, never around it.

Builds ON: the experience spec (docs/experience-spec.md — every section below traces),
the judged-room engine, the one room (docs/one-room-plan.md), the proactive team
(docs/proactive-team-plan.md). Nothing decided there changes; this doc decides what's NEXT and
in what order.

---

## The diagnosis (why this arc, why now)

1. **Deliverable ceiling.** Everything we produce is language-in/language-out. The work our users
   owe — the allocation sheet, the reconciled numbers, the analysis across twelve attachments —
   requires COMPUTE over real files and mechanical self-verification. Every trust law we wrote by
   hand (fulfillment, dated-source, excerpt honesty, true-facts-or-no-facts) is a special case of
   "verify claims mechanically." We keep paying for that lesson one incident at a time; a compute
   capability is the lesson generalized.
2. **Two orchestrators over one team.** The engine (judge → prepare) and the Studio/workflow
   system both drive the same four coworkers, with separate threads, outputs, and failure modes.
   A scheduled workflow is INVISIBLE to the judge: no fulfillment law, no debt when it silently
   dies (the pilot briefing was dead for a month and no surface owed anyone an explanation).
3. **Three chat pages, duplicated seats.** Home ask box, /work chat, /workers chat tabs. The
   /workers surface is absent from the experience spec's seat table — by the spec's own law
   ("each surface owns ONE seat"), a surface that can't name its one job is in the wrong seat.
   Conversation is a CAPABILITY of the product, not a destination in the nav.

---

## THE LAW OF THE ARC: everything lands in the brain

The chat-first idiom breeds brain-bypass (a free-form chat producing work that recognition,
judgment, and state never see — a shadow inbox). This arc is only correct if the opposite holds:

- **Every conversation has a room key; every room key is brain-addressable.** A one-time chat is
  a loose room; loose rooms pass shadow-recognition and adoption like any other atom.
- **Every produced artifact is a ledger event.** A compute output, a frame, a standing-run
  deliverable enters the deliverable pool AND the entity ledger — state synthesis sees "the
  comparison sheet was produced Tuesday" the way it sees an email arrive.
- **Every standing promise is a commitment** — first-class judge input (`kind:'commitment'`),
  so fulfillment, freshness, the deck, and the outcome log apply with zero new machinery.
- **Meetings ground everything for free** (already true, preserved): provenance inheritance,
  transcript retrieval, meeting-action verb scope. New here: a RECURRING promise made in a
  meeting ("I'll send an update every Friday") may found a STANDING commitment (recurrence
  detection in extraction — offer, never auto-found).

---

## THE SCOPE MODEL (how one conversation system handles every scenario)

Conversation has three scope states; capabilities are UNIFORM across them because they mount on
two shared seams — the conversation core (`converse` + `ConverseScope`: where the conversation
lives) and the capability registry (what can be done). A scenario differs only in scope +
executor, never in what's possible (the S5 invariant, now product-wide).

| Scope state | Where | What it does |
|---|---|---|
| **Unscoped** | the Home composer | answers from the brain snapshot, or founds/opens the right room; a growing exchange becomes a loose room |
| **Work-scoped** | a room rail (entity or loose) | steers, approves, gives feedback; artifacts land at the stream's now edge |
| **Addressed** | @coworker / "Max, …" in either | picks the EXECUTOR; never changes where the conversation lives |

"Chat with a coworker" is not a place — it's an addressed conversation whose work lives in the
work's room. The DM feel survives as a filter (my exchanges with Sofia), not an address.

### THE WORK LADDER (every kind of thing, one rung each)

| Kind | Object | Home | Surfaces via |
|---|---|---|---|
| throwaway ask | none — answered inline | the exchange itself | nowhere (dies in place) |
| growing conversation | loose conversation room | sidebar once real | adoptable into a project |
| loose identified item (mail/meeting/commitment) | inbox item / commitment | its loose room | THE DECK when judged to need you |
| project item | same, entity-linked | the project room (room-door law) | deck row + project tag; filed truth |
| explicit request that is work | task/commitment + owner | the room of its subject | spec card → deck |
| standing request | standing commitment | its room's Schedule | runs = prepared artifacts; missed = debt |

Four laws hold the ladder: (1) **origin never determines treatment — recognition + judgment
do** (chat and email pass the same brain; only the door differs). (2) **The sidebar lists
CONVERSATIONS; the deck lists ATTENTION** — pinned projects + a folded Recent of conversations;
loose ITEMS surface via the deck only; the sidebar must never re-become the inbox. (3) **Chat
is cheap, objects are deliberate** — no casual prompt silently mints a task; work objects are
born from the engine's judgment or an explicitly confirmed ask (the spec card). (4) **HISTORY
IS THE DEFAULT, EPHEMERAL IS A CHOICE** (owner call, Aug 5 — conforms to the convention every
user has trained on): every conversation persists as a searchable loose room; a TEMPORARY-CHAT
toggle is the explicit opt-out — nothing persisted, NOTHING enters the brain (also the privacy
control for the regulated pitch). Persistence never implies object creation (law 3).

### CONTEXT CONTROLS (the user steers what enters the brain)

- **The scope chip**: every conversation header shows its scope ("No project · Add to…" /
  "<Project> ✓"), settable at ANY time — scoping after the fact CASCADES everything the
  conversation produced (turns, artifacts, frames, remembered facts) via the one membership
  machinery, same as a meeting move cascades its commitments.
- **Project questions answered in place** — BUILT (Aug 5, the one-grounding unification): a
  question that NAMES a registered entity gets that entity's FULL room grounding appended to the
  Home snapshot (`findEntityFocus` — strict distinctive-token match, an all-generic name never
  matches; the block's [L#]/[F#] tags stripped so no wrong links mint) — "status on X?" from the
  Home and from X's room are the same answer BY CONSTRUCTION. Both global call sites thread the
  question (answerHomeQuestion + the converse agent loop). Gates U1–U3 (40/40); U3 live-verified
  zero-AI on a real account. New facts stated in chat still route through remember_fact +
  recognition's filing proposal; artifacts born unscoped travel on adoption.
- **Action requests ride THE PARITY LAW** (built): reads + reversible acts execute directly;
  irreversible sends stay behind the explicit-send floor / approve click — SAYING PREPARES,
  COMMITTING STAYS EXPLICIT. `read_action_history` BUILT (Aug 5 — `lib/tools/action-history.ts`,
  registry row, mounted in the conversation core): "what was sent this week?" answered from the
  real ledgers (activity_events · action_commits · email_sends), the digest declaring its own
  boundary (through-the-platform only — outside-sent mail is synced as threads, not actions).
  Gates A1–A4 (36/36 in smoke-compute).
- Posture vs the field: CONFORM ON THE CHROME (history, temporary mode, project folders — user
  habits are the spec), DIFFERENTIATE ON THE BRAIN (grounded answers, sayable verbs,
  approve-before-commit — none of the competitors hold a judgment layer).

---

## ARC 1 — THE COMPUTE CAPABILITY + THE VERIFY LOOP (the ceiling; engine-only, no UI change)

**PROGRESS (Aug 5):** stage 1 BUILT — the sandbox service (`infra/compute/`: FastAPI + docker
runner, --network none, declared read-only inputs, hard caps, non-root, per-run cleanup; deploy
via README's manual sequence, Caddy-only exposure), the `run_compute` tool (`lib/tools/compute.ts`
— manifest-declared KB/inline inputs, outputs → work-artifacts + background KB index, FAILURE
HONESTY at every door), one registry row (+PLAN_VERSION 5) reaching chat + workflow steps +
the Studio picker ("Compute" group, both lists). Gates: `scripts/smoke-compute.ts` **16/16
incl. C5 LIVE** — the service is DEPLOYED on the box (:8002, bearer-authed; README has the
sequence + two found-live fixes) and the locked-room proof passed: a script attempting network
access FAILS. Env in .env.local; the two Vercel vars are the remaining flip.
**Stage 2 BUILT (Aug 5) — THE ARITHMETIC FLOOR** (`lib/prepare/verify-claims.ts`, mounted in the
evaluator between the structural floors and the reasoned review): computable claims an artifact
makes (sums/diffs/products/ratios/%-changes · date↔weekday, EN/PT/DE/FR) are extracted by ONE
cheap gated pass and recomputed BY CODE; a confirmed mismatch revises with the exact numbers.
Three honesty laws: THE QUOTE LAW (verbatim-quote-or-ignored), THE OPERAND LAW (found live —
the extractor invented an intermediate operand; every operand must appear in the text or the
check drops), FAILURE ≠ VERDICT (outage → silence). Asymmetric by design: a missed extraction
is a missed catch; a false revise structurally cannot fire. Gates 25/25; live-verified on BOTH
tiers (standard/gpt-4o-mini + bedrock_optimised/Bedrock Haiku — Bedrock caught sum AND weekday;
zero false positives on both).
**Stage 3 BUILT (Aug 5) — PRODUCE COMPUTES BEFORE IT WRITES** (`lib/prepare/compute-produce.ts`,
mounted in the pass's produce lane after the requirements ask-gate): when a judged `produce` item
has kb-backed data files staged, a model-written script runs in the sandbox FIRST and the
COMPUTED FACTS ride the delegation envelope — the writer writes from code-verified numbers, the
arithmetic floor confirms them downstream. THREE laws found live in one build session: THE CLOCK
in codegen (an assumed-year July filter printed a confident 0 against 2026 data — the
year-transposition class reached codegen), THE DATA PREVIEW (a guessed column name KeyError'd —
codegen now reads each input's actual head from KB extracted_text), and REASONED REPAIR (a
numerically-correct run was rejected for a missing FINDINGS label and the blind repair reproduced
it — the repair prompt now carries WHY). Honest at every edge: codegen may decline, one capped
repair, failure → logged null (status quo). Gates **32/32** incl. S3-LIVE: a real staged CSV
through codegen → sandbox → the correct total (6150) in the facts.
NEXT in this arc: AgentOS Python tool (needs box redeploy) · compute artifacts as entity-ledger
events · Arc 2 (standing commitments).

- **One `compute` capability**: sandboxed job service on our own infra (the transcription-worker
  pattern: POST job → 202 → callback with artifact). No ambient network. Inputs are a DECLARED
  manifest (deliverable-pool files, KB docs, attachments — read-only). Output = artifact + an
  execution log. Sends remain impossible in the sandbox — the commit door keeps its monopoly.
- **Mounted at the existing seams** (the agnostic invariant cashed in): one CAPABILITY_MAP row +
  one registered tool → reachable from the judge (`produce` can route to compute), workflow steps
  (a Compute step in the builder), delegation envelopes, and chat. Zero classifier/UI edits.
- **The verify loop generalized**: draft → mechanical check → revise, on EVERY produced
  deliverable where claims are checkable (totals, dates, counts, "the attachment contains what
  the reply claims"). The AHK verification gate becomes the engine's default posture, with code
  where code applies. The evaluator gains a compute-backed check channel.
- **The observation log rides along as a byproduct**: a job's declared manifest IS an observation
  record. Unify with activity_events/action_commits into one auditable action log — the
  compliance story for the regulated pitch, earned structurally, not as a separate project.

## ARC 2 — EXECUTION CONVERGENCE (workflows become standing commitments)

**PROGRESS (Aug 5):** stage 1 BUILT — **THE STANDING BINDING** (`lib/workflows/standing.ts`): a
scheduled active workflow holds exactly ONE open commitment (`source='workflow'`, due_date = the
next scheduled run), advanced in place on every successful run and re-synced hourly by the
dispatch cron (the self-healing convergent door — a silently-dead workflow keeps its past
due_date and stands as an OVERDUE DEBT on the deck; the dead-for-a-month pilot-briefing class
dies structurally). Laws: one row per workflow · a human dismissal STICKS (never resurrected) ·
non-standing/deleted workflows close their row honestly · THE JUDGE FLOOR (a source=workflow
commitment is judged none before any AI — its workflow produces it; the pass can never delegate
it). Also shipped: **THE PROVENANCE CHIP** (Arc 1 made visible) — "✓ computed in code" renders
on prepared deliverables from the STRUCTURAL `provenance.computed` stamp the sandbox writes
(with the as-of + input files), never text-matched. Gates PC1–PC2 + ST1–ST4 (46/46; ST4 live
round-trip on the probe: create → advance-in-place → dismissal sticks).
**Stage 2 BUILT (Aug 5) — THE SPEC CARD** (`lib/work/standing-spec.ts` · `/api/tasks/standing` ·
the rail's card): "I want a weekly report on X", said in any conversation scope, builds a
CODE-VALIDATED spec (name · deliverable · cron proved by nextRunFromTrigger, one repair then
honest error · a REAL coworker owner) and lands it as a durable `standing_spec` component turn —
the CARD — in the work's room (this room / the item's room / global routes via findEntityFocus).
SAYING PREPARES, COMMITTING STAYS EXPLICIT: the propose half creates NOTHING; the card's ONE
Confirm fires the commit route (exactly-once guarded) → executeCreateTask (generate-config,
active workflow) → the stage-1 standing binding → the card flips in place to the confirmed
record. Global-without-a-named-project answers honestly and asks which work it belongs to
(queued: the loose-room home). Gates SC1–SC5 (50/50; SC5 live: a real ask → a validated
weekly-Monday spec on the probe's seeded workers).
**Stages 3–5 BUILT (Aug 5) — ARC 2 COMPLETE.** (3) **THE RUN LANDS IN THE ROOM**
(`narrateStandingRun`): the standing commitment IS the object and its room the home (the deck's
"Standing:" row already opens it) — a successful run narrates there (CoS voice, deduped per run,
deliverable link); a FAILED run narrates honestly AND stamps due_date to today. (4) **THE
MISSED-PROMISE FLOOR** (design-review find: the dispatcher advances next_run_at BEFORE running,
so a task failing every run would push its due_date forever forward and the debt would never
show): a PAST due_date is only advanced by a run that SUCCEEDED (`fromSuccessfulRun`) — the
hourly healer never papers over a missed promise (RN3 live round-trip). (5) **ROOM FEEDBACK
MUTATES THE METHOD** (`steer_standing_task`, chief capability, commitment-room-scoped,
source-verified): "less macro, more tenders" appends dated STANDING FEEDBACK to
worker_instructions — the exact channel the final AI step injects — tail-capped; next run
inherits. **Studio demoted**: the confirmed card's quiet "method" link is its door from the
room. Gates RN1–RN4 (54/54).

- **"I want a weekly report on X" — said anywhere — creates a STANDING COMMITMENT**, confirmed
  via a spec card (the prepared-invite pattern: editable, explicit, approve-to-commit: owner ·
  rhythm · recipients · sources · first run). Its ONE home is the room of what it's about
  (entity room for client work; a loose room otherwise).
- **The pipeline survives as the METHOD, not the object.** generate-config still builds it; the
  Studio builder demotes to the method editor behind the commitment (power-user door). The
  user-facing object is the commitment.
- **Runs land as prepared artifacts** — card in the room stream, stage for review, commit door
  for delivery. A failed/missed run is an OVERDUE DEBT the engine chases (the deck surfaces it
  exactly like an overdue client obligation — the silent-death class dies structurally).
- **Feedback compounds where the work lives**: "less macro, more tenders" spoken in the room
  mutates the standing rules/skills; next run inherits. The outcome log accumulates PER
  COMMITMENT → the future autonomy ladder ("send without waiting for me" after N clean
  sign-offs) has its evidence base.
- The brief is derived, not remembered — the thread is never the system of record; the
  commitment is.

## ARC 3 — THE ONE SURFACE (the collapse; UI, done LAST against the final grammar)

**PROGRESS (Aug 5):** stage 1 BUILT — **THE DRIVE DEMOTION** (owner-confirmed): Drive left the
nav (the seat retired, the /drive route survives whole — nothing lost); Settings → **Knowledge**
is the door. The slim audit panel (sources · indexing status · recents · delete, no folder grid)
remains this arc's follow-through. Also closed from Arc 1's NEXT list: **compute artifacts enter
their project's world** — outputs stamp `entity_id` (caller-supplied from the item's entity,
chained after indexing) so they appear in the room's Files tab, the grounding, and the resolver.
Gates D1–D2 (56/56). Still parked: the AgentOS Python `run_compute` tool (awaits a box redeploy
with the flag's return).

**Stage 2 (Aug 5–6) — THE VOICE landed; the rooms dimension WAITS FOR THE FOLD (owner-corrected
twice, the lesson now law).** Two interim seats for pinned/recent conversations were tried and
KILLED the same morning: the wide nav sidebar (mixes two navigation systems mid-migration) and a
pills strip under the composer (violates spec law 7 — no trailing pills — and DUPLICATES seats
that already exist: pinned projects ARE the Projects lens; recent work IS the deck). **THE
LESSON, generalized: an end-state mockup element gets NO interim approximation — a dimension
earns its seat when its arc lands, not before.** The mockup's sidebar-with-conversations becomes
true AT THE FOLD, where Home is the app and the sidebar is its frame. `/api/rooms/recent` (slim,
zero-AI, ladder-lawful) stands ready for that day; no surface consumes it yet. The rail is the
lean icon column (Drive stays demoted). **THE VOICE** stands: the Home briefing + room openings
wear `.font-voice` (one class in globals, never on chrome). Gates D3–D4 (58/58 — D3 now asserts
the ABSENCE of any interim rooms surface).
**Stage 3 BUILT (Aug 6) — THE FOLD's ENABLING BRICKS.** (1) **THE DURABLE HOME CHAT**: the Home
conversation is a loose room (`chat:<uuid>` in room_turns) — every exchange persists, a reload
rehydrates, "New" starts a fresh room while the old stays durable (ladder rung 2 + law 4 made
real; persistence mints no objects — law 3). This is the brick that lets /work fold: the Home
chat is now a REAL persistent chat. (2) **Settings → Team** (the fold's config door, interim →
/workers, same pattern as Knowledge). (3) **THE CLAUDE-SHAPED CHAT** (owner: "needs to feel
super smooth going from that initial message into a chat panel — like Claude"; the play IS the
industry pattern, which the mockup already wears): the takeover — a live conversation gets a
real chat's room (62vh column, the same smooth grid morph, composer as the floor); **THE
HISTORY PICKER lives INSIDE the panel** (lawful home for thread management — never a nav
surface): past chat rooms titled by their own first ask, one tap loads them; answers wear THE
VOICE (serif). Gates F1–F3 (61/61).
**THE THREAD-MANAGEMENT STORY, fully specified (owner question, Aug 6 — mockup rev 4):** three
layers, all the Claude/Recents convention. (1) END-STATE SIDEBAR: Pinned projects + ~5 Recent
conversations + "All conversations →". (2) **THE ALL-CONVERSATIONS VIEW** (the doorway's
destination, now drawn in the mockup): a searchable center-column list — each row titled by the
conversation's OWN first ask, scope chip (project name / "no project · add to…" — the scope-chip
control surfaces here too), date + turn count, newest first, stage closed. (3) MID-MIGRATION
(built): the HISTORY PICKER inside the chat panel is the interim seat; sidebar layers arrive AT
the fold.
### THE EXECUTION ROADMAP (settled with the owner, Aug 6 — "fresh chrome, same organs")

The owner's call: the plumbing is right; the Home's SHELL restarts fresh from the mockup —
a NEW component tree (never an incremental graft onto the 2.3k-line home-view), with the
battle-tested organs (BriefingBlock · the judged deck · HomeAsk/converse · This-week rail ·
RoomShell) MOUNTED into it, never rewritten. Order:

0. **THE CHECKPOINT** — DONE (Aug 6, `ba201d0` on dev: 39 files, the three arcs, 61/61).
0.5 **SHELL S1 BUILT (Aug 6) — THE FOLD, WHOLESALE.** `components/one/one-sidebar.tsx` replaces
   the icon rail app-wide (the old rail DELETED): the conversation-owned frame — Home · New chat ·
   Pinned (tracked rooms) · Recent (the MERGED conversations list: chat rooms + conversed item/
   entity rooms in one global-recency order) · All conversations → · Sources (Inbox · Meetings) ·
   identity/Settings footer. Workers/Chat/Drive have NO seats; routes survive; Settings holds the
   Team + Knowledge doors. **ALL CONVERSATIONS is real** (`components/one/all-conversations.tsx`,
   the `?view=conversations` sidebar-reached lens): searchable, `?all=1` deep read, a chat row
   loads into the ONE Home panel (aug:open-chat), a room row opens its door. New-chat/open-chat
   wires into HomeAsk; a starting conversation appears in the sidebar live. This is LAWFUL now —
   the fold ships WITH the frame (the Aug-6 lesson honored). Gates D2/D3/D3b (62/62); full
   production build green.
0.6 **SHELL S2 BUILT (Aug 6) — THE CENTER + ONE NAME EVERYWHERE.** The dashboard's top is the
   mockup's composition: date eyebrow · compact greeting (Claude's own idiom, 20px — the 72px orb
   retired; the calm IS the signal) · **THE BRIEF IN THE VOICE** — the brain-authored briefing
   (composeBriefing) renders FLAT and serif as the day's opening, refs live + struck-when-acted
   (BriefingBlock + the existing clearedIds/briefNav machinery — it was composed daily but
   UNRENDERED since the chat removal); voice-styled teaser fallback. NAMING (owner law): the
   sidebar section is **Projects** (never "pinned") with the All-projects mirror; conversation
   chips speak product words (project / work / chat — never "room"); the History picker links
   into the same All-conversations view (picker ↔ view ↔ sidebar = ONE thread system). Gates
   SH1–SH3 (65/65); build green.
0.7 **SHELL S3 (Aug 6, owner-corrected) — THE OPENER IS ONE PARAGRAPH; THE COMPOSER IS THE
   FLOOR.** The full four-block prose brief re-made July's mistake (it DUPLICATED the deck
   sitting under it — Rene/TECNICLIMA/Fidelidade listed twice); the Home now opens with the
   briefing's LEAD ONLY (BriefingBlock `leadOnly` — one short serif paragraph of the day's
   shape, refs live) and the deck carries the inventory. The composer moved to the shell's
   FLOOR (sticky bottom, mt-auto, gradient hood — Claude's anatomy) with the conversation
   takeover opening UPWARD; the mid-page ask zone is gone. Gates SH2 (rewritten) + SH4 (66/66);
   build green.
0.8 **SHELL S4 (Aug 6) — THE DEAD CLICK DIES + CONCRETE WORDS.** Found live: clicking a
   conversation loaded its turns into a CLOSED panel — a dead click. THE OPEN INTENT: the event
   opens the panel same-page; a sessionStorage intent flag covers the cross-page mount (sidebar/
   All-view → /home); "New chat" opens + focuses. Suggestions moved ABOVE the floor input
   (nothing sits below the composer). Conversation rows wear CONCRETE product words (project /
   email / task / meeting / chat — never "work"/"room"). Header rhythm (mb-9) separates the
   opener from the deck. Gates SH1 (rewritten) + SH5 (67/67); build green.
0.9 **SHELL S5 (Aug 6, owner-triggered) — THE DECK WEARS THE CARD GRAMMAR (Home only).**
   `WorkRow variant="card"` — SAME handlers (exit/undo/prefetch/seed), a second skin: semantic
   state dot (rose overdue · indigo prepared-awaits-you · amber due-today) · sentence · sub-line
   (project · context · due) · ONE CTA row whose verb speaks the JUDGED state ("Review & send →"
   only when a prepared draft truly exists — server truth; the July "See X's work" promise-lesson
   honored; the CTA opens the same room the card opens). The deck's bordered divide-y container
   retired for a calm card stack; every OTHER surface keeps the one-line row (H6 in
   smoke-work-surface RE-POINTED to the card design — the house doctrine, never weakened).
   Gates SH6 (68/68); build green.
1.0 **SHELL S6 (Aug 6, owner-corrected) — NO PROSE ON THE HOME (now law, said twice) + COMPACT
   CARDS.** The deck IS the day: no briefing render above it, ever — the composed briefing keeps
   powering ORDER + de-dup (sentencedIds), it just never re-speaks. Cards tightened to TWO lines
   (title+badge · verb+context, py-2, 1.5px dot). Gates SH2 rewritten (68/68); build green.
   HONEST LEDGER of "ground-up": NEW files = the sidebar frame, All-conversations, the
   conversations system, the card skin, the floor anatomy; STILL THE OLD BODY = home-view.tsx
   (2.3k lines) hosting the composition, the deck section headers, the This-week rail, the
   ring/Activity cluster, the view-switcher island. The remaining ground-up step = EXTRACting
   the center into components/one/one-home.tsx (a clean composition mounting agenda/rail/
   composer), retiring home-view to a data shell — a focused session with owner review.
   Rider (Aug 6): **THE SANDBOX FROM THE HOME** — run_compute mounted in the chief loop
   (CHIEF_TOOL_DEFS + dispatch; the exposure existed, the mount didn't) — the Home chat can now
   compute in the locked room.
### THE NEXT-SESSION CONTRACT (settled Aug 6 — execute in THIS order, fresh eyes first)

A. **DONE (Aug 6)** — `components/one/one-home.tsx` authored from blank: `OneHomeHeader`
   (eyebrow · greeting · today line · live-cluster slot) + `OneDeck` (the card stack; grouping
   as a pure function; fresh quiet header, fresh empty state; urgent-open/calm-pin behavior
   carried in as law). home-view now computes and MOUNTS — the deck/header JSX is gone from it
   (~130 lines out). Affected gates re-pointed to one-home (68/68); lint + full build green.
   The meetings-internal "Home" → "All meetings" (own icon) rode along.
   ORIGINAL CONTRACT (kept for reference): author
   `components/one/one-home.tsx` from a BLANK file — the clean composition (top cluster · deck ·
   rail · floor) — and splice it into home-view as `<OneHome {...bindings} />`. The binding
   inventory (derived Aug 6, making the session mechanical): b · greeting · syncing/lastUpdatedAt/
   realtimeConnected · showRing/ringCleared · agenda · activityOpen/setActivityOpen · doGroupMode/
   setDoGroupMode · pinned-group state (togglePinnedGroup/hover) · dismissDeal · onDismiss/
   onCleared/toastInbox/toastCommitment · sentencedIds · deckEntityIds — plus relocating the
   module-local Label/SectionCleared/ThisWeekCard/MovingTier (move or export). home-view retires
   toward a data shell. Every spacing/hierarchy decision made FRESH against the mockup.
B. **FIRST PASS DONE (Aug 6)** — meetings panel aligned to the one sub-panel width (204px, the
   inbox rail's system); the empty-projects narration removed (an empty inventory never narrates
   its own emptiness — the + stays as the create door); "All meetings" replaced the second
   "Home". The inbox rail was ALREADY collapsible (52px) + resizable — the squeeze's remaining
   depth (calendar panel width, reading-pane paddings, one type scale) rides the token pass.
   Gate SH7 (69/69); build green. ORIGINAL SCOPE: the wide
   sidebar (212px) squeezed the sources' own sub-panels — Inbox runs FIVE columns (app sidebar ·
   folder rail · list · reading pane · calendar). The pass: one visual system for section
   sub-panels (width, padding, type scale from the shell), the inbox folder rail collapsible,
   the meetings panel de-noised (the empty projects block earns its space or folds). "All
   meetings" already replaced the meetings-internal "Home" (two Homes never sit side-by-side).
C. **THE ABSORPTION** — after A+B (A done, B first-passed). BRICK 1, protocol VERIFIED Aug 6
   (recon against worker-chat-tab): the worker engine speaks POST
   `/api/work/threads/<threadId>/chat` `{content, agentId, mentions?, attachments?}` → SSE
   `data: {type}` events (`thinking_delta` · `thinking_done` · `text_clear` · `text{delta}` ·
   tool events · artifacts · email drafts). The brick: (1) a get-or-create door for a coworker's
   DM thread (resolve from the existing threads list per agent); (2) HomeAsk detects the ADDRESS
   ("Clara, …" / "@Clara" — roster from /api/workers/mentions, cached) and routes the message
   through that engine, consuming the SSE into the panel (streaming text + tool chips + author
   attribution); (3) the conversation LIVES in work_threads/work_messages (its existing store —
   never double-persisted into room_turns); listing coworker conversations in Recent/All is
   brick 2. **BRICK 1 BUILT (Aug 6, gate AB1 — 71/71, build green):** address detection against
   the live roster (first-name / @name), the DM thread get-or-created + LS-cached (the worker's
   page shows the SAME thread), the SSE consumed live into the panel (streaming text — the
   Home's first true streaming — + tool-progress lines + the coworker's name on their reply),
   honest failure copy, and the TEMPORARY guard (addressing skipped in temp mode — the worker's
   own store would break the not-saved promise). Rider shipped ahead (Aug 6): **TEMPORARY CHAT** (F4 gate) — the ladder's ephemeral
   opt-out, persistence structurally skipped, honest "not saved" label, pre-conversation-armed,
   reset by New.
D. **THE COMPOSER CONSOLIDATION — DONE (Aug 6, gate AB2 — 73/73, tsc + build green).**
   Workstream 3 executed: HomeAsk's bare `<input>` + @-mention-lite DIED; the floor now mounts
   the SAME `WorkerMentionInput` the worker surfaces use (@ opens the Coworkers/Tasks/Documents
   picker · attach buffers files until send · suggestion chips ending in "…" prefill the
   textarea via `prefill`/`onPrefillConsumed`). THE ONE ROUTING in `handleSubmit`: a coworker
   MENTION is the address (typed "Clara, …" detection stays the fallback); files FOLLOW the
   route — an addressed message uploads through the thread's own chat-attach door and rides the
   chat POST as `attachments`, a chief message uploads to the KNOWLEDGE BASE (presign → PUT →
   confirm+index) and the question carries an honest `[Attached to the knowledge base…]` note;
   task/document mention labels ride the chief question as `(about: …)` grounding hints.
   Temporary mode refuses uploads with honest copy (both destinations persist — the not-saved
   promise holds structurally). The user's durable turn persists WITH its attach note (F1
   re-pointed to `persistTurn('user', shown)`). Remaining from the workstream: the rail
   (item-rail composer) still speaks its own idiom — fold it onto WorkerMentionInput when the
   room's exchange grammar next opens; scope chips ride workstream 2. RIDER (owner call, Aug 6):
   `frameless` prop on WorkerMentionInput — the HOST owns the frame (the Home floor's double-pill
   died); the Temporary toggle wears EyeSlashIcon in the composer's icon-word grammar.
E. **THE STREAMING ASK + BRICK 2 — DONE (Aug 6, gates ST8 + AB3 — 75/75, tsc + build green,
   progress channel live-verified on the probe host, listing query live-verified on 4 real
   accounts).** (1) STREAMING: `/api/home/ask` `{stream:true}` answers over SSE — the ONE
   PROGRESS CHANNEL in converse (`onProgress` threaded through the fast-path dispatch AND the
   agent loop; `TOOL_PROGRESS` labels speak consequence: "Searching your files…", "Running the
   numbers…") narrates live; the panel's busy line speaks the stage; `done` carries the same
   payload as the surviving JSON path (non-panel callers untouched). The final answer types in
   via the existing typewriter — full token streaming rides the token pass if ever needed.
   (2) THE ABSORPTION BRICK 2: coworker chat threads (workflow_id null, temporary excluded)
   LIST in the merged Recent/All-conversations (`worker:<threadId>:<agentId>` keys, emerald
   "coworker" chip, global-recency merge) and OPEN in the ONE Home panel: WORKER MODE loads the
   thread's own work_messages with attribution (the thread stays the store — chief persistence
   structurally off), re-aims the `aug-dm-<agentId>` pointer so the next message continues the
   SAME thread through the worker engine; an explicit @-mention overrides; New/chat-load/temp
   all exit the mode. /workers' chat has no remaining listing monopoly — the fold's absorption
   story is complete for DM chats (project/group coworker threads: future).
F. **THE CONVERSATION IS A PAGE — DONE (Aug 6, owner correction: "conversation-focused page
   instead of the component; hover-out made it disappear"; gate F3 re-pointed, 75/75).** The
   Granola hover-card era is dead: `showThread = hasThread && open` — no hover gating, no
   outside-click collapse (a live conversation NEVER disappears under the mouse). The thread
   renders directly on the page in a centered max-w-3xl reading column (no card border/shadow),
   viewport-tall (calc(100vh-250px), min 40vh). Leaving is EXPLICIT: Close (✕ — hands the
   dashboard back; the conversation stays and re-opens on composer focus) or New. Submitting
   from anywhere opens the page.
G. **THE SCOPE CHIP + THE ADOPTION CASCADE — DONE (Aug 6, gate F7 — 76/76, tsc + build green,
   cascade live-verified on the probe host: turns move, room narrates once, chat empties;
   work-surface 51/51 after the picker extraction).** The context-controls clause built: the
   conversation header wears its scope — "No project · Add to…" opens the ONE PICKER GRAMMAR
   (`ProjectPickerPanel`, EXTRACTED from RowProjectPicker into a shared export — every
   add-to-project door now renders the same panel, only consequences differ); "<Project> ✓" is
   the DOOR to the room. Adopting = POST `/api/rooms/adopt`: the chat room's turns RE-HOME into
   the project room (chat:* only; idempotent seam narration "Filed a Home conversation…", dedupe
   `adopt:<chatKey>`), then the panel TALKS IN THE ROOM: turns persist to the entity key (the
   room's rail shows the conversation — one conversation, one home) and answers ground
   entity-scoped through the one core (`entityId` on /api/home/ask → converse entity scope =
   full room grounding + room verbs). Scope survives reload (LS), clears on New / chat-load /
   coworker-DM load; hidden in temp (nothing persists to adopt). V1 boundary: adoption is
   one-way per conversation (turns interleave in the room after the move — re-scoping would need
   per-turn provenance; not built).
H. **THE RAIL COMPOSER FOLD — DONE (Aug 6, gate AB4 — 77/77, one-room 85/85, tsc + build
   green).** The room's bespoke composer (textarea + own attach/send buttons) died; the rail
   mounts the SAME `WorkerMentionInput` (frameless — the rail's own rounded frame hosts it).
   Mapping: a coworker @-mention becomes the ADDRESS in the sent words ("Clara, …" — the steer
   core's delegate path already speaks names, no new plumbing); task/document mentions ride as
   "(about: …)" hints; attach feeds the room's INGEST FUNNEL immediately (pool semantics — a
   room file lands now, never buffered); `send(raw)` keeps serving the offer chips / go-ahead
   buttons (clicks are utterances, unchanged). ONE COMPOSER now holds everywhere it exists:
   Home floor · worker chat · the room rail. Remaining composers by design: the reply/forward
   STAGE editors (rich-text email composition — a different instrument, not a chat composer).
I. **THE SLIM KNOWLEDGE PANEL — DONE (Aug 6, gate KN1 — 78/78, tsc + build green, derivation
   live-verified on the heaviest real account: 68 files → 2 meetings · 66 attachments · 62
   indexed · 6 processing · 36 project-stamped).** The folder grid DIED (drive-client.tsx
   deleted, 1.8k lines); /drive survives as the Settings → Knowledge door, now rendering
   `components/knowledge/knowledge-panel.tsx` — the sovereignty/audit surface: ONE overview
   read (`/api/knowledge/overview`; kind derives STRUCTURALLY — transcript::→meeting,
   email_attachment::→attachment, augmtd source→generated, else upload — never a stored
   label), the audit line (indexed/processing from real chunk counts + which mailboxes feed
   attachments), source-count filter chips, name+content search (instant substring + debounced
   semantic riding the same brain retrieval), each file naming its PROJECT (entity_id), upload
   (presign→PUT→confirm), and the right to remove (two-step, optimistic, restore-on-failure).
   Boundary by design: meeting notes are never deletable here — they live with their meeting.
   Instant-load from LS (ambient, ageless). OWNER CORRECTION (same day, now law): Knowledge is a
   real SETTINGS SECTION — the panel renders INSIDE the Settings shell (`?tab=knowledge`, the
   left panel stays grounded), never a standalone page ejection; /drive survives only as a
   redirect to `/settings?tab=knowledge`. A Settings door must never leave Settings.
J2. **THE FEEL PASS (Aug 6 evening, three owner corrections):** (1) the MovingTier line ("N
   moving · nothing needed from you") DIED — the deck IS the day; an ambient reassurance line
   floating in empty space read as clutter (momentum lives in sidebar Projects + portfolio).
   (2) THE INSTANT ECHO — the submitted turn + busy line land SYNCHRONOUSLY before any
   routing/roster/upload await (an 8s cold /api/workers/mentions made submit look dead);
   the roster warms at mount; askWorker takes `echoed` so no double bubble. (3) the takeover
   EASES — entering fades the deck ~180ms before unmount (chatFading), leaving remounts
   instantly; the swap no longer reads as a glitch.
ZZ. **THE DOCUMENT HANDS — slice 4: THE BRANDED KIT + THE MOMENT THEME (Aug 11 night;
   gate DH4 — 130/130, build green; E2E 11/11 zip/XML + LIVE chain proven; owner
   corrected the frame mid-build: "general use case, not corporate-specific" and "not a
   set-in-stone ask — could be for that moment").** Branding is a CHAT ACT, three ways:
   (1) THE MOMENT THEME — "brand this with the attached logo and matching colors" + an
   image attachment builds the theme ON THE SPOT: accent EXTRACTED from the logo's own
   pixels (canvas, deterministic — nobody types hex), applied to THAT request's
   deliverable only. LIVE-proven: converse → Sofia → the stored artifact's XML wears the
   extracted accent with the logo embedded. The coworker is told BRANDING IS HANDLED
   (found live: "no logo came through" turned a finished summary into an ask). (2)
   DURABLE BY WORD — "always/from now on" saves it as the user's theme; "reset document
   branding" clears it. (3) WORKSPACE FALLBACK — admin theme (logo · accent · footer
   line on the workspace detail page) for the corporate tier. Hierarchy: request
   override → user saved → workspace → house (no theme = byte-identical output).
   Renderers: docx logo header/footer/accent title; pptx accent + logo corner + footer +
   NATIVE CHARTS (typed protocol, code-validated; malformed chart drops, slide keeps
   bullets). Images ride the attach doors as BYTES (≤1MB). Xlsx styling waits for the
   compiler. NEXT: DH5 template-by-example → streaming remainder → DH6 the compiler.
YY. **THE DOCUMENT HANDS — THE FULL ARC SPEC (owner-shaped, Aug 11 evening).** The bar:
   "as good as Claude on documents/charts/decks, plus memory and branding Claude can't
   do." The utterances that define it: "use the template from document X (Dropbox /
   attached / email attachment / KB)" · "brand it with our logo and colors" · "make one
   slide per region like this one". REMAINING SLICES: **DH4 THE BRANDED KIT** —
   workspace doc theme (logo — already in settings.branding — + accent color + footer
   line) consumed by the builders; theme auto-applies once set (said once, every
   deliverable born on letterhead); + the pptxgenjs unlock (brand masters, native tier-1
   charts in decks). NOTE: SheetJS community cannot write xlsx cell styles — xlsx visual
   branding waits for the compiler (openpyxl). **DH5 TEMPLATE-BY-EXAMPLE (structure)** —
   "like document X": the universal resolver finds X anywhere, the fidelity chain
   extracts its SKELETON, the delegation fills the skeleton, the renderer emits.
   **DH6 THE COMPILER (the enabler)** — sandbox image + python-docx · openpyxl ·
   python-pptx · matplotlib · LibreOffice-headless · pypdf · tesseract; the binary
   file-output channel; OUR deterministic helpers baked in (clone_slide with
   relationship fixups; preserve-what-you-can't-parse); THE RENDER-VERIFICATION GATE
   (LibreOffice → images: right page/slide count, nothing blank — a corrupt file NEVER
   ships); fallback ALWAYS lands (failed surgery → house-branded tier-1 + honest note).
   Unlocks: in-place fill of the client's own docx/pptx (hand-made decks included — we
   MUTATE their file, never imitate it, so design survives by construction) · PDF
   export/forms/OCR · native Excel charts with LIVE FORMULAS (=SUM(), recalculating —
   never dead numbers; chart data rides the arithmetic floor) · charted Word docs
   (matplotlib → embedded images) · template-following decks. **DH7 CHART DISCIPLINE**
   — house chart theme keyed to workspace brand. **DH8 THE TEMPLATE REGISTRY** — "save
   this as our report template" (the document-shaped sibling of Skills). Viewer
   previews for xlsx/pptx/pdf fold into THE ONE VIEWER. THE SOVEREIGN SENTENCE: all of
   it in OUR locked room — no third-party document APIs, no files leaving. Honest v1
   limits: client brand fonts substitute in render; aesthetic (vision) QA later —
   render-sanity first. Sequencing: DH4 → streaming remainder → DH6 → DH5/7/8 cheap
   behind it.
XX. **THE DOCUMENT HANDS — slice 3: TYPED DELIVERABLES (Aug 11; gate DH3 — 129/129, build
   green; E2E 8/8 — real xlsx cells and pptx slide XML read back).** The team can now
   hand back SPREADSHEETS and SLIDE DECKS, not just documents: one fenced protocol
   (```spreadsheet / ```slides carrying XlsxContent/PptxContent JSON), one
   code-validating parser shared by BOTH production engines (delegations + workflow
   runs); bad shape → the docx fallback, never a broken deliverable; typed outputs skip
   the length floor; the thread shows the hand-back note while the artifact card carries
   the file; the prompt rule is conservative (never force tabular shape onto prose).
   The builders (pptxgenjs-era buildPptx/buildXlsx) existed since the artifact registry —
   this wired them to the coworkers' hands. THE DOCUMENT HANDS ARC (DH1-3) now covers:
   structured docx out · structure-preserving docx in · xlsx/pptx production. Remaining
   candidates for later slices: in-place docx editing (true style preservation of the
   client's own file), charts in decks/sheets.
WW. **THE DOCUMENT HANDS — slice 2: THE FIDELITY CHAIN (Aug 11; gate DH2 — 128/128, build
   green; round-trip E2E 7/7 on a REAL docx).** The other half of the Claude bar: the
   docx EXTRACTOR was flattening headings/tables/numbering to raw text, so a "fill this
   in" delegation never saw the form's structure and couldn't mirror it. Now: mammoth
   convertToHtml → deterministic htmlToMarkdown (h1-h6 · tables → | tables | · real ol
   numbering · ul · strong/em; zero dependency, zero AI; raw text stays the fallback
   floor) — structure survives INTO the material; the delegation prompt mandates
   MIRRORING it; the structured renderer (DH1) carries it back OUT. The whole chain
   proven: our renderer's docx → extractor → headings, table, numbering, [CONFIRM] all
   survive as markdown. Every attach door benefits at once (chat, worker DM, extract-
   attach — one extractor). NEXT: xlsx + pptx generation as chat/delegation outputs.
VV. **THE DOCUMENT HANDS — slice 1: THE STRUCTURED RENDERER (the coworker capability arc
   begins, Aug 11; gate DH1 — 127/127, build green; E2E 8/8 with XML inspection; demo
   docx delivered to the owner).** The Claude bar René set ("fill in this document and
   hand it back looking right") starts at the renderer: ONE shared builder serves every
   document output (delegations · workflow runs · chat production), so one upgrade lifts
   all. Markdown tables → REAL docx Tables (bold header on light fill, borders, full
   width — forms live in tables); numbered lists → true ordered numbering; ### → small
   bold headings; [CONFIRM: …] slots render bold-italic AMBER (a filled form shows at a
   glance which facts still need the human — the marked-slot law made visible). NEXT
   SLICES: docx-in→docx-out fidelity (fill the client's own file), xlsx generation,
   pptx generation as chat/delegation outputs (builders already exist for both — the
   wiring is the work).
UU. **THE AUTONOMY ARC — BUILT, THEN PARKED THE SAME DAY (Aug 11; gate AU1 now ENFORCES
   the park — 126/126, build green). THE HUMAN-IN-THE-LOOP LAW (owner): "it's dangerous
   territory to have stuff done without human approval — I don't want us to be that yet.
   We should be human in the loop."** Every send in the product goes through a human
   approval; autonomy is not a current feature. What was built and proven before the
   call (recorded so the design survives): the outcome-log evidence read (≥5 unchanged
   sends · ≥70% acceptance · 60d; autonomous sends excluded from their own evidence),
   the once-only strategic ask with a sticking decline, Settings→Autonomy as a visible
   revocable ledger, and the autonomous send behind five floors (grant · daily cap 3 ·
   known-recipient · review-pass · commit door) with because-narration — decision layer
   10/10 E2E on probe. WHAT REMAINS IN THE TREE: `lib/autonomy/{ledger,send}.ts` with ⚠️
   PARKED headers, referenced by NOTHING (pass wiring, Home ask, Settings tab, API route
   all removed); the outcome log keeps collecting as before (R1, collect-only). AU1
   asserts the park structurally — re-activation is a deliberate owner decision, never a
   refactor side-effect. If revisited someday, the likely first step is the ask/ledger
   WITHOUT any send (insight before action).
TT. **THE FRESH FLOOR (Aug 11, hardened twice same morning — owner: "clicking the chat
   opens the older one" / "placeholder doesn't update when clicking back in home"; F3
   re-pointed, 125/125, build green, both verified live with exact repros).** The landing
   law made absolute: NO implicit conversation rehydration at all — the deck + an EMPTY
   chief chat are the default; the stored key restores ONLY behind the explicit
   cross-page intent flag, otherwise it CLEARS (preventing the subtler bug: a "fresh"
   chat silently appending to an unseen old room server-side). Sidebar Home resets
   COMPLETELY (DM mode, turns, scope, stored key — the deck composer can never say
   "Message Clara…"). Past conversations live durable behind explicit doors only:
   sidebar recents, All conversations, the DM History popover, ?chat= links, the
   facepile. The interim restore-quietly design (SS item 2) is superseded by this.
SS. **THE USER-VOICE LAW ON WORKER THREADS + THE HONEST LANDING + DM HISTORY (Aug 11; gate
   DM1 — 125/125, build green, all three verified live).** Owner's three finds, one seam:
   (1) worker threads listed in recents by updated_at alone — the Aug-8 "a conversation
   requires the user's voice" law now extends to them (a real user message required; an
   opened-never-typed DM or system-bumped thread can't parade as a conversation; E2E on
   probe fixtures). (2) THE HONEST LANDING: the LS rehydration chain (loadWorkerRoom →
   focusComposer → onFocusCapture → setOpen) made the last-open DM steal the page, and
   the narrator greeting made an EMPTY DM count as conversation — restore now never
   focuses, and a greeting-only DM doesn't restore (stale key self-clears); the deck is
   the default landing; a conversation reclaims the page only with the user's own turns.
   (3) THE DM HISTORY: /api/workers/dm-sessions (user-voice filtered, first-ask titles —
   the chat rooms' titling law) + a History popover in the DM header beside New session;
   click loads the session in place.
RR. **THE TEAM ARRIVES WITH THE MEMBERSHIP + THE SOVEREIGN GALLERY (Aug 11 morning; gate
   SV6 — 124/124, build green; live repair applied).** Found live day 1: the first real
   iScore user had ZERO coworkers — worker seeding was coupled to the EMAIL bootstrap (a
   sovereign user never connects a mailbox) and the retired /workers page had been the
   silent backstop. Fixed as the class: (1) /api/company/join seeds the team in after()
   — joining IS "set up your agents"; (2) the presence route self-heals an empty roster
   on any authed visit (idempotent; the facepile can never again show a dead no-team);
   (3) the workflow template gallery hides mailbox-READING templates + the Email chip on
   email-off workspaces (delivery via Resend stays; generate-config already excluded
   mailbox tools by feature). The real user was seeded immediately (Clara/Sofia/Luca/
   Max) — prod-fixed ahead of the deploy.
QQ. **THE BRANDED ENTRY GOES SPLIT-SCREEN (Aug 10 last — owner: "use the normal
   onboarding, the screen split looks cooler"; SV2 re-pointed, 123/123, build green,
   screenshot-verified).** The corporate door now wears the standard onboarding's split:
   LEFT the white form panel (co-brand top, big step headlines — "Welcome to <client>" /
   "Choose a password" / "Check your inbox" / "Join <client>" — step dots, the
   onboarding's rounded-2xl inputs + neutral-900 button, the safe-data mark at rest);
   RIGHT the SAME animated AI-work preview (RightPanel EXPORTED from onboarding-client
   and imported — one component, two doors, no copy to drift). Same three-step walk,
   same auth flow, no OAuth anywhere on the page.
PP. **THE ADMIN INDEX ROW + BRANDED JOIN CODES (Aug 10 latest — owner: "see how bad it
   looks"; SV3 re-pointed, 123/123, build green).** The list page is a READ-ONLY INDEX:
   the workspace name finally gets the room (it was squeezed to a sliver by six inline
   selects), quiet badges (type · plan · AI mode · status dot · corporate shield ·
   member count), copyable join code, the whole row opens the detail page. ALL editing
   lives on the detail page — the two-views split made honest. BRANDED JOIN CODES
   (owner, mid-review): the code is an editable field on the detail page (ISCORE26-style;
   uppercase alphanumeric 4-20, uniqueness + format enforced server-side, rejection
   shows and reverts); random regenerate stays beside it. Dead list-page code
   (BrandingEditor copy, expansion handlers) rides the component sweep.
OO. **THE MEETING ASSISTANT UI RETIRED (Aug 10, owner call — "we no longer use it"; gate
   SV5 — 123/123, build green).** The auto-join Google Meet bot's user-facing surfaces
   are gone: the Settings card (component deleted), the meeting page's Send-assistant
   affordance + state chips, both platform-admin toggles (per-company, per-user) and
   their handlers. KEPT DELIBERATELY: the bot API routes + Hetzner infra dormant (the
   same service runs in-person recording — the product), bot_manager's insight
   generation (the recording pipeline uses it), DB columns for stored data. Full infra
   removal only if the box ever gets rebuilt.
NN. **THE WORKSPACE DETAIL PAGE + HONEST SOVEREIGN COPY (Aug 10 latest; gate SV4 —
   122/122, build green; the sovereign door arc CLOSES).** (1) /platform-admin/
   workspaces/[id]: one page per workspace in current product language — identity ·
   access & entry (the corporate toggle with its explanation, entry link, join code) ·
   branding (logo upload inline) · features as EXPLAINED switches (Email / Meetings /
   Knowledge / Coworkers / Workflows — each says what it turns on) · members with roles +
   pending invites · danger zone (suspend, two-step cascade delete). Every mutation
   reuses the SAME platform-admin routes as the list — one behavior, two views; the list
   row's name links in; list labels aligned (Drive→Knowledge, Tasks→Workflows). (2) The
   invite doors speak honestly on a connection-less workspace ("runs without connected
   calendars — share the details in a message instead"), never pointing at a hidden
   Settings tab. (3) Settings re-audited: no connect-email CTA outside the hidden Email
   tab (DataManagement/Identity are read-only over existing connections). The deeper
   list-page redesign remains tail-queued; the detail page is the aligned home.
MM. **THE PLATFORM-ADMIN SOVEREIGN CONTROLS (Aug 10 late night, arc 3/4 of the sovereign
   door; gate SV3 — 121/121, build green; admin UI awaits the owner's superadmin eyeball —
   the dedicated superadmin account is not automatable).** Spinning up a corporate client
   is now a two-minute operation: THE CORPORATE SWITCH on each workspace row (one click =
   email OFF = sovereign; emerald shield state, plain tooltips both ways); THE
   BRANDED-ENTRY editor in the expanded row (entry link click-to-copy · logo URL ·
   tagline → PATCH merges settings.branding); alignment pass: vestigial Home pill hidden,
   bg-primary tokens → the kit's indigo. THE LOGO UPLOAD (owner: "where to upload?"):
   an Upload-logo button in the editor → super-admin route → public `branding` bucket
   (PNG/JPEG/WebP ≤2MB; no SVG — a public SVG executes script on direct navigation) →
   stamps settings.branding.logo_url in one motion (E2E: upload + public fetch 200). REMAINING (small): honest invite-send copy on
   sovereign workspaces; the deeper admin redesign (workspace detail page, current-product
   information architecture) stays on the tail.
LL. **THE BRANDED ENTRY + THE SAFE-DATA MARK (Aug 10 night, arc 2 of the sovereign door;
   gate SV2 — 120/120, build green; verified live: unauth 200 with steps+mark, unknown
   slug → /login, authed non-member → code step, screenshot).** app.augmtd.ai/<slug> is
   a client's own front door — a root [slug] catch-all (real routes win by precedence):
   co-branded header (companies.settings.branding.logo_url × augmtd), email+password
   ONLY, the three steps visible (enter your email → password & workspace code → set up
   your agents; step 3 completes on the Home's sovereign first look). Auth flow:
   supabase signUp with emailRedirectTo back to the SAME landing (auth/callback gained
   ?next=, relative-only); session-immediate signups join in one motion via the existing
   /api/company/join; authed non-members skip to the code step; members bounce /home.
   The SIDEBAR carries the co-brand (client logo beside the wordmark) and THE SAFE-DATA
   MARK ("Private environment · 🛡" footer line, tooltip: private AI models · EU
   processing · no third-party sign-in) on email-feature-off workspaces. Probe branding
   furniture set on Probe Sovereign Co. REMAINING in the arc: the platform-admin revamp
   (sovereign toggle · branding/logo management · entry-link surfacing · current naming ·
   retire dead controls) + honest invite-send copy on sovereign workspaces.
KK. **THE SOVEREIGN LEAK AUDIT (Aug 10 night — the corporate tier begins; gate SV1 — 119/119,
   build green; E2E: probe workspace flag-flip propagated + restored; recording stays IN
   the corporate tier by owner call).** features.email=false is THE sovereign trigger —
   audit findings closed: the Home first look never consulted the flag (the "Connect your
   inbox" CTA rendered regardless — now pivots to "Set up your agent team", which seeds
   the coworkers idempotently and opens the first DM); Settings hides the Email tab AND
   bounces direct ?tab=email navigation; the chief's toolset drops mailbox verbs
   (send_prepared_reply/prepare_forward newly registered in the ONE map; agentLoop
   filters its defs by workspace features — the model cannot offer what the workspace
   does not hold). Already-sound and verified: /inbox guardFeaturePage('email'), the
   sidebar's feature-gated Inbox source. The boundary law: AUTH connections only —
   workflow email sending (Resend, stated addresses) untouched. Probe furniture: "Probe
   Sovereign Co" workspace (all features on, owner=probe) for this arc's gates. NEXT in
   the arc: the branded entry (/join/[code] landing, 3 steps, logo from
   companies.settings.branding) + the safe-data mark + platform-admin revamp. NOTED for
   arc 2: meeting-invite send flows error toward "Reconnect in Settings" copy on
   sovereign workspaces (unreachable-in-practice today); Slack/Nango integrations tab is
   a separate decision (not mailbox OAuth).
JJ. **/work RETIRED (Aug 10, owner call) + THE SOVEREIGN DOOR (designed, awaiting the go).**
   /work → redirect (?thread&agent → the Home conversation opener; six inbound links
   repointed: agent-form ×3, join, oauth-complete, onboarding, workspace guards); client
   components stay one release, deleted with the /workers dead-component sweep. THE
   SOVEREIGN DOOR (the corporate tier — enterprise clients who refuse Google/Microsoft
   OAuth; the iScore blocker class): (1) A CORPORATE WORKSPACE MODE — one flag
   (companies.settings.sovereign or features.email=false as the trigger) that HIDES every
   mailbox/calendar AUTH surface: the Home's Connect-inbox first-look (→ "Set up your
   agent team" CTA instead), Settings connections, the Inbox/Meetings sources where
   unowned — audit finding: features.email exists but NOTHING on the Home consults it
   today, the leak is real. Workflow email SENDING (Resend, stated addresses) stays — the
   boundary is auth connections only. (2) THE BRANDED ENTRY — /join/[code] already
   exists; extend to a branded landing (client logo from companies.settings.branding),
   email+password only, three steps: enter email → password+code → set up your agents.
   (3) THE SAFE-DATA MARK — a visual sovereignty badge at the sidebar's foot (private
   models · EU processing · no third-party OAuth), plus the client logo beside ours in
   the navbar for co-branded workspaces. (4) THE PLATFORM-ADMIN REVAMP — align to the
   current product: current feature names, the sovereign toggle + entry-link + logo
   management per workspace, retire dead controls. /workers components sweep rides along.
II. **THE ATTACHED MATERIAL + TOKEN STREAMING + THE FORMAT-FLOOR FIX (Aug 10 late; gate CH5 —
   118/118, build green; replay suite 6/6; drop cycle re-verified on the served page).**
   Three moves: (1) ATTACH → PRODUCTION: /api/home/extract-attach extracts attachment text
   SYNCHRONOUSLY and it rides the ask itself (classifier sees names · the loop carries the
   material as its own turn · a delegation carries it whole) — a "fill this in" never races
   the KB's background indexing again. (2) TOKEN STREAMING on the agent-loop path (the
   long-wait path): content deltas → SSE token events → the live materializing preview;
   `done` stays authoritative; NUL sentinel clears pre-tool preamble; 15s SSE ping keeps a
   90s hand-off alive. The question path (one fast call + typewriter) stays non-streamed
   BY DESIGN — its JSON contract; revisit only if it ever feels slow. (3) FOUND LIVE while
   testing: Anthropic's OpenAI-compat endpoint began rejecting response_format
   {type:'json_object'} (400 "Input should be 'json_schema'") — EVERY json-shaped call
   routed to Claude was failing, including the Home question path ON PROD. One
   transport-layer strip in aiCreate fixes all 13 call sites (Claude emits fenced JSON,
   the parsers already strip fences — the Bedrock-Haiku lesson). Plus the drag-drop
   hardening ("docx, pptx don't work"): the chat-attach allowlist had drifted below the
   extractor's real capability (pptx/xlsx/csv/doc added), browser mimes are unreliable for
   dragged Office files (extension fallback at chat-attach + presign + the chief client),
   the WHOLE WINDOW is the drop zone (a missed drop attached nothing and navigated the tab
   away), and rejected files toast instead of vanishing.
HH. **THE PRODUCTION HAND-OFF (Aug 10 night; gate CH4 — 117/117, build green; E2E replay T5:
   a pasted questionnaire + "fill this in" → delegated to Sofia, real artifact, 27
   [CONFIRM] marks in the deliverable).** The second pilot comparison ("look how much
   worse we look compared to Claude"): the same fill-in-this-document task returned our
   bare "I couldn't finish that one." beside Claude's finished .docx. Root causes fixed
   as a class: (1) THE PASTE CEILING DIED — the Home ask door silently sliced input at
   500 chars (the brain answered a request it never saw); now 20k, steer door matches,
   route budget 180s; (2) PRODUCTION ROUTES TO THE ENGINE — produced work without a
   named coworker delegates to the fit from the classifier (Sofia default), where there
   is no token ceiling and the artifact comes home (artifacts-into-origin); (3) THE
   EXHAUSTION HAND-OFF — loop exhaustion hands the work + the user's full material to
   Sofia automatically; failure = delegation, never a dead end; (4) [CONFIRM] SLOTS —
   the delegation prompt mandates every original section kept, user-only facts marked
   "[CONFIRM: …]" (the marked-slot-beats-dropped-question law, matching what the pilot
   saw Claude do); (5) chrome honesty — long pastes collapse in the bubble (full text
   still reaches the brain), the filing nudge never decorates an empty answer. Note:
   the competitor run needed the user to hand over context manually; ours had it — the
   gap was the production runtime, not the brain.
GG. **THE PANEL TRANSCRIPT + DRAG-AND-DROP ATTACH (Aug 10 evening; gates CH1–CH3 — 116/116,
   build green; E2E replay scripts/smoke-converse-history.ts 3/3; drop cycle verified on
   the served page).** The pilot-found amnesia class ("somehow became less clever" vs the
   old /work chat): the Home chat's history reached ONLY the question path — the router,
   the agent loop, and delegation each saw just the newest message ("yes please" arrived
   with nothing to say yes TO; a reformat couldn't see the answer it was reformatting;
   "ask sofia to do it" couldn't resolve "it"; and the honesty-floor pointer rode a format
   exchange as a "(a known body of work)" non-sequitur). THE FIX, one law: the panel's own
   conversation reaches EVERY converse path — panelTranscript merges with the room
   transcript for the router/pending check; the agent loop carries the last 8 turns as
   REAL messages (full fidelity, never a squeezed grounding block; the old /work chat's
   whole-thread memory, restored at the core); a delegation hand-off carries the
   conversation so "do it" resolves. THE MISFIRE GATE on the honesty floor: the registry
   pointer is a RECALL rescue — it fires only when the DENIAL SENTENCE itself names
   something the registry holds; plural matches get plural grammar. Plus DRAG-AND-DROP
   ATTACH on every chat box: the ONE composer (Home chat, room rail, coworker DM) and the
   legacy /work ChatInputBar both accept dropped files through the SAME onAttach door as
   the paperclip (same types, same cap, visible overlay, depth-counter enter/leave).
FF. **THE SILENCE WATCH (the initiative loop continues, Aug 10; gate AN2 — 113/113, build
   green; E2E on the probe: a 10-day-quiet awaiting commitment fired ONE chase with its
   because — "Jordan Vale owes you and the thread has been quiet ~10 days" — and the
   re-fire window held).** Absence as an event, the third walk of the anticipation pass:
   a counterparty who OWES the user (direction='awaiting'), quiet ≥7 days, gets the
   judge-gated chase machinery on their item — quiet ≠ settled. PROPORTIONATE BY
   CONSTRUCTION: the quiet check is REAL (any voice on the thread inside the window
   skips — a recent reply from them or a recent chase from the user both stand down);
   re-fires only after another full quiet window; hard cap 2/run; the judge stays the
   only gate to preparation. The work spine is built ONCE per pass (due-soon + silence
   share it). REMAINING IN THE LOOP: the strategic ask + Settings→Autonomy (the outcome
   log finally spent) → the deck-row because-chip generalized.
EE. **DEPLOYED + THE WORKFLOWS TIDY (Aug 10 afternoon; gate CS6 — 112/112, tasks 72/72,
   build green).** The second prod deploy shipped everything since Saturday (retirement,
   Rene's fix, the creation card, facepile, badge/seen, convergence kit, anticipation) —
   presence route live, /workers redirecting on prod. The trailing items closed:
   workflow_notifications writes DIED (the feed that read them dissolved; the opted-in
   Slack DM stays); "digest" retired from generated configs; a REACTION said in a project
   ROOM falls through to the one creation card (steer passes workflowDraft; the rail
   renders the same component — cron-only spec errors no longer dead-end); teammates'
   shared workflows list read-only in the ledger with owner attribution; the box's
   create_task docstring says DRAFT-for-confirm (box redeployed). DEFERRED with reason:
   the dead /workers component sweep (worker-profile + tabs share types with
   workers-page-client — a type-extraction refactor for zero runtime gain since the
   routes are gone) and the /work chat hub (owner decision pending).
DD. **THE ANTICIPATION PASS (the initiative loop begins, Aug 10; gate AN1 — 111/111, build
   green; E2E on the probe: a room-linked meeting tomorrow drew a grounded prep brief into
   its room UNPROMPTED — because line leading, chip resolving, TTL + exactly-once holding,
   and silence-as-verdict on the due-soon half).** Proactivity beyond arrivals: the pass
   walks TIME, not the inbox. (1) MEETINGS (next 36h, linked to a room — anticipation
   prepares WORK, it never invents projects): ONE reasoned pass over the room's page → the
   prep brief narrated into the room, BECAUSE line first ("Prep for X (Tue 09:23) — because
   this meeting is on your calendar and this room holds the work"); the "Prep ready" chip
   on the Home's This-week card opens the room where the prep waits. (2) DUE-SOON (≤48h or
   overdue, still unprepared): the SAME judge-gated prepareOneItem runs EARLY —
   anticipation moves the clock, never bypasses the judge. THE TRUST RULES STRUCTURAL:
   hard caps (2 briefs + 2 prepares/run), 6h self-gate (rides the brief route's after()),
   exactly-once fire records (item_plans kind='anticipation'), silence is a valid verdict.
   REMAINING IN THE LOOP: the silence watch (absence as an event → judged chase) → the
   strategic ask + Settings→Autonomy (the outcome log finally spent) → the deck-row
   because-chip generalized.
CC. **THE CONVERGENCE KIT + THE DAY-STATE BLOCK (Aug 10, owner conversation on DM vs chief —
   "avoid redundancy… can't feel like multiple systems"; gate CS5 — 110/110, build green;
   live-verified).** The settled model: ONE chat surface, the conversation determines the
   addressee (unaddressed → the chief; "Clara, …" anywhere → Clara; her DM → a standing
   addressed conversation). The DM's unique value = SUSTAINED coworker context (memory,
   skills, iteration) + relationship history + her full toolset by words. THE LAW: **facts
   are shared everywhere; depth stays with the role** — (1) THE DAY-STATE BLOCK (initiative
   loop STEP 0): one compact judged state of the day (derived from the SAME spine the deck
   renders — buildWorkItems; cached 10 min, ~500 chars) injected into BOTH worker runtimes,
   so "what's slipping?" asked in a DM can never contradict the deck/chief; the deep
   machinery (full board, ledger, dispatcher, scope binding) stays chief-only BY DESIGN
   (role clarity, not cost). This object IS the anticipation pass's output format — built
   once, two consumers. (2) DM MODE LEGIBILITY: persistent "Chat with X" header; "Message
   X…" placeholder (mention copy says what @ does THERE: pulls a teammate's work/document
   in); an empty DM opens with the narrator's line (found live: the facepile's Chat created
   the thread and read as a dead click). (3) NEW SESSION in the DM (fresh thread, the
   relationship + memory persist — memory lives on the agent, not the thread). NORTH STAR
   noted: the full merge (chief as permanent router, coworker voices inside any
   conversation, DMs optional) pairs with thread migration in the tail. NEXT: THE
   INITIATIVE LOOP proper — the anticipation pass computes the day-state proactively +
   THE BECAUSE-CHIP → silence watch → strategic ask + Settings→Autonomy.
BB. **THE WORKFLOWS COHERENCE SLICE (designed Aug 10 with the owner — the /workers retirement
   made concrete; COMPLETE Aug 10, gates CS1–CS4 — 109/109, tasks 72/72, build green).
   /WORKERS IS RETIRED: the route redirects (old ?worker&thread deep links keep working —
   they open the Home conversation), every link generator repointed to /home?chat=worker:…,
   entry/fallback redirects land on /home, Studio's default way back is the ledger, and the
   Home's "From your team" feed died (its jobs: Runs+badge · deck debt · conversations · the
   facepile). Riders found live: THE SILENT-DRAFT FIX (Rene — 60s generator budget, loud
   failures everywhere on the ledger, ONE GATE code-enforced) and THE GROUNDING BOUNDARY
   (owner law: "ground at the moment the information changes the output" — draft-time =
   identity-level ~400 chars; run-time = the full live page; the full-page-at-draft was
   ballast). NOTE: the old /work chat hub still stands (separate decision, not this slice).** The laws settled in three owner conversations:
   **ORIGIN DECIDES THE SURFACE** (the user's words started it → the result returns to that
   conversation, which artifacts-into-origin already does; a schedule/trigger started it → the
   result lives in Workflows→Runs, full stop — scheduled output NEVER touches conversations;
   the Claude "Morning brief · 9 new" pattern, owner screenshot). **ONE INTENT → ONE CARD →
   ONE HOME** (standing-sounding words anywhere — Home chat, coworker chat, room — draw the
   SAME review card inline; confirm creates; the card collapses to a receipt linking the
   ledger; coworker create_task goes BEHIND the confirm — saying prepares, committing stays
   explicit; ambiguity defaults to once-now + a "make it standing?" offer chip; no redirects —
   cards travel, objects don't). **YOU OWN IT, THE SYSTEM RUNS IT** (a coworker is the voice,
   never the owner; ONE management home = the ledger; chat is a remote control on the one
   registry, never a second ledger). Build order:
   (1) RUNS AS THE ONE HOME — unread badge on the sidebar Workflows item (succeeded runs not
       yet reviewed); opening the Runs lens / a deliverable stamps reviewed_at — REPAIRS THE
       LIVE AUTO-PAUSE REGRESSION (reviewed_at was stamped ONLY by the old /workers chat
       thread; threshold 3 → the AHK workflows would wrongly self-pause in 3 Wednesdays);
       auto-pause speaks its reason in the ledger ("paused itself — runs went unopened ·
       resume?"; resume clears auto_paused_at — verified already wired).
   (2) THE ONE CREATION CARD — the review card componentized, rendered in both chat runtimes;
       coworker create_task behind the confirm.
   (3) SETTINGS→TEAM ABSORPTION — Roster · Tools · Skills config tabs move in.
   (4) THE TEAM FACEPILE — sidebar FOOTER (global chrome, deliberately NOT the island — the
       island shows views-of-here; the team is presence, not a view): small avatars + "Your
       team" → a popover (face · role · ONE line of live state read from run checkpoints ·
       Chat verb · Settings link). The last /workers job ("meet your team") rehomed; presence
       makes proactivity legible and keeps the team fiction — the uncopyable differentiator —
       visible hourly. The report-back feed does NOT migrate: it dissolves (deliverables →
       Runs + badge; failures → deck debt; ad-hoc results → the conversation that asked).
   (5) RETIREMENT MECHANICS — deep-link repoints (/workers?worker&thread → the Home
       conversation opener), post-OAuth landing, /workers → redirect.
   Queue after this slice: THE INITIATIVE LOOP (the proactivity redesign, settled Aug 10:
   anticipation pass + THE BECAUSE-CHIP → silence watch → strategic ask + Settings→Autonomy;
   the loop = notice → understand the delta → decide do/prepare/ask/schedule/SILENT → act at
   the earned autonomy level → surface with proportion → learn; legible + proportionate, the
   deck stays the one attention door, moves narrate into rooms, grounding carries them —
   every part knows), then streaming, THE ONE VIEWER, perf.
AA. **THE WORKFLOWS POLISH ARC — DONE (Aug 9 evening, four owner screenshot rounds; gates
   105/105, tasks 72/72, build green; every change live-verified).** (1) SIMPLE LANGUAGE
   everywhere ("Set one up once — it runs on its own and delivers to you" · "delivered by
   Max" · "ran 10 times · last on 5 Aug" · "Edit in Studio" — the owner asked twice how to
   open Studio while "Edit method" sat visible: an unclear word IS a missing feature).
   (2) THE STUDIO DOORS: review card gains "Adjust in Studio" (saves as DRAFT, nothing
   live); "build one from scratch in Studio" under the describe box; Back/Save-&-close
   honor ?from=workflows (they landed on the retired /workers page); a never-edited blank
   is deleted on back-out (both blank names); presenter chips DIED (a workflow is
   system-owned — the voice is a detail, defaulted silently, changeable in Studio);
   project-suggestion gallery cards removed (owner call); DELETE on every row (two-step
   "Really delete?"); Studio renders verify/approval steps properly (they showed as
   "Agent · No task yet" — a user could mangle the gate). (3) THE RUN AUDIT: Activity
   groups expand to every run (status chip · duration · N steps · Open deliverable);
   each run's steps unfold with per-step duration and the ACTUAL output inline — lazy,
   audit-on-demand. (4) THE DESIGN PASS (Google AI Studio Flows reference): status
   CHIPS (Delivered/Failed/Held back/Waiting), chevron-first expandable rows, THE READER
   (68ch measure, 15px/1.75, real heading scale, 720px panel — shared, so Home chat +
   worker page inherit it). (5) THE ISLAND IS LOCAL (owner: "the island should be a
   navigation of the page it's in" — the Spinnable rule): the sidebar moves BETWEEN
   places, the island shows VIEWS OF HERE (Home: Today·Timeline; Workflows:
   Overview·Runs; one-view places carry NO island); sidebar highlights the ACTIVE LENS
   via the aug:view-changed announcer (it said "Home" on every lens); the Home greeting
   hides on the Workflows lens. (6) NEW CHAT FROM ANY LENS: the chat lives on the
   dashboard lens — aug:new-chat/open-chat now reset the lens (the panel used to open
   invisibly behind Workflows). Also THE ONE STANDING HAND-OFF THREAD + the 72-thread
   sweep (in Z's rider).
Z. **THE LEDGER REWORK — DONE (Aug 9, owner screenshot review; gate PA5b — 105/105, build
   green; live-verified: grouped trail, the briefing document opening DOCKED on the
   Workflows page, the gallery leading with the user's real projects).** Four corrections:
   (1) the recent trail GROUPS per workflow — "10 runs · last 5 Aug"; failures itemize,
   held-backs count, repeat successes never wall (deltas not events); (2) "open" opens THE
   DELIVERABLE in the docked ThreadArtifactsPanel — never the /workers chat page (a run
   with no document artifact honestly shows no open link — the owner's EB emails body
   text); (3) row verbs VISIBLE + worded "Edit method" (a hidden door is no door);
   (4) THE GALLERY (the Gemini-activities pattern): category chips + outcome-worded
   template cards seeding describe→draft→review (never instant-live), TOP SUGGESTIONS
   BRAIN-AWARE from the user's tracked projects ("Weekly status report on EG Bank" —
   the edge a recipe catalogue can't copy). Plus THE ONE STANDING HAND-OFF THREAD:
   delegations append to one "Handed to <Name>" thread per worker (a thread per
   delegation flooded the coworker chat list — 72 legacy threads archived by
   scripts/sweep-delegation-threads.ts, 56 on the owner's account); hand-off threads
   excluded from the conversations list (engine files, not conversations).
Y. **ARTIFACTS-INTO-ORIGIN — DONE (Aug 9, proactivity completion #1; gates AO1/AO2 —
   104/104, build green; E2E on the probe: "Sofia, put together a one-page overview…" →
   delegated, a REAL 9.7KB .docx materialized on the delegation thread, and the turn came
   back carrying the artifact — card + auto-opened viewer in the origin conversation).**
   Substantial delegated production (≥600 chars, evaluator-passed) materializes as a real
   document artifact via a SHARED module (`lib/workflows/doc-content.ts` —
   textToDocContent + uploadArtifact extracted from run-workflow; one mapping, never two
   copies). The artifact rides `ConverseTurn.artifact` → the ask route + the steer route
   pass it through → the Home chat renders the card AND opens the docked viewer; the room
   rail carries the door chip. A short answer or an ask stays text. TWO ROUTING BUGS
   found live by the E2E and fixed as floors (gate AO2): THE ADDRESSED-COWORKER FLOOR
   ("Sofia, put together…" was classified create_task_item — a message opening with a
   real coworker's name IS a hand-off; deterministic, roster-read) and DELEGATE OUTRANKS
   COMMAND (the classifier returned BOTH and the command fast-path ran first — the same
   bug's second face). REMAINING PROACTIVITY COMPLETION: proactive project deliverables ·
   filing-feeds-the-brain · outcome loop → autonomy ladder.
X. **STANDING REACTIONS — DONE (Aug 8, production arc step 6, THE ARC'S LAST STEP; gates
   PA6a/b — 102/102, tasks 72/72, build green; LIVE on the probe: the invoice matching "an
   invoice arrives asking the user to pay" FIRED (queued event-run + exactly-once record
   carrying the trigger context), the lunch note did NOT, the re-checked window fired
   nothing, and the fired run's output was grounded in the event — "Invoice #4417 from
   Acme Billing… 850 EUR… 14 days").** The brain as a trigger: a `reaction` TRIGGER TYPE
   whose `when` is a judged condition in plain words — the deterministic-spine law
   (reasoning at the trigger EDGE; what fires is the fixed auditable pipeline).
   `lib/workflows/reactions.ts`: judged at the SYNC TAIL after recognition (near-real-time
   on arrival; scope = the entity edge — a project-scoped reaction only sees its project's
   items); structural floors FIRST (bulk/own-mail excluded, exactly-once per
   (workflow,item) via item_plans kind='reaction_fire', honest DAILY CAP that logs skips);
   ONE conservative batched judgment per workflow ("a maybe is a no"); a fire = queued
   run + inline after() attempt + THE BACKSTOP (hourly dispatcher re-fires event-runs
   still queued after 10 min with their stored context — a crashed tail never silently
   eats an event; AI-failure writes NO fire record, so the next sync re-judges honestly).
   The trigger context rides every AI step INCLUDING the verify gate (it IS source
   material — unlike projectGrounding, which the gate must not see). generate-config
   births reactions from when/whenever requests (steps work FROM the event, never
   re-fetch the world); schedule/standing machinery ignores reactions by construction
   (nextRunFromTrigger null; no standing commitment); ledger + builder speak "When …".
   Post-migration the approval loop was also E2E-proven REAL: park persisted
   (awaiting_approval, outputs snapshotted) → resume passed exactly the gate → succeeded.
   THE PRODUCTION ARC IS COMPLETE: registry gate → approval → verify → entity edge →
   ledger → reactions. NEXT: the proactivity completion list (artifacts-into-origin
   first), the perf pass, THE ONE VIEWER.
W. **THE WORKFLOWS LEDGER — DONE (Aug 8, production arc step 5; gate PA5 — 100/100, build
   green; LIVE-VERIFIED on the served page with the owner's real production: both AHK
   workflows standing with schedule/presenter/last-run truth, and a deliberately
   overlapping describe drew the amber "Overlaps 'AHK Executive Briefing' (every Wednesday
   at 9am)" warning with the drafted pipeline BORN carrying the verify gate).** Workflows
   is a sidebar door (BoltIcon → /home?view=workflows, a sidebar-reached lens like
   Conversations — never a switcher pill). The surface is LEDGER-LED: "Waiting on you"
   leads (parked approvals decide inline through the one resume route — Approve—deliver
   it / Hold back), then Standing (each workflow: status dot · schedule · project chip ·
   "X presents" · last-run truth · shield/check glyphs for verify/approval steps · hover
   verbs Run now / Pause / Edit method), then the Recent runs trail. CREATION is
   describe→draft→review→confirm: one sentence → generate-from-description → the review
   card in plain grammar (numbered steps, schedule, deliverable home, presenter chips
   defaulting to the ops worker, the overlap warning) → "Confirm — it goes live" POSTs
   through the one save door (entity adoption + scope fire there). Studio is ONE click
   deep as "Edit method" — never the front door. `/api/workflows/ledger` = one read
   (workflows + scopes + parked + recent + the presenter roster). Plus THE CHECKPOINT
   (durable-execution practice): run-workflow persists step_outputs after EVERY step —
   the ledger reads live progress ("running — step 3/12"), a crash leaves evidence, and
   the approval snapshot stopped being the only mid-run truth. REMAINING IN ARC: standing
   reactions (judged triggers — workflows that fire on events, not just cron).
V. **THE ENTITY EDGE — DONE (Aug 8, production arc step 4; gates PA4a/b/c — 99/99, tasks
   72/72, tsc + build green; E2E: a probe request naming the entity drew overlap_note
   naming the existing Monday task AND a pipeline born with the verify gate).** Workflows
   join the one brain — "your team handles the ad hoc; your workflows run the production;
   both share one brain," now structural. `lib/workflows/entity-edge.ts`: the SCOPE
   (item_plans kind='workflow_scope' keyed by workflow id — the room-scope precedent, no
   migration; via recognized|user, a human re-file outranks recognition) adopted at BOTH
   creation doors (chat create_task + the builder save POST) with the SAME deterministic
   focus matcher as the Home/workers (zero AI; all-generic never matches). Four reads on
   the edge: (1) GROUNDED DRAFTING — generateWorkflowConfig drafts over the named
   project's room page (workflowDraftGrounding; sources/language/open work known before a
   step is written); (2) DUP-AWARENESS — the generator sees [EXISTING TASKS] and sets
   `overlap_note` (informs, never blocks; surfaced by the chat door, rides the
   generate-from-description response for the coming ledger); (3) SCOPE INHERITANCE at run
   time — workflowRunGrounding injects the project's CURRENT page into AI steps ONLY
   (`ctx.projectGrounding`; the verify gate is excluded BY the use_worker_identity:false
   check — it must judge draft vs sources alone); (4) THE REVERSE EDGE — the room's
   grounding gains STANDING PRODUCTION (workflows serving this work, schedule + last/next
   run — visible to ALL reasoning at once, so the responder never proposes building what
   already runs). REMAINING IN ARC: the Workflows ledger (nav item, describe→draft→
   review→confirm, overlap_note surfaced in review, Studio one click deep) → standing
   reactions (judged triggers).
U. **THE STRUCTURAL VERIFICATION GATE — DONE (Aug 8, production arc step 3; gate PA3 — 96/96,
   tasks 72/72, tsc + build green; E2E on the probe with a poisoned draft: the wrong sum
   corrected BY the code-computed must-fix, the ungrounded claim deleted, the emptied section
   kept its header).** `verify` is a STEP TYPE built into the engine — VERIFY_GATE_VERSION,
   one implementation; the AHK arc's hand-built gate never copy-pasted into workflow prompts
   again. Order is the law: the ARITHMETIC FLOOR runs FIRST (verifyComputableClaims — its
   findings become MUST-FIX lines the reasoned pass cannot ignore), then ONE persona-free
   reasoned pass (delegated to the one AI-step executor with use_worker_identity:false — the
   clock, language, and previous-outputs context ride along; the draft = last output, sources
   = everything before). generate-config: ALWAYS after synthesis for external-material
   pipelines; duplicate prose verifiers banned ("the verify step IS the gate"). Pilots
   untouched (their prompts keep their hand-built gates; new workflows are born with the
   structural one). REMAINING IN ARC: entity edge + grounded drafting → the Workflows ledger
   (describe-to-draft) → standing reactions.
T. **THE APPROVAL STEP — DONE (Aug 8, production arc step 2; gate PA2 — 95/95, tasks 72/72,
   tsc + build green; E2E on the probe: park → snapshot → resume past the gate → the guarded
   delivery ran; pre-migration behavior proven LOUD).** The Executor-validated pause/resume
   shape: `ApprovalStep` is a STEP TYPE (opt-in by construction — the pilot outcome contract;
   an existing workflow can never hit the branch). The run loop PARKS at it
   (`awaiting_approval`, step_outputs snapshotted), `narrateApprovalAsk` surfaces the ask (an
   `approval` component turn in the standing commitment's room + commitment due TODAY — deck
   debt), and POST /api/workflows/runs/[id]/resume either RESUMES past exactly that gate
   (later gates park again; completion runs the normal path: materialise → narrate → advance
   the binding) or records an honest rejection (room narrates "held back; nothing was
   delivered"). Exactly-once: only `awaiting_approval` resumes. Test/cadence runs AUTO-PASS
   the gate (a paused simulation proves nothing). The room renders the amber APPROVAL CARD
   (Approve — deliver it · Hold back; flips in place). generate-config emits the step for NEW
   workflows on review-language / external recipients. FOUND LIVE + FIXED: the
   workflow_runs status CHECK silently refused the park (the run pretended to wait) — parks
   now FAIL LOUDLY naming **migration 20260808_workflow_runs_approval_status.sql (MANUAL
   APPLY REQUIRED — adds awaiting_approval + rejected to the status check; until applied, an
   approval step yields an honest failed run, and no existing workflow contains one)**.
S. **THE PRODUCTION ARC STEP 1 — THE STEP SPACE ON THE ONE REGISTRY (Aug 8; gate PA1 —
   94/94, tasks 72/72, tsc + build green; commit 1d6d9e6 preceded).** Eight workflow step
   tools gained registry rows (read_kb_file · fetch_url · rss_feed · browser_fetch ·
   get_pt_tenders · get_workflow_output · slack_read_channel · slack_send — the one
   irreversible send step, the coming approval gate's target); `isWorkflowStepTool()` honors
   the absent-exposure default; THE RUNTIME GATE in executeToolStep refuses an unregistered
   tool step (legacy linkedin_post/get_urgent_emails keep running, never pickable);
   workflow-only rows never leak into the item-plan classifier. PA1 cross-checks the executor
   cases AND the Studio picker against the registry BY IMPORT — drift is structurally caught.
   NEXT (step 2): the APPROVAL STEP as pause/resume (action_commit staged · run parked
   `awaiting_approval` with an execution id · the ask on the deck · approve RESUMES — the
   Executor-validated shape).
R5. **A CONVERSATION REQUIRES THE USER'S VOICE + THE PROJECT WORD IS EARNED (Aug 8, owner
   catch — 93/93; live-measured: 38 of 44 listed rooms on the real account were ENGINE-ONLY).**
   (1) The recents scan listed any room with TURNS — but the engine's narrations are turns, so
   proactivity minted conversations the user never had. Law: only a room with a USER turn is a
   conversation; engine-only rooms surface through the DECK (attention), never the conversation
   list. (2) The room rows called every entity "project" — but tracked is a HUMAN decision
   (R4/P13): tracked → "project", machine-recognized → "suggested" (the portfolio's own word,
   never presenting a system guess as the user's project). (3) All conversations centered
   (mx-auto).
R4. **THE ROW MENU + THE CONVERSATIONS PAGE REWORK (Aug 8, owner; SH1/UX2 re-pointed —
   93/93).** (1) Sidebar Recent rows grew the hover ⋯ (chat/coworker only — rooms are work):
   Rename inline · Delete with the Undo toast; one portaled menu (the overlay law); rows became
   divs (no nested buttons). (2) ALL CONVERSATIONS rebuilt on the Claude Recents anatomy: TIME
   BUCKETS (Today · Yesterday · This week · Earlier) over a divided list — glyph · title · sub
   ("with Clara" / "in EG Bank" / kind · project) · short date · hover manage verbs. The chip
   pills DIED (glyph + sub carry the kind); search covers subs too; the two-step delete confirm
   became direct + Undo (the toast IS the safety, consistent with the sidebar).
R3. **THE HOVER EXPAND (Aug 8, owner: "a smooth expand with the name of the project or
   worker?"; SH1 extended — 93/93).** Recent rows smoothly reveal a second line on hover —
   "with Clara" (DMs) · "in EG Bank" (filed chats) · the concrete kind word (rooms:
   project/email/task/meeting); plain unfiled chats stay quiet (nothing worth expanding —
   the owner's own read). Server serves `sub` per row; max-h/opacity transition, glyph-aligned.
   ITERATED (owner screenshot: "missing something"): an ITEM room's line carries its PROJECT
   NAME too — "email · in EG Bank" (entity_links joined, TRACKED-only per the P15 chip law);
   an entity room's title IS the project, so just the word.
R2. **THE LOOP CLOSES IN PLACE + THE KIND GLYPH (Aug 8, owner batch — 93/93).** (1) The flagged
   dispatcher gap FIXED: runDelegation is synchronous — the work EXISTS when the turn speaks;
   "is on it and will report back" was false twice. The origin conversation now receives the
   coworker's own REPORT (reportText, capped, with "the full version is in your <name>
   conversation") — both the dispatcher and the named-coworker path (one executor). (2) Sidebar
   Recent rows wear a subtle KIND GLYPH (chat bubble · coworker person · room folder) —
   recognition without reading. DESIGN ANSWERS RECORDED: (a) the docked-pane + edit-loop
   grammar must generalize to project rooms and loose items — the rooms today use their own
   viewers (DeliverableFocus, the stage); unifying every deliverable onto ONE pane component is
   the token-pass's biggest item, now named THE ONE VIEWER; (b) artifact MANAGEMENT needs no
   new surface — the library already exists twice lawfully: Settings → Knowledge ("Generated"
   kind = every produced doc, searchable, removable) and each room's Files tab; if a gap shows
   it's discoverability, not machinery.
R. **THE DOCKED ARTIFACT PANE (Aug 8, owner: "doesn't make sense to have an overlay on top of
   chat; should be workable like Claude — what if the user wants to edit again?"; AB5
   re-pointed — 93/93).** The overlay era is over: the pane DOCKS non-modally (no dim, no
   backdrop, border+shadow; the conversation section shifts left via margin at lg — both stay
   live; below lg it floats, small screens stack). **THE EDIT LOOP**: every artifact_ready
   refreshes the open pane to the NEWEST version — typing "make it shorter" continues the same
   worker thread (worker-mode continuation + the route's documents-in-context injection), the
   new version arrives, the pane updates in place; versions stay navigable in the pane
   (computeVersionedArtifacts). The pane itself has no edit input BY DESIGN — the conversation
   is the editing instrument (the Claude model). KNOWN GAP (noted, not built): a
   DISPATCHER-assigned production ("Max is on it") reports back into the worker's thread —
   its deliverable doesn't yet stream back into the originating Home conversation live; the
   report-back card arrives via the team feed. Wiring dispatched deliverables back into the
   origin exchange rides the proactive-deliverables step.
Q. **THE VERIFY LOOP ON CHAT DOCUMENTS + THE STRUCTURAL WORD-IS-DEED — DONE (Aug 8,
   production-floor step 3; gate VL1 — 93/93, tsc + build green; claim-regex verified 7/7
   incl. the live failure case).** (1) Every chat-produced document now passes the ARITHMETIC
   FLOOR (`verifyComputableClaims` in generateThreadDocument — the same channel the prepare
   pass uses): a computable claim that doesn't recompute stamps `qa_report` on the artifact
   (persisted; visible in the panel) AND is SAID in the coworker's chat summary ("a number
   didn't verify — worth a look") — flagged, never silent; a floor outage speaks no verdict.
   (2) The prompt rule alone failed live ("I've created a report", tool_calls:[]) — now the
   native loop's final reply CLAIMING a document while none was produced gets ONE CORRECTIVE
   ROUND ([SYSTEM CHECK] → produce it now or restate; never ship the lie; text_clear resets
   the stream). AgentOS parity note: the guard is native-loop only (the bridge streams
   upstream frames) — the prompt-level word-is-deed rides both; structural parity when the
   loop moves or the bridge gains a post-pass. NEXT in arc: proactive project deliverables ·
   then THE PRODUCTION ARC (registry rebase → approval step → workflows ledger).
P. **THE DISPATCHER + THE SENSIBLE ASK — DONE (Aug 8, production-floor step 2; gate DS1 —
   92/92, promise 146/146, tsc + build green; live-verified on the probe: unaddressed produce
   ask → delegated to Max with visible attribution, plain question → no chips).** AGNOSTIC by
   design (owner: "not a selector for a specific case — reasoning when it needs important
   input; not asking for the sake of asking"): two REGISTRY capabilities (chief_of_staff
   exposure, `conversational: true` — excluded from the item-plan classifier where a step
   would have no assembler path). (1) **assign_to_coworker** — a clear-fit production ask ACTS
   (delegation is reversible: the work reports back, nothing external fires) with visible
   attribution and an easy override in words; the ONE delegation executor extracted
   (runCoworkerDelegation — shared with the named-coworker path). (2) **offer_choices** — the
   loop's ONE decision door: ≤4 tappable options, each tap SPEAKS its `say` through the
   composer (clicks are utterances; ephemeral, consumed on tap); prompt law: only a
   consequential, non-inferable decision — "asking for the sake of asking is a failure". The
   loop terminates on options/delegated (never talks past its own hand-off). RIDER (found via
   P30's flake): the command fast-path no longer serves search_knowledge_base raw — a
   context-dump `say` was reaching users when the classifier picked the search command;
   composition reads go through the loop. NEXT: the verify loop on chat documents + the
   structural word-is-deed guard.
O. **THE WORKERS READ THE ONE GROUNDING — DONE (Aug 8, production-floor step 1; gate WG1 —
   91/91, tsc + build green; matcher live-verified 4/4 on the real account).** The last
   reasoner outside the tent brought in: `lib/work/worker-grounding.ts`
   `focusedProjectGrounding` — when the user's message NAMES a registered project (the SAME
   deterministic focus matcher as the Home ask), the worker receives that project's FULL room
   page (the SAME assembleRoomGrounding the room's responder/Q&A/chief read; [L#]/[F#] tags
   stripped) on BOTH runtimes: the native loop's context parts and the AgentOS bridge's
   user_context (both chat-stream and workflow-step call sites; bridge parity lands with the
   flag's runtime — no box redeploy needed, the block rides per-run context). **THE
   ADDRESSED-NAME STRIP** (found live: "Clara, report on EG Bank" matched the entity "Madalena
   Clara" — a coworker's name colliding with a person-named project): the address is the
   envelope, never the subject — the worker's first name strips before matching; a GENUINE
   person-named subject still matches on its remaining tokens (verified). Delegation was
   already entity-grounded via buildItemContext. Clara and the room now read one truth.
   NEXT: the dispatcher (visible assignment selector).
N5. **THE PRESENTATION LAW (Aug 7, owner: "that grounding/reasoning also needs to exist — there
   shouldn't be redundancy"; gate PR1 — 90/90, one-room 85/85).** The no-redundancy dedupes had
   been accumulating as per-pane RENDER PATCHES (move×card, embedded×rail…) — each correct,
   the set ad-hoc. Now ONE module (`lib/room/presentation.ts`: moveTargetId ·
   mergedArtifactKey · stageOfArtifactKey · railCoversItem) is the composition law both panes
   consume — a deed presents EXACTLY ONCE by construction. The REASONING half already existed
   (the one responder composes over the one grounding + live board, so it can't recommend the
   already-done); this is its presentation counterpart. Future duplicate classes get a
   function HERE, never a component-local suppression.
N4. **THE RE-FIREABLE INTENT + ONE DEED ACROSS PANES (Aug 7 late, owner: "why does the left
   button not work now? isn't it redundant in both panels?"; R9 re-pointed — one-room 85/85,
   89/89).** (1) The rail's action button died on the SECOND click: the stage intent rode a
   state value + remount key — same value, no change, nothing fired. Now the intent rides a
   NONCE (`stageSignal` prop; the raise effect keys on it) — every click re-raises, no
   remount, no refetch. (2) The truth pane's embedded "Reply drafted [Open]" card duplicated
   the rail's merged action card — `hideArtifactCards` suppresses the embedded copies exactly
   when the rail's MOVE covers the focused item (one deed, one object, across panes); items
   the move does NOT cover keep their embedded affordance (their only door).
N3. **THE INSTANT SERVE + THE SHEET (Aug 7 evening, gate PF2 — 89/89, one-room 85/85).**
   (1) Found live: the merged card says "drafted by Clara", the raised stage said "drafting…"
   for seconds — the draft route ran the FULL judge (+resolution) before serving even a STORED
   draft. Now a stored prepared draft serves on the CACHED judgment alone (one read; a cached
   non-reply verdict still refuses — P2 holds; an absent cache falls through to the full gate,
   never a bypass). "drafting…" now only shows when genuinely generating. (2) THE STAGE IS A
   SHEET, NOT A CURTAIN — StageOverlay rises from the bottom of the truth pane, capped ~72%,
   rounded top + shadow: the source THREAD stays visible and scrollable above the reply/
   forward/invite being reviewed (owner: "the user sees the context"). One component, all
   three stages.
N2. **THE CONTENTION FINDING (Aug 7 — "everything seems super slow"; gate PF1 — 88/88).**
   The 36-43s "reconcile" in the brief's marks was QUEUE TIME, not work — profiled live: the
   reconcile's real inputs are 168 items / 351 emails / ~0.6s of queries / 0 pending
   resolutions. The killer was the CONCURRENT BURST: brief + portfolio + workers-home +
   timeline + 2×(detail+room) hover-warms, all queueing on one dev process + one DB pool —
   every route's wall-time balloons and the marks blame whoever waited. Fixes: (1) the
   RECONCILE THROTTLE — module-level 10-min TTL + single-flight (the aux stamp landed in
   after(), so overlapping requests both ran it); (2) THE POLITE WARM — 160ms hover intent +
   a serial queue (one warm at a time; a hover sweep across rows had fired N heavy request
   pairs at once); cancel on mouse-leave. KNOWN REMAINING (the real perf pass, still owed):
   the detail/room/portfolio routes are individually heavy (multi-second alone, tens under
   contention) — they deserve the timeline_cache treatment (server last-good + after()
   converge); dev-mode cold compiles amplify everything and prod won't pay those.
N. **THE TRUST FIXES (Aug 7 — the production-floor arc's step 0; gates TF1-TF3 — 87/87,
   one-room 85/85, tsc + build green).** (1) **ONE DEED, ONE OBJECT** — the last dedupe the
   Aug 5 one-responder rework didn't reach: responder MOVE × board artifact card lived in
   different layers with no structural join. Now computed at component scope: when the MOVE's
   target IS a prepared artifact on the rail, ONE action card renders (object + by-line +
   primary verb + ≤2 quiet offer variants ON the card); the duplicate stream card is
   suppressed; banner+chips survive only when nothing prepared matches. (2) **OPEN LANDS ON
   THE PREPARED THING** (found live: "Prepared by Clara" → Open → the bare thread) — the
   merged card's click carries a STAGE INTENT: entity-room focuses the item with
   `initialStage`, ItemDetail raises composer/forward/invite on arrival (the click carried
   the user's intent — the summoned-stage law holds). (3) **THE ROOM WARM** — hovering a
   portfolio row prefetches detail+room into the same LS keys the room hydrates from; a first
   open paints from cache like every later one (the room already LS-hydrated — cold first
   opens were the gap). NEXT (the agreed order): workers-read-the-one-grounding → dispatcher
   (visible assignment selector) → verify loop on chat documents → proactive project
   deliverables.
M. **THE UX BATCH — SPEAK CONSEQUENCE + THE THREAD-STORY COMPLETION (Aug 7 afternoon, gates
   UX1+UX2 — 84/84, one-room 85/85, restore round-trip live-verified; commit a443d01 preceded
   it).** From the owner conversation ("a user might be used to work a certain way — Clear
   maybe he thinks it will delete?"): (1) the room pair is self-explanatory — **New session ↔
   Earlier sessions** ("Clear"/"History" dead; the way back is visible before it's needed).
   (2) conversation DELETE is archive + an **Undo toast** — chat rooms batch-un-archive via
   POST /api/rooms/restore; coworker threads soft-archive via the extended thread PATCH
   (status), never the hard DELETE. (3) **the pre-filed New chat** — the project room's "New
   chat" button starts a Home conversation already scoped (sessionStorage intent → binding
   written up front): the Claude "new conversation in this project" gesture, mapped to
   satellites-around-one-room. (4) **the seam line is a DOOR** (ref → /home?chat=<key>,
   handled in the panel, param stripped after). (5) filed chats wear their **project tag** in
   All conversations (room_scope join in the recent route). SETTLED DESIGN (the thread
   question, owner-worked): ONE room stream per project (the proactive working session — the
   engine must know where to speak); deliverable-threads are SATELLITES (filed chats + worker
   threads the dispatcher will spawn); the user never manages context — typing anywhere is
   always correct because grounding assembles fresh each turn (no context rot to hygiene
   around).
L5. **THE SCOPE BINDING v2 — LINK, NOT MOVE (Aug 7, owner: "any conversation can get
   added/changed/removed?"; gate F7 re-pointed — 82/82; lifecycle live-verified on the probe:
   file→re-file→un-file, seam follows, turns never move).** v1's physical turn-move made
   adoption one-way; v2 is a BINDING: the conversation keeps its own key and turns
   (persistTurn always targets the chat key); `item_plans kind='room_scope'` says which
   project it belongs to; the project room carries ONE dedupe-keyed seam narration that moves
   with the binding and disappears on un-file. Scope is SERVER TRUTH (GET /api/rooms/adopt —
   per-conversation, cross-device; the SCOPE_LS local cache died). The chip when scoped =
   name (the room door) + ▾ (manage: the same picker with "Remove from <project>" on top).
   ANY chat conversation now files, re-files, and un-files at any time. Boundary: coworker
   DMs stay unscoped (addressed, not filed) — their work lands via the thread; item/entity
   rooms have homes by construction.
L4. **THE RECOGNITION NUDGE — DONE (Aug 7, gate RN1 — 82/82, matcher live-verified: "any
   update on soboplac?" → SOBOPLAC on the real 83-entity account).** The answer to "will it
   suggest the project room?": an unscoped Home ask that NAMES a registered project carries
   the deterministic focus match back (`focus` on both ask response paths — the SAME matcher
   the grounding already uses, zero new AI, 200-entity recency-ordered read); the scope chip
   becomes an OFFER — "About EG Bank? · File it" + a dismiss ✕. One click runs the adoption
   cascade (the conversation moves into the room, the chip becomes the door); never an
   auto-file (chat is cheap, objects are deliberate). The full ladder story now: grounded
   answer immediately → refs are doors → the brain OFFERS filing → filing homes the
   conversation → the chip opens the room.
L3. **THE CHROME DIES + CONVERSATIONS ARE MANAGEABLE (Aug 7 midday, owner):** (1) the in-panel
   New/Close DIED — the SIDEBAR is the navigation (Home closes the takeover via
   augmtd:home-reset; New chat starts fresh; the idiom every other product trained users on);
   the Temporary tag rides the composer row. (2) PROJECTS IS ONE NAV ITEM — the sidebar never
   carries the project list; the portfolio lens is the destination (SH1 re-pointed). (3)
   conversations RENAME + DELETE in All conversations (chat rooms: item_plans kind
   'room_title' override + POST /api/rooms/title, archive-delete via the existing turns
   DELETE; coworker threads: the existing thread PATCH/DELETE; item/entity rooms are WORK —
   no delete door). NEXT ARC AGREED (the production floor): chief-as-dispatcher WITH a
   visible assignment proposal ("I'll have Sofia do this — ok or change?" selector, like
   Claude's model picker; never a silent route) · the verify loop on chat-produced documents ·
   the structural word-is-deed guard · the box redeploy · proactive project deliverables.
L2. **THE ARTIFACT ARRIVES OPEN (Aug 7, owner):** the FIRST document of an exchange summons
   the artifact panel itself (auto-open on artifact_ready); the card stays as the durable
   re-open. Verified live by the owner: summary + card + real document, end to end (the
   deliverable grammar + word-is-deed held on the retry).
L. **THE CONVERSATION HEADER QUIETED + THE CLAIMED-DOCUMENT CLASS (Aug 7 morning, owner
   corrections + a live catch):** (1) the in-panel HISTORY PICKER DIED — the sidebar owns
   history (Recent + All conversations); a second picker was redundant (SH3/F3 re-pointed).
   (2) THE FULL TAKEOVER — the greeting header (+ ring/activity cluster) clears WITH the deck
   (`!chatActive` on the header block); a stale takeover can't survive a lens switch (unmount
   dispatches active:false). (3) THE SCOPE CHIP moved INTO the composer's control row
   (WorkerMentionInput gained an `accessory` slot — context controls live with the composer,
   not above the conversation). (4) **CLAIM-WITHOUT-DEED, found live**: Clara said "I've
   created a focused priorities report" with tool_calls:[] — ZERO calls, no document. THE WORD
   IS THE DEED added to the deliverable grammar (native + AgentOS): a document exists only if
   generate_document was called in THIS response. (5) **THE DM GLUE BUG, found live**: dmThread
   took threads[0] and glued the Home DM onto a "Handed to Clara: …" delegation thread — now it
   finds/creates the "Chat with <name>" thread by title (LS key bumped to aug-dm2-*, polluted
   v1 keys orphaned). KNOWN OPEN (observed in the same logs): /api/home/brief recomputes
   15-23s of queries on REPEATED loads in dev — the sig/cache path deserves a perf pass.
K. **THE DELIVERABLE GRAMMAR + SETTINGS → TEAM — DONE (Aug 6 late, gates DG1 + TM1 — 81/81,
   tsc + build green, workers.py ast-verified).** (1) DG: the worker prompt's inline-era FILE
   INTENT GATE ("content type alone is never enough") is DEAD — a substantial composed
   deliverable (report/briefing/proposal past ~a screen) is PRODUCED via generate_document
   DIRECTLY (no added clarification friction) with a 2-3 sentence chat summary, never pasted
   whole into chat; quick answers/short-form stay inline. Native prompt + all four AgentOS
   prompts (DELIVERABLE_GRAMMAR appended — parity lands on the next box redeploy). With brick
   3, a worker report now arrives as a CARD that opens the artifact panel. (2) TM: Settings →
   Team is a real grounded section (`?tab=team`) — roster rows expanding into the SAME
   WorkerToolsTab/WorkerKnowledgeTab the worker page mounts + the skills library below; the
   href ejection died (F2 re-pointed). /workers still serves report-back deep-links until
   kill-list items 2-3 land.
J. **THE ABSORPTION BRICK 3 — artifacts in the one surface — DONE (Aug 6, gate AB5 — 79/79,
   tsc + build green).** The Home conversation OWNS its outputs: a coworker's DOCUMENT card
   opens the SAME `ThreadArtifactsPanel` the worker page docks, as a right-side overlay over
   the conversation (viewer · versions · download · delete — zero re-implementation, one
   component both hosts); an EMAIL DRAFT mounts the SAME editable `EmailDraftCard` inline
   (recipients/subject/body editable, the user-gated Send through the existing
   send-coworker-email door); a LOADED worker conversation surfaces its existing documents as
   openable cards. Only typed registry renders (rare) still point at the worker page. THE
   /WORKERS KILL LIST (what remains before it becomes a redirect like /drive): (1) Settings →
   Team as a real embedded section (roster · per-worker tools · skills — the grounded-door
   law); (2) registry renders inline; (3) repoint report-back deep-links to rooms/panel; then
   /workers → redirect. The team-home review desk DIES rather than moves (its jobs are deck
   jobs).

### THE POC CONTINUITY CLAUSE (AHK et al. — nothing breaks mid-rebuild)

The pilots ride the ENGINE, which no shell work touches: scheduled workflows run from the
dispatcher regardless of UI; deliverables still reach their email/document homes; report-backs
still write; the standing binding only ADDS visibility (a dead run = an overdue deck row).
Doors that must stay open and are: /workers + /work ROUTES live (Settings → Team), Studio via
?workflow= (the card's "method" link), report-back deep-links (/workers?worker=&thread=). The
fold retires NAV SEATS only — never routes, never the engine — until the absorption gives chat
a better home than the one it closes.

1. **THE SHELL** — the one-surface frame built clean: sidebar (New chat · Pinned · Recent ·
   All-conversations view · Inbox · Meetings · team footer) + center (brief → deck → composer,
   full-page chat takeover) + stage. THE FOLD HAPPENS HERE, WHOLESALE (Workers/Chat/Drive seats
   don't exist in the new frame; routes survive; Settings doors already in). The design-token
   pass rides this build natively.
2. **CHAT SMOOTHNESS** — streaming /api/home/ask · ~~temporary chat~~ (done) · the scope chip +
   adoption cascade. **Riders shipped Aug 6:** THE PAGE TAKEOVER (a live conversation OWNS the
   page — the deck steps aside via aug:chat-active, the thread fills to the viewport; Claude's
   arrival feel) · @-MENTION LITE (typing "@" offers the team; a pick becomes the address) ·
   DELIVERABLE CARDS in the Home exchange (artifact_ready / artifact / email_draft events →
   cards that POINT at the worker page's viewer/send door). QUEUED with owner note (Aug 6, low
   priority): ONE REASONING RIBBON — a unified thinking/processing visual (chief "Thinking…" ·
   worker thinking_delta · tool progress lines today are three idioms; unify in the token pass).
   The FULL attach + mention composer (tasks · documents · files · scope chips) IS workstream 3
   (the composer consolidation) — never faked piecemeal.
3. **THE ABSORPTION** — coworker chat as addressed conversations with full worker capability +
   the composer consolidation (one composer). The step that lets /workers' chat truly die.
4. **THE TAIL** — slim Knowledge panel · loose-room standing tasks · recurrence founding ·
   compute-vs-source checks · FRAMES (post-shell; a stage tenant) · AgentOS Python tool (flag).

- **Nav**: Home · rooms/projects (sidebar list: recent + pinned tracked entities) · sources
  (Inbox · Meetings — untouched-sources seat, unchanged) · Settings. /work and /workers leave
  the nav; team config (roster, skills, per-worker tools) → Settings; the "meet your team"
  moment → first-look.
- **Drive leaves the nav too** (the prepared-work plan's D1, owner-confirmed Aug 5). Drive is
  NOT an untouched source — it's OUR knowledge base, and files live WITH their work (the room's
  Files tab, the deliverable pool, the resolver's pool → KB → drives). The folder grid dies; the
  slim Knowledge panel (connected sources · indexing status · search · recents · delete — the
  sovereignty/audit surface) moves to Settings beside Team. Finding a file = the room's Files
  tab or asking the composer — never a destination.
- **THE SEAT-CONTINUITY CLAUSE (owner question, Aug 6 — "where do identified items, tasks go?"):
  Arc 3 changes NAVIGATION and CONVERSATION; it reassigns NO seat from the experience spec.**
  Identified items stay on the Home deck (brief + deck + composer IS the Home, before and
  after); the room's right pane keeps its filed truth WHOLE (header/state · watch-outs · key
  dates · people · Goals/Rules · Tasks/Schedule/Conversations/Files/Activity tabs) as its
  RESTING state, with the stage summoned OVER it exactly as today. The mockup draws only the
  stage-open state — it is a navigation + voice statement, never a seat redesign; anything the
  mockup omits keeps its current home.
- **The familiar idiom IS our anatomy** (adoption by recognition, not retraining): sidebar
  chats+projects ≈ rooms+entities · empty state ≈ the Home (briefing + deck — EARNED, never
  blank) · thread ≈ the rail · artifacts panel ≈ the stage · @-context ≈ our mentions · group
  chat ≈ attributed coworker turns. The differences users feel are exactly our laws: rooms open
  mid-story with the derived brief; some replies are cards with one commit line; the landing
  state is the day, not a prompt box.
- **One composer** (the deferred refactor, done ONCE here): rail + worker-mention-input + home
  ask box consolidate. Budgeted as its own workstream — the streaming/caching code is delicate
  and untested (recorded in project_worker_composer_refactor).
- **Thread migration**: existing work_threads land as read-only loose-room history (pilot users
  mid-engagement are never stranded). A first-class "new conversation" affordance stays — one
  button; a bare chat is a loose room whose work hasn't declared itself yet.
- **Home firehose guard**: with one front door, the deck's curation laws (judged, folded, earned
  calm, no silent caps) become load-bearing, not polish. Any convergence PR must show the deck
  survives the added inflow.

## THE PRODUCTION ARC (designed Aug 8, owner-worked — "coworkers are ad hoc; workflows are production")

**The taxonomy (the owner's sketch, adopted):** assistants → prompts · **agents → team → AD HOC** ·
**workflows → production**. A real company has colleagues AND production lines; "a team took over"
was never the whole company. The narrative: **"Your team handles the ad hoc; your workflows run
the production; both share one brain."** The differentiator vs Relay/Zapier/n8n: their workflows
know their own steps — OURS KNOW YOUR COMPANY (judged triggers, grounded drafting, entity-scoped
retrieval, verification gates, sandboxed compute, sovereign runtime, debt on the deck when one
fails).

**The surface — a "Workflows" nav item, LEDGER-LED (never canvas-led):**
- **Landing = the ledger**: every workflow — promise · schedule/trigger · last run · next run ·
  health dot · the project it feeds · presenter-coworker chip when output wears a voice. A row
  opens its run history + room narration; "method" opens Studio. Doubles as the sovereignty/audit
  surface ("everything the system does on its own authority").
- **Creation = describe → draft → review → confirm**: a describe box ("Every Monday build the ops
  report from the tracker and email it to me") → generate-config DRAFTS the pipeline → shown as
  READABLE STEPS (gather → compute → synthesize → verify → deliver), editable → Confirm = the
  standing binding + the ledger row. SAYING PREPARES, COMMITTING STAYS EXPLICIT — same spec-card
  grammar. The Studio canvas survives ONE CLICK DEEP ("edit steps" / "start from blank") — the
  power-user door; builder available, never builder-led. Conversational creation (the spec card
  from any chat) lands in the SAME ledger.
- **SYSTEM-OWNED, coworker-optional**: the dispatcher runs it; an attached coworker is VOICE and
  report-back only (the per-coworker Tasks tabs become filtered views of the one ledger).

**The engine — REBASE ON THE ONE REGISTRY** (workflows are the last consumer of the pre-registry
flat toolkit; proven by run_compute: one registry row lit up chat + workflows + picker at once):
1. Step types = capability rows (exposure slice 'workflow') — one row lights up chat, judge,
   items, AND the picker; the Studio double TOOL_GROUPS sync wart dies; generate-config derives
   its catalogue from the registry.
2. **THE APPROVAL STEP = the commit door with a pause** (backlog #3 "approval gate — backend
   done, UI missing" revived): a pipeline send stages an action_commit, the approve lands on the
   deck (and later email), approval fires exactly-once; reject steers. This is what makes
   production trustworthy for the regulated audience (the Relay-style human gate, on our rails).
3. Verification becomes a STRUCTURAL step type (evaluator + arithmetic floor as a pipeline
   stage; generate-config emits it by default) — every generated workflow born with a QA gate,
   never a copy-pasted prompt block (the AHK lesson, made law).
4. Sends route through action_commits; outputs get provenance chips + outcome logging (production
   feeds the same learning loop as ambient work).
5. **Judged triggers → STANDING REACTIONS** ("whenever a role brief lands…", "when a client goes
   quiet 10 days…"): the same describe→confirm grammar, brain-conditioned — only possible because
   capability and judgment share one registry.

**BRAIN-AWARE BY CONSTRUCTION (the owner's requirement — "the system knows what we have"):**
1. The workflow ↔ PROJECT edge is first-class (creation from a room pre-links; describe
   recognizes a named project via the same focus matcher; the ledger's project column).
2. **Grounded drafting**: generate-config reads the ROOM'S PAGE (goals/rules/people/actual
   sources) — "the EG Bank weekly report" drafts steps naming EG Bank's real material; the
   pipeline author is just another reasoner behind the one grounding.
3. **Scope-inherited runtime**: a project-linked workflow's retrieval steps default to the
   entity's scope (its files, threads, ledger) — like a filed conversation grounds on its room.
4. **The ledger rides the grounding**: standing tasks (schedule · last run · health) become a
   section of the room grounding + the brain snapshot — "what's automated here?" answers from
   the same truth the Workflows page shows; the responder can SAY "Monday's report failed".
5. **Duplicate-awareness at creation**: the brain knows existing automations → the spec card
   catches "you already have a weekly EG Bank report — extend or replace?" (the covers-merge
   class; never two standing promises for one job).

**Sequencing**: after workers-read-the-one-grounding + the dispatcher (shared foundation: "make
every executor read the same page"); then registry-rebase → entity edge + grounded drafting →
the approval step → the ledger surface. **Never**: a canvas-led surface; coworker-owned
automation; a second creation grammar outside the spec card.

**THE PILOT OUTCOME CONTRACT (owner law, Aug 8, refined — "the workflow itself can be adapted
to whatever improved system we develop; the OUTCOME needs to be the same"):** an
implementation-freeze is NOT the law — the engine under existing workflows may evolve freely
(and already has: the registry gate, date discipline, the head-truncation fix all improved
pilot runs in place). The INVARIANT is the outcome: **the same deliverable keeps arriving on
the same schedule at the same destination, and nothing NEW executes** — no new sends, no new
recipients, no approval pauses a pilot never asked for, no silently skipped runs. Rules:
(1) the approval step is a STEP TYPE a workflow explicitly contains — never retrofitted onto
existing steps (a scheduled pilot run pausing for an approval nobody knows to click is a
silently dead briefing — structurally impossible). (2) No auto-migration of stored rows;
generate-config emits new-grammar steps for NEW workflows only. (3) The ledger lists pilots
as-is (visibility improves; behavior doesn't move). (4) Engine changes touching the RUN PATH
prove the contract before deploy with the CADENCE SIMULATION (the dated-source arc's tool:
test-mode runs, rewound last_run, assert deliverable produced · destination unchanged · no
unexpected sends). PROVEN for step 1 (Aug 8 live scan): 11 live workflows / 66 tool steps all
pass the registry gate — zero refusals, zero outcome change.

**THE EXECUTOR LEARNINGS (Aug 8 — reviewed executor.sh / UsefulSoftwareCo/executor at the
owner's ask; our registry/commit-door/Nango architecture already embodies its core principles —
these four refinements adopted):**
1. **The approval step is PAUSE/RESUME, not a blocking wait** (their `resume --execution-id`
   validates our design): the run stages its send as an action_commit, the RUN ROW parks as
   `awaiting_approval` with an execution id, the ask lands on the deck (later: approval via
   email reply), approval RESUMES the run where it stopped; reject steers. The commit-door
   claim/fire machinery is ~80% of this — the durable parked-run + resume door is the build.
2. **Protocol-derived safety defaults for the MCP adoption recipe**: a mounted third-party tool
   without a hand-set row derives its gate from the protocol — read-only verbs → allowed;
   mutations/destructiveHint/unknown → approval-gated. The safe path is the easy path,
   structurally. (Hand-set registry rows still override — curation stays sovereign.)
3. **Lazy tool loading for the worker loop** (noted, build when tool count justifies): a
   search_tools capability + dynamic schema injection once MCP mounts grow the catalog — the
   1,640-tools→1-tool token math is real; the chief loop (~20 defs) doesn't need it.
4. **The policy page is the sovereignty surface's centerpiece**: a registry-derived render —
   everything the system can do, what runs free, what waits for approval, per coworker/surface
   — visible and auditable. Cheap (the registry is the source); sales-critical for the
   regulated pitch. NOT adopted: catalog-scale schema auto-ingestion (the opposite of judged
   curation) and the gateway business itself — though if we ever expose the brain to users'
   OTHER agents, the shape is one MCP endpoint + our registry as catalog + our policies as
   governance.

**THE PROACTIVITY COMPLETION (Aug 8 — the owner's standing flag: "there's more to be done,
also regarding proactivity"; the remaining ladder, in dependency order):**
1. **Proactive project deliverables** — the judge extends from "what does this item need" to
   "what does this PROJECT deserve this week" (an entity-level produce appetite: a client
   gone quiet deserves a check-in draft; a project with a Friday cadence deserves its status
   doc before Friday). Rides the workflow machinery (a proposed deliverable = a spec-card
   offer, never silent production).
2. **Standing reactions** (judged triggers): "whenever a role brief lands, draft the JD" —
   the same describe→confirm grammar, brain-conditioned; the Production arc's trigger half.
3. **Dispatched deliverables stream back into the origin exchange** (today: the report text
   returns; the ARTIFACT/pane doesn't ride along for delegation-produced docs).
4. **Filing feeds the brain**: a filed conversation's decisions/facts distill into entity
   memory on adoption — the room's brief genuinely reflects what was discussed.
5. **The outcome loop → the autonomy ladder** (collecting since July): accept/edit/discard
   history earns per-lane autonomy — drafts start sending themselves in lanes the user has
   always approved. The months-scale payoff; needs the approval-step plumbing first (an
   auto-approved lane = an approval gate the ladder opens).

## FRAMES — live, shareable artifacts (rides Arc 1 capability + Arc 3 stage)

The Cloudflare-gadget / Dust-frame class: a LIVE view (dashboard, tracker, mini-app) built by
the team, self-refreshing, shareable by link. Ours, disciplined:

- **A frame is an artifact kind**, not a new universe: `{ data steps (tool/compute, manifest-
  declared) + a view spec }`, produced via ONE `create_frame` capability row — therefore
  creatable from ANY scope (one-time chat, addressed coworker, project room, a standing
  commitment whose deliverable IS a living frame instead of a weekly email).
- **Serving**: a route renders the stored view over the latest data snapshot; refresh = re-running
  the data steps (on open, on schedule for standing frames). Sharing reuses the meeting-notes
  access pattern (private → live/company → specific recipients).
- **THE STANDING-CLAIM LAW** (dated-source + truth-before-presentation, applied): a live frame
  asserts "these are today's numbers" continuously. Every frame carries its data's as-of stamp;
  a failed refresh shows honestly ("data as of Mon — refresh failed"), never serves stale
  silently. A frame that quietly shows last month is the 2021-article bug with a permalink.
- **THE SHARE IS A COMMIT**: sharing outward is an explicit user act through the commit door —
  logged, revocable, never automatic. The word is the deed; the deed is audited.
- **On the surface**: a frame is a stage tenant — card in the stream ("Frame ready — Revenue by
  region · Open →"), stage renders the live view + the share affordance. App/Code/Connections
  tabs are a LATER depth; v1 is view + as-of + share.

---

## SPEED & MOTION (felt quality — laws, not polish)

- **Instant-load doctrine applies everywhere new**: LS hydrate → background refresh → persist;
  skeletons gated on `loading && !cached`; last-good serve; action surfaces demand freshness
  (stamped cache), ambient stays ageless.
- **One shell = in-place swaps, not page navs**: the focusFromHref pattern generalized — opening
  a room, summoning a stage, swapping a focus are stage/center swaps inside the constant
  anatomy. Most perceived speed comes from here.
- **One motion vocabulary**: RiseIn, the transition tokens, the reflow-panel idiom
  (transition-[width]) — reused, never re-invented; reduced-motion honored. A new surface state
  earns AT MOST one new transition, added to the shared vocabulary first.

---

## WHAT EACH EXISTING SURFACE BECOMES

| Today | After |
|---|---|
| Home | The front door (unchanged seat, promoted to whole-product landing) |
| /work chat | Folded: the Home composer + loose conversation rooms |
| /workers team home | Folded: deck (needs-you) + room narration (activity) |
| /workers chat tabs | Addressed conversations in rooms; history → read-only loose rooms |
| Studio builder | The method editor behind a standing commitment (deep-dive, not nav) |
| Workers config tabs | Settings → Team |
| Drive page | Folder grid dies; slim Knowledge panel (status/audit) → Settings; files live in rooms |
| Inbox / Meetings | Unchanged — the sources seat |

## SEQUENCING & GATES

Order is load-bearing: **1 → 2 → 3**, frames riding 1+3. Arc 1 ships value alone; Arc 2 hollows
the old surfaces; Arc 3 removes empty shells (never amputates live ones). Each arc gets promise
gates in the standing style — outcome-asserted on real accounts + the probe host:

- **C-gates (compute)**: a produced deliverable with checkable claims carries a passed
  mechanical check or an honest flag; a compute failure never resolves/claims; the manifest is
  logged for every job; sends from the sandbox are structurally impossible.
- **S-gates (standing)**: "weekly report" uttered in chat yields a spec card, never a silent
  cron; a missed run surfaces as a debt within one sweep; room feedback provably alters the next
  run; the standing commitment is visible in its room's filed truth and nowhere else.
- **F-gates (frames)**: every served frame shows its as-of stamp; a stale/failed refresh renders
  the honest state; an unshared frame is reachable by no one but the owner; every share/revoke
  is in the action log.
- **U-gates (the one surface)**: every conversation resolves to a room key the brain can see;
  the three-composer count is ONE; no nav destination duplicates a seat; deck survives the
  consolidated inflow under the earned-calm laws.

## OPEN QUESTIONS (decide before their arc starts)

1. Sandbox substrate: extend the Hetzner box (fits the sovereignty pitch + existing ops pattern)
   vs. a managed isolation service. Cold-start, concurrency, and egress-lockdown decide.
2. Frame serving surface: in-app route only, or external share links v1? (External = the
   share-is-a-commit law must ship first.)
3. Does free-form "ChatGPT-replacement" chat carry real usage worth a first-class seat, or does
   the loose room fully absorb it? Check actual /work usage before deciding.
4. Recurrence founding from meetings: offer threshold (how many repeated promises before we
   propose a standing commitment?).
5. Autonomy ladder mechanics (post-Arc-2): what outcome-log evidence unlocks "send without me,"
   and how is it revoked?
