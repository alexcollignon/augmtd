// ─── Minimal cron parser ──────────────────────────────────────────────────────
// Supports standard 5-field cron: minute hour day-of-month month day-of-week.
// Fields accept: *, number, comma-list (1,5,9), range (1-5), step (*/5 or 0-30/5).
// Day-of-month and day-of-week use "OR" semantics when both are constrained
// (Vixie cron convention). If only one is constrained, the other acts as "*".
// No special strings (@daily, @hourly) — users configure via builder UI.

import type { ScheduleTrigger } from './types';

interface ParsedField {
  values: Set<number>;       // explicit values this field matches
  isWildcard: boolean;       // true if field is "*" (unconstrained)
}

const FIELD_RANGES: Array<[number, number]> = [
  [0, 59],   // minute
  [0, 23],   // hour
  [1, 31],   // day-of-month
  [1, 12],   // month
  [0, 6],    // day-of-week (0 = Sunday)
];

function parseField(raw: string, min: number, max: number): ParsedField {
  if (raw === '*') {
    const values = new Set<number>();
    for (let i = min; i <= max; i++) values.add(i);
    return { values, isWildcard: true };
  }

  const values = new Set<number>();
  const parts = raw.split(',');

  for (const part of parts) {
    // step: */N or RANGE/N
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    let base = part;
    let step = 1;
    if (stepMatch) {
      base = stepMatch[1];
      step = parseInt(stepMatch[2], 10);
      if (!Number.isFinite(step) || step <= 0) {
        throw new Error(`Invalid cron step: "${part}"`);
      }
    }

    let start = min;
    let end = max;
    if (base === '*') {
      // use full range
    } else if (base.includes('-')) {
      const [s, e] = base.split('-').map(n => parseInt(n, 10));
      if (!Number.isFinite(s) || !Number.isFinite(e)) {
        throw new Error(`Invalid cron range: "${part}"`);
      }
      start = s;
      end = e;
    } else {
      const n = parseInt(base, 10);
      if (!Number.isFinite(n)) throw new Error(`Invalid cron value: "${part}"`);
      start = n;
      end = n;
    }

    if (start < min || end > max || start > end) {
      throw new Error(`Cron value out of range: "${part}"`);
    }
    for (let i = start; i <= end; i += step) values.add(i);
  }

  return { values, isWildcard: false };
}

export interface ParsedCron {
  minute: ParsedField;
  hour: ParsedField;
  dayOfMonth: ParsedField;
  month: ParsedField;
  dayOfWeek: ParsedField;
}

export function parseCron(expr: string): ParsedCron {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${fields.length}`);
  }
  return {
    minute:     parseField(fields[0], ...FIELD_RANGES[0]),
    hour:       parseField(fields[1], ...FIELD_RANGES[1]),
    dayOfMonth: parseField(fields[2], ...FIELD_RANGES[2]),
    month:      parseField(fields[3], ...FIELD_RANGES[3]),
    dayOfWeek:  parseField(fields[4], ...FIELD_RANGES[4]),
  };
}

// ─── Timezone-aware next-run computation ─────────────────────────────────────
// Strategy: compute the "wall clock" time in the target timezone minute-by-minute
// using Intl.DateTimeFormat, advancing until we find a match. Limited to 1 year
// lookahead to avoid infinite loops on impossible schedules (e.g. "0 0 31 2 *").

function wallClockInTz(date: Date, timeZone: string): {
  year: number; month: number; day: number; hour: number; minute: number; dayOfWeek: number;
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year:      parseInt(get('year'), 10),
    month:     parseInt(get('month'), 10),
    day:       parseInt(get('day'), 10),
    hour:      parseInt(get('hour'), 10) % 24,   // Intl may return 24 for midnight
    minute:    parseInt(get('minute'), 10),
    dayOfWeek: weekdayMap[get('weekday')] ?? 0,
  };
}

function matchesCron(parsed: ParsedCron, wall: ReturnType<typeof wallClockInTz>): boolean {
  if (!parsed.minute.values.has(wall.minute)) return false;
  if (!parsed.hour.values.has(wall.hour)) return false;
  if (!parsed.month.values.has(wall.month)) return false;
  // DOM / DOW OR semantics: if both are constrained, either match is enough.
  const domMatch = parsed.dayOfMonth.values.has(wall.day);
  const dowMatch = parsed.dayOfWeek.values.has(wall.dayOfWeek);
  if (parsed.dayOfMonth.isWildcard && parsed.dayOfWeek.isWildcard) return true;
  if (parsed.dayOfMonth.isWildcard) return dowMatch;
  if (parsed.dayOfWeek.isWildcard) return domMatch;
  return domMatch || dowMatch;
}

/** Compute the next matching time strictly after `after`. Returns null if none within 1 year. */
export function computeNextRun(cron: string, timezone: string | undefined, after: Date = new Date()): Date | null {
  const parsed = parseCron(cron);
  const tz = timezone || 'UTC';

  // Start at the next whole minute after `after`.
  const start = new Date(Math.ceil(after.getTime() / 60000) * 60000);
  const maxLookahead = 365 * 24 * 60; // minutes in a year
  for (let i = 0; i < maxLookahead; i++) {
    const candidate = new Date(start.getTime() + i * 60000);
    const wall = wallClockInTz(candidate, tz);
    if (matchesCron(parsed, wall)) return candidate;
  }
  return null;
}

export function nextRunFromTrigger(trigger: { type: string; cron?: string; timezone?: string }, after?: Date): Date | null {
  if (trigger.type !== 'schedule' || !trigger.cron) return null;
  return computeNextRun(trigger.cron, trigger.timezone, after);
}

const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function fmtTime(hour: number, minute: number): string {
  const suffix = hour < 12 ? 'am' : 'pm';
  const h = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const m = minute === 0 ? '' : `:${String(minute).padStart(2, '0')}`;
  return `${h}${m}${suffix}`;
}

/** Convert a cron expression + optional timezone into a plain-English description. */
export function describeCron(cron: string, timezone?: string): string {
  try {
    const [min, hr, dom, , dow] = cron.trim().split(/\s+/);
    const tzStr = timezone ? ` (${timezone})` : '';

    // Sub-daily: hour field is */N or *
    if (hr === '*') return `Every hour${tzStr}`;
    const stepMatch = hr.match(/^\*\/(\d+)$/);
    if (stepMatch) {
      const n = parseInt(stepMatch[1], 10);
      return `Every ${n} hours${tzStr}`;
    }

    const hour   = parseInt(hr,  10);
    const minute = parseInt(min, 10);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) throw new Error();

    const timeStr = fmtTime(hour, minute);

    // Monthly
    if (dom !== '*') return `1st of every month at ${timeStr}${tzStr}`;

    // Daily
    if (dow === '*') return `Every day at ${timeStr}${tzStr}`;

    // Weekly — one or more specific days
    const days = dow.split(',').map(Number).filter(d => Number.isFinite(d) && d >= 0 && d <= 6);
    if (days.length === 0) return `Every day at ${timeStr}${tzStr}`;
    if (days.length === 5 && days.every(d => d >= 1 && d <= 5))
      return `Every weekday at ${timeStr}${tzStr}`;
    if (days.length === 7) return `Every day at ${timeStr}${tzStr}`;
    const dayNames = days.sort((a, b) => a - b).map(d => DOW_FULL[d]).join(', ');
    return `Every ${dayNames} at ${timeStr}${tzStr}`;
  } catch {
    return cron;
  }
}

/** Validate a cron expression by attempting to parse it. Returns error message or null. */
export function validateCron(cron: string): string | null {
  try {
    parseCron(cron);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid cron expression';
  }
}

/** Common preset cron expressions for the builder UI. */
export const CRON_PRESETS: Array<{ label: string; cron: string }> = [
  { label: 'Every day at 9am',          cron: '0 9 * * *' },
  { label: 'Every weekday at 9am',      cron: '0 9 * * 1-5' },
  { label: 'Every Monday at 9am',       cron: '0 9 * * 1' },
  { label: 'Mon/Wed/Fri at 9am',        cron: '0 9 * * 1,3,5' },
  { label: 'Every day at noon',         cron: '0 12 * * *' },
  { label: 'Every Monday at 8am',       cron: '0 8 * * 1' },
  { label: 'First of the month at 9am', cron: '0 9 1 * *' },
];
