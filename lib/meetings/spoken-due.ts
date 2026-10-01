/**
 * THE SPOKEN DEADLINE (W29 · invariant 14 TIME TRUTH, meeting lane). Pure, client-safe, zero AI.
 *
 * A meeting says "next week", "today", "by Friday". The resolved YYYY-MM-DD is only half the fact:
 * when the words name no single day ("next week", "end of the month") the date is honestly null —
 * and the words were being DROPPED, so the card said "no due date" for a deadline that was spoken.
 * The words now ride beside the date (`dueText`, additive in the existing action-item JSON), and the
 * day-words code CAN resolve are resolved here against the MEETING'S OWN local date — never today's.
 */

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12));
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

/**
 * Resolve the day-words that name ONE day ("today", "tonight", "end of day", "tomorrow", "Friday",
 * "by Thursday", "next Monday") against the meeting's local date (YYYY-MM-DD). Anything else —
 * a span ("next week", "this month"), an unknown phrase — returns null: the words stand alone.
 */
export function resolveSpokenDue(words: string | null | undefined, meetingLocalDate: string | null | undefined): string | null {
  if (!words || !meetingLocalDate || !/^\d{4}-\d{2}-\d{2}$/.test(meetingLocalDate)) return null;
  const t = words.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\b(week|month|quarter|year|weeks|months)\b/.test(t)) return null; // a span, not a day
  if (/\b(today|tonight|end of (the )?day|eod|this afternoon|this evening)\b/.test(t)) return meetingLocalDate;
  if (/\btomorrow\b/.test(t)) return addDays(meetingLocalDate, 1);
  const day = WEEKDAYS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(t));
  if (day < 0) return null;
  const from = weekdayOf(meetingLocalDate);
  let ahead = (day - from + 7) % 7;
  if (ahead === 0) ahead = 7; // "Friday" said on a Friday = the next one
  return addDays(meetingLocalDate, ahead);
}

/** Keep the spoken words; fill a missing date only when the words name one day. Never drops a word. */
export function withSpokenDue<T extends { dueDate?: string | null; dueText?: string | null }>(
  item: T, meetingLocalDate: string | null | undefined,
): T {
  const words = typeof item.dueText === 'string' && item.dueText.trim() ? item.dueText.trim() : undefined;
  if (!words) return { ...item, dueText: undefined };
  const due = item.dueDate || resolveSpokenDue(words, meetingLocalDate) || undefined;
  return { ...item, dueText: words, dueDate: due };
}
