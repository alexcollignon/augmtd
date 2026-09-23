import { describe, it, expect } from 'vitest';
import { clipForPrompt, clipLabel, EXCERPT_MARK } from '@/lib/utils/clip-for-prompt';

describe('clipForPrompt', () => {
  it('passes short text through unchanged, with no marker', () => {
    expect(clipForPrompt('hello world', 100)).toBe('hello world');
  });

  it('trims surrounding whitespace even when under the limit', () => {
    expect(clipForPrompt('  hello world  ', 100)).toBe('hello world');
  });

  it('clips at a sentence boundary when one exists past the halfway point', () => {
    const text = 'This is sentence one. This is sentence two that goes long enough to get cut off eventually here.';
    const out = clipForPrompt(text, 30);
    expect(out.endsWith(EXCERPT_MARK)).toBe(true);
    expect(out).toContain('This is sentence one.');
    expect(out).not.toContain('sentence two');
  });

  it('falls back to a word boundary when no sentence boundary qualifies', () => {
    const text = 'aaaaaaaaaa bbbbbbbbbb cccccccccc dddddddddd eeeeeeeeee ffffffffff gggggggggg';
    const out = clipForPrompt(text, 40);
    expect(out.endsWith(EXCERPT_MARK)).toBe(true);
    // No mid-word cut: the text before the mark should be whole words.
    const prefix = out.slice(0, out.length - EXCERPT_MARK.length).trim();
    expect(text.startsWith(prefix)).toBe(true);
  });

  it('always appends EXCERPT_MARK when anything was actually cut', () => {
    const text = 'x'.repeat(500);
    const out = clipForPrompt(text, 50);
    expect(out.endsWith(EXCERPT_MARK)).toBe(true);
  });

  it('never appends the marker when nothing needed cutting', () => {
    const text = 'exactly fits';
    const out = clipForPrompt(text, text.length);
    expect(out).toBe(text);
    expect(out.includes(EXCERPT_MARK)).toBe(false);
  });

  it('handles empty/undefined input without throwing', () => {
    expect(clipForPrompt('', 10)).toBe('');
    // @ts-expect-error — exercising the runtime String(text ?? '') guard
    expect(clipForPrompt(undefined, 10)).toBe('');
  });
});

describe('clipLabel', () => {
  it('passes short labels through unchanged', () => {
    expect(clipLabel('Weekly report', 40)).toBe('Weekly report');
  });

  it('collapses internal whitespace/newlines before measuring', () => {
    expect(clipLabel('Weekly   \n  report', 40)).toBe('Weekly report');
  });

  it('never carries the EXCERPT_MARK — a label clip is chrome, not a prompt excerpt', () => {
    const out = clipLabel('a '.repeat(100), 20);
    expect(out.includes(EXCERPT_MARK)).toBe(false);
  });

  it('ends with an ellipsis when it actually clips', () => {
    const out = clipLabel('The quarterly financial highlights and executive summary document', 20);
    expect(out.endsWith('…')).toBe(true);
  });

  it('cuts at a word boundary, never mid-word (the report-back regression)', () => {
    const out = clipLabel("Last Week's Highlights summary document for the team", 24);
    const body = out.replace(/…$/, '');
    expect("Last Week's Highlights summary document for the team".startsWith(body.trim())).toBe(true);
    // No dangling single-letter fragment like "…'Last Week's Highlights' s"
    expect(/\s[a-z]$/i.test(body.trim())).toBe(false);
  });

  it('strips trailing punctuation/separators before the ellipsis', () => {
    const out = clipLabel('First section, second section, third section here', 22);
    expect(out).not.toMatch(/[\s,;:—–-]…$/);
  });

  it('handles empty/undefined input without throwing', () => {
    expect(clipLabel('', 10)).toBe('');
    // @ts-expect-error — exercising the runtime String(text ?? '') guard
    expect(clipLabel(undefined, 10)).toBe('');
  });
});
