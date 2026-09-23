// Shared "is this an automated / no-reply / transactional sender" signal — used to keep automated mail
// (security alerts, billing/dunning notices, order/receipt confirmations, notifications) OUT of surfaces
// that should be about REAL human/business work (e.g. project clustering). Mirrors the tight heuristic in
// app/api/home/brief/route.ts (kept intentionally conservative so it never nukes a genuine human reply).
//
// The pattern lists live in lib/core/senders.ts — ONE list, shared with notice-demotion.ts's
// isAutomatedSenderStrong (CLAUDE.md: "BOTH copies"; they had drifted apart before this consolidation).
import { matchesAutomatedSenderPatterns } from '@/lib/core/senders';

export function isAutomatedSender(fromEmail: string | null, fromName: string | null, subject: string | null): boolean {
  return matchesAutomatedSenderPatterns(fromEmail, fromName, subject);
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
