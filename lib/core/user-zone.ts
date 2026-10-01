// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE READER'S ZONE (invariant 14 TIME TRUTH · law `one-reader-zone`, docs/laws-registry.json).
//
// THE INCIDENT (owner walk, Oct 1): the same calendar event read 10:00 on Home and 11:00 on Meetings.
// Home's times are composed on the server in THE USER'S ZONE (lib/utils/user-time.ts userTimezone —
// derived from the user's own calendar); Meetings formatted the same instant in the BROWSER's zone.
// Two clocks, one event, two answers — and a reader has no way to know which one is lying.
//
// THE LAW: every surface that renders an event's clock time or calendar day renders it in ONE zone —
// the user's zone, served by the shell (context/user-zone-context.tsx, from the server's one reader).
// The browser's zone is only the fallback when the server knows none (no calendar yet). When the
// device disagrees with the user's zone, ONE quiet hint says so (components/one/zone-hint.tsx) —
// the times never silently switch.
//
// PURE, zero IO, client-safe (Intl only). Gate: tests/unit/user-zone.test.ts (+ the render-site sweep).
// ════════════════════════════════════════════════════════════════════════════════════════════════

const validZone = (tz: string | null | undefined): string | null => {
  if (!tz || typeof tz !== 'string') return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return null; }
};

/** The device's own zone (the fallback only), or null when the runtime cannot say. */
export function browserZone(): string | null {
  try { return validZone(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { return null; }
}

/** THE ONE CHOICE: the served user zone when valid, else the device's, else UTC. */
export function readerZone(served: string | null | undefined): string {
  return validZone(served) ?? browserZone() ?? 'UTC';
}

const toDate = (at: string | number | Date): Date => (at instanceof Date ? at : new Date(at));

/** An instant's wall clock in a zone: its calendar day (YYYY-MM-DD) and hour/minute (24h). */
export function zonedClock(at: string | number | Date, zone: string): { dayKey: string; hour: number; minute: number } | null {
  const d = toDate(at);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d);
    const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
    const hour = Number(g('hour')) % 24;
    return { dayKey: `${g('year')}-${g('month')}-${g('day')}`, hour, minute: Number(g('minute')) };
  } catch { return null; }
}

/** The calendar day (YYYY-MM-DD) an instant falls on in a zone ('' on a bad instant). */
export function dayKeyIn(at: string | number | Date, zone: string): string {
  return zonedClock(at, zone)?.dayKey ?? '';
}

/** The calendar day (YYYY-MM-DD) of a LOCAL calendar Date (a grid column, a picker day) — no zone
 *  conversion: the Date's own y/m/d are the day it names. */
export function dayKeyOfLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** An event's clock time in a zone: '24h' → "10:00", '12h' → "10:00 AM" ('' on a bad instant). */
export function clockIn(at: string | number | Date, zone: string, style: '24h' | '12h' = '24h'): string {
  const d = toDate(at);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return style === '24h'
      ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zone }).format(d)
      : new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: zone }).format(d);
  } catch { return ''; }
}

/** A day label for an instant in a zone ("Thu, Oct 1"), via Intl date options. */
export function dateIn(at: string | number | Date, zone: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }, locale = 'en-US'): string {
  const d = toDate(at);
  if (Number.isNaN(d.getTime())) return '';
  try { return new Intl.DateTimeFormat(locale, { ...opts, timeZone: zone }).format(d); } catch { return ''; }
}

/** Minutes east of UTC a zone observes at an instant. */
function offsetMin(zone: string, ms: number): number {
  const c = zonedClock(ms, zone);
  if (!c) return 0;
  const [y, mo, d] = c.dayKey.split('-').map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, c.hour, c.minute);
  return Math.round((asUtc - Math.floor(ms / 60000) * 60000) / 60000);
}

/** Do two zones show DIFFERENT clocks right now? (Same offset under two names — Lisbon/London — is
 *  not a disagreement: the reader sees the same times.) */
export function zonesDisagree(a: string | null | undefined, b: string | null | undefined, atMs = Date.now()): boolean {
  const za = validZone(a), zb = validZone(b);
  if (!za || !zb || za === zb) return false;
  return offsetMin(za, atMs) !== offsetMin(zb, atMs);
}

/** A zone's plain place name ("Europe/Lisbon" → "Lisbon", "America/New_York" → "New York"). */
export function zonePlace(zone: string): string {
  const last = zone.split('/').pop() ?? zone;
  return last.replace(/_/g, ' ');
}

/** THE ONE HINT — null when the device agrees with the user's zone (or the user's zone is unknown). */
export function zoneHintText(userZone: string | null | undefined, deviceZone: string | null | undefined, atMs = Date.now()): string | null {
  const u = validZone(userZone), dz = validZone(deviceZone);
  if (!u || !dz || !zonesDisagree(u, dz, atMs)) return null;
  return `Times are in ${zonePlace(u)} time, your calendar's zone — this device is set to ${zonePlace(dz)} time.`;
}

/** The LOCAL calendar Date (midnight) naming the day an instant falls on IN THE USER'S ZONE — so a
 *  grid built from local calendar Dates (month/week views keyed by `toDateString()`) buckets an event
 *  on its day in the user's zone, never the device's. */
export function calendarDateIn(at: string | number | Date, zone: string): Date {
  const key = dayKeyIn(at, zone);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(NaN);
}
