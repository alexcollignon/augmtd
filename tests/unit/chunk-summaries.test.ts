import { describe, it, expect } from 'vitest';
import { parseChunkSummaries, summaryMaxTokens, isThrottleError } from '@/lib/knowledge/chunk-summaries';

describe('chunk summaries — the keyed contract', () => {
  it('maps a keyed object, fenced, onto its slots', () => {
    expect(parseChunkSummaries('```json\n{"1": "Alpha tender.", "2": "Beta report."}\n```', 2)).toEqual(['Alpha tender.', 'Beta report.']);
  });
  it('salvages every COMPLETE pair from a reply cut off at max_tokens (the found failure)', () => {
    const cut = '```json\n{\n  "1": "Acme tender worth €547,504 matches.",\n  "2": "Globex \\"engineering\\" profile.",\n  "3": "Initech sanitation consul';
    expect(parseChunkSummaries(cut, 4)).toEqual(['Acme tender worth €547,504 matches.', 'Globex "engineering" profile.', null, null]);
  });
  it('a single chunk answered with two strings is joined, never discarded', () => {
    expect(parseChunkSummaries('["Charging tender, deadline 22/10.", "No matching profile."]', 1)).toEqual(['Charging tender, deadline 22/10. No matching profile.']);
  });
  it('a legacy array is accepted only when its length matches', () => {
    expect(parseChunkSummaries('["a one", "b two"]', 2)).toEqual(['a one', 'b two']);
    expect(parseChunkSummaries('["a one", "b two", "c three"]', 2)).toEqual([null, null]);
  });
  it('out-of-range keys and empty values leave the slot missing', () => {
    expect(parseChunkSummaries('{"0": "x", "9": "y", "1": ""}', 2)).toEqual([null, null]);
  });
  it('the output budget grows with the batch (8 dense chunks no longer fit in a flat 400)', () => {
    expect(summaryMaxTokens(8)).toBeGreaterThanOrEqual(8 * 60);
    expect(summaryMaxTokens(1)).toBeLessThan(summaryMaxTokens(8));
  });
  it('throttling is told apart from content failures', () => {
    expect(isThrottleError('ThrottlingException: Too many tokens per day')).toBe(true);
    expect(isThrottleError('429 rate limit exceeded')).toBe(true);
    expect(isThrottleError('Unexpected token in JSON')).toBe(false);
  });
});
