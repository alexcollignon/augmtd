import { describe, it, expect } from 'vitest';
import { isForbiddenAddress, classifyUrl } from '@/lib/utils/safe-fetch';

describe('isForbiddenAddress — SSRF address law (v4)', () => {
  it('forbids loopback', () => {
    expect(isForbiddenAddress('127.0.0.1')).toBe(true);
  });
  it('forbids private ranges (10.x, 172.16-31.x, 192.168.x)', () => {
    expect(isForbiddenAddress('10.0.0.5')).toBe(true);
    expect(isForbiddenAddress('172.16.0.1')).toBe(true);
    expect(isForbiddenAddress('192.168.1.1')).toBe(true);
  });
  it('forbids the cloud-metadata link-local range', () => {
    expect(isForbiddenAddress('169.254.169.254')).toBe(true);
  });
  it('forbids CGNAT (100.64.0.0/10)', () => {
    expect(isForbiddenAddress('100.64.0.1')).toBe(true);
  });
  it('allows a public address', () => {
    expect(isForbiddenAddress('8.8.8.8')).toBe(false);
  });
  it('a non-IP string is forbidden (fails closed)', () => {
    expect(isForbiddenAddress('not-an-ip')).toBe(true);
  });
});

describe('isForbiddenAddress — SSRF address law (v6)', () => {
  it('forbids ::1 loopback', () => {
    expect(isForbiddenAddress('::1')).toBe(true);
  });
  it('forbids the unspecified address ::', () => {
    expect(isForbiddenAddress('::')).toBe(true);
  });
  it('allows a real public v6 address', () => {
    expect(isForbiddenAddress('2001:4860:4860::8888')).toBe(false);
  });
  it('forbids a v4-mapped loopback embedded in v6 (::ffff:127.0.0.1)', () => {
    expect(isForbiddenAddress('::ffff:127.0.0.1')).toBe(true);
  });
  it('allows a v4-mapped PUBLIC address embedded in v6', () => {
    expect(isForbiddenAddress('::ffff:8.8.8.8')).toBe(false);
  });
  it('forbids link-local (fe80::/10)', () => {
    expect(isForbiddenAddress('fe80::1')).toBe(true);
  });
  it('forbids unique-local (fc00::/7)', () => {
    expect(isForbiddenAddress('fd00::1')).toBe(true);
  });
  it('handles a bracketed literal the same as bare', () => {
    expect(isForbiddenAddress('[::1]')).toBe(true);
  });
});

describe('classifyUrl — scheme + hostname + IP-literal law', () => {
  it('accepts a normal https URL', () => {
    const v = classifyUrl('https://example.com/path');
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.needsDns).toBe(true);
  });

  it('rejects non-http(s) schemes', () => {
    expect(classifyUrl('ftp://example.com/').ok).toBe(false);
  });

  it('rejects a malformed URL', () => {
    expect(classifyUrl('not a url').ok).toBe(false);
  });

  it('rejects credentials embedded in the URL', () => {
    const v = classifyUrl('https://user:pass@example.com/');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/credentials/);
  });

  it('rejects a decimal-encoded loopback IP (2130706433 === 127.0.0.1)', () => {
    const v = classifyUrl('http://2130706433/');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain('127.0.0.1');
  });

  it('rejects a bare loopback IP literal directly', () => {
    expect(classifyUrl('http://127.0.0.1/').ok).toBe(false);
  });

  it('accepts a public IP literal, with needsDns false (no name to resolve)', () => {
    const v = classifyUrl('http://8.8.8.8/');
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.needsDns).toBe(false);
  });

  it('rejects localhost and its subdomains', () => {
    expect(classifyUrl('http://localhost/').ok).toBe(false);
    expect(classifyUrl('http://foo.localhost/').ok).toBe(false);
  });

  it('rejects .local and .internal TLD-like suffixes', () => {
    expect(classifyUrl('http://foo.local/').ok).toBe(false);
    expect(classifyUrl('http://foo.internal/').ok).toBe(false);
  });

  it('rejects a bare single-label hostname with no dot (never resolvable publicly)', () => {
    expect(classifyUrl('http://intranet/').ok).toBe(false);
  });

  it('needsDns is true for an ordinary public hostname (the async DNS check runs next)', () => {
    const v = classifyUrl('https://api.example.com/data');
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.needsDns).toBe(true);
  });
});
