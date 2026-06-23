# Inbox Intelligence — Canonical Plan

*Status: planned (June 2026). Supersedes ad-hoc "smart inbox" ideas. Grounded in the audit of `lib/context/*`, `lib/ai/email-processor.ts`, `app/api/inbox/*`, and 2026 best-practice (Serif, Fyxer, alfred_, Claryti, Shortwave Ghostwriter).*

## Product promise
**"Nothing you commit to slips — wherever you said it, and the drafts sound like you."**
Email and meetings are two *inputs* to one brain. The user never sees two systems — one Day Brief, one list of what they owe / are owed, drafts in their voice.

## Why now (the gap)
Today voice is modeled as **statistics, not examples** (the drafter gets "tone: balanced 55%", never a sentence you wrote → generic drafts you rewrite). The two richest voice signals are **dead** (`draft_modified` never logged; `reply_sent` strips the body). Commitments are **detected then discarded** (`hasPreviousCommitment`/`explicitDeadline` computed, never read). The whole market has standardized on few-shot-from-sent-mail + commitment tracking across email **and** meetings + a daily brief. We do none of it.

## Architecture principles (decided)
1. **Platform-level, not a coworker.** Triage / voice / commitments / brief are infrastructure — always on, included, coworker-agnostic. Protects per-seat pricing (you pay for the *doers*: Luca/Max/Sofia) and means the data is open to **any** coworker.
2. **Connect at the obligations spine, don't merge surfaces.** Inbox stays inbox, Meetings stays meetings. Commitments + the Day Brief are the shared layer that both feed.
3. **Suggested actions, not manual hand-off.** The system proposes a coworker action ("want Sofia to draft the proposal you promised?"); the user approves. On-brand with prepared-work; better adoption.
4. **No new tabs/panels.** Enrich the inbox *landing* (the Brief) + the drafter. One new table + one cron.

---

## Pillar 1 — Voice (the drafter rebuild)  ·  *Slice 1*
**Goal:** drafts sound like the user; improve with use.

**Drafter** (`app/api/inbox/chat/route.ts:202-219`; mirror `app/api/work/prepare-from-email/route.ts:50`):
- **Few-shot exemplars** — retrieve 2–4 of the user's real sent emails most similar to the thread; inject as "write like these." v1: by recipient + recency. v2: semantic (pgvector over sent bodies).
- **Voice skill** — inject the interview-built `voice`-kind skill if present (reuse `buildSkillsBlock`). [[project-skill-interview-builder]]
- **Meeting context for follow-ups** — when the thread follows a meeting, pull that meeting's notes/action items as *what to say* (voice from emails, content from meetings).
- **Kill the hardcoded template** at `:215`; nudge temp 0.3 → ~0.5; demote `buildUserContextBlock` stats to a thin fallback.

**Close the dead loops:**
- Wire `ContextService.logDraftEdit(original, edited)` from `send-reply/route.ts:108` when sent text ≠ AI draft (consumer `extractToneDelta` already exists at `user-context-engine.ts:97`; pass original draft from client).
- Retain + (v2) embed sent-email bodies in `lib/context/sent-email-analyzer.ts:37`.
- Confidence reflects "have exemplars + voice skill", not raw signal count (`user-context-engine.ts:349/384`).

---

## Pillar 2 — Commitments & follow-ups (cross-source: email + meetings)  ·  *Slices 3–4*
**Goal:** detect what you owe and what you're owed; surface before it slips. **Meetings are a primary source, not an add-on.**

**Detection (stop discarding what we compute):**
- Inbound email: keep `hasPreviousCommitment`/`explicitDeadline` (`email-processor.ts:70/89`).
- Sent email: extract "I'll send X by Friday" in `analyzeSentEmail`.
- **Meetings: reuse existing action-item extraction** in `lib/integrations/meeting-bot/bot-manager.ts` → write commitments too.

**Data model — `commitments` table:**
`{ id, user_id, direction: 'you_owe'|'awaiting', description, counterparty, due_date?, source: 'email'|'meeting', source_id, thread_id?, status: 'open'|'done'|'dismissed', last_nudged_at, created_at }`

**Aging sweep — new cron** (beside `fetch-emails` in `vercel.json`):
- `you_owe` near/past due → surface; `awaiting` with no reply after N days → surface.
- **Auto-close** when a reply arrives / the thing is sent (thread activity) — not nagware.

**Surfacing:** reuse the `waiting` work-state (currently never resurfaces — `work-state-mapper.ts`) + the Day Brief. A commitment can become a **suggested coworker action**.

---

## Pillar 3 — The Day Brief (the surface)  ·  *Slice 5*
**Goal:** "what needs me, what's aging, what was handled" — before opening the inbox. A **day** brief (email + calendar + commitments), not just an inbox brief.

- **Platform-level, neutral-voiced** (works with zero coworkers; a PA coworker may narrate as an upgrade).
- **Lives on the inbox landing** (empty state), reusing the worker-home/team-home component. No new tab; doesn't touch the right-panel chat/calendar.
- **Content (one question — "what's my day + what do I owe"):** needs-your-reply (prioritized) · aging/follow-ups (P2) · what-was-auto-handled (archived N, with undo) · tasks/commitments created · **suggested coworker actions** (approval-gated).
- **Generation:** mirror `/api/workers/team-briefing` — grounded in `inbox_items` + `commitments` + `calendar_events`, cached, regenerated on new activity.
- **References meetings, never duplicates them** ("from Tuesday's call" → links to the meeting).

---

## Cross-source spine (how it all connects)
- Email + meetings → **commitments** (one table, two writers).
- Commitments + inbox + calendar → **Day Brief** (one surface, reconciled).
- Brief → **suggested coworker actions** → the paid doers.
- Voice (P1) makes the drafts the Brief offers worth sending.
- Everything platform-level → any coworker can read it; pricing intact.

---

## Net data-model + infra additions (small)
- `commitments` table (P2) + 1 aging cron (P2).
- Sent-email embeddings for exemplar retrieval (P1, v2).
- `logDraftEdit` wired (P1 — consumer already exists).
- Day-Brief endpoint + landing component (P3, reuses the home pattern).
- Everything else hooks into existing seams (detection code, `waiting` state, edit-delta consumer, meeting extraction, home pattern — all present, just unwired).

## Build slices (sequenced)
1. **Voice drafter rebuild** — exemplars (recipient+recency) + voice-skill injection + meeting-context for follow-ups + kill template + wire `logDraftEdit`. *Biggest perceived-quality jump; reuses voice work.*
2. **Semantic exemplars** — embed sent bodies; upgrade retrieval to similarity. *(enhancement on slice 1)*
3. **Commitments capture** — `commitments` table + 3 writers (inbound email, sent email, meetings); stop discarding signals.
4. **Aging sweep + resurfacing** — cron + `waiting` resurfacing + auto-close.
5. **Day Brief** — inbox-landing digest reconciling email + calendar + commitments.
6. **Suggested coworker actions** — approval-gated connective layer in the Brief + inline.

## Guardrails (anti-bloat)
- Platform-level, not a coworker. Suggested actions, not manual hand-off. No new tabs/panels. The Brief answers one question — anything that doesn't serve it stays out. Reuse existing extraction/state/patterns.

## Open decisions
1. Aging thresholds (N days) — default + per-user override?
2. Day-Brief voice when a PA coworker exists — neutral always, or narrated by them?
3. Exemplar retrieval v1 (recipient+recency) vs jump straight to semantic.
4. Commitment auto-close confidence — how aggressive before it stops surfacing.
