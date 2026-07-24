# THE WORK SURFACE — false facts out, one obligation one task, the brain mounts the work (July 2026)

Follows THE WORKBENCH (shipped + iterated). Source: the July-24 evening review — the Home is right
in structure but fat and under-curated at the noise end; extraction atomizes one motion into four
tasks; a dismissal can't carry context; the deal room still renders a mail client instead of the
WORK; two false facts destroyed trust in one room (a forward counted as fulfillment; pre-heal
self-nudge debris); the competitor's mail-kind labels and component-based deal room are the
patterns to absorb — through OUR brain, not copied.

**The architecture sentence this arc implements (locked with the user):**
recognize (identity, the registry) → understand (what this is — USER RULES first, mail-kind
beneath) → **JUDGE THE WORK (one verdict)** → the verdict has three consequences at once: the
COMPONENT the surface mounts · the EXECUTOR it proposes (coworker / user / system) · the COMMIT
GATE it protects → user approves → done, reported, remembered. Nothing downstream of "understand"
is a lookup table except the registries the reasoning reads (roster, capability map, component
registry).

**Best practices, stated once and applied throughout** (what Claude/Scape-class products actually
do, and what our own arcs already proved):
- Structural floor first, ONE reasoned call after — never many small guesses (the evaluator, the
  roster judge, recognition all follow this; the work judge will too).
- Structured outputs against a schema; conservative defaults ("none" is always a legal verdict; a
  wrong route costs trust, no route costs nothing).
- One judgment, many consequences — component/executor/gate come from the SAME verdict so the
  surface can never tell three different stories.
- Registries make capability additive: add a coworker/tool/component = one row, zero choosing-code.
- Human-in-the-loop at the commit line only (approve sends/books/shares); everything before is
  prepared, attributed, evaluated.
- Every user correction is a signal the brain hears (dismiss-context → the ledger → synthesis).

---

## T — TRUST FIRST (false facts out before any layout work)

**T1 · a forward is not fulfillment.** `resolveThreadOnReply`/`reconcileRepliedItems` currently
treat ANY user-sent message on the thread as resolution — the observed bug: an FYI forward to a
colleague marked "Share onboarding kit" done. Fix, structural floor first: a user message resolves
only if a recipient resolves (registry) to the item's counterparty/thread sender; a message to
third parties only → NOT resolution. The genuinely ambiguous remainder (rare) gets ONE cheap
reasoned check ("does this message plausibly fulfill X?" — classification tier, cached on the
message id). Sweep (dry-run default): re-open items resolved by `reply-resolution` in the last 14
days whose resolving message fails the new floor; log + undoable.
**Gates:** the Spartak fixture stays OPEN under the new floor (live); a real to-counterparty reply
still resolves; sweep reports before applying.

**T2 · self-artifact debris.** Extend `heal-self-identity.ts`: pool deliverables whose title/
recipient resolves to the SELF entity (the "Nudge — Alex Collignon" class) are deleted (they are
machine output, not user work — safe); the evaluator already blocks new ones.
**Gates:** zero self-recipient deliverables across users post-sweep.

**T3 · never draft for automated mail.** The Zaask password-reset got a drafted reply. Fix at
every drafter entry: the pass's reply branch + on-demand draft + compose all refuse when
`isAutomatedSender` OR the understanding says awareness/notification (rule-respecting: an explicit
user rule with auto_draft still wins). The evaluator gains a STRUCTURAL check: a no-reply/automated
recipient address → revise verdict, zero AI.
**Gates:** a no-reply fixture through prepareOneItem → did:none with the honest reason; evaluator
catches a planted no-reply draft structurally.

**T4 · the Prepared→Suggested→Accepted boundary holds in PRESENTATION.** An entity the user never
accepted (untracked, scope suggestion) must never render as an established project: the deep-dive
rail and item chips show it as quiet context ("connects to: <name>") with the Accept affordance —
no project chrome, no "In this project" framing. Tracked entities keep today's treatment. Also:
the internal posture pills ("For awareness") disappear from user-facing surfaces everywhere — the
posture drives behavior, not vocabulary the user reads.
**Gates:** structural — untracked entities render the context treatment; no posture-pill strings
in the deep-dive header.

## G — ONE OBLIGATION = ONE TASK (granularity)

The SOBOPLAC case: one email → four sibling commitments ("send pricing", "send deck", "clarify
integrations", "identify use case") that are ONE motion with four steps.

- **G1 · extraction judges at the obligation level.** The extractor prompt reframes: ONE
  commitment per deliverable/motion (the thing you'd mark done once); sub-clauses become `steps`
  (short strings) riding the SAME extraction call. Steps persist as the commitment's item plan
  (`item_plans`, kind commitment — the table and panel exist; no migration). Write-time
  consolidation backstop: same source + same counterparty fragments that survive the prompt merge
  under ONE reasoned check before insert (extends the existing near-duplicate fold).
- **G2 · consolidation sweep** for existing data (dry-run default): same-thread/same-counterparty
  open sibling commitments → one keeper + steps; the others fold in (status merged, activity
  logged, undoable).
- **G3 · steps render as a checklist** under the one task — room TaskRow expand + the Home row's
  "+3 more" becomes the checklist, cleared once.
**Gates:** a synthetic multi-ask email yields ONE commitment with ≥2 steps (live, through the real
extractor); the sweep consolidates a real sibling set (fixture user) reversibly; the Home count
drops accordingly.

## D — DISMISS WITH CONTEXT (the user teaches the brain)

- **D1 · UI:** every dismiss (Home row, room, deep-dive) gains an optional one-line note —
  "Dismiss" works instantly as today; a small "add context" affordance opens the input ("had a
  call, waiting on X" / "we'll discuss it Thursday").
- **D2 · plumbing:** the note is a LEDGER fact: commitments → `resolved_reason` (column exists);
  inbox → `source_data.dismiss_note`; both surfaced by `assembleLedger` so the next state
  synthesis reasons WITH it (next move changes, the nudge holds, the deal card reflects it). No
  snooze parser, no date extraction — the synthesis judges what the note means (a stated call date
  naturally shifts the next move; that is judgment, not a snooze rule). Also a learning signal.
**Gates:** a dismissal-with-note lands in the ledger and the next synthesis's state references it
(live, sig-forced); dismiss-without-note unchanged.

## M — MAIL-KIND + THE RULES REDO (labels that make sense, under the user's rules)

- **M1 · `mailKind` on the understanding** (`computeUnderstanding` — same Haiku pass, one field):
  `receipt · newsletter · notification · calendar · cold_outreach · customer · team · personal ·
  other`. REGISTRY-GROUNDED, not keyword: a corporate-domain colleague → team; a sender whose
  person entity ties to a client deal → customer; provable transactional headers → the structural
  floor. Backfill script (preserving all other fields — the established pattern).
- **M2 · the precedence chain (the July-10 law, extended):** user rule (incl. type_override) →
  mailKind refines → structural fallback. Consumers: the Home's bulk-collapse (H3), the FYI digest
  (grouped by kind, "idealista · 4 updates"), the drafter gate (T3 — never draft
  receipt/newsletter/notification/cold_outreach absent an explicit rule), AUGMTD label write-back
  (kind label only where no rule labeled; respects `auto_label` as today).
- **M3 · DEFAULT RULES REDO** (`lib/inbox/rules/defaults.ts` v2) so defaults and kinds are one
  coherent system instead of two overlapping vocabularies:
  - KEEP deterministic floors: Gmail category rules, the no-reply sender rule (cheap, provider
    truths).
  - KEEP the POSTURE rules — Urgent, Needs reply, Waiting for reply, Done, Meeting updates —
    posture is the rules' job.
  - RETIRE the overlapping AI taxonomy rules ("Marketing", "Notifications", "FYI" as AI matches) —
    that's now mailKind's job, reasoned once in the understanding instead of guessed per-rule; the
    fyi posture remains the classifier fallback, not a rule.
  - Seeded-user migration: a sweep updates rules with `source: 'default'` that the user never
    edited (name+ai_match unchanged from v1) to v2; user-touched rules are NEVER modified.
  - Settings copy explains the split plainly: rules decide what needs you; kinds describe what the
    mail is; your rules always win.
**Gates:** precedence proven (a user rule overrides a kind; a kind fills where no rule fired);
re-backfill stability check (role/relevance/bulk unchanged — the Home-neutral rule); default-redo
sweep touches only unedited default rules (live, all users).

## H — HOME COMPACTION (her density, our brain)

- **H1 · dense rows.** The time-grouped list's rows become true LIST rows: one line — checkbox ·
  title (full) · project chip · due/age · prepared token — hairline separators, no per-row card,
  hover actions (dismiss/context, open). Target: ~40px/row; the whole curated pool visible in one
  screen. The first-row emphasis survives as a subtle accent, not a card.
- **H2 · Tasks | By project toggle.** Same entries, regrouped by entity (loose last) — the quiet
  segmented control, persisted.
- **H3 · bulk-collapse.** Same-sender automated/notification rows (mailKind, structural fallback:
  automated + same sender) collapse to ONE row with a count, expandable — the idealista×4 case.
- **H4 · non-tasks out.** Calendar acceptances (`isCalendarSystemSubject`) and pure notifications
  leave "needs you" for the digest unless action-worthy (the existing re-posture judgment) — the
  "Meeting acceptance confirmed" row class.
- **H5 · the calendar rail.** The This-week card becomes a slim full-height rail column (sticky,
  day-grouped as now, tighter type scale) instead of a floating box over dead space.
**Gates:** row height budget (structural class check); bulk-collapse proven on a real
multi-notification sender; acceptances absent from needs-you across users; nothing hidden (counts
reconcile: collapsed rows sum to the section count).

## W — THE WORK SURFACE (the brain mounts the component; coworkers or you execute)

- **W1 · the component REGISTRY** (`lib/work/surface-registry.ts`): each work component one row —
  `{ key, mounts (client component), commitGate ('send'|'book'|'share'|null), feature }`. Initial
  set from what EXISTS: `decision` (numbered options card) · `reply_composer` (ReplyEditor + draft)
  · `document` (DeliverableFocus) · `send_file` (composer + suggested attachment) · `invite`
  (InvitePreviewCard) · `chase` (nudge composer) · `none` (context only). Adding a component = one
  row; the judge picks from what's registered (the roster-judge/capability-map invariant, third
  leg).
- **W2 · THE ONE WORK JUDGMENT** (`lib/work/judge.ts` `judgeWork`): input = the item's grounding +
  entity state + person brain + mailKind + the roster + the component registry; output (structured
  schema, classification tier, sig-cached on item activity):
  `{ work, component, executor: {kind: 'coworker'|'user'|'system', id?}, gate, reason }`.
  Replaces per-surface inference; `suggestWorkerForMove`/routeTasks become the executor half of
  this verdict (one judge, not two agreeing by luck). Conservative: `none` is always legal.
- **W3 · the artifact plane re-renders as WORK, not mail.** In the room and the deep-dive: the
  RELEVANT message as a clean card (sender · to · body), thread history COLLAPSED behind "show N
  earlier" (the inbox keeps the full mail client — that's its job); beneath it, the judged
  component mounts inline (Scape's shape, our judgment). The rail stays the conversation; reworks
  land in the mounted component.
- **W4 · suggested attachments.** The composer components surface the file resolver's confident
  candidate as an accept/✕ chip ("Scape.pdf" style) — `resolveFileUniversal` + the reasoned pick
  already exist (the docsend branch); this mounts them in the composer for the send_file/reply
  cases.
- **W5 · loose = project minus the panel.** One plane for both doors; the project panel
  (tasks/goals/schedule) is the only difference. The `/item` deep-dive adopts the same message-card
  + component rendering.
**Gates:** structural — one registry, judge output schema-validated, no type→component mapping
anywhere; live across users — a needs-reply item judges `reply_composer` + an executor; a
decision-shaped item judges `decision`; an automated notice judges `none`; component and executor
always come from ONE verdict (the stored reason references both).

---

## Order & scope

**T → G → D → M → H → W.** Trust before beauty (T); granularity shrinks the Home more than styling
(G); D is small and feeds the brain; M before H because bulk-collapse and the digest want mailKind;
H is the visible payoff; W is the deepest and lands on a cleaned foundation. `smoke-work-surface.ts`
grows per slice; full regression (workbench 39/39, orchestrated-loop, work-loop, tasks, room,
briefing, recognition-integrity) every slice, all four users.

**Not in scope:** inbound two-way, 5D capability slices (still paused; they land later as roster
tools + registry components), B5's chat-rework second half (subsumed by W3's mounted components —
the rework path lands WITH W3), personal category taxonomies.

---

## PROGRESS (July 24, late) — T + G + D SHIPPED (smoke-work-surface 31/31)

- **T shipped.** T1: `messagesForResolution`/`threadCounterpartyEmail` in thread-resolution.ts; both
  resolvers + both callers wired; sweep `scripts/sweep-false-resolutions.ts` APPLIED (reopened 4
  false-dones incl. the Spartak item + contract commitment across 3 users; deleted the self-nudge
  debris). T3: automated-sender refusal in the pass + the on-demand draft route + a structural
  no-reply check in the evaluator. T4: email posture chip gone (`chip={null}`); untracked entities
  render "connects to <name> · Track" (membership chip) and "Around this:" (rail); items/entity GET
  + RoomEntity serve `tracked`.
- **G shipped.** Extractor prompt judges at MOTION level + emits `steps`; write-time same-batch
  consolidation backstop in `writeCommitments`; steps persist as the commitment's item plan
  (PLAN_VERSION-stamped); `scripts/sweep-consolidate-tasks.ts` APPLIED (9 groups merged, 10
  fragments folded across 4 users — src-keyed + entity-keyed cross-source passes, conservative
  judge). Live gate: a 3-part ask → ONE commitment + ≥2 steps.
- **D shipped.** Dismiss-with-context: inbox `dismiss_note` on source_data (item-actions), commitment
  note → `resolved_reason` (PATCH + chat resolve); the LEDGER surfaces both (`— user: "…"`), so the
  next synthesis reasons with it; deep-dive menu gained "Dismiss with a note…". Live gate: the note
  provably lands in the deal's ledger.
- Regression green: workbench 39/39 · orchestrated-loop 39/39 · tasks 72/72 (5A.4 gate updated —
  the email chip is now ALWAYS null, stronger than embedded-only) · work-loop 44/44. Note: the T1
  sweep reopening a pre-O1 row resurfaced one self-counterparty — re-ran heal-self-identity (clean).
- **M shipped.** `mailKind` (closed set, registry-grounded — team from the roster, customer from the
  relationship context) on the understanding (type + coerce + prompt line + JSON schema); the M2
  drafter gate refines UNDER the rules (`rule_type==='needs_reply'` always wins); M3 defaults redo
  (the v1 AI taxonomy rules Marketing/Notifications/FYI RETIRED — posture rules + deterministic
  floors stay); `sweep-default-rules-v2.ts` APPLIED (9 unedited seeds retired, 0 user-edited
  touched); `backfill-mail-kind.ts --apply` stamped 237 items (merge-only, Home-neutral).
  ⚠️ PROD-SKEW: prod's sync re-writes understanding WITHOUT mailKind on active accounts (user A
  wiped minutes after stamping) — **re-run `backfill-mail-kind.ts --apply` once after deploy.**
- **H shipped** (smoke-work-surface 39/39; work-loop fixture updated for T3 — its stale-draft gate
  now skips automated/kind-gated senders). H1 dense rows (WorkRow px-3 py-2, small icon — one line
  per task). H2 Tasks | By-project lens on the deck (same entries regrouped by
  bundle/deal/initiative, Loose last; persisted `aug-do-group`, effect-hydrated). H4 a
  calendar/notification KIND judged merely "action" leaves the deck (digest keeps it) unless a
  user rule (needs_reply/to_do) or a real stated deadline says otherwise — kills the
  idealista/"Meeting acceptance confirmed" rows at the source. H5 slim calm calendar rail.
  H3 note: the deck-level bulk-collapse became MOOT — H4's demotion removes the collapsible class
  from the deck entirely and the near-dup fold + the FYI digest cover the rest; no separate
  mechanism built (recorded, not skipped silently).
- **REMAINING: W — the component registry + THE ONE WORK JUDGMENT + the message-card artifact
  plane (B5's chat-rework lands with it). The deepest slice; lands next session on this cleaned
  foundation.**

## CORRECTION (July 24, night — user review: "looks terrible, worse")

Two real mistakes, recorded so they don't repeat:
1. **H4 shipped without busting the brief cache** — the Home served the pre-H4 cached brief, so the
   demoted rows were still on screen (violated our own invariant: any change to what the brief
   serves MUST bust `home_brief`). Worse: on the user's own account the demotion couldn't bite even
   fresh, because PROD wipes `mailKind` from source_data (pre-field code) — the demotion needs a
   STRUCTURAL fallback (automated-sender + no rule + no deadline), not only a field prod can erase.
2. **H1 was cosmetic** — padding classes, not structure. The fat is the SECOND LINE on every row.
   The real fix: ONE line per row (second line dies; meta folds inline right), checkbox left,
   hairline dividers. The consolidation-metric lesson repeated: optimize what the user SEES, not
   what a gate can grep.

**CORRECTION SHIPPED (July 24, night — smoke-work-surface 41/41):**
- **One-line rows for real**: WorkRow's second line is DELETED from the DOM — anything real folds
  inline muted after the ask; "Action needed" boilerplate dropped at render; items-center single
  flex line, py-[7px]. Structure, not padding.
- **The demotion is OWNERSHIP-KEYED** (the reasoned boundary, proven on real data): a notice with
  `understanding.ownership === 'none'` + a structural notice shape (automated sender OR
  notification/calendar kind) is not a task — on BOTH paths (the action branch AND the
  needs_reply/must-respond path, where the idealista class actually lived: an AI-rule needs_reply
  guess + the July-13 direct-recipient protection). Real obligations survive by the same key
  (bank/tax alerts = ownership you_owe — language-proof, no keyword list). Legacy no-understanding
  items fall to the structural floor (automated + not action-worthy). The user's explicit
  `type_override` is the only authoritative override (rule_type includes AI guesses — the bug).
- Live-verified on user A's real pool: 11 junk rows demoted (all four "Property inquiry" + the
  meeting acceptance), 8 real obligations kept (pay-booking, security, billing).
- **Re-stamps RUN post-deploy** (prod now carries mailKind): heal clean ×4; mail-kind stamped
  (Rene 120). **home_brief CACHE BUSTED for all 8 profiles** — verified 0 remaining.
- ⚠️ The ownership-keyed fix renders only after the NEXT deploy (prod serves this morning's
  kind-keyed H4-v1 until then). NEXT: W.**


## THE HOME, CLOSED (July 24, late night — user-locked keep/change split)

The final simplification, and the Home is DONE (focus moves to W and the substance):
- **Bundles RETIRED from the deck** — the bundle card was project-grouping nested inside the time
  lens, competing with the By-project toggle (double grouping = the "feels off"). Now: ONE row
  species, flattened from every entry kind (bundle members inherit the bundle name as their project
  chip; slipping deals are rows too). Grouping is the user's toggle alone.
- **One container per group** (hairline dividers) — not N bordered cards. `WorkRow flat` mode; the
  emphasis row is an accent + CTA inside the container, not a different species.
- **Consistent right-meta order on every row: project chip · prepared · due.**
- **KEPT ours deliberately (user call)**: the type icon (NOT a checkbox — rows aren't all
  completable; ✓/✕ on hover completes), the synthesized ask leading, time groups + judged order
  within, prepared tokens, Start-here + CTA, no per-row status dropdowns/priority dots (the room
  owns those).
- Composer at the TOP; "No project" language; When-you-can folds past 6; demotion is the
  ownership-keyed set filtering EVERY pool. smoke-work-surface 43/43.

## HOME — FINAL POLISH ROUND (July 24, late night; user-driven, all verified on the live page)

- **Chat card (final anatomy):** input at the card's FLOOR (standard chat), conversation expands
  ABOVE it with the one grid transition; smooth hover reveal; scroll is CONTAINER-scoped and pinned
  to the latest turn (on new turns, while typing, and after the reveal settles). The newest answer
  TYPES in (typewriter restored; history never re-animates; partial grouped tags never flash raw).
- **Answer content:** hard limits (summary ≤3 short paragraphs/~100 words, ≤5 tags, one id per
  bracket placed right after the thing it names); renderer splits real paragraphs and tolerates
  grouped tags ("[E34, E35, E36]" → chips). Live-verified: 112 words, 3 paragraphs, ends with the
  one-thing-first recommendation.
- **The ROW-DENSITY LAW:** one signal per category — structure (text-only project name, capped
  width) · status (ONE word: "ready" — "drafted" and a coworker's name are the SAME OUTCOME to the
  user; attribution lives in the deep-dive) · time (overdue/today badge OR the due date — effort +
  received date moved to the deep-dive). The meta cluster sheds BEFORE the title truncates.
- **Groups:** Overdue + Due today always open; This week + When you can rest COLLAPSED to
  header+count, hover-preview + click-pin (persisted `aug-do-pinned`).
- smoke-work-surface 44/44 · production build clean. THE HOME IS CLOSED. Next: W.
