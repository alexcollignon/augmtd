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
//
// W27 · A ROLE MAILBOX IS NOT A MACHINE (the loss diagnosis — a staffed `billing@` asking the user
// for their IBAN was floored to "a reply reaches no one"). The address list is split in two:
//   • MACHINE local-parts — nobody reads what is sent there (no-reply, mailer-daemon, bounces, a
//     notifications/newsletter/digest sender): the local-part alone decides.
//   • ROLE local-parts — billing@, invoices@, payments@, receipts@, support+…@: a person staffs many
//     of them, so the local-part is only a HINT. It counts as automated when a STRONGER signal
//     corroborates it: a machine phrase in the name/subject (the phrase list below), or a bulk-sending
//     subdomain (billing@mail.vendor.example). Otherwise the content decides (the reasoned judges).
// Matching is token-bounded now (a pattern must start the local-part or follow a separator): the old
// substring test read "andrews@" as a `news` sender and "valerts" as an alert.
export const AUTOMATED_SENDER_ADDR_PATTERNS: readonly string[] = [
  'no-reply', 'noreply', 'no_reply', 'donotreply', 'do-not-reply', 'do_not_reply', 'naoresponder', 'nao-responder',
  'notifications', 'notification', 'notify', 'mailer', 'mailer-daemon', 'bounce', 'bounces',
  'postmaster', 'automated', 'auto-confirm', 'alerts', 'alert',
  'updates', 'newsletter', 'news', 'digest', 'failed-payment',
];

/** ROLE mailboxes — automated only with corroboration (see above). */
export const ROLE_MAILBOX_PATTERNS: readonly string[] = [
  'billing', 'invoices', 'invoice', 'receipts', 'receipt', 'payments', 'payment', 'support+',
];

/** A bulk-sending subdomain on the address's domain ("@mail.vendor.example", "@em.vendor.example"). */
const SENDING_SUBDOMAIN_RE = /@(?:mail|email|e|em|send|sender|mailer|mg|notify|notifications|news|newsletter|bounce|mkt|marketing)\d*\./;

const escRe = (p: string) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Does the local-part carry `p` as a token — at its start, or right after a separator? */
export function localPartHas(localpart: string, p: string): boolean {
  if (p.endsWith('+')) return localpart.startsWith(p);
  return new RegExp(`(?:^|[.\\-_+])${escRe(p)}`).test(localpart);
}

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
  if (AUTOMATED_SENDER_ADDR_PATTERNS.some((p) => localPartHas(localpart, p))) return true;
  if (AUTOMATED_SENDER_BOUNDARY_RE.test(email)) return true;
  const text = `${(fromName || '').toLowerCase()} ${(subject || '').toLowerCase()}`;
  if (AUTOMATED_SENDER_PHRASE_PATTERNS.some((p) => text.includes(p))) return true;
  // A ROLE mailbox needs a stronger signal than its own name (W27): a bulk-sending subdomain.
  if (ROLE_MAILBOX_PATTERNS.some((p) => localPartHas(localpart, p)) && SENDING_SUBDOMAIN_RE.test(email)) return true;
  return false;
}
