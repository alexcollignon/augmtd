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
