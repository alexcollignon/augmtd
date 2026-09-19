# THE ATTENTION ARC — the day frame, the held-quiet ledger, bulk deeds, postures, and the review-first doc card

**Status: THE CONSTITUTION (Sep 17). Every change in this arc traces to a law here.**
Born from the owner's two Sep 17 screenshots — the calm Home five rows apart from a
fourteen-row wall of "overdue" — and one sentence he found and adopted: every assistant
optimizing locally for helpfulness surfaces one more thing, so globally you get the
notification tragedy of the commons. The personal agent does the opposite: ingest
everything, hold ~95% with receipts, rank the remainder against current context, and
decide when NOT to interrupt. Design canvas: the AUGMTD Threads artifact, Proposals page.

The experience-spec clauses this arc extends: earned calm · one fact one home · speak
consequence · the word is the deed · truth before presentation.

---

## PART I — THE LAWS

### A1 · THE WHY-NOW LAW
A surfaced needs-you row must say **why now and why you**, in words derived from judged
facts (its verdict, due date, counterparty, calendar adjacency) — "Jordan will ask at
your 14:00", "needs the account reference only you have". Bare "overdue" is banned as a
row's only stated reason: fourteen rows all reading "overdue" carry zero information. A
row that cannot state a why-now has not earned the deck; it belongs to the ledger.

### A2 · THE BUDGET LAW
Needs-you is a fixed budget: **at most 5 rows**, ranked against CURRENT context — the
next calendar event's adjacency outranks age; a consequence today outranks a bigger
consequence next week. The 6th-best thing goes to the ledger *however good it is*.
The budget is enforced at the serving layer (one choke point), never by the client.

### A3 · THE LEDGER LAW (held quiet)
Suppression is a **posture with receipts, never a dismissal**. Nothing is deleted;
nothing is hidden without an account of why. Every held item belongs to exactly one
**class**; every class carries a **consequence-of-waiting sentence** derived from the
class's own facts (its nearest real deadline, or the honest "nothing changes if these
wait"). Classes derive from verdicts and floors that ALREADY EXIST — judged-none +
resolution, the echo floor, the notice law, understanding.bulk, CC-only watch — zero
new AI passes at serve time. Anything can be brought forward; the agent answers for
what it held. "Everything else" is renamed **"Held quiet"**: the old label reads as a
guilt backlog, the new one states the agent's act.

### A4 · THE DAY FRAME
The chat stays the SPINE; the day is the FRAME around it. Beneath the needs-you rows,
two quiet zones — **Today** (calendar with prep state) and **In motion** — render as
part of the page's silence: 11px caps headers, no cards, no borders, no counts-as-chrome.
**A zone earns its seat**: it renders only when its organ is connected AND has something
true to say. An empty calendar day means no Today zone, never "No meetings today."

### A5 · THE FEATURE LADDER
Three states per organ, because the superadmin sits above everything:
1. **Feature OFF** — the organ does not exist for this user: no section, no empty
   state, no upsell, no vocabulary anywhere (nav, chips, copy, composer suggestions).
   The sovereign copy law, extended to every zone.
2. **ON, not connected** — still no empty widget begging for setup. The connect offer
   speaks ONCE, in the CoS's own voice, as a dismissible message; Settings stays the
   durable door.
3. **Connected, nothing true today** — the zone is still absent.
Only connected-with-content earns the render. **Chips are claims**: a suggestion may
only claim what this account's features + connections can actually deliver.

### A6 · IN MOTION IS STATE, NEVER EVENTS
The zone answers one question: **who is moving on my behalf right now** — workflow
runs, handed-off tasks, prep in flight. Every row leads with its OWNER's face (the
author-on-speech law reaching the day frame). What does NOT enter: coworker messages
and deliveries (they arrive in the THREAD as message-grammar cards) and decisions
(they are needs-you rows). The day frame is a glance, never a second inbox — one
attention queue, one record, one glance. A finished delivery earns at most the quiet
unread pointer at the zone's tail.

### A7 · THE BULK DEED
Each ledger class carries its **natural verb** on the row: newsletters → Unsubscribe,
notices/echoes → Archive, stale commitments → Expire, spam → Trash. Select-all and
per-item picking; the confirmation is a **bulk-deed card in the thread** (a member of
the message grammar): what will happen, to how many, the undo note, ONE commit door.
Floors: **trash, never delete** (provider-reversible is the ceiling); **the honest
unsubscribe subset** — one-click/mailto unsubscribes fire automatically, link-only ones
are reported as "need a click from you", never pretended; every bulk deed is logged,
and undoable WHERE THE VERB HONESTLY IS — archive/trash/expire reverse through the
existing restore doors; an unsubscribe is the sender's to reverse, and the card says
so rather than printing an undo it cannot keep (corrected Sep 17, by the build);
**parity** — the same deed is sayable in the composer and routes through the same
door. Every bulk deed may end with "keep doing this?" → a posture (A8).

### A8 · THE POSTURE REGISTRY
**Two doors, one store.** A posture is born in conversation (a correction, a bulk
deed's tail) OR in Settings — and both doors edit the same object: **one plain
sentence**, never a condition builder. The Settings page renders each posture as: the
sentence · on/off · edit in place · delete · its **receipts** ("archived 12 this
month") — a posture without visible effect is a mystery toggle. The existing
`inbox_rules` engine remains the deterministic substrate (kind ladder, set_kind
corrections, auto-draft gating); postures are its user-facing life. Census fact that
forced this: 22 rules platform-wide, all default-seeded, zero user-created ever.
The mailbox label mirror becomes an explicit choice, not a silent default (the
`auto_label` kill-switch already exists; the choice surfaces at connect time).

### D · THE REVIEW-FIRST DOC CARD (completes the threads-plan card contract)
1. **The deed is REVIEW** — the card is a HANDLE (glyph · title · type · pages ·
   version · owner), never the document embedded. "Docs can get big" is solved by
   never putting the doc in the thread.
2. **Review opens the SIDE PANEL** — the player idiom — and the conversation continues
   beside it. Chat asks while the panel is open revise the document; the new version
   lands on the SAME card (never a twin; the shipped version-chain + revision-in-place
   are the mechanics).
3. **The edit ladder, honest per type**: our OWN produced documents (we hold the
   authored content) edit in place, saving as a new version; foreign/binary types
   (PDF, complex sheets) review in the player and edit BY ASK — the ask path IS the
   editor. Never a fake contenteditable over pixels.
4. **Any type, one anatomy**: PDF · Word · Slides · Sheets share the card, the panel,
   and the commit door; only the glyph and the player change. Universal preview rides
   the compute sandbox's LibreOffice → PDF lane (already deployed for render-verify);
   the PDF player is the universal reviewer.

---

## PART II — THE WAVES

**W1 — THE ATTENTION HOME** (serving + surfaces): why-now clauses at the serving
layer; the ≤5 budget at one choke point; the held-quiet class derivation (zero-AI,
from cached verdicts/floors) + the ledger surface; the day frame zones (Today from
calendar + anticipation state; In motion from runs/handoffs, avatar-led) mounted
beneath the calm Home; the feature ladder enforced on every zone. Gates: a new
`scripts/smoke-attention.ts` — budget cap · why-now presence · class partition
(every held item in exactly one class; classes sum to the held count) · zone absence
per feature state · in-motion excludes events.

**W2 — BULK DEEDS + POSTURES**: the bulk-deed preview card (grammar member) + the one
bulk commit door (archive · unsubscribe honest-subset · expire · trash floor) +
undo/receipts; the posture registry (sentence-form over the rules store) + the
Settings postures page (sentence · toggle · edit · receipts) + the spoken door +
label-mirror-as-choice. Gates: preview-then-commit structural · trash-not-delete ·
unsubscribe honesty · posture round-trip both doors · receipts counted from the log.

**W3 — THE DOC CARD**: the `doc` card kind in the thread kit; the side panel with the
version chain; the LibreOffice→PDF universal preview lane; in-place editing for
our-produced documents → new version on the same card; ask-path revisions wired
through the existing revision machinery. Gates: ride `scripts/smoke-threads.ts`
(the card contract section) — handle-never-embed · same-card versioning · edit-ladder
honesty per type · one commit door.

**Progress log** (append per wave):
- Sep 17 · constitution written; W1 launched.
- Sep 17 · **W2, the DEED half (A7)** — `lib/deeds/` (words · unsubscribe parser · mail target ·
  live header read · held members · the engine), the `bulk` card kind + its host, three thin routes
  (`/api/deeds/prepare` · `/commit` · `/[id]`), and the sayable door `prepare_bulk_deed`
  (chief-exposed; preview-only). Gates: new `scripts/smoke-deeds.ts` **78/78**; smoke-threads
  570/570 re-earned (the grammar grew by one kind). The floors as built: the preview is a STORED
  fact · one commit door with an atomic exactly-once claim · archive/trash go through
  `executeResolveInboxItem` (so `/api/restore` already reverses them) · expire goes through
  `applyExpiryVerdict` and SKIPS a not-expired verdict · trash never deletes · link-only
  unsubscribes are reported with their URL and NEVER fetched. **One correction to A7's letter,
  deliberate**: "every bulk deed is undoable" is not true of an unsubscribe — the card says so
  rather than pretending. Still open: the class rows' verb buttons (the ledger integrator wires
  them to `/api/deeds/prepare`) and the "keep doing this?" posture tail (A8's seam, marked
  `TODO(postures, A8)` on the card).
- Sep 17 · **W1 landed on the surfaces.** The calm Home's needs-you list renders the SERVED
  attention set only, each row wearing its why-now clause as the muted half of its line (the mapped
  urgency/receipt tail is the fallback for a row served without one — one claim per row, never the
  same fact twice). The one door became **"Held quiet · N →"** and it opens a LENS, not a wall:
  `components/home/held-quiet.tsx` (`?view=held`) — back line · title · a deterministic CoS intro
  from the route's own counts · brought-forward promoted first · the classes folded with their
  consequence-of-waiting sentences, one expandable at a time, each member carrying its why-held and
  a "Bring forward" door · a receipts footer that states the read's own bound. The in-place unfold
  and its per-session state are deleted. The day frame mounts beneath the rows as a hairline +
  two-column grid that collapses to whatever was served, and the date caps-line gains
  `· next: <event>, <time>` only when a Today zone was earned. Gates: smoke-attention 83 → **124**
  (feature ladder · zone absence · tail · prep honesty · the one-work-one-row fold · the delivered
  POINTER · the name dedupe · the surface reads `attention.served` and owns no budget of its own);
  smoke-threads T8.3 + T8.12 and smoke-work-surface H7 RE-POINTED to A3 (the unfold accounted for
  nothing; the ledger accounts for everything it holds).
  ⚠️ Open: /api/home/held's pool is PENDING MAIL, so a held commitment or slipping deal is invisible
  to it — the Home hands those rows to the ledger itself (`deckHeldRows`) as promoted rows. The
  right fix is the ledger reading the deck's non-mail lanes at the route; this wave carried it on
  the client rather than let the work vanish.
- Sep 17 · **THE LEDGER GREW HANDS** (A7 × A3 × A8 — the integration wave). (1) **THE CLASS'S VERB**:
  every held class whose declared deed is a real bulk verb carries it as ONE QUIET WORD at the row's
  edge (12px neutral, indigo on hover — no button block, no colour), and firing it PREVIEWS through
  `/api/deeds/prepare` and mounts the bulk-deed card **in place, directly beneath the row**. The card
  is the confirmation and its own button is the only commit door on the page (the lens names neither
  `/api/deeds/commit` nor any executor). An open class turns its members into a pickable set
  (checkbox each + one select-all) so the verb can act on a subset — the same preview door, by ids.
  The word never promises more than a deed can hold (`MAX_DEED_ITEMS`), and a committed deed
  **re-reads the account** so an archived member leaves the list honestly. (2) **THE POSTURE TAIL**,
  wired: after a committed deed the card offers one line, and accepting posts `/api/postures/from-deed`
  → **the sentence is composed DETERMINISTICALLY from the deed's own facts** (`lib/postures/from-deed.ts`,
  zero AI on the path; primitives handed to the ONE writer, which re-validates them through the same
  floor a typed sentence passes), then the card shows back the engine's own reading — or the refusal,
  as itself. **THE ELIGIBILITY LAW**: a tail is offered only where the class is a property of ARRIVING
  MAIL *and* the class's own account survives the posture — bulk_mail · own_outreach · notices (archive
  or trash) yes; judged_quiet (a cached verdict about one thread's history) no; quieter_threads (defined
  by the budget — real correspondence) no; brought_forward (read-time calendar) no; **cc_watch no even
  though it is expressible** — a standing archive would cancel the watch the ledger just promised;
  unsubscribe/expire never (neither is an outcome the rules engine can perform). An unkeepable promise
  is worse than none. (3) **ONE HOME**: the route's inline derivation is gone — `lib/deeds/held-members.ts`
  `deriveHeld` is THE derivation (pool · floors · judgments · adjacency · the reasoned weight order ·
  the one budget), read by the ledger route, by `prepareBulkDeed` (via `deriveHeldMembers`) and by the
  brief (via `countHeld`). (4) **ONE SCALE**: the brief serves `attention.heldTotal` — the ledger's own
  number — and the Home's door speaks THAT plus the deck's non-mail held rows, exactly the sum the
  ledger's intro states (observed live on the reference account: 4,944 pending · 5 served · **4,939
  held**, door and ledger identical; the door used to say the deck's remainder, ~a dozen). The deck's
  non-mail rows STAY a client handoff, now stated in the route's header: a commitment's held-ness is a
  verdict of the DECK's budget over the agenda's own lanes and the slipping-deal lane exists only
  inside that synthesis — re-deriving either here would be a second budget over a second pool, and the
  first disagreement would have the ledger claiming to hold a row the Home is showing. Gates:
  smoke-deeds 78 → **117** (WD1 verbs · WD2 the tail + the eligibility table · WD3 one home · WD4 one
  scale, live on two accounts); BD7.15 re-pointed from "the seam is named" to "the tail is wired";
  smoke-attention 124 → **125** (AT5's route clauses re-seated on the module the work moved to, plus
  the module's own zero-AI floor); smoke-threads T8.3 + T8.12 and smoke-work-surface H7 re-pointed to
  the one scale (the door's number changed; the one-door law did not).
- Sep 17 · ARC COMPLETE, walked. W1+W2+W3 built in loop (five build agents + one wiring agent),
  every wave suite-gated and browser-walked on the live account. The walk earned its seat twice:
  THE NO-RESTATEMENT RULE (the why-now clause repeated the row's own leading name — the name now
  survives only where it does new work, the calendar-adjacency branch) and THE CALENDAR-ARTIFACT
  EXCLUSION (invite/RSVP mail is by construction adjacent to a calendar event, so brought_forward
  had become a wall of invites; kind-gated, agnostic). Final board: attention 125 · deeds 118 ·
  postures 41 · threads 585 · compute 151 (two pre-existing gate drifts from 243f7fa/88c8a7e
  re-pointed: the knowledge door moved to /documents; the room's folded past moved to the drawer)
  · deck-truth 55 · reach 447 · one-room 94 · work-surface 52 · tsc clean. Deferred, named: in-place
  typed editing needs the artifact to stamp tier + authored source at materialize's exit (W3's
  report has the path); the deck's non-mail held rows stay a client handoff until the brief owns
  them; the Today zone rides features.meetings — the calendar may deserve its own feature key
  (owner call); cc_watch/judged_quiet/quieter_threads deliberately offer no posture tail.

---

## PART III — THE QUALITY LAWS (Sep 17 night — the owner's walk of the shipped arc; the audit measured every complaint)

### Q1 · THE SELF-RECOGNITION FLOOR
Mail from the user's OWN coworkers (the seeded roster + any is_worker sender on the
user's team domain) never founds a new ask, item, or commitment — it is a POINTER to
the work it reminds about: deduped to the existing item, its arrival at most bumping
that item's freshness. (Audit: the same shortlist ask stood FOUR times — Clara's own
reminder emails re-ingested as counterparty asks.) And THE VOICE COLLAPSES: when the
narrated actor IS the speaker, speech is first person — "I've held the shortlist since
Aug 19", never "Clara is asking you" from Clara's own mouth. A narration may claim only
what renders beside it — "drafted a reply below" with nothing below is impossible.

### Q2 · HELD ≠ HANDLED (the gradient — the 0-to-100 cliff dies)
Three numbers, three bands, never a cliff:
- **WAITING (~10-20)** — alive + real + budget-overflow. THE DOOR SPEAKS ONLY THIS
  NUMBER ("When you're ready · 12 →"). Kept small by Q4, not by hope.
- **WATCHED** — others owe the user / copied threads. State, one line.
- **HANDLED (the big number)** — the classes, counts + verbs, reassurance at the
  ledger's bottom, never a door. The Home shows it only as the quiet right-side fact
  ("4,948 handled quietly").
The intro copy never claims to have "held" a newsletter — it filed it.

### Q3 · THE GRADUATION LAW
An item in a class whose consequence is "nothing changes if these wait" files itself
after 10 quiet days — resolved through the existing undoable door, activity-logged,
counted in receipts ("filed 312 this month"). The standing number trends to zero.
Real-deadline members are exempt while the deadline stands. This is retirement, the
half of noise reduction that suppression alone never delivers.

### Q4 · THE SEAT CONTRACT
The needs-you budget is 5 seats for FINISHED PREPARATION, not 5 rankings. A row earns
a seat only if it passes three tests: **real counterparty** (never ourselves — Q1),
**alive** (proof-of-life below), **prepared** (an artifact staged, or the honest state
word "needs shaping" with the CoS offering to shape). Fail any test → Waiting, however
important it claims to be.

### Q5 · A DECISION SHOWS ITS OBJECT
Nothing may ask for approval without rendering or linking the thing being approved, on
the same surface as the ask (the shortlist itself, the draft itself). The processes-arc
queued gap, promoted to law. A decision card with no object is not "decision laid out".

### Q6 · A CTA REVIEWS WORK DONE
A primary button never commands work to start ("Confirm status, send material, lock
time" is a to-do in button costume). If the chain's first artifact can be staged, stage
it and the CTA reviews it; if not, the row wears "needs shaping" and the CTA is the
CoS's offer to shape it.

### Q7 · PROOF-OF-LIFE
An undated ask older than ~10 days must re-earn its seat: re-grounded against its
thread (anyone mention it since? counterparty gone quiet? world moved?) via the
judgment sweep. Failing, it decays to Waiting/handled with "went quiet — say the word
to revive", or the CoS asks ONCE: "still live?". An ask never sits on the deck for 22
days past its own stated deadline again.

### Q8 · THE PREPARATION LIFT
Coverage (audit: 8/40 newest actionable had anything staged) rises through: the pass's
lane budgets repaired; the produce lane firing; **prepare-the-words-even-without-the-
deed** — where the send/act is out of reach (external apps, portals), the artifact is
still staged (the message to paste, the 30-second pack); proposed slots from real
free/busy for schedule asks. OWNER CALL TAKEN (Sep 17): the meeting-prep deliverable
lane RETIRES in favour of the anticipation lane (one prep mechanism; the workbench B3c
gate re-points to the anticipation seat as the law's home).
+ brought_forward hardening: an INTERNAL teammate is never a calendar bridge (the
recurring-meeting swallow), external counterparties only, cap ~3.

**PART III progress log**:
- Sep 17 · **QB — THE GRADIENT, THE GRADUATION LANE, AND THE BRIDGE (Q2 · Q3 · Q8's half).**
  (1) **THREE BANDS AT THE SERVE** (`bandOf` in `lib/home/attention.ts`, first match wins: a WATCHED
  class or the waiting-on-others fact → watched · the budget, not a floor → waiting · everything
  else → handled). A class not named in `WATCHED_CLASSES` lands in handled with no edit to the band
  law — the coordination contract for a later `self_echo`. `buildHeldLedger` partitions in the SAME
  one pass that files the classes, so waiting + watched + Σ handled classes can only equal the held
  total (AQ1, live). **`brought_forward` is now a STRICT SUBSET of waiting** (it requires
  `budgetOverflow` — A3's own words said it was "held only because the budget was full"), which is
  what let the promoted section DISSOLVE into the waiting band instead of standing as a smaller wall.
  (2) **THE DOOR SPEAKS THE SMALL NUMBER**: `When you're ready · <waiting> →` with
  `<handled> handled quietly · <n> today` beside it; both numbers SERVED
  (`attention.heldWaiting` / `heldHandled`, from the one `countHeld`) — the client computes neither.
  (3) **THE LEDGER RE-SKINNED**: title "When you're ready", the CoS intro composed from the real
  three numbers, Band 1 waiting rows (adjacency leads, Bring forward), Band 2 watched as one folded
  line, Band 3 handled classes under the graduation sentence; receipts gain "filed N this month".
  The sentences moved to **`lib/home/held-words.ts`** (pure, client-safe) so a CLI gate can assert
  the WORDS — and so "none urgent" is spoken ONLY when the served `urgent` count is zero.
  (4) **THE GRADUATION LANE** (`lib/work/graduation.ts`, hosted by the judgment-sweep cron, 20s
  slice, cap 200/user/run, oldest first): `selectGraduates` is PURE and zero-AI — handled band only ·
  the four "nothing changes if these wait" classes (`quieter_threads` deliberately absent: filing
  real correspondence on a timer is how trust dies) · exempt while a stated deadline still stands ·
  ten quiet days. It acts ONLY through `executeResolveInboxItem` (`resolution_reason: 'graduated'`),
  so `/api/restore` already reverses it and `reactivateResolvedThreadOnReply` already reopens it on a
  newer inbound — filing is never final (AQ4). Dry by default; the receipt is COUNTED from
  `activity_events`, never estimated. **Measured dry on the reference account: 3,735 would file**
  (bulk_mail 2,575 · notices 1,154 · judged_quiet 6; oldest quiet 90 days) — ~19 runs to drain at
  the cap, and the handled band trends down from 4,953 instead of only up.
  (5) **Q8's HALF — AN INTERNAL TEAMMATE IS NEVER A CALENDAR BRIDGE**: `internalDomainsOf` /
  `isInternalBridge` (free-mail domains contribute NO corporate domain — the inverse swallow — and
  `team.augmtd.ai` is always internal) guard the adjacency fact at BOTH readers, the ledger's
  derivation and the deck's why-now half; adjacency promotions are capped at
  `MAX_ADJACENCY_PROMOTIONS = 3` and the overflow keeps its true class.
  Gates: smoke-attention 125 → **199** (AQ1–AQ7); smoke-deeds **118** re-earned (WD4 re-pointed: the
  one-scale law unchanged, the door's chosen number honest); smoke-threads **585** (T8.3 + T8.12 +
  T8.12a re-pointed, third time and stricter); smoke-work-surface **52**; smoke-deck-truth **55**;
  tsc clean. ⚠️ Open: the deck's non-mail held rows are still a client handoff (they ride into the
  waiting band from the Home); the lane has NEVER been run with writes on a real account — the first
  live drain is a deliberate release step.

- Sep 18 · **QC — THE SEAT CONTRACT, THE DECISION'S OBJECT, AND THE CTA LAW (Q4 · Q5 · Q6 + Q1's
  source half).**
  (1) **THE SEAT CONTRACT AT THE ONE CHOKE** (`seatVerdict`/`rankAttention` in `lib/home/attention.ts`,
  run by the brief route where the budget already cuts): three tests, two kinds of failure. A row
  authored by our OWN coworkers (the Q1 predicate, reused — never a second sender read) and a row
  that failed proof-of-life are HELD with a stated refusal (logged per serve); a row with nothing
  staged still SEATS — wearing the machine's own honest word — and yields to a prepared row of equal
  urgency (`attentionRank` untouched; the preference is a second sort key, so the published ranks
  and A2's budget of five are unchanged). **THE COORDINATION CONTRACT is three-valued**: `provedAlive`
  unseats only on a computed `false`, so Q7's lane can land without a rendezvous and a pass that
  never ran can never read as "this went quiet" (`provedAliveOf` is the ONE reader of the named
  optional `source_data.proof_of_life` stamp).
  (2) **"needs shaping" IS A SPEC CHANGE**, so it was declared in the machine's vocabulary
  (`NEEDS_SHAPING_WORD`/`SEAT_WORDS` beside `STATE_WORDS`, with its rationale in the module header)
  and NOT added to `WorkLifecycle`: a lifecycle state the ladder can never emit would be exactly the
  standing lie the ladder exists to refuse. The word reaches the row through the served why-now
  clause; no surface types the literal (gated).
  (3) **A DECISION SHOWS ITS OBJECT** (`lib/room/decision-object.ts`): the object resolves from the
  door's OWN prepared artifacts (the one prepared reader — source_data lanes + the deliverable pool;
  no new fetch, no new shape), rides the reported decision payload as FACTS (it travels through a
  JSON sig), and mounts as the card's head — handle grammar, a taste, one Review door into the
  drawer's existing Prepared section. The decision BRIEF is never the object (it is the reasoning
  about it) and a send-shaped draft is the deed, not the object. With nothing resolved the card says
  so in its own words and **recommends NOTHING** — structural rather than a verb vocabulary hunting
  the word "approve" in whatever language the judge wrote.
  (4) **A CTA REVIEWS WORK DONE** (`lib/room/cta-law.ts`, one implementation, two seams): at
  COMPOSITION the code floor reads the board's own prepared column right where the move's target is
  already validated, and demotes an unstaged move to the CoS's first-person OFFER (its words kept,
  `offer: true` served so no surface can dress it as a button); at the RENDER the pre-compose
  "Next: <stored next_move>" fallback — which never passed a composer at all, and which produced the
  walk's "Confirm Sep 14 call status, send material, lock call time" — passes the SAME predicate
  against the room's own staged facts. The prompt carries the rule too (a move reviews work done, one
  deed, never a to-do chain); ROOM_BRIEF_VERSION 12 → **13** so every cached move re-authors.
  (5) **THE GROUNDING SPEAKER (Q1's source half)**: `assembleRoomGrounding` takes an optional
  `speaker` and renders a self-authored ask first person AT THE SOURCE (`askAttribution`), so every
  consumer — the responder, `answerEntityQuestion`, the converse loop — inherits the collapse with
  zero edits; `collapseSelfVoice` survives as the BELT, not the fix. Gates: new **SQ6–SQ9** in
  `scripts/smoke-quality.ts` (62 → **121**), including the live half (a real room with a named
  author's ask contains no "<name> asks" line in that name's own reading). Re-points, honest and
  stricter: smoke-threads T10.9 (the attribution moved into `askAttribution`; an ask still carries
  who asks, a non-speaker is still named) and T22.10/T22.11 (the pinned seat gained one more way of
  speaking — the offer line — and the ask folds behind it exactly as it folded behind a CTA).
  Board: quality 121 · one-room 94 · deck-truth 55 · reach 447 · threads 585 · attention 199 ·
  deeds 118 · compute 151 · work-surface 52 · tsc clean.
  ⚠️ Open: Q4's aliveness test is inert until Q7's lane stamps proof-of-life (by design); the entity
  room mounts the decision object without a Review door (the handle is still true — the deep-dive
  owns the drawer); the seat contract seats needs-shaping rows, so the SHAPE half of Q6's promise
  (the offer actually preparing something when the user says the word) rides Q8's preparation lift.

- Sep 18 · **QD — PROOF OF LIFE AND THE PREPARATION LIFT (Q7 · Q8).**
  (1) **THE SILENCE IS THE MEASURE, NOT OUR BOOKKEEPING** (`lib/work/proof-of-life.ts`). The obvious
  reading of Q7 — "re-judge anything whose judgment is older than ten days" — is a NO-OP here: the
  judgment cache is day-keyed, so every item the sweep reaches is re-judged daily. Measured on the
  reference account: items whose JUDGMENT is >10d old = **0**; items whose WORK has not moved in
  ≥10 days = **114** (quietest 89 days). The lane therefore measures the ITEM's own silence.
  `selectProofOfLife` is pure and zero-AI (actionable verdicts only · quiet ≥10d · not asked inside
  the same window · quietest first · cap 12/run); the re-judgment is the EXISTING `judgeWork` door
  with no new verdict grammar; the fact reaches the prompt exactly as the anchor/sibling/outcome
  facts do — the lane STAMPS the ask (`item_plans` kind `proof_of_life`), the judge reads the stamp,
  speaks it ("this has sat N days with NO movement… silence alone settles nothing") and carries it in
  its SIG, so today's cached verdict cannot swallow the question. No JUDGE_VERSION bump (a facts
  addition; with no stamp the sig is byte-identical). Hosted by the judgment sweep under its OWN 20s
  slice, before the general walk — the items it visits then hit that walk as cache hits, so nothing
  is paid twice. A proof RESETS FRESHNESS: one question per item per window, and the deck serves the
  stamp additively (`machine.proved`) so a row can say it went quiet instead of standing mute at day 22.
  **The seat contract's half is wired**: the lane writes Q4's ONE named field
  (`source_data.proof_of_life` = 'alive' | 'quiet') straight from the verdict it just got, so
  `provedAliveOf` has a writer and no second derivation exists — while an unstamped row still reads
  alive, which keeps a lane that never ran from changing anything.
  (2) **THE LANE REPAIR (Q8a).** The B3c meeting-prep block is RETIRED from the pass (owner call):
  it spent the item lanes' budget, always last, on a 118-candidate backlog it structurally could not
  reach, while the anticipation lane prepared the same meetings better on its own clock. ONE PREP
  MECHANISM; workbench B3c re-points to the decision + the anticipation lane's own fire records
  (40/40). **NEW & UNSORTED IS NOW A LANE**: the spine's report routes a fresh, undated item to
  `triage`, and the pass only ever read `needsYou` + `openQuestions` — so the NEWEST work on the desk
  was by construction the work the engine never prepared (the audit's "8 of the 40 newest had
  anything staged", structural half). The `stale` lane stays out deliberately — 74 long-dead
  candidates belong to Q7, not to a drafting budget. **EVERY LANE NOW HAS A FLOOR**: the remaining
  wall clock is divided by the lanes still unserved (the graduation-slice idiom, inside one pass); a
  long lane DEFERS rather than eats, and the overflow is walked afterwards in the ONE nominated
  order. The starvation was measured, not theorised: the pass's own `prep_outcome` ledger read
  `(never attempted)` for **6 of 11** standing `schedule` verdicts and **8 of 16** `send_file`
  verdicts — items lane 1 (80 reply rows) meant the walk had never once looked at.
  (3) **PREPARE THE WORDS EVEN WITHOUT THE DEED (Q8b)** — `lib/prepare/paste-pack.ts`. Deterministic
  eligibility, zero AI before the decision, two honest reasons only: the workspace feature gating the
  verb's commit capability is OFF (the sovereign tier — read through the ONE registry + the capability
  row's own `feature`, since `send_email` has no TOOL_FEATURE row), or a `reply` verdict on a
  COMMITMENT (the reply lane is mail-only by construction — its first query misses, and 4 standing
  reply commitments on the reference account were preparing NOTHING). A mail-capable reply never
  packs, and only the message-shaped verbs (reply · chase) can: `produce` already lands a document
  in the pool and `send_file` stages the FILE — replacing either with words would be a downgrade
  wearing a new name. The pack is drafted through the SAME drafter under the same artifact truth, told honestly
  WHO OWES (`direction` on `generateNudgeDraft` — a message about your own debt is never a chase),
  and lands in the pool as a `paste_pack` PreparedArtifact, so `getPrepared` serves it everywhere with
  no consumer edited; the machine reads it as work to REVIEW and never as send-shaped (there is no
  door here that could fire). One card, one deed: Copy.
  (4) **PROPOSED SLOTS (Q8c)** — `lib/prepare/free-slots.ts`. Measured: 11 `schedule` verdicts, **9
  with no invite staged at all and 2 with an invite carrying no time**. The grounding pass is right to
  refuse — it may only propose inside a day the ITEM states — so the proposal comes from the other
  authority: the user's OWN CALENDAR, in code. Business days, working hours, never today, never a
  booked hour, at most three; the first becomes the invite's time with `proposed: true` (the card
  already says the time is ours) and the rest ride as alternatives noted "free on your calendar".
  Gates: smoke-attention 199 → **248** (QL1–QL4 + the lane's dry read on the reference account);
  smoke-workbench **40/40** (B3c re-pointed); smoke-compute **151/151**; smoke-promise **146/146**
  (P29's third clause re-pointed with the law: it read a literal inside the retired meeting-prep
  block, and now reads the anticipation lane's author-LESS meeting turn — the same statement in its
  stronger form); tsc clean.
  ⚠️ Open: the lane has never been run with writes on a real account — the first live drain is a
  deliberate release step (the graduation lane's precedent, same paragraph).

- Sep 18 · **QE — THE DAY ANCHOR, THE FRESH SEAT, AND INSTANT CATCH-UP** (the owner's morning walk:
  two WEEK-OLD rows floating alone above the day, both seated only because their people sit in his
  15:30, while the night's arrivals waited for a sweep — plus "we need to be able to present
  helpfulness almost instantly… the user can't wait half a day").
  (1) **A ROW SEATED BY A MEETING LIVES UNDER THAT MEETING** (`lib/home/day-anchors.ts`). The
  adjacency fact always knew WHICH event it was and never said so; it now carries `eventId` (both
  readers — the brief's why-now and the ledger's band) and the served row carries
  `anchoredToEventId`, which the Home reads to EXCLUDE it from the floating whispers while the day
  frame renders it under its meeting ("· 2 things they'll raise →", the whisper grammar, unfolding
  to the rows). **ONE DERIVATION, HANDED OVER**: the day frame is its own request, so the brief —
  the one choke point that seated the rows — RECORDS what it served (`item_plans` kind
  `day_anchors`, one row, 15-minute freshness) and the frame READS it; re-deriving attention there
  would be a second budget over a second pool, and the first disagreement would have the meeting
  promising something the Home shows as floating. **A HOME IS A THING THAT EXISTS** (the hole the
  build found): a row is anchored only where the Today zone is EARNED (the same A5 ladder day.ts
  applies — `DEFAULT_FEATURES.meetings` is false platform-wide) and only to a meeting the zone will
  actually draw (today, not yet over) — otherwise the seat would have vanished from both surfaces.
  (2) **THE FRESH SEAT**: `attention.fresh {count, ids}` — deck-eligible work FIRST JUDGED inside
  24h (the machine batch's own `judgedFirstAt`, never a second definition of "new") that the budget
  could not seat. The rank ladder gains one rung, stated as the law: at equal band a fresh arrival
  outranks a stale calendar-adjacent row UNLESS that meeting is TODAY (today's meeting is the day's
  own shape). `adjacencyToday` is three-valued like `provedAlive` — only a computed `false`
  demotes, so a caller that never computed the day changes nothing.
  (3) **INSTANT CATCH-UP** (`lib/work/catch-up.ts` + `app/api/internal/attention/catch-up`): the
  lanes were 2-hourly slices — right for steady state, wrong for a first look (≈19 sweeps to drain
  the reference account). DETECTION IS A FACT (`attention.catchUp {filing}` = `selectGraduates`'
  own count, riding the `countHeld` read the brief already pays for, threshold 300); THE KICK is
  the kick precedent exactly (bearer `AGENTOS_SECRET`, maxDuration 300, work in `after()`, 202
  immediately) dispatched fire-and-forget from the brief's `after()` — **no request handler drains
  synchronously, ever**; THE STAMP IS THE CLAIM (insert-first, then ONE conditional update whose
  filter IS the 6h interval — never a read-then-write, so two Home opens and two boxes race
  safely); and the FIRST-LOOK chain now runs the same `runCatchUp` after the prep pass, so a new
  account never accumulates the backlog at all. One implementation drives cron, kick, bootstrap and
  the manual runner. ⚠️ Unchanged: the first live drain on a real account stays a deliberate
  owner-run release step — nothing here was executed with writes.
  Gates: smoke-attention 255 → **312** (AR1 anchor + the one-derivation floor · AR2 the rank rule ·
  AR3 detection/kick/claim/bootstrap, incl. "the brief reaches no lane"); re-points, honest: AT1's
  rank ladder (two new rungs, same law) and smoke-deeds WD4.1 + AT1's payload literal (the payload
  grew two served fields; the one-scale law untouched). Board: attention 312 · deeds 118 · quality
  150 · deck-truth 55 · compute 151 · promise 146 · tsc clean.

**Waves**: QA (Q1 + retro-sweep) ∥ QB (Q2+Q3 gradient serve/UI + graduation lane +
brought_forward hardening) → QC (Q4+Q5+Q6 seat tests + decision object + CTA law) ∥
QD (Q7 proof-of-life + Q8 preparation lift). Gates ride smoke-attention/smoke-deeds +
a new smoke-quality.ts where the seam is new.
- Sep 18 · PART III COMPLETE, walked. QA+QB+QC+QD in loop; the orchestrator's walk added AQ8
  (MACHINERY STAYS MACHINERY — a deck-eligible automated notice overflows to HANDLED unless a
  judged deadline is still ahead; bulk/echo never lift; the waiting band's words may never
  contradict its claim). Walk-verified live: the self-echo rows are gone from needs-you; Waiting
  fell 228 → 71 after the band fix; the intro speaks the three real numbers. Final board:
  quality 121 · attention 255 · deeds 118 · threads 585 · one-room 94 · deck-truth 55 · reach 447
  · workbench 40 · compute 151 · promise 146 · tsc clean. RELEASE STEPS (deliberate, never run
  with writes): the graduation lane's first live drain (~3.7k would file over ~2 days of sweeps);
  the proof-of-life lane's first drain (114 asks, ~20h); sweep-self-echoes --apply (42 rows / 6
  resolutions on the owner account).

### Q9 · THE TRIAGE DECK (owner, Sep 18 — "tinder for the middle band"; approved to build)
One card at a time is the right interaction for the HUMAN-JUDGMENT residue — and only there:
seats stay curated (the agent's job), noise classes keep bulk verbs. The deck is a MODE over the
served Waiting band, never a new derivation: same rows, second render.

**Entry**: "When you're ready · N →" opens INTO the deck (a quiet "view as list" toggle keeps the
ledger; Watched/Handled bands stay list-shaped below either view). Later entries reuse the ONE
component: the morning fresh pass, proof-of-life's "still live?" questions.

**The card**: the message/item essentials + the why-held clause + THE PREPARED ARTIFACT when one
exists (the drafted reply on the card — triage is review at speed, the review-first doctrine on
rails). Keyboard first-class: ← → ↑ ↓ · Enter · Space · Z · Esc.

**The verbs and where each sends the item (nothing ever flows back to the top by itself)**:
- → DONE — the existing undoable resolve door → Handled + receipts; only a new inbound reactivates.
- ← LATER — one-keystroke when (tomorrow / next week / date) → the revisit park → returns ON that
  date as a deck candidate wearing "you asked to see this today".
- ↑ NOW — prepared: the artifact opens for review-and-commit IN the deck (the one commit door);
  unprepared: takes a seat on today's Home (displacing #5) and/or opens its room. The only path
  to "top", always explicit.
- ↓ NEVER — archive + the A8 posture tail ("always?") → look-alikes go straight to Handled. Each
  ↓ makes tomorrow's deck smaller.
- Enter opens the room (Esc returns to the same card); Space skips (stays in Waiting; proof-of-life
  eventually asks its own question); Z undoes through restore.
**The receipt**: session end speaks the tally ("Cleared 23 in 4 minutes — 14 done, 5 later,
3 postures taught, 1 pulled to today") and every swipe logs an outcome-fact (Law 7 — the densest
per-user training signal the ranking can get).

**BUILT (Sep 18) — gates SQ13–SQ17, smoke-quality 205/205 · attention 312 · deeds 118 · threads 585
· promise 146 · one-room 94 · deck-truth 55 · tsc clean.**
`components/triage/triage-deck.tsx` is the deck; `lib/triage/words.ts` is its pure half (the receipt,
the whens, the verb table, THE ONE KEYBOARD MAP the component reads rather than typing arrows into a
switch). It is a SECOND RENDER: `HeldQuietView` hands it `bands.waiting.rows` in the server's own
order and it sorts, filters and fetches nothing. The card's extra essentials are SERVED on the band
row itself (`HeldBandRow.from` / `.excerpt` / `.prepared`, composed in `memberOf` from the pool row
the ledger already holds — the excerpt through THE ONE CLIPPER, so it ends at a word and says WE cut
it), and the deck's day is served too (`today` on the payload): a deck that reads its own clock
offers a dead "tomorrow" at 23:58 in the wrong zone.

Every verb is a door that already existed. → and ↓ are `useRowActions` (the inbox/commitments routes,
the optimistic exit, the "…· Undo" toast) — which also means the outcome fact keeps writing itself at
THE ONE RESOLVER and this arc added no outcome writer. Z is the same `restoreEntity`, and it never
claims a reversal it did not perform (a skip and a park are not restore-shaped). ↑ mounts the
artifact's OWN component (`EmailCard` / `InviteCard`) with its OWN commit door — there is no send
path in the deck at all — and is the only route to today, always by the person's own keystroke.
↓'s tail asks `postureFromDeed` whether a standing version is keepable and offers NOTHING where it is
not; `POST /api/postures/from-item` re-derives the class server-side (the client never names it) and
lands through `createPosture`.

← LATER is the one place a route was genuinely needed, and it writes THE EXISTING RECORD:
`POST /api/items/later` → `parkItem` (exported from `lib/work/judge.ts`, beside the cache writer it
uses) → the judgment's own `revisit`, then `applyVerdictConsequences` for the identical room line and
the identical undoable `work_parked` entry a judged park has always produced. Live shape, proven on
the probe: `item_plans{kind:'judgment', entity_id:'inbox:<id>', tasks:{sig:'19:<day>:user-park',
verdict:{work:'none', component:'message_only', reason:'you asked to see this later',
revisit:{after:'<date>', by:'user'}}}}`. `by:'user'` is the ONLY thing that differs from a judged
park and the only thing that needs to: **a user's word outranks the judge**, so the parked serve
holds it until its date regardless of the non-day sig, while the judge's own park still yields when
the item's facts move. A when is REQUIRED — a malformed, past or over-horizon day is refused in code,
in the USER's zone. It RESURFACES because `deriveHeld` reads the park off the SAME judgments map the
judged-none facts come from (no second store, no extra query) and `bandOf` lifts an ARRIVED park into
WAITING ahead of every class rule — without that clause a plain judged-none is `judged_quiet`, which
is machinery, which is HANDLED, and "show me this Thursday" would have FILED it on Thursday. Its
why-line is then the only one on the page authored by the reader: "you asked to see this today".

⚠️ Deferred, stated: a `paste_pack` does not render IN the card (packs live in `item_deliverables`,
which the ledger's pool read does not touch — serving them would mean a second paged read over the
whole pool for a rare artifact). ↑ on one opens its room, where `PastePackCard` already mounts.
Likewise `nudge_draft` and `prepared_forward` have no standalone renderer to mount, so ↑ opens the
room for those too. Deck-handed non-mail rows (a held commitment, a slipping deal) carry no sender,
excerpt, prepared artifact or class — their cards say only what they have, and offer no posture tail.

## PART IV · THE SEP-18 WALK (two live regressions + four card/ledger corrections)

**R1 · A DEEP LINK TO A LENS ALWAYS OPENS THAT LENS.** `/home?view=held` could rewrite itself to
`/home` and render the dashboard. The lens lived in React state seeded by an effect while THREE
window events (`augmtd:home-reset`, `aug:new-chat`, `aug:open-chat`) forced `dashboard` and deleted
the query — with no test of when they fired. The URL is now the authority: ONE reader
(`lensInSearch` over ONE `LENSES` list, replacing three hand-written `||` chains), seeded in a
LAYOUT effect so a deep link never flashes the dashboard first, and the reset listeners ARM after
the arrival paints — an event fired during a mount's own arrival (a one-shot cross-page chat intent
being consumed, a hydration re-dispatch, a dev hot reload, a leftover from a previous session) can
no longer exit the lens the address asked for. The ledger holds no auto-exit path at all: Esc's
exit is session-local state, written to no store, and `onBack` is only ever the reader's click.

**R2 · THE DOOR ALWAYS RENDERS, AND AN ANCHORED ROW RENDERS ONCE.** With both current seats
day-anchored and the brief still in flight, the dashboard showed NOTHING between the composer and
TODAY. Two causes, both fixed: (a) `CalmDoor` RETURNED NULL on three zeroes — which is exactly the
state of a Home whose brief has not landed — and the whole block was additionally gated on
`!nothing`; the list and its one door are now a property of the DASHBOARD LENS, not of the data, and
only the door's WORDS depend on what is known (`waiting: number | null`; an unlanded brief says
"Reading your day…" above it). (b) The day anchor's client half had never shipped: the serve states
`anchoredToEventId` and the Home now EXCLUDES those rows from the floating whispers and from the
door's remainder, so a row seated by the 15:30 lives under the 15:30 and nowhere else — the freed
seats refill from the served held rows, so the list never shrinks for it.

**Q9b · THE DECK OPENS ON WHAT IS ALREADY HELD.** The ledger's first visit derived the whole pool
while the reader watched a skeleton. Two seams, no new derivation: the Home hands the lens its own
`attention.heldBack` atoms (capped 12, the server's order, off the brief it hydrates from
localStorage before its first paint) and the ledger's read EXTENDS that stack in place; and the
brief's `after()` PRIMES the ledger's last-good from the derivation `countHeld` already paid for —
one payload shape and one writer (`lib/deeds/held-cache.ts`), used by the primer and the ledger
route alike. The deck's day is served either way (the ledger's, else the brief's `today`), so the
whens are never composed from a client clock. "Reading the account…" is now said only when there is
genuinely nothing in hand.

**Q9c · THE WORDS AND THE CARD.** The exit read "Done for now" beside a DONE verb pointing the other
way — one word, two meanings; the way out is **Close** (`esc close`), and "done" belongs to the verb
alone. The card says WHO, what KIND (`TRIAGE_SOURCE_WORD`, one table; an unmapped source says
nothing), why it is held, the message's own first words, and a prepared WORD as a chip where no
artifact token was served (a word never promises a renderer). The four arrow verbs are laid out as
the arrow keys they are — ↑ NOW over ← LATER · ↓ NEVER · → DONE, quiet key-caps, ≥40px, colour only
on hover — with ⏎ OPEN apart and the hints furthest right.

Gates: `scripts/smoke-attention.ts` AS1–AS4 (356/356) · smoke-quality 227/227 · smoke-threads
585/585, four pins re-pointed honestly (never weakened, two of them strictly stronger).

### Q9v2 · THE TRIAGE DECK, RESHAPED (owner walk, Sep 18 afternoon — "hard to follow, empty real
estate; this [reference] seemed more simple")
Three structural corrections + the owner's own verb mapping. Same doors, same laws, same queue.

**THE QUEUE FACT, stated for the record**: Waiting IS the Home list continued past seat 5 — one
pool, one ranking, one cut. Triaging the deck prunes tomorrow's candidates.

**1 · FRAME OWNS VERBS, CARD OWNS CONTENT.** Two large fixed pills ABOVE the stack — "← Dismiss"
and "Done →" (the bulk pair) — plus quiet "↑ Keep" and "⏎ Open" beside/below, and an Undo pill.
Nothing verb-shaped inside the card. Keyboard unchanged in spirit, remapped:
  ← DISMISS (the dismiss door, undoable; where a standing rule is expressible the "always?"
     posture tail rides HERE, contextually — Never as a separate arrow is retired)
  → DONE (the complete door, undoable)
  ↑ KEEP (stays in Waiting, no date — the explicit form of skip; deck advances)
  ⏎ OPEN (the room; Esc returns) · L = dated later (the park, demoted to a secondary key/chip)
  Space = synonym of Keep · Z undo · Esc close. Dismiss and Done teach the outcome loop different
  lessons; both logged.
**2 · TRUE FOCUS.** Entering the deck takes the room: intro/band prose and Watched/Handled fade
back (reachable on close or scroll-past), the card narrows (~640px) and centers. A small header
line only: "When you're ready · N left · ← Close · View as list".
**3 · THE CARD IS THE THING ITSELF.** Top: avatar/initial + counterparty name + source line
(mail · commitment · meeting action) + the contextual chip (prepared state / class). Middle, when
applicable: THE ACTUAL CONTENT — for mail the thread's tail (last 1–2 messages, author-named,
excerpt-law clipped, lazy-fetched per card through the existing thread door and cached); for a
commitment its founding context; never blank space where substance exists. Bottom: the reply
slot — Clara's prepared draft rendered IN it when one exists (review at speed), and typing there
talks to Clara about THIS item through the item's own composer door. Minimal chrome throughout.

**BUILT (Sep 18, evening) — gates SQ13–SQ17 re-pointed + NEW SQ19; quality 263/263 · attention
357/357 · threads 585/585 · deeds 118/118 · tsc clean.**
The file split follows the law: `TriageDeck` (the stack, the tally, the one header line) →
`TriageStation` (ONE row's frame: the doors, the keyboard, the pills) → `TriageCard` (pure content)
→ `ReplySlot`. The card component imports neither the row kit nor the verb table, which is how
"nothing verb-shaped inside the card" is a fact about the component rather than a hope about the
file — SQ19 slices the card's own source and asserts it.

- **THE VERB TABLE IS THE FRAME'S** (`lib/triage/words.ts`): each row now carries a `rank`
  (`primary` · `quiet` · `chip`) and the frame renders BY RANK — it types no label, key or order.
  ← dismiss · → done · ↑ keep · ⏎ open · **L** later · Space = keep · Z undo · Esc close, and the
  map holds NOTHING ELSE (the gate asserts the table's whole key set, so a retired binding cannot
  survive in one of the four places it lives). `↓ NEVER` is retired as a direction: an "always?" is
  a property of A DISMISSAL, so the posture tail rides ← DISMISS through the SAME
  `postureFromDeed` eligibility table and offers nothing where nothing is keepable. `↑ KEEP` writes
  NOTHING (the explicit form of a skip) and therefore counts nothing — a session of pure keeps gets
  no receipt. The **Undo pill** exists only while there is something to undo.
- **TRUE FOCUS is the lens's half**: `focus = deckShown` collapses the title, the intro, the band
  header and its sentence, and folds Watched + Handled + the receipts line behind one quiet word
  ("The rest of the account") — nothing is unmounted, and Close returns the page whole. The column
  narrows to 640px. The fold is a LAYOUT change under `motion-reduce:transition-none`: a reader who
  asked for stillness gets the layout and no fade.
- **THE CARD IS THE THING ITSELF**: initial-avatar + counterparty + source word + date, the
  contextual chip at the edge, then — for a mail row — THE THREAD'S TAIL, read through THE EXISTING
  door (`GET /api/inbox/<id>/thread`), last ≤2 messages, author-named, each message's OWN words
  (`topMessageOf`, its conservative 40-char floor intact) clipped by THE ONE CLIPPER with its
  honest marker. The read is LAZY (the card in hand), CACHED per item for the session, SHARED in
  flight, and PREFETCHED exactly ONE card ahead — a deck is a cursor, not a crawler. While it is in
  flight the card shows the SERVED excerpt, so there is never a hole and never a spinner where
  substance exists.
- **THE REPLY SLOT NEVER SENDS.** A prepared draft (asked for only where the serve already said one
  stands, so it is the door's instant serve of a stored draft and never a generation the deck
  triggered) renders read-only under "ready to send", and its only affordance is the room. With no
  draft it is a quiet line that SPEAKS to Clara about this item through `POST /api/items/steer` —
  the item's own conversation door, with the item's own kind from one table; a row with no honest
  kind (a deal) gets NO slot rather than one posting to the wrong door. The v1 artifact mounts
  (`EmailCard` / `InviteCard`) are GONE from the deck entirely, which makes SQ15 strictly stronger
  than the gate it replaces: there is now no send-capable component in the surface at all.
- ⚠️ **Stated honestly**: the deck writes NO room turn of its own. An item's room key is resolved
  SERVER-side (an item linked to an entity lives in that entity's room), so a client that composed
  one would write the exchange into the wrong room — the slot therefore shows the answer in place
  and leaves the durable record to the room's own door. Giving the slot a persisted transcript
  needs a served room key on the band row; it is not built.

## PART V · THE EVENING WALK (Sep 18 — the graduation flood's one casualty, and three doors made honest)

The owner's five-screenshot review, every find root-caused before any edit; three Opus waves on
disjoint files; all suites green after two re-points (AK1 → the chat-lane clock's
`enforceWeekdayDatePairs` wrapper; smoke-judged-room J1 adjudicated as live-AI sample variance,
green on rerun).

- **THE DONE SIDE CAN NEVER EVICT THE LIVE SIDE** (the arc's own graduation drain found the repo's
  oldest class in the SPINE): `lib/work-items/model.ts` read live + recently-resolved through ONE
  unordered `.or().limit(800)`; the morning's ~1,570 graduations (each stamped `resolved_at = now`)
  flooded the page and 91 live rows — including a pending item carrying a real prepared draft —
  silently fell off every board. Now four lanes, each ordered with its own cap, saturation LOUD,
  and graduated corpses excluded from the resolved window at the query (`is.null` beside `neq` —
  SQL's `!=` drops NULLs; the reason string is the graduation lane's own constant). Gates SP1–SP5.
  Riders: the entity detail route hands its member links to a SCOPED spine read (817ms vs 1824ms;
  the dedupe basis stays account-wide via one slim read — SP5), `buildRoomView` 4 waves → 2.
- **THE ROW SAYS WHERE THE WORK LIVES** (owner: "some items missing the who or project reference?"):
  the tracked project tag was SERVED all along and died at the render — `whisperProject` in calm.ts
  (never-say-twice via the same `bodyNames` test the who obeys), printed last and muted inside the
  truncating line. Gate AS0. The missing WHO was a data gap (pre-July-7 commitments, counterparty
  null) — `scripts/sweep-commitment-counterparty.ts` (guarded, attendee-reduction only via
  `soleCounterpartOf`, dry-proven: 1 of 111 resolvable, 106 rosterless in-person recordings left
  honestly null).
- **THE REPLY STAGE IS UNREACHABLE FROM A MAIL MOVE, BY CONSTRUCTION**: the CTA ladder's fallback
  could still reach the old two-pane reply stage when the board lost its card (exactly the eviction
  cascade). A mail move with no card now goes no deeper than the THREAD, or speaks one ephemeral
  line; forward/invite keep their deep read. Gates T28.4e/j. The room opener derives from
  `hasRecord` — "Picking <name> back up" for a room with filed history; "Fresh start" only for a
  genuinely new one (T30.3b).
- **THE CHAT OPENS INSTANTLY** (the DM door's Sep-7 fix, mirrored one lane over): a sidebar chat
  click now takes the page synchronously (shared skeleton, no fork), a failed turns fetch SPEAKS,
  an empty room opens with the composer, and `aug-open-chat-intent` is consumed on same-page opens
  (the fresh floor). Sidebar row highlights on click. Gates T12.10–13.
- **Walked end-to-end**: rows wear a quiet ` · <Project>` tail; a restored evicted row ranked straight into the
  deck's top 5; the project room opens fast and — after the owner sent the RIB reply mid-walk, the
  reconcile resolved it and the brief recomposed — now reads "You sent him a message today, but the document itself has not moved… You owe him the
  document" with the move as an OFFER
  (ref null, no dead door). The stale text seen one open earlier was the no-mutation law's arrival
  paint, by design. Past-conversation click: skeleton at click, conversation loads, no dead air.
- Board: compute 156/156 · threads 592/592 · attention 362/362 · quality 272/272 · one-room 94/94 ·
  promise 146/146 · work-surface 52/52 · deck-truth 55/55 · workbench 40/40 · ledger 54/54 ·
  judged-room 34/34 · tsc clean.
- Owner-runnable: `npx tsx scripts/sweep-commitment-counterparty.ts --all --apply` (1 write; the
  resolved label is a bare EMAIL address, not a display name; say the word for a names-only guard
  instead). Deferred honestly: the held-ledger rows carry no project tag (half the stack's payload
  lacks the field — server plumbing).
