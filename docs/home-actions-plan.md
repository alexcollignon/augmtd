# Home deep-dive — actions follow intent (plan)

**Principle:** every Home item deep-dive surfaces the **natural next move**, not buttons locked to the
item's storage type. The most common resolution is *"send a message,"* so a **pre-filled drafter** is a
first-class action across item types (meeting, commitment, action-item, awareness) — recipient + draft
inferred from the item — alongside **Mark done** and (later) **Hand to a coworker**. Email is the 90% case
to start; the design stays channel-agnostic for Slack/doc later.

## The gap (from the user)
The deep-dives show **context** but the actions are type-locked:
- **Meeting → "follow up"**: shows summary, but no way to draft the follow-up email to the attendees.
- **Commitment "you owe Madalena the refund details"**: only Done/Dismiss — no drafter to email Madalena.
- Keep-an-eye-on items have a `>` but open **no** deep-dive.

The system already knows the intent (the "suggested next step" / the commitment description) — it just
doesn't turn it into the action.

## Architecture
### A. Universal drafter (compose-to-inferred-recipient)
- **`POST /api/compose/draft`** `{ kind, entityId, intent? }` → `{ to[], cc[], subject, bodyHTML }`.
  - **Recipient inference:** meeting → `calendar_events.attendees` (minus self); commitment → its
    `counterparty` (parse "Name <email>"); action-item → the source thread's counterparty; awareness/email →
    the sender. If no email resolvable, return the recipient NAME + leave `to` empty for the user to fill.
  - **Draft generation:** reuse the voice block (`buildVoiceBlock` / the reply-drafter) + the item context
    (meeting summary + suggested next step; commitment description; thread) → an AI-drafted message. Same
    grounding/voice as the reply drafter.
- **`POST /api/compose/send`** `{ to[], cc[], subject, bodyHTML, threadId? }` → sends. **Sends AS the user**
  via the connected mailbox (reuse the existing `/send-email` connected-Gmail/Outlook path); **fallback** to
  coworker-email (`sendCoworkerEmail`, Resend/OAuth-free) if no mailbox connected — noted in the UI.
- Logs an `activity_event` (`message_sent` / reuse `reply_sent`).

### B. Deep-dive contextual action bar (`components/home/item-detail.tsx`)
A shared **action bar** per deep-dive, actions chosen by intent:
- **Draft email/message →** opens a compose panel (reuse the shared **`ReplyEditor`** + To/Cc/Subject
  chips) **pre-addressed + pre-drafted** from `/api/compose/draft`; edit → **Send** via `/api/compose/send`.
  Available on **meeting, commitment, action-item, awareness** (and it's the existing reply composer on
  emails).
- **Mark done** — the type's completion (`/complete` | `/commitments/[id]` | action-item complete).
- **Hand to a coworker** — deferred (ties into coworker delegation; stub the slot).
- (later) Snooze / make a task.

### C. Keep-an-eye-on opens the deep-dive
Wire the awareness rows to open `/item/[id]?kind=email` (or `awareness`) — read the full thread + an
**optional Reply** (lighter framing, no pressure). Honor the chevron.

## NORTH STAR — each item is a work-plan, graded system / you
The end state: a deep-dive doesn't show one button — it shows **what it takes to resolve this item**,
decomposed into **tasks**, each tagged **[System]** (we can do it) or **[You]** (needs you), with the
system tasks executable now and **handed to AI coworkers** later. Example — *"process the refund + share
details with Madalena"* → pull refund status (system if we have access / you if external), draft the
update (system), send it (system/approve), process the refund in billing (you). The user sees the whole
job **and what's already off their plate.**

**The discipline that makes it honest (same "bounded to real capabilities" rule, at task level):** the
**[System]** tag must be TRUE — grounded in what we can *actually* do now: draft/analyze/summarize
(always), fetch from data we have (email/calendar/meetings/KB — yes; an external tool — no), send on the
user's behalf (yes). Everything else is honestly **[You]**. Conservative by default; over-labeling =
broken promises. As capabilities grow (coworkers, integrations), tasks **migrate You → System** and the
product visibly gets more capable.

**Smart but bounded (the "system reasons what to do" ask):** the synthesis **reasons the next move but
only chooses from a fixed capability palette** (draft email · mark done · hand to coworker · [later: slack,
snooze, task]). It emits a **`recommendedAction`** (from the palette) + its **pre-fill** (recipient, draft)
per item; the deep-dive **leads with that recommendation**, others available. If the ideal action isn't in
the palette, it degrades to the closest supported (usually "draft a note") — never a dead-end. Palette
grows over time.

## Staging (ship value, then deepen — don't vaporware it)
1. **Now — recommended pre-filled action** (single-task, ~80% of items): synthesis emits `recommendedAction`
   + pre-fill; deep-dive leads with it (draft email / mark done). Ship this first.
2. **Next — task-breakdown + system/you grading:** synthesis decomposes an item into tasks, tags each
   [System]/[You] against the real capability set; system-single-tasks auto-map to the palette, the rest are
   the user's checklist.
3. **Then — execute system tasks + coworker hand-off:** do/queue the [System] tasks; later delegate to
   coworkers. [You] tasks stay the user's checklist.

## Slices (build order)
1. **Awareness deep-dive** — keep-an-eye-on rows open the email deep-dive (read + optional reply). Small.
2. **Compose endpoints** — `/api/compose/draft` (recipient inference + AI draft, reuse voice) +
   `/api/compose/send` (connected mailbox → coworker-email fallback). The core.
3. **Compose panel + action bar** — a shared compose panel (ReplyEditor + To/Cc/Subject) + the action bar
   in `item-detail.tsx`; wire **Draft email →** into the **meeting** (follow-up to attendees) and
   **commitment** ("you owe X" → email X) deep-dives, seeded + pre-addressed, plus **Mark done**.
4. **(later)** Hand-to-a-coworker action; non-email channels (Slack); snooze/task.

## Principles / guardrails
- **Actions follow intent, not storage type.** The drafter is available wherever the resolution is to send
  something — general, not per-type hardcoding.
- **Grounded drafts** (voice + real item context, real recipient) — never invent a recipient; if unknown,
  leave `to` empty for the user.
- **Reuse:** `ReplyEditor`, the reply-drafter/voice block, `/send-email` + `sendCoworkerEmail`, the deep-dive
  shell + activity logging. Non-fatal. Light + indigo `components/ui` tokens.
- Channel-agnostic framing so Slack/doc drop in later without a redesign.
