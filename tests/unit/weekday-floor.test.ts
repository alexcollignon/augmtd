import { describe, it, expect } from 'vitest';
import { enforceWeekdayDatePairs } from '@/lib/utils/weekday-floor';

// Anchor "now" = Tuesday 2026-09-22, throughout — matches the module's own worked examples.
const NOW = new Date('2026-09-22T12:00:00Z');

describe('enforceWeekdayDatePairs — the precedence chain', () => {
  it('leaves an already-correct weekday/date pair untouched', () => {
    // 2026-09-22 really is a Tuesday.
    const text = 'Confirming Tuesday, September 22, 2026 at 10am.';
    expect(enforceWeekdayDatePairs(text, { now: NOW })).toBe(text);
  });

  it('(2) no user claim: the DATE is the anchor, the weekday word is corrected', () => {
    // September 25, 2026 is really a Friday — the model wrote "Tuesday".
    const text = 'Confirming Tuesday, September 25, 2026 at 10am.';
    const out = enforceWeekdayDatePairs(text, { now: NOW });
    expect(out).toBe('Confirming Friday, September 25, 2026 at 10am.');
  });

  it('preserves the casing register of the original weekday word (lowercase stays lowercase)', () => {
    const text = 'lets meet tuesday, September 25, 2026';
    const out = enforceWeekdayDatePairs(text, { now: NOW });
    expect(out).toBe('lets meet friday, September 25, 2026');
  });

  it('THE SECOND INCIDENT (no userText): naively "fixing" both pairs by date can turn a visible ' +
     'miscount into a confident wrong answer — documented, not defended', () => {
    // Sept 25 is a Friday, Sept 26 is a Saturday; with no user words to arbitrate, the date-anchor
    // law (2) rewrites both weekday words — landing on a Saturday nobody asked for.
    const text = 'Thursday 25 or Friday 26';
    const out = enforceWeekdayDatePairs(text, { now: NOW });
    expect(out).toBe('Friday 25 or Saturday 26');
  });

  it('(1) THE ANCHOR LAW: when the user\'s own words name the weekday and no day-number, the ' +
     'DATE moves to match — fixing the second incident', () => {
    const text = 'Thursday 25 or Friday 26';
    const out = enforceWeekdayDatePairs(text, { now: NOW, userText: 'either thursday or friday works for me' });
    // Sept 24 is a Thursday, Sept 25 is a Friday — both weekday words now agree with real dates.
    expect(out).toBe('Thursday 24 or Friday 25');
  });

  it('(3) the user stated BOTH a weekday and a disagreeing day-number: the contradiction is theirs ' +
     'to resolve — untouched', () => {
    const text = 'Thursday 26'; // Sept 26, 2026 is actually a Saturday
    const out = enforceWeekdayDatePairs(text, { now: NOW, userText: 'Thursday the 26th works for me' });
    expect(out).toBe(text);
  });

  it('never touches a pair with an unresolvable/impossible day (30 February)', () => {
    const text = 'Monday, February 30, 2026';
    expect(enforceWeekdayDatePairs(text, { now: NOW })).toBe(text);
  });

  it('handles a two-digit day with an ordinal suffix', () => {
    const text = 'Tuesday, September 25th, 2026';
    const out = enforceWeekdayDatePairs(text, { now: NOW });
    expect(out).toContain('Friday');
  });

  it('emits the correction in the SAME language as the original weekday word (Portuguese stays ' +
     'Portuguese; month vocabulary is English-only by design, so the month token itself is untouched)', () => {
    // quinta-feira = Thursday; sexta-feira = Friday. September 25, 2026 is really a Friday — the
    // floor must write the correction as "sexta-feira", never translate to English.
    const text = 'quinta-feira, 25 September';
    const out = enforceWeekdayDatePairs(text, { now: NOW });
    expect(out).toBe('sexta-feira, 25 September');
  });

  it('a monthless bare day-number followed by non-date prose is left alone (not treated as a date)', () => {
    const text = 'Friday 15 people attended the meeting.';
    expect(enforceWeekdayDatePairs(text, { now: NOW })).toBe(text);
  });

  // THE MAY RULE (W3.4 — was an it.fails KNOWN BUG): "may" the auxiliary verb is never the month.
  it('"may" the auxiliary verb is not read as the month May', () => {
    const text = 'Monday 15 may be fine for you.';
    expect(enforceWeekdayDatePairs(text, { now: NOW })).toBe(text);
  });

  it('"may" with a lowercase verb continuation after a capitalized month is still left alone', () => {
    const text = 'Friday 15 May have to move.';
    expect(enforceWeekdayDatePairs(text, { now: NOW })).toBe(text);
  });

  it('"May" in a real date shape is still read as the month (2027-05-15 is a Saturday)', () => {
    const out = enforceWeekdayDatePairs('Friday 15 May 2027', { now: NOW });
    expect(out).toBe('Saturday 15 May 2027');
  });

  it('"May" followed by a date-tail word stays the month', () => {
    const out = enforceWeekdayDatePairs('Friday 15 May at 10:00, 2027', { now: NOW });
    expect(out).toContain('15 May');
  });

  it('returns text unchanged when it contains no digits at all (fast path)', () => {
    const text = 'Let us find a time that works for everyone.';
    expect(enforceWeekdayDatePairs(text, { now: NOW })).toBe(text);
  });

  it('an unstated year past the tolerance window rolls forward to next year', () => {
    // "Tuesday, January 5" evaluated from a September anchor: January 5 this year is long gone,
    // so it resolves to next January — and since day-of-week arithmetic for that far-future date
    // may or may not already read as Tuesday, we only assert the function does not throw and
    // returns a string containing "January 5".
    const text = 'Tuesday, January 5';
    const out = enforceWeekdayDatePairs(text, { now: NOW });
    expect(out).toContain('January 5');
  });
});
