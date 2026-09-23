// lib/core/senders.ts — THE ONE AUTOMATED-SENDER PATTERN LIST (W1.6 SHARED PRIMITIVES).
//
// `lib/inbox/automated.ts` (isAutomatedSender) and `lib/inbox/notice-demotion.ts`
// (isAutomatedSenderStrong) carried BOTH COPIES of this pattern list verbatim (CLAUDE.md: "the
// automated-sender patterns duplicated verbatim ... BOTH copies"). They had drifted apart:
// automated.ts had accumulated extra entries (`naoresponder`/`nao-responder` in the address list;
// `account suspension`, `prepaid billing`, `security vulnerabilit`, `alerta de segurança`,
// `vulnerabilities detected` in the phrase list) that notice-demotion.ts never received. Since the
// two were always meant to be the SAME list (both copies, by design), the union below is the
// canonical set — a real widening of `isAutomatedSenderStrong`'s detection, called out here and in
// the stabilization report rather than silently folded in.
export const AUTOMATED_SENDER_ADDR_PATTERNS: readonly string[] = [
  'no-reply', 'noreply', 'no_reply', 'donotreply', 'do-not-reply', 'do_not_reply', 'naoresponder', 'nao-responder',
  'notifications', 'notification', 'notify', 'mailer', 'mailer-daemon', 'bounce', 'bounces',
  'postmaster', 'automated', 'auto-confirm', 'alerts', 'alert', 'billing', 'invoices', 'receipts',
  'support+', 'updates', 'newsletter', 'news', 'digest', 'payments', 'failed-payment',
];

export const AUTOMATED_SENDER_PHRASE_PATTERNS: readonly string[] = [
  // dunning phrasings vary ("payment to X was unsuccessful") — match the verb forms, not one exact bigram
  'payment failed', 'payment unsuccessful', 'was unsuccessful', 'payment declined', 'account suspended', 'account suspension',
  'account restricted', 'account has been', 'your subscription', 'subscription renew', 'prepaid billing',
  'verify your', 'confirm your email', 'confirm your account', 'security alert', 'security notice',
  'security vulnerabilit', 'alerta de segurança', 'unusual sign', 'sign-in attempt', 'password reset',
  'invoice is', 'your receipt', 'order confirmation', 'vulnerabilities detected',
];

/** The address-shape + address-then-boundary regex both call sites ran inline. */
export const AUTOMATED_SENDER_BOUNDARY_RE = /(^|[.@])(no-?reply|donotreply|notifications?|mailer|bounce|postmaster)([.@])/;

/** Shared core: does this from-address/name/subject look like an automated/no-reply sender?
 *  Both `lib/inbox/automated.ts` and `lib/inbox/notice-demotion.ts` build their exported function
 *  on top of this same test — see the note above about the historical drift between the two. */
export function matchesAutomatedSenderPatterns(fromEmail: string | null, fromName: string | null, subject: string | null): boolean {
  const email = (fromEmail || '').toLowerCase();
  const localpart = email.split('@')[0] || '';
  if (AUTOMATED_SENDER_ADDR_PATTERNS.some((p) => localpart.includes(p))) return true;
  if (AUTOMATED_SENDER_BOUNDARY_RE.test(email)) return true;
  const text = `${(fromName || '').toLowerCase()} ${(subject || '').toLowerCase()}`;
  if (AUTOMATED_SENDER_PHRASE_PATTERNS.some((p) => text.includes(p))) return true;
  return false;
}
