// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SOURCE CARD'S OWN WORDS (stabilization W15.1 · ONE THREAD COMPONENT) — pure, client-safe.
//
// Owner walk (Sep 24): the thread card on the item page read LONG and strange — quoted history,
// blank-line runs, "On Thu … wrote:" tails, signature blocks. A card is a GLANCE at a message; the
// full conversation is one click away ("Open thread"). So every body the one source card prints
// passes through `ownWords` here, for every host (email threads, a commitment's own source message,
// the triage evidence, a forward's folded object, a project room's opening) — never a per-host
// cleaner.
//
// STRUCTURAL, NEVER A CONTENT GUESS: the reply-history cut is the house's one parser
// (lib/inbox/top-message.ts `topMessageOf`); on top of it this adds only what a DISPLAY needs and a
// judge does not:
//   · the attribution tail when a mail client WRAPPED it over two lines ("On Thu, … Sam <" /
//     "sam@acme.test> wrote:"), and a short top that the judge-side floor keeps whole;
//   · the signature block — the RFC "-- " delimiter, mobile footers, and a closing line
//     ("Best regards," · "Cumprimentos," · "Viele Grüße" · "Cordialement") with only a short
//     block of name/title/phone lines beneath it;
//   · blank-line runs collapsed to one blank line.
// CONSERVATIVE: a cut that would leave nothing keeps the text it had — a card with the message is
// better than a card with a hole. The render floor (displayText — EXCERPT_MARK never renders) is
// applied at the render site, not here.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { topMessageOf } from '@/lib/inbox/top-message';

/** THE ONE DOOR LABEL — every source/thread card's door to the conversation reads exactly this. */
export const OPEN_THREAD_LABEL = 'Open thread';

/** The card never grows past this (px); its loading skeleton stands at exactly this height, so a
 *  host's actions below it are never pushed off screen by a long message. */
export const SOURCE_CARD_MAX_PX = 232;

// Attribution lines — the one-line forms topMessageOf knows, plus the two-line WRAPPED forms a
// mail client emits for a long sender (EN · PT · DE · FR). Anchored at a line start.
const ATTRIBUTION: RegExp[] = [
  /^On [^\n]{4,160}(?:\n[^\n]{0,120})?\b(?:wrote|writes)\s?:\s*$/im,
  /^(?:No dia|Em) [^\n]{4,160}(?:\n[^\n]{0,120})?\bescreveu\s?:\s*$/im,
  /^Am [^\n]{4,160}(?:\n[^\n]{0,120})?\bschrieb[^\n]{0,60}:\s*$/im,
  /^Le [^\n]{4,160}(?:\n[^\n]{0,120})?\ba écrit\s?:\s*$/im,
  /^-{2,}\s*(?:Original Message|Forwarded message|Mensagem original|Ursprüngliche Nachricht|Message d'origine)\s*-{2,}\s*$/im,
  // Outlook / Apple inline header blocks and the Outlook divider (EN · PT/ES · DE · FR).
  /^_{10,}\s*$/m,
  /^From:\s[^\n]+\n(?:Sent|Date):\s[^\n]+$/im,
  /^De:\s[^\n]+\n(?:Enviad[oa]|Data|Envoyé|Date)\s?:\s?[^\n]+$/im,
  /^Von:\s[^\n]+\n(?:Gesendet|Datum):\s[^\n]+$/im,
];

// Mobile/app footers — a line that is ONLY the footer.
const FOOTER = /^(?:Sent from my [^\n]{1,40}|Get Outlook for [^\n]{1,30}|Enviado do meu [^\n]{1,40}|Enviado desde mi [^\n]{1,40}|Von meinem [^\n]{1,40} gesendet|Envoyé de mon [^\n]{1,40})\s*$/im;

// Closing lines — a line that is ONLY a sign-off (optionally followed by a comma/stop).
const CLOSING = /^(?:best(?: regards| wishes)?|kind regards|warm regards|regards|many thanks|thanks(?: again)?|thank you|cheers|all the best|atenciosamente|cumprimentos|melhores cumprimentos|com os melhores cumprimentos|obrigad[oa]|abraços?|beijinhos|mit freundlichen grüßen|freundliche grüße|viele grüße|beste grüße|liebe grüße|lg|cordialement|bien cordialement|bien à vous|salutations|merci(?: beaucoup)?|bonne journée)\s*[,.!]?\s*$/i;

/** The block under a closing line reads as a signature: few lines, each short. */
const SIG_MAX_LINES = 8;
const SIG_MAX_LINE = 90;

function cutAt(text: string, index: number): string {
  const kept = text.slice(0, index).trim();
  return kept ? kept : text;
}

/** Remove a trailing signature block (delimiter · footer · closing + short block). */
export function stripSignature(text: string): string {
  let t = String(text ?? '');
  // The RFC delimiter "-- " (or "--") on its own line: everything below is signature.
  const delim = /^--\s?$/m.exec(t);
  if (delim) t = cutAt(t, delim.index);
  const foot = FOOTER.exec(t);
  if (foot) t = cutAt(t, foot.index);
  // The LAST closing line whose remainder is a short block — scan bottom-up so a "Thanks," that
  // opens a paragraph mid-message is never taken for the sign-off.
  const lines = t.split('\n');
  for (let i = lines.length - 1; i > 0; i--) {
    if (!CLOSING.test(lines[i].trim())) continue;
    const rest = lines.slice(i + 1).filter((l) => l.trim());
    if (rest.length <= SIG_MAX_LINES && rest.every((l) => l.trim().length <= SIG_MAX_LINE)) {
      const kept = lines.slice(0, i).join('\n').trim();
      if (kept) t = kept;
    }
    break;
  }
  return t.trim();
}

/** Collapse runs of blank lines (whitespace-only lines included) to ONE blank line. */
export function collapseBlankRuns(text: string): string {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Cut the quoted history: the house parser first, then the wrapped/short forms a card still sees. */
export function stripReplyHistory(text: string): string {
  let t = topMessageOf(String(text ?? ''));
  let cut = t.length;
  for (const re of ATTRIBUTION) {
    const m = re.exec(t);
    if (m && m.index < cut) cut = m.index;
  }
  // A run of ≥2 ">"-quoted lines.
  const q = /(?:^|\n)((?:>[^\n]*(?:\n|$)){2,})/.exec(t);
  if (q && q.index < cut) cut = q.index;
  if (cut < t.length) t = cutAt(t, cut);
  return t;
}

/** THE MESSAGE'S OWN WORDS, as a card prints them. */
export function ownWords(body: string | null | undefined): string {
  const raw = String(body ?? '');
  if (!raw.trim()) return '';
  return collapseBlankRuns(stripSignature(collapseBlankRuns(stripReplyHistory(raw))));
}

/** The first line of a message's own words — an older message's one-line row. */
export function firstLine(body: string | null | undefined): string {
  const own = ownWords(body);
  const line = own.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return line;
}
