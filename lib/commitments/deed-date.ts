// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DEED-SCOPED DATE (W20 · invariant 14 TIME TRUTH). Pure, zero AI, client-safe.
//
// A `promised` fulfillment verdict may re-date an open commitment only to a date the message states
// FOR THAT DEED. The case that made the law: the counterparty's reply scheduled a call for Oct 12,
// and the "send the signed offer" commitment was re-dated to Oct 12 — a meeting date elsewhere in the
// message is not a deadline for the offer. The check: some sentence of the message that states the
// date (`dateStatedInText`) also names the deed — shares a key term with the obligation's own words
// (a 4-letter stem, so "signed"/"sign", "offer"/"offers" meet). No such sentence → no re-date.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { dateStatedInText } from '@/lib/utils/user-time';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Words that carry no deed of their own: function words and the generic hand-over verbs every
// obligation shares ("send", "share", "get back"). A date beside "I'll send an invite" must not
// count as the date for "send the signed offer".
const GENERIC = new Set([
  'the', 'and', 'for', 'with', 'from', 'about', 'into', 'over', 'this', 'that', 'them', 'their', 'your',
  'will', 'would', 'should', 'need', 'needs', 'please', 'have', 'been', 'back', 'also', 'just',
  'send', 'sent', 'share', 'provide', 'deliver', 'return', 'give', 'make', 'reply', 'respond', 'follow',
  'get', 'take', 'confirm', 'update', 'updates', 'let', 'know', 'check',
]);
const keyTerms = (s: string): string[] =>
  [...new Set(fold(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
    .filter((t) => t.length >= 4 && !/^\d+$/.test(t) && !GENERIC.has(t)))];
const sameStem = (a: string, b: string) => a.slice(0, 4) === b.slice(0, 4);

/** The message's sentences (line breaks, and sentence ends before a capital — "Oct. 12" stays whole). */
export function sentencesOf(text: string): string[] {
  return String(text ?? '').split(/\n+|(?<=[.!?])\s+(?=\p{Lu})/u).map((s) => s.trim()).filter(Boolean);
}

/** Does the message state `iso` in a sentence about THIS deed? The re-date floor. */
export function deedScopedDate(text: string, iso: string, deed: string): boolean {
  const terms = keyTerms(deed);
  if (!terms.length) return false; // a deed with no key term cannot be matched — no re-date
  return sentencesOf(text).some((s) => {
    if (!dateStatedInText(s, iso)) return false;
    const words = keyTerms(s);
    return terms.some((t) => words.some((w) => sameStem(t, w)));
  });
}
