# Inbox coherence & live-brief plan

Next focused session. Three interlinked work items: make the Home brief feel live, wire **See draft**
everywhere it belongs, and make the email **Settings** coherent + actually wired. All shippable on
the existing prod pipeline (no AgentOS redeploy). Deploy = merge `dev` → `main` via the worktree
method (`git worktree add /tmp/wt -B main origin/main && git -C /tmp/wt merge origin/dev && push`).

Context from this session: classification is fixed (Haiku + `batchMatchRules` token budget), AUGMTD
labels are coherent on both inboxes, commitment cross-source resolution is live. What's left is the
**experience layer** — the brief refreshing, the draft affordance, and settings that do what they say.

---

## 1. Home brief → "live" (cadence)

**Today:** `app/api/home/brief/route.ts` caches the whole brief in `profiles.home_brief`, regenerated
only when the day-shape *signature* changes **or** the 3h TTL (`BRIEF_TTL`) expires. Feels behind
Serif, which recomputes on every new message.

**Change — two parts:**
- **Bust on new actionable mail.** Fold the **most recent actionable inbox_item's `created_at`**
  (and most recent `commitments.updated_at`) into the cache signature, so a new needs-reply/commitment
  invalidates the cache immediately instead of waiting out the TTL. Drop `BRIEF_TTL` to ~30 min as a
  floor, not the primary trigger.
- **Split cached vs live.** Only the **AI prose** (TLDR teaser, the narrative lines) needs caching for
  cost. The **structured sections** — Must-respond list, Ball-in-your-court, counts, schedule — should
  **recompute every load** (they're cheap DB reads, no AI). Restructure the route so the response =
  `{ ...liveStructured, prose: cachedProse }`. This is what makes it feel live without per-load AI cost.

**Acceptance:** sending yourself a reply-needed email → it appears in Must-respond on next Home load
without a 3h wait; the AI prose only regenerates when the shape materially changes.

---

## 2. "See draft" wired everywhere

**Today:** on-demand draft exists only in the Home Must-respond card (`MustRespondItem` →
`/api/inbox/[id]/draft` → `EmailDraftCard`). The inbox detail view itself has no draft affordance.

**Change:**
- **Inbox detail:** add a **See draft** action on any item where `classifyItem === 'needs_reply'`
  (and where the email's `auto_draft` rule/setting is on). Reuse `/api/inbox/[id]/draft` +
  `EmailDraftCard` (To/Cc/Subject/Body, editable) → existing `/api/inbox/[id]/send-reply`.
- **Consistency:** the same component in Home brief and inbox detail (one source of truth). Persist a
  generated draft on the item metadata so reopening doesn't regenerate (mirror the coworker
  `email_drafts[]` pattern).
- **FYI / awareness items:** lightweight quick-actions (Archive / Mark done) — components currently
  missing. Lower priority than the draft affordance.

**Acceptance:** open a needs-reply email in the inbox → See draft → edit → Send, no Home round-trip.

---

## 3. Email Settings — coherence + real wiring

**The model: two MASTER toggles (default ON), each gating per-rule behavior. Rules carry the detail.**
The rules are the single configuration surface — they classify, and the classification IS the label
and the per-rule draft decision. The two Settings toggles are **master kill-switches**, not duplicate
config:

| Master toggle (Settings) | Gates | Off → |
|---|---|---|
| **Label emails in Gmail/Outlook** (`auto_label`) | mirroring rule classifications into the mailbox | app identical; no `AUGMTD/…` labels in Gmail/Outlook |
| **Automatically draft replies** (`auto_draft`) | auto-drafting on rules that have it enabled | no auto-drafts anywhere |

An email is **auto-drafted iff** master `auto_draft` is ON **AND** its matched rule's `auto_draft` is
enabled. Labels are **written iff** `auto_label` is ON (the rule supplies the label). Both masters
**default ON**. The toggle being off NEVER degrades the in-app experience — classification, inbox,
Home, commitments all run off the rules regardless; the masters only control writing to the mailbox /
generating drafts.

**Status of the pieces:**
- **Per-rule `auto_draft` toggle — ALREADY EXISTS** (`components/settings/email-settings.tsx:476`, with
  an instructions field). No build needed; just confirm save round-trips.
- **`auto_label` master — ALREADY WIRED** (sync write-back is `if (emailSettings.auto_label)`). Verify
  default `true` + off → no write-back, in-app unchanged. (~no change.)
- **`auto_draft` master + the generation — NOT WIRED** (this is the real work).

**Part 3 — wire auto-draft generation (the substantive piece):**
- After classification at sync, in a background pass (`after()`, so sync isn't blocked): for each item
  where master `auto_draft` is ON **AND** the matched rule's `auto_draft.enabled`, generate a reply in
  the user's voice via the existing drafter (`buildVoiceBlock` + the LLM — extract the core of
  `/api/inbox/[id]/draft` into a reusable function), honoring the rule's `auto_draft.instructions`.
- **Store on the item** — `source_data.draft = { to, cc, subject, body, generated_at }`. No migration.
- Inbox/Home: if a stored draft exists → render `EmailDraftCard` **pre-filled** ("ready to review");
  else fall back to on-demand "See draft" (item 3 below). Never writes to the mailbox.
- Low volume (only auto_draft-matched rules), so cost is a non-issue.

**Part 4 — Settings cleanup:** remove **"Allow new CC/BCC in drafts"** (`cc_bcc_new` — never wired).
Keep the two masters with current copy.

**Acceptance:** rules are the single config surface; the two master toggles are honest kill-switches
(default ON) that gate write-back / drafting and never affect the in-app experience when off; an
auto_draft-enabled rule actually produces a ready-to-review draft when the master is on.

---

## 4. Recipient-aware needs_reply (CC/To)

**The gap (confirmed in code):** `lib/inbox/needs-reply.ts` `isNeedsReply` checks automated-sender +
reply-state + `hasDirectQuestion`/`hasRequestForAction`, but has **no notion of whether you're a
direct (To) recipient or CC-only** — and the question signals don't know if the ask is aimed at *you*
or at the To recipient. The rule-match envelope (`batchMatchRules`) also omits to/cc entirely. So an
email where you're **CC'd, not addressed, and not asked to do anything** can wrongly become Needs
reply. (Real signal in this account: `madalena@zeroto100.ai` is the user's 2nd-most-frequent "To"
among *received* mail — i.e. he's routinely CC'd on mail addressed to her.)

**Change:**
- **Compute recipient position** per email: `to` / `cc` / `bcc`, matched against the user's known
  mailbox addresses (login + each connection's account address — note `connections.email` was empty in
  this account; source the addresses reliably, e.g. connection metadata or the account profile).
- **Feed it into the decision:** if **CC-only** AND not personally addressed (name in greeting/body)
  AND no ask directed at the user → **cap at FYI**, never Needs reply. A direct To (or an explicit
  "@you / Alex, can you…") keeps Needs reply.
- **Two touch-points:** (a) `isNeedsReply` takes a `recipientPosition` + "addressed-to-me" signal;
  (b) the `batchMatchRules` envelope includes `to_count`/`is_cc_only` so the AI rule can use it. Ideally
  the processor's question-detection also resolves *who* the ask targets.

**Acceptance:** an email where you're only CC'd, with no mention of you and nothing asked of you, lands
as FYI — not Needs reply.

---

## Progress
- ✅ **Recipient-aware needs_reply (item 4)** — shipped + deployed.
- ✅ **Draft model (item 2)** — two master toggles gating per-rule behavior; per-rule toggle already
  existed; **auto-draft generation wired** (`draft-sweep` cron + `draft-reply.ts`); CC/BCC toggle
  removed. Shipped + deployed.
- ✅ **Prepared drafts in the Home (item 3, scoped to Home only)** — `MustRespondItem` now shows
  **"✦ Draft ready"** when the sweep prepared a reply, opens to a **pre-filled, editable** draft with
  **Send** (→ `/send-reply`) + Copy; `/api/home/brief` attaches `source_data.draft.body` per item.
  **Decision: drafts live ONLY in the Home** — not the inbox detail.

## Remaining
**Item 1 — Home brief cadence → live, WITH an "always alive" visual.**
- Cadence: fold the latest actionable item's `created_at` + latest `commitments.updated_at` into the
  brief cache signature (new reply-needed mail busts it immediately); structured sections recompute
  per load, only AI prose stays cached.
- **Alive visual (modern/professional, à la Linear/Vercel):** a thin **flowing gradient** accent
  (indigo→violet→transparent) that slowly drifts along the top edge / under the greeting via a slow CSS
  keyframe; a small **"Live" pill with a softly pulsing dot**; a **gentle shimmer** on the brief card
  the moment it refreshes (ties the motion to the cadence — shimmer = "just updated"). Restrained, slow,
  low-opacity — premium, not a spinner.

**Ops — cover the other users (not a reconnect).** The code is live for everyone for NEW mail, but only
this account was backfilled, and **2 of 4 active-email users have no rules** (so no auto-draft). Task:
seed per-inbox rules for users missing them + run the one-time backfill (re-classify, `is_cc_only`,
labels, pre-drafts) per user. No disconnect/reconnect required.

## Deferred (not this session)
- FYI quick-action components (archive/mark-done).
- Semantic exemplars for the voice drafter (Slice 2).
- The two-way INBOUND phase (Slack + email replies → coworker).
