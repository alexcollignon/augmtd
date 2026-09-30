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

// ── W27 · THE QUOTED SENTENCE (the agnostic clause — found by the eval). The stem test above compares
// the obligation's words with the message's, so it only works when both are in ONE language and the
// message NAMES the deed: "Envio tudo até 2026-10-01", "vous parviendra le 2026-10-02", "schicke ich
// es bis 2026-10-03" — a correct re-date in PT/FR/DE — were always dropped (the deed is an English
// title; the sentence says "tudo"/"it"). The second path is language-agnostic and keeps the floor's
// asymmetry: THE MODEL PROPOSES A QUOTE, CODE DISPOSES. The judge names the one sentence that states
// the new date for the thing owed, verbatim; code accepts it only when (1) the quote really stands in
// the message, (2) the quote itself states the date, and (3) the quote carries no clock time — a
// sentence with a time of day is a meeting line ("catch up Oct 12 at 9:30"), the exact incident this
// floor exists for; a deadline with a clock time simply keeps its old date (no re-date is the safe
// direction).
/** A time of day in any common mail form ("9:30", "14h", "9h30", "3pm", "10 Uhr") — never a numeric
 *  date ("01.10." is the first of October, not 01:10). */
const CLOCK_TIME = /(?<![\d.])\d{1,2}(?::[0-5]\d|h(?:[0-5]\d)?\b|\s?(?:am\b|pm\b|a\.m\.|p\.m\.)|\s?uhr\b)/i;
const foldSpan = (s: string) => fold(String(s ?? '')).replace(/[“”«»"']/g, '').replace(/\s+/g, ' ').trim();

/** Does the message state `iso` in a sentence about THIS deed? The re-date floor.
 *  `opts.quote` — the judge's verbatim sentence for the new date (the agnostic path above). */
export function deedScopedDate(text: string, iso: string, deed: string, opts: { quote?: string | null } = {}): boolean {
  const terms = keyTerms(deed);
  const byStem = terms.length > 0 && sentencesOf(text).some((s) => {
    if (!dateStatedInText(s, iso)) return false;
    const words = keyTerms(s);
    return terms.some((t) => words.some((w) => sameStem(t, w)));
  });
  if (byStem) return true;
  return quotedSentenceStatesDate(text, iso, opts.quote);
}

/** THE QUOTED-SENTENCE PATH (W27), exported for its gate. Pure. */
export function quotedSentenceStatesDate(text: string, iso: string, quote: string | null | undefined): boolean {
  const q = foldSpan(String(quote ?? '').replace(/^["'“”«»]+|["'“”«»]+$/g, ''));
  if (q.length < 6 || q.length > 300) return false;
  if (!foldSpan(text).includes(q)) return false;                 // (1) verbatim in the message
  if (!dateStatedInText(String(quote), iso)) return false;       // (2) the quote states THIS date
  if (CLOCK_TIME.test(String(quote))) return false;               // (3) a time of day = a meeting line
  return true;
}
