import { describe, it, expect } from 'vitest';
import { sanitizeDraftHtml, sanitizeSignatureHtml } from '@/lib/utils/sanitize-html';

describe('sanitizeDraftHtml — render safety for model/user-authored HTML', () => {
  it('keeps allowed formatting tags', () => {
    expect(sanitizeDraftHtml('<p>Hello <b>world</b></p>')).toBe('<p>Hello <b>world</b></p>');
  });

  it('strips <script> tags AND their content', () => {
    const out = sanitizeDraftHtml('<script>alert(1)</script><p>hi</p>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('alert');
    expect(out).toContain('<p>hi</p>');
  });

  it('drops a remote https <img> in a draft (no fetch before approval)', () => {
    const out = sanitizeDraftHtml('<img src="https://evil.example.com/x.png">');
    expect(out).not.toContain('evil.example.com');
    expect(out).not.toContain('<img');
  });

  it('allows a remote https <img> in a SIGNATURE (the user\'s own logo)', () => {
    const out = sanitizeSignatureHtml('<img src="https://cdn.example.com/logo.png">');
    expect(out).toContain('cdn.example.com');
  });

  it('allows a data: image URI in both drafts and signatures', () => {
    const out = sanitizeDraftHtml('<img src="data:image/png;base64,AAAA">');
    expect(out).toContain('data:image/png');
  });

  it('strips a javascript: href', () => {
    const out = sanitizeDraftHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain('javascript:');
  });

  it('strips onclick and other event handler attributes', () => {
    const out = sanitizeDraftHtml('<a href="http://x.com" onclick="evil()">click</a>');
    expect(out).not.toContain('onclick');
    expect(out).toContain('href="http://x.com"');
  });

  it('forces target=_blank + rel=noopener noreferrer on links', () => {
    const out = sanitizeDraftHtml('<a href="https://x.com">x</a>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('strips a CSS url() that can fetch, even inside an otherwise-allowed style attribute', () => {
    const out = sanitizeDraftHtml('<div style="background:url(https://evil.example.com/x.png)">x</div>');
    expect(out).not.toContain('url(');
    expect(out).not.toContain('evil.example.com');
  });

  it('strips <iframe> entirely', () => {
    const out = sanitizeDraftHtml('<iframe src="https://evil.example.com"></iframe>');
    expect(out).not.toContain('iframe');
  });

  it('strips <form>/<input> (no submission surfaces)', () => {
    const out = sanitizeDraftHtml('<form action="/x"><input type="text"></form>');
    expect(out).not.toContain('<form');
    expect(out).not.toContain('<input');
  });

  it('strips <base> (no relative-URL re-pointing)', () => {
    const out = sanitizeDraftHtml('<base href="https://evil.example.com">');
    expect(out).not.toContain('base');
  });

  it('returns empty string for null/undefined input without throwing', () => {
    expect(sanitizeDraftHtml(null)).toBe('');
    expect(sanitizeDraftHtml(undefined)).toBe('');
    expect(sanitizeSignatureHtml(null)).toBe('');
  });

  it('drops an <img> whose src the scheme law stripped (a dead box), rather than leaving a bare tag', () => {
    const out = sanitizeDraftHtml('<img src="ftp://x.com/y.png">');
    expect(out).not.toContain('<img');
  });

  it('preserves a table structure (allowed for formatted content)', () => {
    const out = sanitizeDraftHtml('<table><tr><td>A</td></tr></table>');
    expect(out).toContain('<table>');
    expect(out).toContain('<td>A</td>');
  });
});
