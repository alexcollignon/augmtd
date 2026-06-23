// "Needs reply" — a smart signal recombined from the email processor's EXISTING per-email
// signals (no new AI pass). An email needs a reply when a real person asks something of you and
// you haven't answered — never a newsletter, notification, receipt, or automated/FYI message.
//
// The processor already does the hard part: it classifies a "respond via email" state
// (work_prepared = reply/decide/approve) and detects hasDirectQuestion / hasRequestForAction /
// hasExplicitApprovalRequest / isAutomatedSender / isNotification. We were just collapsing all
// of that into work_state and querying the wrong bucket. This helper reads the signals back out.

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

export function isNeedsReply(item: SignalItem): boolean {
  const s = (item.source_data?.signals ?? {}) as Record<string, unknown>;

  // Hard gate: a real person must have sent it. Catches the junk the classifier mislabels.
  const from = fromAddress(item);
  const local = from.includes('@') ? from.split('@')[0] : from;
  if (AUTOMATED_SENDER.test(local) || s.isAutomatedSender || s.isNotification || s.isMechanicalConfirmation) return false;

  // Then: the classifier's "respond via email" state, or the email plainly asks something.
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
