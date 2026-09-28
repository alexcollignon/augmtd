// W22.B — THE CHAT FEELS LIKE A REAL AI CHAT: the one markdown parser, the paste law, the in-flight words.
import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseMarkdown, parseInline, safeHref, markdownToPlain } from '@/components/thread/markdown';
import { Markdown } from '@/components/thread/markdown-view';
import { Answer, answerPlainText } from '@/components/home/ask-answer';
import { classifyPaste, pastedWire, pastedNote, PASTE_CHIP_MIN, PASTE_LIMIT, PASTE_MAX_PIECES } from '@/components/home/paste-material';
import { inFlightLine, failureLine, trimPartialTag } from '@/components/home/chat-flight';

const html = (text: string) => renderToStaticMarkup(React.createElement(Markdown, { text }));

describe('the one markdown parser', () => {
  it('reads headings, paragraphs, lists, tables, code, quotes and rules', () => {
    const b = parseMarkdown('# Plan\n\nIntro line\nsecond line\n\n- one\n- two\n  - nested\n\n1. a\n2. b\n\n| A | B |\n|---|:-:|\n| x | y |\n\n```ts\nconst a = 1;\n```\n\n> quoted\n\n---');
    expect(b.map((x) => x.t)).toEqual(['h', 'p', 'list', 'list', 'table', 'code', 'quote', 'hr']);
    const p = b[1] as Extract<typeof b[number], { t: 'p' }>;
    expect(p.lines).toHaveLength(2);
    const ul = b[2] as Extract<typeof b[number], { t: 'list' }>;
    expect(ul.ordered).toBe(false);
    expect(ul.items).toHaveLength(2);
    expect(ul.items[1].children[0]?.t).toBe('list');
    const t = b[4] as Extract<typeof b[number], { t: 'table' }>;
    expect(t.align).toEqual([null, 'center']);
    expect((b[5] as { v: string }).v).toBe('const a = 1;');
  });

  it('an unclosed fence (mid-stream) is code, never prose', () => {
    expect(parseMarkdown('```\nlet x = 1;').map((x) => x.t)).toEqual(['code']);
  });

  it('inline: bold, italic, code, strike; unknown syntax stays text', () => {
    const n = parseInline('**bold** and *it* and `c` and ~~gone~~ and 2 * 3');
    expect(n.map((x) => x.t)).toEqual(['strong', 'text', 'em', 'text', 'code', 'text', 'del', 'text']);
    expect(n[n.length - 1]).toEqual({ t: 'text', v: ' and 2 * 3' });
  });

  it('grounding tags are text (never links), so the answer renderer can chip them', () => {
    expect(parseInline('see [E1] and [R2, L3]')).toEqual([{ t: 'text', v: 'see [E1] and [R2, L3]' }]);
  });
});

describe('RENDER SAFETY in the markdown renderer', () => {
  it('raw HTML renders as text — nothing executes', () => {
    const out = html('<script>alert(1)</script> <img src=x onerror=alert(1)> <b>hi</b>');
    expect(out).not.toMatch(/<script|<img|<b>/i);
    expect(out).toContain('&lt;script&gt;');
  });

  it('javascript:, data:, vbscript: and protocol-relative links are neutralised to their words', () => {
    for (const u of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.example/x', 'java\tscript:x']) {
      expect(safeHref(u)).toBeNull();
      const out = html(`[click](${u})`);
      expect(out).not.toMatch(/<a /);
      expect(out).toContain('click');
    }
  });

  it('allowed links: http(s) open in a new tab with noopener; app-relative stays in-app', () => {
    const ext = html('[docs](https://example.com/a)');
    expect(ext).toMatch(/<a href="https:\/\/example.com\/a" target="_blank" rel="noopener noreferrer nofollow"/);
    expect(html('[item](/item/abc)')).toMatch(/<a href="\/item\/abc" class/);
    expect(html('<mailto:sam@example.com>')).toMatch(/href="mailto:sam@example.com"/);
  });

  it('images are never loaded — they become a link the reader may follow', () => {
    const out = html('![chart](https://example.com/c.png)');
    expect(out).not.toMatch(/<img/);
    expect(out).toMatch(/<a href="https:\/\/example.com\/c.png"[^>]*>chart<\/a>/);
  });
});

describe('the answer: chips inside markdown, Copy as plain text', () => {
  const refs = [{ label: 'Acme renewal (handled) — "Hi"', href: '/item/a', tag: 'L1' }];
  it('a tag inside a bullet and inside bold still resolves to its chip', () => {
    const out = renderToStaticMarkup(React.createElement(Answer, { text: '## Status\n\n- The renewal [L1]\n- **Pending [L1]**\n- gone [L9]', refs, onOpen: () => {} }));
    expect(out).toMatch(/<h3[^>]*>Status<\/h3>/);
    expect((out.match(/<button[^>]*>Acme renewal<\/button>/g) ?? []).length).toBe(2);
    expect(out).not.toMatch(/\[L\d\]/);
  });
  it('Copy: markdown → plain text, tags → their chip names', () => {
    expect(answerPlainText('## Status\n\n- **The renewal** [L1]\n- [site](https://example.com)', refs))
      .toBe('Status\n\n- The renewal Acme renewal\n- site (https://example.com)');
    expect(markdownToPlain('| A | B |\n|---|---|\n| 1 | 2 |')).toBe('A\tB\n1\t2');
  });
});

describe('the stream never remounts painted blocks', () => {
  it('every block but the last of any prefix equals the full parse at the same position', () => {
    const full = '# Title\n\nFirst paragraph with **bold**.\n\n- one\n- two\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```\ncode\n```\n\nClosing line.';
    for (let n = 1; n <= full.length; n++) {
      const pre = parseMarkdown(full.slice(0, n));
      const all = parseMarkdown(full);
      for (let i = 0; i < pre.length - 1; i++) expect(pre[i]).toEqual(all[i]);
    }
  });
});

describe('a long paste is material', () => {
  it('short pastes stay inline; long ones become a chip; over-limit is refused out loud', () => {
    expect(classifyPaste('x'.repeat(PASTE_CHIP_MIN - 1), 0).kind).toBe('inline');
    const chip = classifyPaste('Quarterly report\n' + 'x'.repeat(PASTE_CHIP_MIN), 0);
    expect(chip.kind).toBe('chip');
    if (chip.kind === 'chip') expect(chip.piece.name).toBe('Pasted: Quarterly report');
    const over = classifyPaste('x'.repeat(PASTE_LIMIT + 1), 0);
    expect(over.kind).toBe('refused');
    if (over.kind === 'refused') expect(over.reason).toMatch(/limit is 20,000/);
    expect(classifyPaste('x'.repeat(PASTE_CHIP_MIN), PASTE_MAX_PIECES).kind).toBe('refused');
  });
  it('the wire carries the pieces as material (the pasted field + the attachments bridge), whole', () => {
    const text = 'y'.repeat(5000);
    const w = pastedWire([{ text, name: 'Pasted: y' }]);
    expect(w.pasted?.[0].text).toBe(text);
    expect(w.attachments[0]).toEqual({ name: 'Pasted: y', text });
    expect(pastedNote([{ text, name: 'Pasted: y' }])).toMatch(/5,000 characters/);
  });
});

describe('never a silent ring', () => {
  it('the in-flight line speaks the stage, and says still working past the wait', () => {
    expect(inFlightLine('Looking at your calendar…', false)).toBe('Looking at your calendar…');
    expect(inFlightLine(null, false)).toBe('Thinking…');
    expect(inFlightLine('Looking at your calendar…', true)).toBe('Looking at your calendar — still working…');
    expect(failureLine('timeout')).toMatch(/too long/);
    expect(failureLine('error')).toMatch(/didn't come through/);
  });
  it('a half-written tag never flashes', () => {
    expect(trimPartialTag('the renewal [L')).toBe('the renewal ');
    expect(trimPartialTag('done [L1]')).toBe('done [L1]');
  });
});
