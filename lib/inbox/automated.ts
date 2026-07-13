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
    'support+', 'updates', 'newsletter', 'news', 'digest',
  ];
  if (addrPatterns.some((p) => localpart.includes(p))) return true;
  if (/(^|[.@])(no-?reply|donotreply|notifications?|mailer|bounce|postmaster)([.@])/.test(email)) return true;
  const text = `${(fromName || '').toLowerCase()} ${(subject || '').toLowerCase()}`;
  const phrasePatterns = [
    'payment failed', 'payment unsuccessful', 'payment declined', 'account suspended', 'account suspension',
    'account restricted', 'account has been', 'your subscription', 'subscription renew', 'prepaid billing',
    'verify your', 'confirm your email', 'confirm your account', 'security alert', 'security notice',
    'security vulnerabilit', 'alerta de segurança', 'unusual sign', 'sign-in attempt', 'password reset',
    'invoice is', 'your receipt', 'order confirmation', 'vulnerabilities detected',
  ];
  if (phrasePatterns.some((p) => text.includes(p))) return true;
  return false;
}
