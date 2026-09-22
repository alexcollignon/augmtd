// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE HEADER FLOOR (Sep 21) — a header value can never carry a line break.
//
// THE CLASS: `Subject: ${subject}` written straight into an RFC822 block (lib/google/gmail.ts) with
// a subject that was only `.trim().slice(0, 300)` on the way in. A CR/LF inside it ENDS the Subject
// header and starts whatever the next line says — `Bcc:` included. Every send door validated its
// recipients and none of them validated the shape of a header, so the guarantee lived nowhere.
//
// THE LAW, at the layer that cannot be forgotten: the TRANSPORTS sanitize every header value they
// build, and the doors sanitize on the way in as well. One of the two would close the hole; both
// make it structural — a new door inherits the floor, and a new transport cannot lose it.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** C0 + DEL + C1 — every control character, not just the two that end a line. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

/** An address as a header may carry it. Deliberately the same shape the send doors validate with. */
const ADDRESS_RE = /^[^\s<>",;:]+@[^\s<>",;:]+\.[a-z]{2,}$/i;
/** `Display Name <someone@example.com>` — the only decorated form we accept. */
const DECORATED_RE = /^(.*?)<([^<>]+)>$/;

/**
 * One header value, safe to write after `Name: `. Control characters (CR/LF included) become
 * spaces rather than disappearing — a subject that was split stays readable as one line instead of
 * silently re-joining two halves into a new word. Capped well under the RFC's 998-octet line limit.
 */
export function sanitizeHeaderValue(value: unknown, maxLen = 400): string {
  return String(value ?? '')
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/**
 * A comma-separated address header (To / Cc / Bcc). Each entry must BE an address — bare, or a
 * display name wrapping one. Anything else is dropped rather than passed through: a string that is
 * not an address has no business in an address header, and one that contains a newline is an
 * injection attempt wearing a recipient's clothes.
 */
export function sanitizeAddressList(value: unknown): string {
  const raw = String(value ?? '').replace(CONTROL_CHARS, ' ');
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const entry = part.replace(/\s+/g, ' ').trim();
    if (!entry) continue;
    const decorated = DECORATED_RE.exec(entry);
    if (decorated) {
      const addr = decorated[2].trim();
      if (!ADDRESS_RE.test(addr)) continue;
      const display = decorated[1].replace(/["<>,;:]/g, '').trim().slice(0, 120);
      out.push(display ? `${display} <${addr}>` : addr);
      continue;
    }
    if (ADDRESS_RE.test(entry)) out.push(entry);
  }
  return [...new Set(out)].join(', ');
}

/** An attachment filename as it appears inside `Content-Disposition` — quotes and control chars out
 *  (a `"` closes the parameter exactly as a CR/LF ends the header). */
export function sanitizeFilename(value: unknown, fallback = 'attachment'): string {
  const clean = String(value ?? '')
    .replace(CONTROL_CHARS, ' ')
    .replace(/["\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  return clean || fallback;
}

/** A MIME type as a header parameter — the grammar is narrow, so anything outside it is refused
 *  rather than cleaned (a mis-typed attachment is better than a forged header). */
export function sanitizeMimeType(value: unknown, fallback = 'application/octet-stream'): string {
  const v = String(value ?? '').trim();
  return /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(v) ? v.slice(0, 120) : fallback;
}
