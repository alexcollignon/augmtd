// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CHAT'S MARKDOWN, PARSED (stabilization W22.B — THE CHAT FEELS LIKE A REAL AI CHAT).
//
// Before W22 the Home answer renderer STRIPPED `**` and `#` (components/home/ask-answer.tsx) while the
// coworker chat drew a hand-rolled subset of its own (components/work/chat-message.tsx) — two opinions
// about one kind of speech, and neither could show a heading, a code block or a link. There is ONE
// reading now: this pure parser turns an answer's markdown into a small block/inline tree, and ONE
// React renderer (./markdown-view.tsx) draws it on every chat surface — the Home chat, the coworker
// DM and the item/project room.
//
// RENDER SAFETY (Tier-1 invariant 3), BY CONSTRUCTION:
//   · there is no HTML node in this tree — `<script>` in an answer is TEXT, and the renderer only ever
//     emits React elements (no dangerouslySetInnerHTML anywhere on this path);
//   · a link survives only when its target is http(s), mailto, or app-relative (`/…`, never `//…`) —
//     `javascript:`, `data:`, `vbscript:` and anything else renders as its words, unlinked;
//   · an image is never loaded: `![alt](url)` becomes a plain link the reader can choose to follow.
//
// THE STREAM NEVER REMOUNTS: blocks are emitted in source order and keyed by position, so appending
// tokens only ever changes the LAST block — everything the reader has already read keeps its node
// (the no-mutation law; the gate replays every prefix of a sample answer).
//
// Pure, zero IO, client-safe.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type MdInline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: MdInline[] }
  | { t: 'em'; c: MdInline[] }
  | { t: 'del'; c: MdInline[] }
  | { t: 'code'; v: string }
  /** `href` is already vetted by `safeHref` — the renderer never sees an unsafe target. */
  | { t: 'link'; href: string; external: boolean; c: MdInline[] };

export type MdListItem = { c: MdInline[][]; children: MdBlock[] };

export type MdBlock =
  | { t: 'h'; level: 1 | 2 | 3 | 4; c: MdInline[] }
  | { t: 'p'; lines: MdInline[][] }
  | { t: 'list'; ordered: boolean; start: number; items: MdListItem[] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'table'; head: MdInline[][]; align: Array<'left' | 'center' | 'right' | null>; rows: MdInline[][][] }
  | { t: 'quote'; c: MdBlock[] }
  | { t: 'hr' };

// ── LINKS: THE ALLOWLIST ─────────────────────────────────────────────────────────────────────────

/**
 * The one link vetting. Returns the target to render, or null (the words render unlinked).
 * Allowed: `http://`, `https://`, `mailto:`, and app-relative paths (`/x`, never `//host`).
 * Control characters or whitespace inside the target reject it (the classic `java\tscript:` trick).
 */
export function safeHref(raw: string): { href: string; external: boolean } | null {
  const href = String(raw ?? '').trim();
  if (!href || /[\u0000-\u001f\u007f\s\\]/.test(href)) return null;
  if (/^https?:\/\/[^/]/i.test(href)) return { href, external: true };
  if (/^mailto:[^\s]+$/i.test(href)) return { href, external: true };
  if (/^\/(?!\/)/.test(href)) return { href, external: false };
  return null;
}

// ── INLINE ───────────────────────────────────────────────────────────────────────────────────────

// Order matters: code spans first (their content is literal), then images/links, then autolinks,
// then emphasis. Every alternative is anchored at the scan position.
const INLINE_RE = new RegExp([
  '(`+)([\\s\\S]*?[^`])\\1(?!`)',                                 // 1,2  code span
  '!\\[([^\\]]*)\\]\\(([^()\\s]*)(?:\\s+"[^"]*")?\\)',               // 3,4  image → a link, never loaded
  '\\[((?:[^\\[\\]]|\\[[^\\]]*\\])+)\\]\\(([^()\\s]*(?:\\([^()\\s]*\\))?[^()\\s]*)(?:\\s+"[^"]*")?\\)', // 5,6 link
  '<(https?:\\/\\/[^\\s<>]+|mailto:[^\\s<>]+)>',                    // 7    <autolink>
  '(https?:\\/\\/[^\\s<>()\\[\\]]+[^\\s<>()\\[\\].,;:!?\'"*_~])',    // 8    bare url
  '(\\*\\*|__)(?=\\S)([\\s\\S]*?\\S)\\9',                            // 9,10 strong
  '~~(?=\\S)([\\s\\S]*?\\S)~~',                                      // 11   strikethrough
  '\\*(?=[^\\s*])((?:[^*\\n]|\\*\\*[^*\\n]+\\*\\*)*?[^\\s*])\\*(?!\\*)', // 12  em (*)
  '(?<![\\w])_(?=\\S)([^_\\n]*?\\S)_(?![\\w])',                      // 13   em (_)
].join('|'), 'g');

function pushText(out: MdInline[], v: string) {
  if (!v) return;
  const last = out[out.length - 1];
  if (last && last.t === 'text') last.v += v;
  else out.push({ t: 'text', v });
}

/** Parse one line (or table cell) of inline markdown. Unknown syntax is text, always. */
export function parseInline(src: string): MdInline[] {
  const out: MdInline[] = [];
  const s = String(src ?? '');
  const re = new RegExp(INLINE_RE.source, 'g');
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m[0] === '') { re.lastIndex++; continue; }
    pushText(out, s.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push({ t: 'code', v: m[2].replace(/^ (.*) $/, '$1') });
    } else if (m[3] !== undefined) {
      // AN IMAGE IS NEVER LOADED — it becomes the words of a link the reader may choose to follow.
      const h = safeHref(m[4]);
      const label = m[3].trim() || 'image';
      if (h) out.push({ t: 'link', href: h.href, external: h.external, c: [{ t: 'text', v: label }] });
      else pushText(out, label);
    } else if (m[5] !== undefined) {
      const h = safeHref(m[6]);
      const inner = parseInline(m[5]);
      if (h) out.push({ t: 'link', href: h.href, external: h.external, c: inner });
      else for (const n of inner) { if (n.t === 'text') pushText(out, n.v); else out.push(n); } // neutralised: the words stay, the door does not
    } else if (m[7] !== undefined) {
      const h = safeHref(m[7]);
      if (h) out.push({ t: 'link', href: h.href, external: h.external, c: [{ t: 'text', v: m[7].replace(/^mailto:/i, '') }] });
      else pushText(out, m[0]);
    } else if (m[8] !== undefined) {
      const h = safeHref(m[8]);
      if (h) out.push({ t: 'link', href: h.href, external: h.external, c: [{ t: 'text', v: m[8] }] });
      else pushText(out, m[0]);
    } else if (m[9] !== undefined) {
      out.push({ t: 'strong', c: parseInline(m[10]) });
    } else if (m[11] !== undefined) {
      out.push({ t: 'del', c: parseInline(m[11]) });
    } else if (m[12] !== undefined) {
      out.push({ t: 'em', c: parseInline(m[12]) });
    } else if (m[13] !== undefined) {
      out.push({ t: 'em', c: parseInline(m[13]) });
    } else {
      pushText(out, m[0]);
    }
    last = m.index + m[0].length;
  }
  pushText(out, s.slice(last));
  return out;
}

// ── BLOCKS ───────────────────────────────────────────────────────────────────────────────────────

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR_RE = /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const ITEM_RE = /^(\s*)([-*+•]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE_RE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?\s*$/;

const isBlank = (l: string) => l.trim() === '';
const splitRow = (line: string): string[] => {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
};
const isTableStart = (lines: string[], i: number) =>
  lines[i].includes('|') && i + 1 < lines.length && lines[i + 1].includes('-') && TABLE_SEP_RE.test(lines[i + 1])
  && splitRow(lines[i]).length >= 2;

/** Does this line open a block other than a paragraph? (what ends a paragraph without a blank) */
function opensBlock(lines: string[], i: number): boolean {
  const l = lines[i];
  return FENCE_RE.test(l) || HEADING_RE.test(l) || HR_RE.test(l) || ITEM_RE.test(l) || QUOTE_RE.test(l) || isTableStart(lines, i);
}

function parseList(lines: string[], start: number): { block: MdBlock; next: number } {
  const first = ITEM_RE.exec(lines[start])!;
  const baseIndent = first[1].replace(/\t/g, '  ').length;
  const ordered = /\d/.test(first[2]);
  const items: MdListItem[] = [];
  let i = start;
  while (i < lines.length) {
    const l = lines[i];
    if (isBlank(l)) {
      // A blank line inside a list continues it only when the next line is still one of its items
      // (or an indented continuation); otherwise the list ends here.
      const n = lines[i + 1];
      const nm = n !== undefined ? ITEM_RE.exec(n) : null;
      const nIndent = n !== undefined ? (n.match(/^\s*/)?.[0].replace(/\t/g, '  ').length ?? 0) : 0;
      if (n !== undefined && ((nm && nIndent >= baseIndent && /\d/.test(nm[2]) === ordered) || (!nm && nIndent > baseIndent && !isBlank(n)))) { i++; continue; }
      break;
    }
    const m = ITEM_RE.exec(l);
    const indent = (l.match(/^\s*/)?.[0] ?? '').replace(/\t/g, '  ').length;
    if (m && indent < baseIndent) break;
    if (m && indent === baseIndent) {
      if (/\d/.test(m[2]) !== ordered) break; // a list of the other kind starts a new list
      items.push({ c: [parseInline(m[3])], children: [] });
      i++;
      continue;
    }
    if (m && indent > baseIndent && items.length) {
      // A NESTED list belongs to the item above it.
      const sub = parseList(lines, i);
      items[items.length - 1].children.push(sub.block);
      i = sub.next;
      continue;
    }
    if (!m && items.length && !opensBlock(lines, i)) {
      // A lazy / indented continuation line of the current item.
      items[items.length - 1].c.push(parseInline(l.trim()));
      i++;
      continue;
    }
    break;
  }
  const startNum = ordered ? parseInt(first[2], 10) || 1 : 1;
  return { block: { t: 'list', ordered, start: startNum, items }, next: i };
}

/** Parse a whole answer into blocks. Total: any input returns a tree; nothing throws. */
export function parseMarkdown(src: string): MdBlock[] {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (isBlank(l)) { i++; continue; }

    const fence = FENCE_RE.exec(l);
    if (fence) {
      // An UNCLOSED fence (a stream mid-block) renders as code so far — never as prose that flips.
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i].trim().startsWith(fence[1]) && lines[i].trim().replace(/[`~]/g, '') === '')) { body.push(lines[i]); i++; }
      i++; // the closing fence (or past the end)
      out.push({ t: 'code', lang: fence[2] ?? '', v: body.join('\n') });
      continue;
    }

    const h = HEADING_RE.exec(l);
    if (h) {
      out.push({ t: 'h', level: Math.min(4, h[1].length) as 1 | 2 | 3 | 4, c: parseInline(h[2]) });
      i++;
      continue;
    }

    if (HR_RE.test(l)) { out.push({ t: 'hr' }); i++; continue; }

    if (isTableStart(lines, i)) {
      const head = splitRow(lines[i]);
      const align = splitRow(lines[i + 1]).map((c) => {
        const L = c.startsWith(':'), R = c.endsWith(':');
        return L && R ? 'center' as const : R ? 'right' as const : L ? 'left' as const : null;
      });
      i += 2;
      const rows: MdInline[][][] = [];
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) {
        const cells = splitRow(lines[i]);
        rows.push(head.map((_, ci) => parseInline(cells[ci] ?? '')));
        i++;
      }
      out.push({ t: 'table', head: head.map(parseInline), align, rows });
      continue;
    }

    if (ITEM_RE.test(l)) {
      const { block, next } = parseList(lines, i);
      out.push(block);
      i = next;
      continue;
    }

    if (QUOTE_RE.test(l)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) { body.push(QUOTE_RE.exec(lines[i])![1]); i++; }
      out.push({ t: 'quote', c: parseMarkdown(body.join('\n')) });
      continue;
    }

    // A PARAGRAPH: consecutive lines until a blank or another block opens. Single newlines are kept
    // as line breaks — a chat answer's line structure is meaningful (the old renderer's pre-line).
    const para: MdInline[][] = [];
    while (i < lines.length && !isBlank(lines[i]) && (para.length === 0 || !opensBlock(lines, i))) {
      para.push(parseInline(lines[i].trim()));
      i++;
    }
    out.push({ t: 'p', lines: para });
  }
  return out;
}

// ── PLAIN TEXT (Copy) ────────────────────────────────────────────────────────────────────────────

const inlinePlain = (c: MdInline[]): string => c.map((n) => {
  switch (n.t) {
    case 'text': return n.v;
    case 'code': return n.v;
    case 'link': {
      const words = inlinePlain(n.c);
      const target = n.href.replace(/^mailto:/i, '');
      return words === n.href || words === target ? words : `${words} (${n.href})`;
    }
    default: return inlinePlain(n.c);
  }
}).join('');

function blocksPlain(blocks: MdBlock[], depth = 0): string[] {
  const out: string[] = [];
  const pad = '  '.repeat(depth);
  for (const b of blocks) {
    switch (b.t) {
      case 'h': out.push(inlinePlain(b.c)); break;
      case 'p': out.push(b.lines.map(inlinePlain).join('\n')); break;
      case 'code': out.push(b.v); break;
      case 'hr': out.push('—'); break;
      case 'quote': out.push(blocksPlain(b.c).join('\n\n')); break;
      case 'table':
        out.push([b.head, ...b.rows].map((r) => r.map(inlinePlain).join('\t')).join('\n'));
        break;
      case 'list': {
        const lines: string[] = [];
        b.items.forEach((it, k) => {
          const marker = b.ordered ? `${b.start + k}.` : '-';
          lines.push(`${pad}${marker} ${it.c.map(inlinePlain).join('\n' + pad + '  ')}`);
          for (const ch of it.children) lines.push(...blocksPlain([ch], depth + 1));
        });
        out.push(lines.join('\n'));
        break;
      }
    }
  }
  return out;
}

/** Markdown → the plain text a reader would expect on their clipboard (Copy). Pure. */
export function markdownToPlain(src: string): string {
  return blocksPlain(parseMarkdown(src)).join('\n\n').trim();
}
