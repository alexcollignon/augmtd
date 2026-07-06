# Home coherence pass

**Why:** we've layered a lot fast (deep-dives, action bars, task plans, realtime, resolution). Time to make
it feel like ONE cohesive tool, not stacked features — before stage 3.

**North star:** this is a tool to get busywork done fast. Every item = *see it → understand it in one glance
→ act in one click → it's gone.* 100% accurate, fast, meaningful, actionable. Anything that doesn't serve
that is noise and gets cut or simplified.

## 1. Kill the flicker / make content persist (correctness + feel) — FIRST
Today every action triggers a full brief refetch, and optimistic-surfacing returns the basic list then
re-enriches, so the *remaining* items flicker/reload under the user.
- Actions stay **local + instant**: the acted item is already removed optimistically; **do not re-render the
  other items' content** on an action.
- Counts / ring / day-progress update in the **background** (no visible content reload).
- The brief's item content persists in place; enrichment only swaps in when it's genuinely new, never a
  visible reload on an action.
- Result: nothing reloads under the user; the list is stable.

## 2. Simplify — tasks only where they earn it; lead with THE action
- **Drop "What this takes" from simple email/reply items.** A reply is one action — the composer IS the
  plan. The 1s load + the breakdown add cost and clutter for zero benefit.
- **Reserve the task breakdown for genuinely multi-step items** (commitments, meetings) where decomposition
  helps.
- Every deep-dive **leads with the one primary action** (draft & send / the natural move); breakdown is
  secondary, below.
- Tasks = a **single ordered list** (the sequence fetch→draft→send IS the meaning) with a subtle system/you
  marker. **No 2-column layout** (it fragments the sequence).

## 3. One consistent layout across all item types
- Same shell for email / meeting / commitment / follow-up: **header (what + who) → primary action → context
  (thread/summary) → [breakdown, only if multi-step]**.
- One visual language: same section labels, spacing, badges, radii, the shared `ThreadMessages` +
  `ReplyEditor`. No per-type divergence.

## 4. Verify accuracy end-to-end (trust foundation)
- Nothing stale or wrong surfaces: reply-resolution drops handled items; honest grading never over-claims;
  counts match what's shown (meeting-in-ring fix); no calendar/dup junk.
- Spot-check with real data (scripts), not just build-verify.

## Sequencing
Do 1 → 2 → 3 → 4 (cheap, high-impact, in order of jarring-ness). Each is small and shippable on its own.
**Then** stage 3 (make the [System] steps executable on the AgentOS/Studio engine — content flows, pauses
for [You]/inputs, override any step, never send without approval) — the capstone, on a base that's already
clean, fast, and cohesive.

## Out of scope for this pass (parked)
Historical same-thread dup cleanup (~26 groups, reversible); actionable-automated-notice surfacing
(payment-failed/account-suspended judgment); the temporal calendar.
