# Email Rules Engine + Email Settings Tab — Plan

The user-facing control + transparency layer over our email intelligence. A rules engine
(Serif-style) that drives classification and actions, with sensible seeded defaults, plus a
dedicated **Email** settings tab. **Labels (types) are fixed; rules are editable.**

## Why
Unifies everything we hand-built this cycle into one transparent, editable system:
- Deterministic rules (Gmail categories, no-reply senders) = our `BULK_HINT`/automated-sender
  regexes, now **visible, editable rules** instead of buried code (the principled noise fix).
- "Sent" rules (Waiting for Reply, Done) = our **resolution-on-reply + waiting-on** logic.
- "Needs reply → auto-draft" = our **voice drafter**, triggered by a rule.
- `classifyItem` defaults + `type_override` = "the default rules" + "a one-off user rule".

## Model (from Serif)
A **rule** = Trigger + Conditions + Outcome, ordered by priority (first match wins), toggleable.
- **Trigger**: `received` | `sent`.
- **Conditions**: either **Filters** (deterministic, match ALL/ANY of: from / not_from / to /
  not_to / cc / not_cc / subject_contains / subject_excludes / body_contains / body_excludes /
  has_label / has_no_label) **or** **AI Match** (a natural-language description the AI evaluates).
- **Outcome** (any combination): apply label (= our type) · auto-draft reply (+instructions) ·
  mark read · archive · forward to · escalate (+instructions) · trash.
- Deterministic rules are pinned/evaluated first (free); AI-match only sees what's left.

## Labels / types (fixed)
In-app display types stay legible; the rule label set is slightly broader for write-back parity:
`needs_reply · to_do · waiting_on · meeting · fyi · notifications · marketing · done`.
In-app grouping maps `notifications/marketing → (hidden noise tier)`, `done → resolved`.

## Seed default rules (our adaptation, in priority order)
| # | Name | Trigger | Condition | → label | Outcome |
|---|---|---|---|---|---|
| 1 | No-reply / automated senders | received | Filter: from contains no-reply/do-not-reply/noreply/notifications | notifications | — |
| 2 | Gmail Promotions/Social/Forums | received | Filter: has_label CATEGORY_PROMOTIONS/SOCIAL/FORUMS (any) | marketing | — |
| 3 | Gmail Updates | received | Filter: has_label CATEGORY_UPDATES | notifications | — |
| 4 | Urgent | received | AI: time-sensitive/blocking/deal-critical | needs_reply | escalate |
| 5 | Needs reply | received | AI: sender expects a reply/action from me | needs_reply | auto-draft |
| 6 | Meeting updates | received | AI: meeting/calendar update | meeting | — |
| 7 | Notifications | received | AI: automated alert/reminder/confirmation | notifications | — |
| 8 | Marketing | received | AI: promotional/commercial | marketing | — |
| 9 | FYI | received | AI: useful info, no reply needed | fyi | — |
| 10 | Waiting for reply | sent | AI: I sent it, awaiting their response | waiting_on | — |
| 11 | Done | sent | AI: thread complete, nothing more from me | done | — |

## Email settings tab
1. **Connections** — connected inboxes (per-inbox settings hang off each).
2. **Rules** — list (drag-reorder, toggle), create/edit modal (Trigger/Conditions/Outcome).
3. **Drafting** (per inbox) — auto-draft (voice) · **auto-label = Gmail/Outlook write-back, default-on/opt-out** · new CC/BCC recipients.
4. **Todo Capture** (= our commitments) — auto-capture · internal-facing · other-people's
   (accountability = `awaiting`) · **custom extraction instructions** (free text → fed into
   `extractEmailCommitments`).

## Runtime architecture (important)
`classifyItem` is synchronous (render-time); AI-match is async (needs a model call). So:
- **AI-match rules run at PROCESS time** (during sync / email processing) and store the resulting
  type on the item. `classifyItem` reads that stored type (after a user `type_override`).
- **Deterministic rules** can run anywhere (no AI) — including a synchronous pass in `classifyItem`.

## Phasing
- **Phase 1 (this slice): foundation + deterministic rules.** `inbox_rules` schema, the rule
  types, the seed defaults (as data), the evaluation library (`evaluateDeterministic` sync now;
  `evaluateAiMatch` signature for later), and a safe deterministic pass in `classifyItem` (the
  noise tier becomes rule-driven). No UI, no behavior risk beyond cleaner noise handling.
- **Phase 2: the Email tab UI** — Connections + Rules management (create/edit/reorder/toggle) +
  Drafting + Todo Capture settings, all wired to existing features.
- **Phase 3: AI-match at process time + action outcomes** — run AI-match rules during sync to set
  the type; wire archive/forward/escalate/trash + the Gmail/Outlook **write-back labels**
  (namespaced `Augmtd/…`, additive, reversible).

## Write-back labels (Phase 3) — guardrails
Default-on (opt-out, per inbox). Namespaced under one parent (`Augmtd/…` Gmail nested labels;
`Augmtd: …` Outlook category prefix). **Additive only** (never touch the user's own labels),
**reversible** (toggle off + "remove all Augmtd labels"). Needs `gmail.modify` / `Mail.ReadWrite`.
