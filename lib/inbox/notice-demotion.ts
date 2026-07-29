// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE OWNERSHIP-KEYED NOTICE LAW (H4, extracted for J1 — ONE helper, never re-implemented).
// A notice NOBODY owes a move on is not a task, whatever an AI rule guessed. Verified on real data:
// junk (portal responses, calendar acceptances) = ownership 'none' + a structural notice shape;
// real obligations (bank/tax alerts) = ownership 'you_owe' — protected by the same key,
// language-proof (no keyword list decides an obligation). Legacy items with NO understanding fall
// to the structural floor (automated sender + not action-worthy).
// Consumers: the Home brief route (both paths) + judgeWork's structural floor.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { ItemUnderstanding } from '@/lib/inbox/item-understanding';

/** The strong "do not reply to this mailbox" sender read (moved verbatim from the brief route —
 *  broader than lib/inbox/automated's, tuned for the Home's demotion decisions). */
export function isAutomatedSenderStrong(fromEmail: string | null, fromName: string | null, subject: string | null): boolean {
  const email = (fromEmail || '').toLowerCase();
  const localpart = email.split('@')[0] || '';
  const addrPatterns = [
    'no-reply', 'noreply', 'no_reply', 'donotreply', 'do-not-reply', 'do_not_reply',
    'notifications', 'notification', 'notify', 'mailer', 'mailer-daemon', 'bounce', 'bounces',
    'postmaster', 'automated', 'auto-confirm', 'alerts', 'alert', 'billing', 'invoices', 'receipts',
    'support+', 'updates', 'newsletter', 'news', 'digest', 'payments', 'failed-payment',
  ];
  if (addrPatterns.some((p) => localpart.includes(p))) return true;
  if (/(^|[.@])(no-?reply|donotreply|notifications?|mailer|bounce|postmaster)([.@])/.test(email)) return true;
  const text = `${(fromName || '').toLowerCase()} ${(subject || '').toLowerCase()}`;
  const phrasePatterns = [
    'payment failed', 'payment unsuccessful', 'was unsuccessful', 'payment declined', 'account suspended',
    'account restricted', 'account has been', 'your subscription', 'subscription renew',
    'verify your', 'confirm your email', 'confirm your account', 'security alert', 'security notice',
    'unusual sign', 'sign-in attempt', 'password reset', 'invoice is', 'your receipt', 'order confirmation',
  ];
  if (phrasePatterns.some((p) => text.includes(p))) return true;
  return false;
}

/** "Can't reply" ≠ "no action needed" — the dunning/suspension/security/expiry class that must
 *  surface as an ACTION even from an automated sender (moved verbatim from the brief route). */
export function isActionWorthyAutomated(workState: string | null, fromName: string | null, subject: string | null): boolean {
  if (workState === 'action_required' || workState === 'decision_required') return true;
  const text = `${(fromName || '').toLowerCase()} ${(subject || '').toLowerCase()}`;
  const actionPhrases = [
    'payment failed', 'payment unsuccessful', 'payment declined', 'payment could not',
    'account suspended', 'account restricted', 'account limited', 'account locked', 'account disabled',
    'account has been suspended', 'has been restricted', 'has been limited', 'has been locked',
    'security alert', 'security notice', 'unusual sign', 'suspicious', 'verify your', 'confirm your account',
    'action required', 'action needed', 'immediate action', 'expiring', 'expires', 'will expire',
    'storage is full', 'storage full', 'past due', 'overdue', 'update your payment', 'billing problem',
  ];
  return actionPhrases.some((p) => text.includes(p));
}

/** THE LAW: is this a no-move notice (nobody owes anything on it)? The caller applies its own
 *  authoritative-override guard (the user's explicit type_override) around this core.
 *
 *  THREE tiers, most-reasoned first:
 *  1. FULL understanding → the ownership key decides (a bank alert with ownership 'you_owe' is
 *     protected; a portal notice with 'none' demotes) — language-proof.
 *  2. KIND-ONLY understanding (the backfill class — a REASONED mailKind judged from content, but
 *     no role/relevance so coercion nulls it) → the kind itself is the brain's verdict that this
 *     is bulk/automated mail; demote unless the action-worthy re-posture protects it. This is the
 *     reasoned signal REPLACING the sender-pattern heuristic — the portal-notice class (an info@ sender the
 *     patterns miss, kind says notification, Clara must never draft for it).
 *  3. NO understanding at all → the legacy structural floor (sender patterns + action-worthy).
 *
 *  `rawKind` = the UNCOERCED understanding.mailKind (callers read it off source_data directly —
 *  kind is kind regardless of whether the rest of the understanding exists). */
export function isNoMoveNotice(args: {
  u: ItemUnderstanding | null;
  rawKind?: string | null;
  fromEmail: string | null; fromName: string | null; subject: string | null;
  workState: string | null;
}): boolean {
  const { u, rawKind, fromEmail, fromName, subject, workState } = args;
  const auto = isAutomatedSenderStrong(fromEmail, fromName, subject);
  const kind = (u?.mailKind ?? rawKind ?? '').toLowerCase();
  const noticeKind = kind === 'notification' || kind === 'calendar' || kind === 'receipt' || kind === 'newsletter';
  const structuralNotice = auto || noticeKind;
  return (
    (!!u && u.ownership === 'none' && structuralNotice)
    || (!u && structuralNotice && !isActionWorthyAutomated(workState, fromName, subject))
  );
}

/** The raw mailKind straight off source_data — usable even when the full understanding fails
 *  coercion (the kind-only backfill class). ONE reader, so callers never re-derive. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rawMailKindOf(sd: any): string | null {
  const mk = sd?.understanding?.mailKind;
  return typeof mk === 'string' && mk ? mk.toLowerCase() : null;
}
