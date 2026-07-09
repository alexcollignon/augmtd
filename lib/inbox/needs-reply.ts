// "Needs reply" — a smart signal recombined from the email processor's EXISTING per-email
// signals (no new AI pass). An email needs a reply when a real person asks something of you and
// you haven't answered — never a newsletter, notification, receipt, or automated/FYI message.
//
// The processor already does the hard part: it classifies a "respond via email" state
// (work_prepared = reply/decide/approve) and detects hasDirectQuestion / hasRequestForAction /
// hasExplicitApprovalRequest / isAutomatedSender / isNotification. We were just collapsing all
// of that into work_state and querying the wrong bucket. This helper reads the signals back out.

import { getUnderstanding } from './item-understanding';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SignalItem = { work_state?: string | null; source?: string | null; source_data?: any };

// The decisive signal in practice: a real human sender. The classifier happily files
// "no-reply@booking.com" / "do-not-reply@binance.com" as work_prepared, but you can't reply to
// those. The local-part is a near-perfect tell for transactional/automated mail.
const AUTOMATED_SENDER = /^(no-?reply|do-?not-?reply|donotreply|noreply|notifications?|notify|mailer-?daemon|bounce|postmaster|automated|alerts?|newsletter|updates?|mailer|payments?|billing|receipts?|invoices?)([.\-_+]|@|$)/i;

function fromAddress(item: SignalItem): string {
  const sd = item.source_data ?? {};
  return String(sd.from || sd.from_address || sd.fromEmail || '').toLowerCase();
}

// You're a bystander on this thread — not the one expected to answer. The PRIMARY signal is the
// unified `understanding` (reasoned over the real recipients + your own addresses + how the body
// addresses you): role `bystander`/`one_of_many` or relevance `awareness` means the ask (if any)
// targets someone else — this catches the group "Dear Team" To case that the To-vs-CC header math
// misses (you're technically in the To, but one of many, unaddressed). When there's no understanding
// (legacy items), FALL BACK to the old `is_cc_only` header check — non-fatal, today's behavior.
export function isCcOnlyBystander(item: SignalItem): boolean {
  const u = getUnderstanding(item);
  if (u) {
    // Reasoned judgment wins. `addressed` + `reply` is genuinely yours; anything else is awareness.
    if (u.role === 'bystander' || u.role === 'one_of_many') return true;
    if (u.relevance === 'awareness') return true;
    return false;
  }
  // Fallback (no understanding): the legacy header-math input.
  const sd = (item.source_data ?? {}) as Record<string, unknown>;
  if (sd.is_cc_only !== true) return false;
  const ws = (item as { work_state?: string | null }).work_state;
  return !(ws === 'work_prepared' || ws === 'decision_required');
}

export function isNeedsReply(item: SignalItem): boolean {
  const s = (item.source_data?.signals ?? {}) as Record<string, unknown>;

  // Hard gate: a real person must have sent it. Catches the junk the classifier mislabels.
  const from = fromAddress(item);
  const local = from.includes('@') ? from.split('@')[0] : from;
  if (AUTOMATED_SENDER.test(local) || s.isAutomatedSender || s.isNotification || s.isMechanicalConfirmation) return false;

  // PRIMARY signal: the unified understanding. When present it is the decider for whether the reply
  // is yours — reasoned over the real recipients, so it correctly demotes a group "Dear Team" To (you
  // in the To but one of many) to awareness, and correctly keeps a directly-addressed ask as a reply.
  const u = getUnderstanding(item);
  if (u) {
    // A bystander / one_of_many / awareness item is not your reply (visible as FYI, never hidden).
    if (u.role === 'bystander' || u.role === 'one_of_many' || u.relevance === 'awareness') return false;
    // Addressed + expecting a reply (or an action that lands via email) → your move.
    return u.relevance === 'reply' || u.relevance === 'action';
  }

  // Fallback (legacy items, no understanding): the old header + signal recombination.
  // CC-only and not personally in the loop → awareness, not your reply.
  if (isCcOnlyBystander(item)) return false;
  const replyState = item.work_state === 'work_prepared' || item.work_state === 'decision_required';
  const asks = !!(s.hasDirectQuestion || s.hasRequestForAction || s.hasExplicitApprovalRequest);
  return replyState || asks;
}

// Given the user's sent emails (thread_id + received_at), decide whether a candidate has already
// been answered — i.e. a reply went out on its thread after it landed. Keeps handled threads off
// the list without a per-item query.
export function buildAnsweredSet(
  sent: { thread_id: string | null; received_at: string | null }[],
): Map<string, string> {
  const latest = new Map<string, string>();
  for (const r of sent) {
    if (!r.thread_id || !r.received_at) continue;
    const cur = latest.get(r.thread_id);
    if (!cur || r.received_at > cur) latest.set(r.thread_id, r.received_at);
  }
  return latest; // thread_id -> latest sent timestamp
}
