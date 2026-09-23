// RENDER SAFETY (Sep 22 — stabilization W0.1, invariant 3): model- and user-authored HTML (drafts,
// prepared email bodies, signatures) passes ONE allowlist sanitizer before any render or editor
// mount. A draft carries no remote resources (a remote <img> would fetch — and exfiltrate — at
// render, BEFORE the user approved anything), no event handlers, no forms/frames/meta/base/style.
// Inbound mail does NOT come through here — it renders inert in the sandboxed IframeEmailBody.
// Isomorphic (sanitize-html runs in node and the browser), so the server lane (emailBodyHTML) and
// the client editors share one law.

import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  'p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 'a', 'ul', 'ol', 'li', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'pre', 'code', 'hr', 'img',
];

// A style attribute that can fetch or evaluate is dropped whole (url(), legacy expression(), @import).
const DANGEROUS_STYLE = /url\s*\(|expression\s*\(|@import|javascript:|behavior\s*:|-moz-binding/i;

function build(allowRemoteImages: boolean): sanitizeHtml.IOptions {
  return {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      '*': ['style', 'align', 'dir'],
      // data-sig marks the editors' signature block — inert, kept so a re-seed never doubles it.
      div: ['data-sig'],
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height', 'title'],
      td: ['colspan', 'rowspan', 'valign', 'width'],
      th: ['colspan', 'rowspan', 'valign', 'width'],
      table: ['width', 'cellpadding', 'cellspacing', 'border'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      a: ['http', 'https', 'mailto'],
      img: allowRemoteImages ? ['data', 'cid', 'https'] : ['data', 'cid'],
    },
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: false,
    // Script/style/frames/forms are removed WITH their content (never leaked as visible text).
    disallowedTagsMode: 'discard',
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed', 'template'],
    // Scheme-less (relative) URLs pass sanitize-html's scheme check — the law here is absolute:
    // an href is http/https/mailto, an img src is data:/cid: (+https: for a signature), or gone.
    transformTags: {
      a: (tagName, attribs) => {
        const { href, ...rest } = attribs;
        const keep = href && /^(https?:|mailto:)/i.test(href.trim());
        return { tagName, attribs: { ...rest, ...(keep ? { href } : {}), target: '_blank', rel: 'noopener noreferrer' } };
      },
      img: (tagName, attribs) => {
        const { src, ...rest } = attribs;
        const ok = src && (allowRemoteImages ? /^(data:image\/|cid:|https:)/i : /^(data:image\/|cid:)/i).test(src.trim());
        return { tagName, attribs: ok ? { ...rest, src } : rest };
      },
    },
    exclusiveFilter: (frame) => {
      // An <img> whose src the scheme law stripped is a dead box — drop it entirely.
      if (frame.tag === 'img' && !frame.attribs.src) return true;
      return false;
    },
  };
}

function stripDangerousStyles(html: string): string {
  // sanitize-html keeps `style` verbatim when allowed; drop any that can fetch/evaluate.
  return html.replace(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, _q, dq, sq) =>
    DANGEROUS_STYLE.test(dq ?? sq ?? '') ? '' : m,
  );
}

const DRAFT_OPTS = build(false);
const SIGNATURE_OPTS = build(true);

/** Drafts / model-authored bodies: formatting only, no remote resources, nothing executable. */
export function sanitizeDraftHtml(html: string | null | undefined): string {
  if (!html) return '';
  return stripDangerousStyles(sanitizeHtml(html, DRAFT_OPTS));
}

/** The user's OWN signature: the draft law plus https images (their signature logo). */
export function sanitizeSignatureHtml(html: string | null | undefined): string {
  if (!html) return '';
  return stripDangerousStyles(sanitizeHtml(html, SIGNATURE_OPTS));
}
