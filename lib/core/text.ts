// lib/core/text.ts — THE ONE HTML-ENTITY DECODER for plain-text excerpts (W5b, Sep 23).
//
// Owner walk (/home?view=held): a triage card read "…bot tried to join "Team Catch Up" but
// wasn&#39;t admitted." Provider SNIPPETS arrive HTML-escaped (Gmail's `snippet` is escaped text, and
// several sync paths store it as the body when a message has no text/plain part), and every
// surface that shows a plain excerpt rendered the escape sequence as literal text. Five partial
// decoders already existed (each handling two or three named entities), so the same escape leaked
// wherever a surface used a different one — or none.
//
// This is the decoder every PLAIN-TEXT excerpt seam calls (the held ledger's row facts, the thread
// door's tail, the deck card's founding line, the thread door's subject). React escapes on render,
// so decoding to plain characters here can never become markup: the output is text, not HTML.
//
// ONE PASS, never recursive: "&amp;lt;" decodes to the literal "&lt;" (what the author typed), never
// on to "<". Unknown named entities are left as written — a guess is worse than the raw token.
// Pure, zero IO, client-safe.

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™',
  euro: '€', pound: '£', yen: '¥', cent: '¢', deg: '°', times: '×', shy: '',
  zwnj: '', zwj: '', thinsp: ' ', ensp: ' ', emsp: ' ',
};

const ENTITY_RE = /&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g;

/** Decode HTML character references in PLAIN text — numeric (decimal + hex) and the common named
 *  set. Single pass. Invalid code points and unknown names are left untouched. */
export function decodeEntities(s: string | null | undefined): string {
  const text = String(s ?? '');
  if (!text.includes('&')) return text;
  return text.replace(ENTITY_RE, (whole, ref: string) => {
    if (ref[0] === '#') {
      const hex = ref[1] === 'x' || ref[1] === 'X';
      const cp = parseInt(ref.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return whole;
      try { return String.fromCodePoint(cp); } catch { return whole; }
    }
    const named = NAMED[ref] ?? NAMED[ref.toLowerCase()];
    return named === undefined ? whole : named;
  });
}
