// W20.B · A STATED ZONE IS A PLACE, NOT AN OFFSET (TIME TRUTH). "9.30 am CET" on Oct 12 is the sender's
// Paris time — CEST that day — so 07:30Z, never the fixed-offset 08:30Z the invite stored. Across every
// DST boundary the named zone resolves through its IANA region ON THAT DATE.
import { describe, expect, it } from 'vitest';
import { correctStatedZone, statedMeetingTime, wallTimeToUtc, zonedTimesInText } from '@/lib/core/zoned-time';

describe('wallTimeToUtc — the region on the date', () => {
  it.each([
    // Central Europe: CEST until the last Sunday of October (Oct 25, 2026), CET after; CEST from Mar 29.
    ['2026-10-12', 9, 30, 'Europe/Paris', '2026-10-12T07:30:00.000Z'],
    ['2026-10-24', 9, 30, 'Europe/Paris', '2026-10-24T07:30:00.000Z'],
    ['2026-10-26', 9, 30, 'Europe/Paris', '2026-10-26T08:30:00.000Z'],
    ['2026-03-28', 9, 30, 'Europe/Paris', '2026-03-28T08:30:00.000Z'],
    ['2026-03-30', 9, 30, 'Europe/Paris', '2026-03-30T07:30:00.000Z'],
    // Western Europe (Lisbon): WEST in summer, WET in winter.
    ['2026-07-01', 10, 0, 'Europe/Lisbon', '2026-07-01T09:00:00.000Z'],
    ['2026-12-01', 10, 0, 'Europe/Lisbon', '2026-12-01T10:00:00.000Z'],
    // UK: BST in summer, GMT in winter.
    ['2026-06-15', 14, 0, 'Europe/London', '2026-06-15T13:00:00.000Z'],
    ['2026-11-15', 14, 0, 'Europe/London', '2026-11-15T14:00:00.000Z'],
    // US East: EDT until Nov 1, 2026, EST after.
    ['2026-10-30', 9, 0, 'America/New_York', '2026-10-30T13:00:00.000Z'],
    ['2026-11-02', 9, 0, 'America/New_York', '2026-11-02T14:00:00.000Z'],
  ])('%s %i:%i %s → %s', (d, h, m, tz, want) => {
    expect(wallTimeToUtc(d, h, m, tz)).toBe(want);
  });
});

describe('correctStatedZone — the invite floor', () => {
  it('the incident: "Oct 12, 9.30 am CET" stored at the fixed +1 (08:30Z) → 07:30Z', () => {
    expect(correctStatedZone('2026-10-12T08:30:00.000Z', 'Confirming the call — Oct 12, 9.30 am CET.', 'Europe/Lisbon')).toBe('2026-10-12T07:30:00.000Z');
  });
  it('CET in winter is CET: the fixed reading is already true (returned unchanged)', () => {
    expect(correctStatedZone('2026-11-12T08:30:00.000Z', 'Nov 12, 9.30 am CET', 'Europe/Lisbon')).toBe('2026-11-12T08:30:00.000Z');
  });
  it('"CEST" written in winter still means Paris local time that day', () => {
    expect(correctStatedZone('2026-11-12T07:30:00.000Z', 'Nov 12 at 9:30 CEST', null)).toBe('2026-11-12T08:30:00.000Z');
  });
  it('WET in summer → Lisbon summer time; BST/GMT → London that day', () => {
    expect(correctStatedZone('2026-07-01T10:00:00.000Z', 'July 1, 10:00 WET', null)).toBe('2026-07-01T09:00:00.000Z');
    expect(correctStatedZone('2026-06-15T14:00:00.000Z', 'June 15 at 2pm GMT', null)).toBe('2026-06-15T13:00:00.000Z');
    expect(correctStatedZone('2026-11-15T13:00:00.000Z', 'Nov 15 at 2pm BST', null)).toBe('2026-11-15T14:00:00.000Z');
  });
  it('the model read the zone in the USER\'s region → corrected to the stated region', () => {
    // 9:30 Lisbon on Oct 12 = 08:30Z; the sender meant Paris.
    expect(correctStatedZone('2026-10-12T08:30:00.000Z', '9:30 CET on 12 October', 'Europe/Lisbon')).toBe('2026-10-12T07:30:00.000Z');
  });
  it('a time the text never states with a zone is left alone', () => {
    expect(correctStatedZone('2026-10-12T15:00:00.000Z', 'Oct 12, 9.30 am CET', 'Europe/Lisbon')).toBeNull();
    expect(correctStatedZone('2026-10-12T08:30:00.000Z', 'Oct 12, 9.30 am', 'Europe/Lisbon')).toBeNull();
  });
  it('lower-case words are never zones', () => {
    expect(zonedTimesInText('ele está às 9h est')).toHaveLength(0);
  });
});

describe('statedMeetingTime — the schedule offer\'s trigger', () => {
  it('the incident: a concrete future call time in the stated zone', () => {
    const s = statedMeetingTime('Great — confirming the implementation call, Oct 12, 9.30 AM CET.', '2026-09-27T10:00:00Z', 'Europe/Lisbon');
    expect(s?.startISO).toBe('2026-10-12T07:30:00.000Z');
    expect(s?.zoneStated).toBe(true);
  });
  it('no zone → the fallback region', () => {
    expect(statedMeetingTime("Let's meet on 3rd of November at 10:00", '2026-10-20T10:00:00Z', 'Europe/Lisbon')?.startISO).toBe('2026-11-03T10:00:00.000Z');
  });
  it('a deadline is not a meeting; a date without a time is not concrete', () => {
    expect(statedMeetingTime('Please send the signed offer by Oct 12, 5pm.', '2026-09-27T10:00:00Z', 'UTC')).toBeNull();
    expect(statedMeetingTime("Let's have the call on Oct 12.", '2026-09-27T10:00:00Z', 'UTC')).toBeNull();
  });
  it('a month/day before the message rolls to next year', () => {
    expect(statedMeetingTime('Call on Jan 5 at 9am', '2026-12-20T10:00:00Z', 'UTC')?.startISO).toBe('2027-01-05T09:00:00.000Z');
  });
});
