// "Needs reply" — a smart signal recombined from the email processor's EXISTING per-email
// signals (no new AI pass). An email needs a reply when a real person asks something of you and
// you haven't answered — never a newsletter, notification, receipt, or automated/FYI message.
//
// The processor already does the hard part: it classifies a "respond via email" state
// (work_prepared = reply/decide/approve) and detects hasDirectQuestion / hasRequestForAction /
// hasExplicitApprovalRequest / isAutomatedSender / isNotification. We were just collapsing all
// of that into work_state and querying the wrong bucket. This helper reads the signals back out.

import { getUnderstanding } from './item-understanding';
import { isCampaignEcho } from './campaign-echo';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SignalItem = { work_state?: string | null; source?: string | null; source_data?: any; user_id?: string | null; type_override?: string | null };

// The decisive signal in practice: a real human sender. The classifier happily files
// "no-reply@booking.com" / "do-not-reply@binance.com" as work_prepared, but you can't reply to
// those. The local-part is a near-perfect tell for transactional/automated mail.
//
// W27 · A ROLE MAILBOX IS NOT A MACHINE (the loss diagnosis): `billing@`, `invoices@`, `payments@`,
// `receipts@` are ROLE mailboxes — a person staffs many of them, and "reply with your IBAN and BIC"
// from billing@ is a real ask. The local-part gate now names only the UNREACHABLE family (nobody reads
// what you send to no-reply@ or mailer-daemon@); a role mailbox is judged by the stronger signals
// below — the ingest's reasoned `isAutomatedSender` / `isNotification`, and the understanding.
const AUTOMATED_SENDER = /^(no-?reply|do-?not-?reply|donotreply|noreply|notifications?|notify|mailer-?daemon|bounce|postmaster|automated|alerts?|newsletter|updates?|mailer)([.\-_+]|@|$)/i;

function fromAddress(item: SignalItem): string {
  const sd = item.source_data ?? {};
  return String(sd.from || sd.from_address || sd.fromEmail || '').toLowerCase();
}

/** W27 · THE GROUP ASK: a one_of_many item is the user's to answer when the producer judged a reply
 *  (or an action) owed by the group — and it is not a list broadcast (bulk mail greets a list, it never
 *  waits on one member's answer). Pure. */
function groupAskIsYours(u: { relevance?: string | null; bulk?: boolean | null; ownership?: string | null }): boolean {
  if (u.bulk === true) return false;
  if (u.ownership === 'none' || u.ownership === 'awaiting') return false;
  return u.relevance === 'reply' || u.relevance === 'action';
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
    // Reasoned judgment wins. A bystander, or anything judged awareness, is not the user's to answer.
    // W27 · A GROUP ASK IS STILL YOURS: `one_of_many` + reply/action means the producer judged the ask
    // aimed at the group the user is in ("could each of you reply…" — computeUnderstanding's own
    // contract: one_of_many with NO ask aimed at the user is awareness). The consumer honours it.
    if (u.role === 'bystander') return true;
    if (u.relevance === 'awareness') return true;
    if (u.role === 'one_of_many') return !groupAskIsYours(u);
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

  // THE ECHO FLOOR (LAW 5 — proactive-reach), consulted exactly where the automated-sender gate is:
  // a reply into the user's OWN outbound sequence is not a reply they owe. Derived per user from
  // their own sent corpus — nothing here names a vendor, token or language. The user's own
  // `type_override` short-circuits inside `isCampaignEcho` (authoritative beats the refiner), and
  // with no signature derived the check is inert.
  if (isCampaignEcho(item)) return false;

  // PRIMARY signal: the unified understanding. When present it is the decider for whether the reply
  // is yours — reasoned over the real recipients, so it correctly demotes a group "Dear Team" To (you
  // in the To but one of many) to awareness, and correctly keeps a directly-addressed ask as a reply.
  const u = getUnderstanding(item);
  if (u) {
    // A bystander / awareness item is not your reply (visible as FYI, never hidden).
    if (u.role === 'bystander' || u.relevance === 'awareness') return false;
    // W27 · one_of_many is yours only when the group ask is (see groupAskIsYours); a broadcast is not.
    if (u.role === 'one_of_many') return groupAskIsYours(u);
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
