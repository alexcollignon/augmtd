import { describe, it, expect } from 'vitest';
import { localNow, timesInText, dateStatedInText, quoteProvesDate } from '@/lib/utils/user-time';

describe('localNow', () => {
  it('formats a known instant in a known timezone', () => {
    const d = new Date('2026-09-22T14:30:00Z');
    const r = localNow('UTC', d);
    expect(r.tz).toBe('UTC');
    expect(r.dateStr).toBe('2026-09-22');
    expect(r.hhmm).toBe('14:30');
    expect(r.pretty).toContain('2026');
  });

  it('shifts the date boundary correctly across a timezone (Lisbon, WEST +1)', () => {
    // 23:30 UTC on the 21st is 00:30 on the 22nd in Lisbon during summer time.
    const d = new Date('2026-09-21T23:30:00Z');
    const r = localNow('Europe/Lisbon', d);
    expect(r.dateStr).toBe('2026-09-22');
    expect(r.hhmm).toBe('00:30');
  });

  it('midnight hour renders as 00, never 24', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    const r = localNow('UTC', d);
    expect(r.hhmm).toBe('00:00');
  });

  it('falls back to UTC on an invalid timezone without throwing', () => {
    const d = new Date('2026-09-22T14:30:00Z');
    const r = localNow('Not/A_Zone', d);
    expect(r.tz).toBe('UTC');
    expect(r.dateStr).toBe('2026-09-22');
  });
});

describe('timesInText', () => {
  it('parses a 24h colon time', () => {
    expect(timesInText('meet at 12:30')).toEqual(['12:30']);
  });

  it('parses PM correctly, rolling into 24h', () => {
    expect(timesInText('call at 3:00pm')).toContain('15:00');
  });

  it('parses 12pm as noon and 12am as midnight', () => {
    expect(timesInText('12:00pm')).toContain('12:00');
    expect(timesInText('12:00am')).toContain('00:00');
  });

  it('accepts the "9h30" French/German-style separator', () => {
    expect(timesInText('rendez-vous à 9h30')).toContain('09:30');
  });

  it('rejects an impossible hour or minute', () => {
    expect(timesInText('25:00 and 10:61')).toEqual([]);
  });

  it('dedupes repeated times', () => {
    expect(timesInText('12:30 then again at 12:30')).toEqual(['12:30']);
  });

  it('returns an empty array when no time is stated', () => {
    expect(timesInText('no time here at all')).toEqual([]);
  });
});

describe('dateStatedInText — layer 1, deterministic', () => {
  it('matches an ISO date verbatim', () => {
    expect(dateStatedInText('the deadline is 2026-09-25', '2026-09-25')).toBe(true);
  });

  it('matches an English long month rendering', () => {
    expect(dateStatedInText('due by September 25', '2026-09-25')).toBe(true);
  });

  it('matches a Portuguese "D de MMMM" rendering', () => {
    expect(dateStatedInText('até 25 de setembro', '2026-09-25')).toBe(true);
  });

  it('matches a German "D. MMMM" rendering', () => {
    expect(dateStatedInText('bis zum 25. September', '2026-09-25')).toBe(true);
  });

  it('matches a French "Der MMMM" rendering (1er)', () => {
    expect(dateStatedInText('le 1er septembre', '2026-09-01')).toBe(true);
  });

  it('matches a bare weekday name (covers "by Thursday")', () => {
    // 2026-09-24 is a Thursday.
    expect(dateStatedInText('by Thursday please', '2026-09-24')).toBe(true);
  });

  it('matches accented text against unaccented candidates (fold)', () => {
    expect(dateStatedInText('ATÉ 25 DE SETEMBRO', '2026-09-25')).toBe(true);
  });

  it('returns false when the date is not stated anywhere', () => {
    expect(dateStatedInText('let us talk soon', '2026-09-25')).toBe(false);
  });

  it('returns false on a malformed ISO date', () => {
    expect(dateStatedInText('September 25', '2026-09-XX')).toBe(false);
  });

  it('matches a DE-style numeric date "25.09."', () => {
    expect(dateStatedInText('Termin am 25.09.', '2026-09-25')).toBe(true);
  });
});

describe('quoteProvesDate — the model proposes, code disposes', () => {
  const text = 'Please confirm by 25 September for the launch.';

  it('accepts a verbatim quote that names day+month', () => {
    expect(quoteProvesDate(text, '25 September', '2026-09-25')).toBe(true);
  });

  it('rejects a quote that is not actually in the text (non-verbatim)', () => {
    expect(quoteProvesDate(text, '25 October', '2026-09-25')).toBe(false);
  });

  it('rejects a quote missing the day number', () => {
    expect(quoteProvesDate('sometime in September', 'in September', '2026-09-25')).toBe(false);
  });

  it('rejects a quote where the day number belongs to a different reading (le 11 septembre ≠ Nov 11)', () => {
    // "11" appears, but claiming it proves 2026-11-11 (November) requires the month too.
    expect(quoteProvesDate('le 11 septembre', '11 septembre', '2026-11-11')).toBe(false);
  });

  it('rejects an empty or absurdly long quote', () => {
    expect(quoteProvesDate(text, '', '2026-09-25')).toBe(false);
    expect(quoteProvesDate(text, 'x'.repeat(300), '2026-09-25')).toBe(false);
  });

  it('accepts the bare ISO string as a quote when present in text', () => {
    expect(quoteProvesDate('deadline: 2026-09-25 sharp', '2026-09-25', '2026-09-25')).toBe(true);
  });
});
