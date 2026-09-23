import { describe, it, expect } from 'vitest';
import { namesOverlap, GENERIC_WORK_WORDS } from '@/lib/entities/recognize';

describe('namesOverlap', () => {
  it('matches when a distinctive token of the named engagement appears in the entity text', () => {
    expect(namesOverlap('Galp Energy Deal', 'we are working with Galp on the refinery project')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(namesOverlap('GALP', 'discussions with galp continue')).toBe(true);
  });

  it('returns false when no distinctive token appears', () => {
    expect(namesOverlap('Contoso Merger', 'this is about a completely different company entirely')).toBe(false);
  });

  it('an all-generic name (every token in GENERIC_WORK_WORDS) trusts the judge — returns true', () => {
    expect(namesOverlap('AI Assessment', 'anything at all, even unrelated text')).toBe(true);
  });

  it('generic words are filtered from the distinctive-token set', () => {
    // "New Project Review" is entirely generic tokens once "new"/"project"/"review" are excluded;
    // remaining token count is zero → treated as all-generic → true regardless of entity text.
    expect(namesOverlap('New Project Review', 'totally unrelated text about something else')).toBe(true);
  });

  it('short tokens (<3 chars) never count as distinctive', () => {
    // "Ib SA" — "sa" is 2 chars, dropped; "ib" is 2 chars, dropped too → all-generic → true.
    expect(namesOverlap('Ib SA', 'unrelated text')).toBe(true);
  });

  it('a mixed name needs only ONE distinctive token to overlap', () => {
    expect(namesOverlap('Acme Corp Rebrand Initiative', 'the acme team confirmed the new logo')).toBe(true);
  });

  it('ai/ia/ml acronyms are excluded as distinctive signal', () => {
    expect(namesOverlap('AI ML Pilot', 'nothing related here whatsoever')).toBe(true);
  });

  it('GENERIC_WORK_WORDS is the shared vocabulary the function filters against', () => {
    expect(GENERIC_WORK_WORDS.has('project')).toBe(true);
    expect(GENERIC_WORK_WORDS.has('galp')).toBe(false);
  });
});
