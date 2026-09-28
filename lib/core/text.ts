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
  szlig: 'ß', aelig: 'æ', AElig: 'Æ', oelig: 'œ', OElig: 'Œ', eth: 'ð', ETH: 'Ð', thorn: 'þ', THORN: 'Þ',
  iexcl: '¡', iquest: '¿', ordf: 'ª', ordm: 'º', sect: '§', para: '¶', frac12: '½', frac14: '¼', frac34: '¾',
  ...latinAccents(),
};

/** W18 walk (an invoice mail rendered "Ol&aacute;"): the accented Latin letters, by structure —
 *  base letter + accent name → the composed character (e.g. aacute → á, Ccedil → Ç). */
function latinAccents(): Record<string, string> {
  const MARKS: Record<string, [string, string]> = {
    acute: ['́', 'aeiouyAEIOUY'], grave: ['̀', 'aeiouAEIOU'], circ: ['̂', 'aeiouAEIOU'],
    tilde: ['̃', 'anoANO'], uml: ['̈', 'aeiouyAEIOUY'], cedil: ['̧', 'cC'], ring: ['̊', 'aA'],
  };
  const out: Record<string, string> = { oslash: 'ø', Oslash: 'Ø' };
  for (const [name, [mark, letters]] of Object.entries(MARKS)) {
    for (const l of letters) out[l + name] = (l + mark).normalize('NFC');
  }
  return out;
}

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

// ── THE ONE HTML → TEXT CONVERTER (W18.B, Sep 25) ───────────────────────────────────────────────
// Owner walk: an invoice mail's text/plain part itself carried the HTML document (the mailer put
// the same markup in both parts), the sync stored it verbatim as `body`, and the thread card showed
// "<html><head><meta…". Six private tag-strippers existed, each slightly different. This is the one
// every body seam calls: the sync parsers (Gmail + Outlook) at write time, the thread route and the
// thread tail at read time (so rows stored before the fix display correctly without a data write),
// and the prompt assemblers that used private copies. Pure, zero IO, client-safe — the thread
// component imports it too.

const HTML_OPENERS = /^\s*(?:<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<meta[\s>]|<!--)/i;
const HTML_TAG = /<\/?(?:html|head|body|div|p|br|table|tbody|tr|td|th|span|a|font|meta|style|img|li|ul|ol|h[1-6]|strong|b|i|em|u|center|blockquote|hr)\b[^<>]*>/gi;

/** Whether a stored "plain" body is really an HTML document/fragment. Structural: it opens like a
 *  document, or carries at least three real tags. A plain mail that mentions one tag stays plain. */
export function looksLikeHtml(s: string | null | undefined): boolean {
  const t = String(s ?? '');
  if (!t.includes('<')) return false;
  if (HTML_OPENERS.test(t)) return true;
  const tags = t.match(HTML_TAG);
  return (tags?.length ?? 0) >= 3;
}

/** HTML → readable plain text. Line structure survives (block ends and <br> become newlines, list
 *  items become "- " lines); head/script/style/comments are dropped whole; entities decode once
 *  (through decodeEntities); runs of blank lines collapse to one. The output is text, never markup. */
export function htmlToText(html: string | null | undefined): string {
  let s = String(html ?? '');
  if (!s) return '';
  s = s
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(head|script|style|noscript|title|xml)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(?:p|div|tr|h[1-6]|table|blockquote|ul|ol|section|article|header|footer)\s*>/gi, '\n')
    .replace(/<(?:p|div|tr|h[1-6]|table|blockquote|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/t[dh]\s*>/gi, ' ')
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s).replace(/ /g, ' ');
  return s
    .split('\n').map((l) => l.replace(/[ \t\f\v]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A body for DISPLAY or a prompt: HTML-carrying text is converted; plain text passes unchanged. */
export function plainBody(s: string | null | undefined): string {
  const t = String(s ?? '');
  return looksLikeHtml(t) ? htmlToText(t) : t;
}
