# THE PROACTIVE REACH ARC — the constitution (Sep 13, 2026)

**Why this arc exists.** The chrome is commodity (Grok Bot, Muse, an OSS clone at 2.5k stars); the moat is the harness's proactive reasoning actually being *right*. The Sep 13 census on the owner's live account proved the current gap: of the five top whispers served on a Sunday evening, two were moot (a settled-and-past meeting; a lapsed lunch that never existed) and one was fabricated relevance (the user's own cold-outreach campaign echoing back). The laws were correct — the judge produced a textbook "already settled" verdict on the copy of the conversation it happened to reach — but **reach, not law, was the binding constraint**, and three lanes sat structurally outside the law entirely.

**THE STANDING SENTENCE: nothing the machine surfaces may be false about time, done-ness, or who is asking.** A deck that speaks one dead fact costs more trust than ten true ones earn.

**THE AGNOSTIC CLAUSE (owner, Sep 13: "our system needs to be agnostic and working across users and scenarios").** Every mechanism in this arc derives its facts from the user's own corpus at runtime — no hardcoded tokens, senders, names, languages, or providers. A fix that names this account's data is a repair script, never a law. Reasoned where judgment lives, deterministic where facts live (the house doctrine).

---

## LAW 1 · THE REACH LAW — no lane outside the judge, no item beyond its reach

- Every *actionable* item is guaranteed a judgment revisit cadence. Reach is scheduled, not incidental.
- **The nominator** (zero-AI, deterministic): ranks the judgment queue as (1) **anchor-passed first** — any item whose code-verifiable anchor (understanding.deadline, commitment due_date, linked calendar event start) is `< today` in the USER'S OWN timezone (the T-class clock law); (2) least-recently-judged among actionable; (3) recency. The ≤1-re-judgment/item/day rule stands; the nominator decides *which* items get their turn.
- **Its own budget.** Judgment reach must not share draft-sweep's leftovers. A dedicated sweep (or a guaranteed first slice of the existing one) with the honest-budget grammar: wall-clock guard, `leftBehind` counted and logged, least-recently-served-user-first (the coverage-repair precedent).
- **Commitment-spawned items pass through `judgeWork`** like every other item. The commitments sweep may not insert a deck-visible row that no judge has seen (the current `action_required` hand-built insert is the violation). An unjudged row may exist; an unjudged row *leading the deck* may not.

## LAW 2 · THE EXPIRY LAW — a lapsed obligation gets a verdict, not a nag

- The commitment lane gains its missing third outcome. Today: close-on-fulfilling-reply, or nag forever. Now: **past-due + no fulfilling reply → NOMINATE → one cheap reasoned verdict** ("did this obligation's moment pass, or is it still owed?") → `expired` with an auditable note, activity-logged, **undoable** — never a silent delete (the NOMINATE→JUDGE idiom; the fulfillment-law asymmetry: failure or unclear NEVER expires).
- The verdict is reasoned because "past due" alone is not proof of mootness (an overdue invoice is still owed — the judge's own July law). The *nomination* is deterministic; the *disposition* is judged. This is the reasoned-not-bolted doctrine applied to death, not just birth.
- Undated commitments age into the judge's facts (open-ask-age already rides for items; commitments get the same fact).
- **Retro-repair by law, not by hand**: the same lane, run over the standing backlog (22 past-due open commitments on the owner's account, one per month of condominium bills, etc.), through the same judged path with the same undo. A guarded sweep applies the law; nothing is hand-picked.

## LAW 3 · THE SERVED-WORDS LAW — the deck never speaks a frozen snapshot

- **Deixis is resolved at every write seam, as a structure**: one shared resolver applied to `understanding.ask`, `work_title`, and commitment descriptions (today it is wired at exactly one of the three — the site-list decay class, fourth occurrence). Day-words ("tomorrow", "Thursday", "next week", multilingual per the existing EN/PT/DE/FR sets) resolve absolute against the source's own date at storage.
- **The serve-time guard**: a served whisper label carrying an unresolved day-word is a build error — structurally detected at the serving seam, re-derived or stripped, never rendered. (Legacy rows heal on serve.)
- The whisper label's precedence stays (ask → title) but the *text* served is the guard's output.

## LAW 4 · ONE CONVERSATION, ONE OBLIGATION — settlement crosses providers

- A human conversation split across the user's mailboxes (counterparty switched addresses mid-thread) must not hold two independent debts. **Settlement cascades to siblings**: when a resolution door settles a thread, it settles items on threads that are structurally the same conversation — RFC references/in-reply-to bridge first; fallback = same counterparty + distinctive-token subject overlap within a bounded window (the namesOverlap primitive, conservative bar).
- **The asymmetry is deliberate**: settlement spreads; reactivation stays per-thread. A false un-settle costs a nag; a false settle costs a dropped obligation — wait, inverted: a false SETTLE hides real work (the trust killer), so the sibling bar is HIGH and code-checked (references bridge = structural; the fuzzy fallback requires the settling evidence itself — the user's reply or the fulfilling delivery — to be visible on the sibling's own facts too, or it only NOMINATES the sibling for judgment rather than settling it outright). Showing costs less than hiding.

## LAW 5 · THE ECHO FLOOR — the machine recognizes the user's own outbound coming back

- **Derived per user, zero-AI, self-maintaining**: a token/pattern appearing in ≥N subjects of the user's OWN sent mail within a window is that user's outbound-campaign signature (any sequencer, any language — nothing names a vendor or a token). An inbound whose subject carries the user's own campaign signature is a **campaign reply**: it never earns top-whisper promotion, never founds an entity, never mints a commitment, never gets judged `bulk:false`+`customer` by default.
- It is **postured, not hidden**: campaign replies live in their own lane (Everything-else / a digest row), visible on demand — a real prospect answering a sequence is still worth a look, in its place.
- **Retro-repair by law**: the guarded sweep reclassifies standing sequencer-born items and archives the machine-founded echo entities/commitments through the same undoable doors.

## LAW 6 · THE DECK TRUTH GATE — the census becomes permanent

- New standing suite `scripts/smoke-deck-truth.ts` (the P26 outcome-scan pattern): serve the deck AS THE CLIENT WOULD for the probe host and (read-only) real accounts, then assert against the world: **no served whisper anchors a past date** unless its judgment explicitly ruled it live (an overdue invoice may stand; an ended meeting may not); **no served label carries a day-word**; **no campaign echo sits in the whispers**; the door's number is real. Zero-AI where facts suffice. This suite is the reason this class of rot can never again be found first by the owner.

## LAW 7 · THE OUTCOME LOOP (wave 4, spec-lite here)

- R1's collect-only ledger (accepted/edited-share/discarded since July) becomes judge and drafter FACTS: "the user discarded the last N preparations of this shape" rides the judgment prompt; edit-share informs drafter register. Consumption is facts-in-prompt first (no weights, no thresholds hand-tuned per user — agnostic by construction). Detailed at its wave.

---

**Sequencing**: W1 = Laws 1+2 (reach + expiry, parallel agents, fenced). W2 = Laws 3+5. W3 = Laws 4+6. W4 = Law 7 + the receipt-grammar census. Every wave: orchestrator seam review → combined suites → browser walk → fidelity proof on the live account where a repair ran. Gates ship with laws, in the same change, always.
