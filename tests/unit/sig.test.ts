import { describe, it, expect } from 'vitest';
import { sigOf, canonicalSig, sigVersion } from '@/lib/core/sig';

describe('sigOf — THE ONE SIG HELPER (W2.5)', () => {
  it('is deterministic and prefixed by its version', () => {
    const s = sigOf({ version: 20, deps: { a: 1 } });
    expect(s).toBe(sigOf({ version: 20, deps: { a: 1 } }));
    expect(sigVersion(s)).toBe('20');
  });

  it('never moves on the order deps are listed in', () => {
    expect(sigOf({ version: 1, deps: { a: 'x', b: 2, c: { d: 1, e: 2 } } }))
      .toBe(sigOf({ version: 1, deps: { c: { e: 2, d: 1 }, b: 2, a: 'x' } }));
  });

  it('treats a Set as a set and an array as a sequence', () => {
    expect(sigOf({ version: 1, deps: { s: new Set(['b', 'a']) } })).toBe(sigOf({ version: 1, deps: { s: new Set(['a', 'b']) } }));
    expect(sigOf({ version: 1, deps: { s: ['b', 'a'] } })).not.toBe(sigOf({ version: 1, deps: { s: ['a', 'b'] } }));
  });

  it('moves on a version bump and on any dep change', () => {
    const base = sigOf({ version: 1, deps: { a: 'x' } });
    expect(sigOf({ version: 2, deps: { a: 'x' } })).not.toBe(base);
    expect(sigOf({ version: 1, deps: { a: 'y' } })).not.toBe(base);
    expect(sigOf({ version: 1, deps: { a: 'x', b: null } })).not.toBe(base);
  });

  it('keeps absent, null, empty and false distinct', () => {
    const vals = [undefined, null, '', false, 0, '0'].map((v) => sigOf({ version: 1, deps: { v } }));
    expect(new Set(vals).size).toBe(vals.length);
  });

  it('cannot collide by concatenation', () => {
    expect(canonicalSig({ p: 'ab', q: 'c' })).not.toBe(canonicalSig({ p: 'a', q: 'bc' }));
    expect(canonicalSig(['a,b'])).not.toBe(canonicalSig(['a', 'b']));
  });

  it('is colon-free so it embeds in colon-delimited keys', () => {
    expect(sigOf({ version: 3, deps: { at: '2026-09-22T10:00:00Z' } })).not.toContain(':');
  });
});
