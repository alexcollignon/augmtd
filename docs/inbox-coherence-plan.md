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

**The incoherence:** `app/api/inbox/email-settings` `auto_draft` defaults true with copy
*"Automatically draft replies — Draft replies in your voice, ready to review,"* and the default
"Needs reply" rule carries `auto_draft: { enabled: true }` — but **nothing executes auto-draft**. We
deliberately chose on-demand. So the settings/rules promise behavior we don't do.

**Decision — ONE three-state draft mode, not two booleans.** Today there are *two* `auto_draft`
booleans with the same name and no defined relationship: the **Settings** one (global) and the
default **"Needs reply" rule** one (per-rule). That ambiguity is the bug. Replace both with a single
three-state control:

- **Off** — never draft.
- **Offer (on-demand)** — show **See draft**; generate on click. Cheap. **Default.**
- **Auto** — generate at sync and **store the draft on the inbox item (in-app, NOT the mailbox)**, so
  it's already there when the email is opened. This is the Serif/Superhuman "alive" feel; it costs an
  AI call per reply-needed email, so it's **opt-in**, not default.

Both modes are worth having — Auto is the magic, Offer is the cheap floor — but they're *states of one
control*, because a boolean can't say "offer here, auto there."

**Global default + per-rule override (this is the rules review):**
- **Settings** holds the **global default mode** (Off / Offer / Auto).
- **Rules** become an **optional per-category override** — e.g. *Auto-draft client replies, Offer for
  everything else*. The rule's `auto_draft` boolean is **replaced** by the same three-state (inherit
  global, optionally override), so it stops duplicating the global and becomes genuinely useful.
- The default "Needs reply" rule should inherit the global (no override) out of the box.

**Wiring:**
- Resolve the effective mode per email = `rule override ?? global default`.
- **Offer** → See draft affordance (Home brief — already; inbox detail — item 2).
- **Auto** → at sync, generate via the same drafter and persist on the item metadata (mirror the
  coworker `email_drafts[]` pattern); the `EmailDraftCard` renders pre-filled instead of click-to-fill.
- **Never write to the mailbox** in any mode — distinct from Serif writing into your Drafts folder.
- **Audit the other settings end-to-end** while here: to-do capture actually drives `to_do` surfacing;
  per-inbox rules editor writes + sync reads (true as of this session — add a "last applied" signal);
  "re-run rules" backfill uses the fixed `batchMatchRules`.

**Acceptance:** one coherent draft-mode control (Off/Offer/Auto) with a clear global→rule relationship;
every Settings toggle has a verified effect or honest copy; no setting claims behavior we don't perform.

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

## Sequence
1. Recipient-aware needs_reply (item 4) — precision fix, cheap, improves everything downstream.
2. Three-state draft mode + rules review (item 3) — unblocks the draft affordance's gating.
3. See draft in inbox detail (item 2) — the visible win.
4. Brief cadence (item 1) — the "feels live" win.

Each is independently shippable. Suggest one commit per item, merge + deploy after each so you can
eyeball it on real mail before the next.

## Deferred (not this session)
- FYI quick-action components (archive/mark-done) — after the draft affordance.
- Semantic exemplars for the voice drafter (Slice 2).
- The two-way INBOUND phase (Slack + email replies → coworker).
