import { describe, it, expect } from 'vitest';
import { stripPastePlaceholders } from '@/lib/workflows/generate-config';

describe('stripPastePlaceholders — span-scoped, not line-scoped', () => {
  it('text with no placeholders passes through unchanged, nothing reported stripped', () => {
    const text = 'No placeholders here at all.';
    expect(stripPastePlaceholders(text)).toEqual({ text, stripped: [] });
  });

  it('a labeled entry whose entire content WAS the placeholder collapses the dangling label too', () => {
    const out = stripPastePlaceholders('Inputs: 1. Approved job description: [PASTE JOB DESCRIPTION]');
    expect(out.text).toBe('Inputs: 1. Approved job description:');
    expect(out.stripped).toEqual(['[PASTE JOB DESCRIPTION]']);
  });

  it('a placeholder inside a sentence strips only the bracketed span, prose survives on both sides', () => {
    const text = 'Please review this candidate. [PASTE OR UPLOAD RESUMES] Then score them accordingly.';
    const out = stripPastePlaceholders(text);
    expect(out.text).toContain('Please review this candidate.');
    expect(out.text).toContain('Then score them accordingly.');
    expect(out.text).not.toContain('[PASTE');
    expect(out.stripped).toEqual(['[PASTE OR UPLOAD RESUMES]']);
  });

  it('adjacent placeholders collapse to a single hole, both reported', () => {
    const out = stripPastePlaceholders('[PASTE A] [UPLOAD B]');
    expect(out.text).toBe('');
    expect(out.stripped).toEqual(['[PASTE A]', '[UPLOAD B]']);
  });

  it('THE FROZEN-PASTE CLASS: a one-line paste (no newlines at all) loses only its bracketed ' +
     'placeholders — the doc-comment law, proven shape-independent', () => {
    const oneLine =
      'Inputs: 1. Job description: [PASTE JD]  2. Resumes: [PASTE OR UPLOAD RESUMES]  ' +
      'Evaluation: score 1-10 based on fit, experience, and communication skills as described here.';
    const out = stripPastePlaceholders(oneLine);
    expect(out.text).not.toMatch(/\[PASTE|\[UPLOAD/);
    expect(out.text).toContain('Evaluation: score 1-10 based on fit, experience, and communication skills as described here.');
    expect(out.stripped).toHaveLength(2);
  });

  it('matches paste/pasted/upload/uploaded/insert/attach/attached/provide/drop verbs, case-insensitively', () => {
    const verbs = ['paste', 'PASTED', 'Upload', 'uploaded', 'insert', 'attach', 'attached', 'PROVIDE', 'drop'];
    for (const v of verbs) {
      const out = stripPastePlaceholders(`before [${v} the thing here] after`);
      expect(out.stripped, `verb=${v}`).toHaveLength(1);
      expect(out.text, `verb=${v}`).toContain('before');
      expect(out.text, `verb=${v}`).toContain('after');
      expect(out.text, `verb=${v}`).not.toMatch(/\[/);
    }
  });

  it('a bracketed span that is not a recognized placeholder verb is left alone', () => {
    const text = 'See [Appendix A] for details.';
    expect(stripPastePlaceholders(text)).toEqual({ text, stripped: [] });
  });

  it('never touches text on a different line than the placeholder', () => {
    const text = 'Line one stays whole.\n[PASTE X]\nLine three also stays whole.';
    const out = stripPastePlaceholders(text);
    expect(out.text).toContain('Line one stays whole.');
    expect(out.text).toContain('Line three also stays whole.');
  });

  it('collapses runs of 3+ spaces left behind, but not ordinary single spaces', () => {
    const out = stripPastePlaceholders('a [PASTE X]     b');
    expect(out.text).not.toMatch(/ {3,}/);
  });
});
