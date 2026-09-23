import { describe, it, expect } from 'vitest';
import { validateFrameHtml, injectCsp, FRAME_MAX_BYTES } from '@/lib/frames/validate-frame';

const OK_DOC = '<html><head></head><body><h1>Report</h1></body></html>';

describe('validateFrameHtml — the no-egress floor', () => {
  it('accepts a minimal, self-contained document', () => {
    const r = validateFrameHtml(OK_DOC);
    expect(r.ok).toBe(true);
  });

  it('rejects empty input', () => {
    const r = validateFrameHtml('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.length).toBeGreaterThan(0);
  });

  it('rejects a non-string input defensively', () => {
    // @ts-expect-error — exercising the runtime typeof guard
    const r = validateFrameHtml(null);
    expect(r.ok).toBe(false);
  });

  it('rejects a document missing <html> or </html>', () => {
    const r = validateFrameHtml('<body>no html wrapper</body>');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.some((x) => /complete HTML document/.test(x))).toBe(true);
  });

  it('rejects an external URL in a src attribute (egress)', () => {
    const html = `<html><body><img src="https://evil.example.com/x.png"></body></html>`;
    const r = validateFrameHtml(html);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.some((x) => /external URL/.test(x))).toBe(true);
  });

  it('accepts a data: URI image (no egress)', () => {
    const html = `<html><body><img src="data:image/png;base64,AAAA"></body></html>`;
    expect(validateFrameHtml(html).ok).toBe(true);
  });

  it('rejects a protocol-relative URL', () => {
    const html = `<html><body><script>fetch('//evil.example.com')</script></body></html>`;
    const r = validateFrameHtml(html);
    expect(r.ok).toBe(false);
  });

  it('rejects a CSS url() pointing externally', () => {
    const html = `<html><head><style>body{background:url(https://evil.example.com/bg.png)}</style></head><body></body></html>`;
    const r = validateFrameHtml(html);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.some((x) => /url\(\)/.test(x))).toBe(true);
  });

  it('rejects @import of an external stylesheet', () => {
    const html = `<html><head><style>@import url(https://evil.example.com/x.css);</style></head><body></body></html>`;
    expect(validateFrameHtml(html).ok).toBe(false);
  });

  it('rejects a <base> tag (retroactive re-pointing of relative URLs)', () => {
    const html = `<html><head><base href="https://evil.example.com/"></head><body></body></html>`;
    const r = validateFrameHtml(html);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.some((x) => /<base>/.test(x))).toBe(true);
  });

  it('rejects a <link> tag entirely (no external stylesheets/fonts)', () => {
    const html = `<html><head><link rel="stylesheet" href="style.css"></head><body></body></html>`;
    expect(validateFrameHtml(html).ok).toBe(false);
  });

  it('rejects an <iframe>', () => {
    const html = `<html><body><iframe src="https://example.com"></iframe></body></html>`;
    expect(validateFrameHtml(html).ok).toBe(false);
  });

  it('rejects a <form> with an action attribute', () => {
    const html = `<html><body><form action="/submit"><input></form></body></html>`;
    expect(validateFrameHtml(html).ok).toBe(false);
  });

  it('rejects fetch() in script', () => {
    const html = `<html><body><script>fetch('/api/data')</script></body></html>`;
    expect(validateFrameHtml(html).ok).toBe(false);
  });

  it('rejects WebSocket / EventSource / XMLHttpRequest / sendBeacon usage', () => {
    for (const call of ["new WebSocket('wss://x')", "new XMLHttpRequest()", "new EventSource('/x')", "navigator.sendBeacon('/x')"]) {
      const html = `<html><body><script>${call}</script></body></html>`;
      expect(validateFrameHtml(html).ok, call).toBe(false);
    }
  });

  it('rejects dynamic import()', () => {
    expect(validateFrameHtml(`<html><body><script>import('/x.js')</script></body></html>`).ok).toBe(false);
  });

  it('rejects an ES import statement at the start of a line (module-shaped script)', () => {
    const html = `<html><body><script>\nimport x from '/x.js';\nconsole.log(x);</script></body></html>`;
    expect(validateFrameHtml(html).ok).toBe(false);
  });

  it('rejects navigation via location assignment / window.open', () => {
    expect(validateFrameHtml(`<html><body><script>window.location = '/x'</script></body></html>`).ok).toBe(false);
    expect(validateFrameHtml(`<html><body><script>location.replace('/x')</script></body></html>`).ok).toBe(false);
    expect(validateFrameHtml(`<html><body><script>window.open('/x')</script></body></html>`).ok).toBe(false);
  });

  it('collects ALL violations in one pass, not just the first', () => {
    const html = `<html><head><base href="https://evil.example.com/"></head><body>` +
      `<img src="https://evil.example.com/x.png"><iframe src="https://x.com"></iframe>` +
      `<script>fetch('/x')</script></body></html>`;
    const r = validateFrameHtml(html);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.length).toBeGreaterThanOrEqual(4);
  });

  it('rejects a document larger than FRAME_MAX_BYTES', () => {
    const big = `<html><body>${'x'.repeat(FRAME_MAX_BYTES + 1000)}</body></html>`;
    const r = validateFrameHtml(big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.some((x) => /larger than/.test(x))).toBe(true);
  });

  it('a mailto: link is allowed (not egress)', () => {
    const html = `<html><body><a href="mailto:sam@example.com">email</a></body></html>`;
    expect(validateFrameHtml(html).ok).toBe(true);
  });

  it('a same-page fragment link is allowed', () => {
    const html = `<html><body><a href="#section1">jump</a></body></html>`;
    expect(validateFrameHtml(html).ok).toBe(true);
  });
});

describe('injectCsp', () => {
  it('inserts the CSP meta as the first child of an existing <head>', () => {
    const out = injectCsp('<html><head><title>x</title></head><body></body></html>');
    const headStart = out.indexOf('<head>') + '<head>'.length;
    const metaStart = out.indexOf('<meta http-equiv="Content-Security-Policy"');
    expect(metaStart).toBeGreaterThan(-1);
    expect(out.indexOf('<title>')).toBeGreaterThan(metaStart);
    expect(headStart).toBeLessThanOrEqual(metaStart);
  });

  it('creates a <head> when the document has none but has <html>', () => {
    const out = injectCsp('<html><body>hi</body></html>');
    expect(out).toContain('<head>');
    expect(out).toContain('Content-Security-Policy');
  });

  it('is idempotent — a document that already carries a CSP meta is untouched', () => {
    const withCsp = '<html><head><meta http-equiv="Content-Security-Policy" content="default-src none"></head><body></body></html>';
    expect(injectCsp(withCsp)).toBe(withCsp);
  });

  it('handles a document with neither <head> nor <html>', () => {
    const out = injectCsp('<body>hi</body>');
    expect(out).toContain('Content-Security-Policy');
  });
});
