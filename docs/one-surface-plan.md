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
