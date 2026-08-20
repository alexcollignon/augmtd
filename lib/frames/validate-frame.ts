// ─── THE LOCKED FRAME — the no-egress validator (frames plan, law 2 + law 8) ─────────────────
// A frame is ONE self-contained HTML file: data inlined, charts inlined, ZERO egress. This is
// the floor that decides whether a generation is ALLOWED to become an artifact — the sibling of
// the document compiler's render-verification gate. It is deliberately blunt and aggressive:
// a false reject costs one repair pass; a false accept is a data-exfiltration hole in a file we
// hand to a sandboxed iframe and, later, to a share link.
//
// Pure, dependency-free, table-testable: string surgery only (no DOM library — a parser here
// would be a second opinion about what the HTML means, and law 2 forbids two opinions).
//
// ALL reasons are collected, never first-only: the repair pass feeds them back verbatim, and a
// model that fixes one hole per round trip never converges.

export const FRAME_CSP_META =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:;">`;

/** 1.5MB — a frame is data + layout, not a media bundle. */
export const FRAME_MAX_BYTES = 1_500_000;

export type FrameValidation =
  | { ok: true; html: string }
  | { ok: false; reasons: string[] };

type Check = { re: RegExp; reason: string };

// Every check is case-insensitive and whitespace-tolerant. Attribute matching allows
// `src = "…"`, `src='…'`, and bare `src=…`.
const ATTR = String.raw`(?:src|href|action|formaction|ping|poster|srcset|xlink:href)\s*=\s*["']?\s*`;
const EXTERNAL = String.raw`(?:https?:|wss?:|\/\/)`;

const CHECKS: Check[] = [
  // ── EGRESS: any external URL in a loading/navigating attribute. data:, #fragment, mailto:
  // and relative paths are fine (nothing leaves the sandbox for them).
  { re: new RegExp(ATTR + EXTERNAL, 'i'),
    reason: 'An external URL appears in a src/href/action/poster/srcset attribute. A frame must be fully self-contained: inline every asset as a data: URI, and use no http/https/protocol-relative URLs anywhere.' },
  // CSS-side egress (background images, @font-face) — the same hole through a different door.
  { re: new RegExp(String.raw`url\(\s*["']?\s*` + EXTERNAL, 'i'),
    reason: 'A CSS url() points at an external address. Inline images/fonts as data: URIs or drop them.' },
  { re: /@import\s+(?:url\()?\s*["']?\s*(?:https?:|\/\/)/i,
    reason: 'A CSS @import loads an external stylesheet. All styles must be inline.' },

  // ── EXTERNAL DOCUMENT MACHINERY ──
  // <base> would silently re-point every RELATIVE url (which the attribute check allows) at an
  // external origin — the one tag that turns "passes" into "leaks" retroactively.
  { re: /<base\b/i,
    reason: 'A <base> tag is present. A frame never re-points its URLs — remove it.' },
  { re: /<link\b/i,
    reason: 'A <link> tag is present. A frame carries no external stylesheets, fonts, or preloads — put every style in an inline <style> block.' },
  { re: /<(?:iframe|frame|frameset|object|embed)\b/i,
    reason: 'An <iframe>/<frame>/<object>/<embed> is present. A frame may not embed another document.' },
  { re: /<meta[^>]+http-equiv\s*=\s*["']?\s*refresh/i,
    reason: 'A <meta http-equiv="refresh"> is present. A frame never navigates or reloads itself.' },
  { re: /<form\b[^>]*\baction\s*=/i,
    reason: 'A <form> carries an action attribute. Controls must be handled in inline script over the inlined data — never submitted anywhere.' },

  // ── NETWORK APIS IN SCRIPT ──
  { re: /\bfetch\s*\(/i, reason: 'Script calls fetch(). A frame makes zero network requests — all of its data is already inlined.' },
  { re: /\bXMLHttpRequest\b/i, reason: 'Script references XMLHttpRequest. A frame makes zero network requests.' },
  { re: /\bWebSocket\b/i, reason: 'Script references WebSocket. A frame makes zero network requests.' },
  { re: /\bEventSource\b/i, reason: 'Script references EventSource. A frame makes zero network requests.' },
  { re: /\bnavigator\s*\.\s*sendBeacon\b/i, reason: 'Script calls navigator.sendBeacon. A frame sends nothing out.' },
  { re: /\bimport\s*\(/i, reason: 'Script uses a dynamic import(). A frame loads no modules — inline every helper.' },
  { re: /(?:^|[\n;{])\s*import\s+[^(\n]/i, reason: 'Script uses an ES import statement. A frame loads no modules — inline every helper.' },

  // ── NAVIGATION (assignment only; reading location is harmless) ──
  // (?<![\w.-]) keeps `data-location="…"` and `myLocation` out of the net; reading location is fine.
  { re: /(?:(?:window|document|self|top|parent)\s*\.\s*location|(?<![\w.-])location)\s*(?:\.\s*href\s*)?=(?!=)/i,
    reason: 'Script assigns to location/location.href. A frame never navigates.' },
  { re: /(?:(?:window|document|self|top|parent)\s*\.\s*location|(?<![\w.-])location)\s*\.\s*(?:replace|assign)\s*\(/i,
    reason: 'Script calls location.replace()/location.assign(). A frame never navigates.' },
  { re: /\bwindow\s*\.\s*open\s*\(/i, reason: 'Script calls window.open(). A frame never opens a window.' },
];

export function validateFrameHtml(html: string): FrameValidation {
  const reasons: string[] = [];
  const src = typeof html === 'string' ? html : '';

  if (!src.trim()) return { ok: false, reasons: ['The frame is empty — no HTML was produced.'] };
  if (Buffer.byteLength(src, 'utf8') > FRAME_MAX_BYTES) {
    reasons.push(`The frame is larger than ${Math.round(FRAME_MAX_BYTES / 1000)}KB. Inline less raw data (aggregate, or show the top rows) and keep the markup lean.`);
  }
  if (!/<html\b/i.test(src) || !/<\/html\s*>/i.test(src)) {
    reasons.push('The output is not one complete HTML document — it must open with <html> and close with </html>, with nothing outside it.');
  }
  for (const c of CHECKS) if (c.re.test(src)) reasons.push(c.reason);

  if (reasons.length) return { ok: false, reasons: [...new Set(reasons)] };
  return { ok: true, html: injectCsp(src) };
}

/** Idempotently place our no-egress CSP as the first child of <head> (creating <head> if the
 *  document has none). The meta is a belt on top of the sandboxed iframe's braces. */
export function injectCsp(html: string): string {
  if (/http-equiv\s*=\s*["']?\s*Content-Security-Policy/i.test(html)) return html;

  const head = html.match(/<head\b[^>]*>/i);
  if (head) {
    const at = head.index! + head[0].length;
    return html.slice(0, at) + '\n' + FRAME_CSP_META + html.slice(at);
  }
  const htmlTag = html.match(/<html\b[^>]*>/i);
  if (htmlTag) {
    const at = htmlTag.index! + htmlTag[0].length;
    return html.slice(0, at) + `\n<head>\n${FRAME_CSP_META}\n</head>` + html.slice(at);
  }
  return `<head>\n${FRAME_CSP_META}\n</head>\n` + html;
}
