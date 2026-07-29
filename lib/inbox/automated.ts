// Shared "is this an automated / no-reply / transactional sender" signal — used to keep automated mail
// (security alerts, billing/dunning notices, order/receipt confirmations, notifications) OUT of surfaces
// that should be about REAL human/business work (e.g. project clustering). Mirrors the tight heuristic in
// app/api/home/brief/route.ts (kept intentionally conservative so it never nukes a genuine human reply).

export function isAutomatedSender(fromEmail: string | null, fromName: string | null, subject: string | null): boolean {
  const email = (fromEmail || '').toLowerCase();
  const localpart = email.split('@')[0] || '';
  const addrPatterns = [
    'no-reply', 'noreply', 'no_reply', 'donotreply', 'do-not-reply', 'do_not_reply', 'naoresponder', 'nao-responder',
    'notifications', 'notification', 'notify', 'mailer', 'mailer-daemon', 'bounce', 'bounces',
    'postmaster', 'automated', 'auto-confirm', 'alerts', 'alert', 'billing', 'invoices', 'receipts',
    'support+', 'updates', 'newsletter', 'news', 'digest', 'payments', 'failed-payment',
  ];
  if (addrPatterns.some((p) => localpart.includes(p))) return true;
  if (/(^|[.@])(no-?reply|donotreply|notifications?|mailer|bounce|postmaster)([.@])/.test(email)) return true;
  const text = `${(fromName || '').toLowerCase()} ${(subject || '').toLowerCase()}`;
  const phrasePatterns = [
    // dunning phrasings vary ("payment to X was unsuccessful") — match the verb forms, not one exact bigram
    'payment failed', 'payment unsuccessful', 'was unsuccessful', 'payment declined', 'account suspended', 'account suspension',
    'account restricted', 'account has been', 'your subscription', 'subscription renew', 'prepaid billing',
    'verify your', 'confirm your email', 'confirm your account', 'security alert', 'security notice',
    'security vulnerabilit', 'alerta de segurança', 'unusual sign', 'sign-in attempt', 'password reset',
    'invoice is', 'your receipt', 'order confirmation', 'vulnerabilities detected',
  ];
  if (phrasePatterns.some((p) => text.includes(p))) return true;
  return false;
}

/** Automated check for a RAW who-string ("Name <email>", a bare address, a bounce token) — the
 *  work-items spine's blockedOn guard. Extends isAutomatedSender with the address shapes that only
 *  show up in raw strings: bounce/relay subdomains (@mail. / @send.) and machine-hex localparts
 *  (SES-style bounce addresses). One module owns "is this a machine?" — never a private regex. */
export function isAutomatedWho(who: string | null | undefined): boolean {
  if (!who) return false;
  if (/no-?reply|bounce|notif|mailer-daemon|donotreply|@mail\.|@send\.|^[0-9a-f]{12,}[-@]/i.test(who)) return true;
  const email = who.match(/[^\s<>"]+@[^\s<>"]+/)?.[0] ?? null;
  return isAutomatedSender(email, who, null);
}

/** Calendar-SYSTEM email subjects (invite created/updated/cancelled, RSVP replies) — the literal
 *  multi-language strings providers auto-generate. Used to keep acceptance/invite noise out of
 *  curated surfaces (rail sibling chips, thread subtitles). */
export function isCalendarSystemSubject(subject: string | null | undefined): boolean {
  const s = (subject || '').trim();
  if (!s) return false;
  return /^(convite atualizado|invitation updated|updated invitation|updated:|canceled event|cancelled event|canceled:|cancelled:|convite cancelado|convite:|invitation:|invite:|accepted:|declined:|tentative:|aceito:|aceite:|acceptée\s*:|refusée\s*:|recusado:|talvez:|einladung|aktualisierte einladung|abgesagt:)/i.test(s);
}
