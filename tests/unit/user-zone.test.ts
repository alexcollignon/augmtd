// LAW `one-reader-zone` (invariant 14 TIME TRUTH) — the same event never shows two times.
// Outcome half: the helpers render one instant identically wherever they are called, in the user's
// zone. Sweep half: no client render site formats an event's time or day in the device's zone.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  clockIn, dayKeyIn, calendarDateIn, readerZone, zonesDisagree, zoneHintText, zonedClock, dateIn,
} from '@/lib/core/user-zone';
import { formatMeetingTime } from '@/lib/types/meetings';
import { localTimeLabel } from '@/lib/home/day';

const EVENT = '2026-10-01T09:00:00Z'; // 10:00 in Lisbon (WEST), 11:00 in Paris (CEST)

describe('one reader zone — outcomes', () => {
  it('Home (server label) and Meetings (client helpers) agree on the same event in the user zone', () => {
    const zone = 'Europe/Lisbon';
    expect(localTimeLabel(EVENT, zone)).toBe('10:00');
    expect(clockIn(EVENT, zone)).toBe('10:00');
    expect(formatMeetingTime(EVENT, '2026-10-01T09:30:00Z', zone).primary).toMatch(/10:00\sAM–10:30\sAM$/);
    // the device's zone never leaks in: the same helpers in another zone say another time
    expect(clockIn(EVENT, 'Europe/Paris')).toBe('11:00');
  });

  it('the served zone wins; the device zone is only the fallback; junk is refused', () => {
    expect(readerZone('Europe/Lisbon')).toBe('Europe/Lisbon');
    expect(readerZone('Not/AZone')).not.toBe('Not/AZone');
    expect(typeof readerZone(null)).toBe('string');
  });

  it('days bucket in the user zone, not the device zone', () => {
    const late = '2026-10-01T23:30:00Z'; // Oct 2 in Paris, still Oct 1 in New York
    expect(dayKeyIn(late, 'America/New_York')).toBe('2026-10-01');
    expect(dayKeyIn(late, 'Europe/Paris')).toBe('2026-10-02');
    const d = calendarDateIn(late, 'Europe/Paris');
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 10, 2]);
    expect(zonedClock(late, 'Europe/Paris')).toEqual({ dayKey: '2026-10-02', hour: 1, minute: 30 });
    expect(dateIn(late, 'America/New_York', { month: 'short', day: 'numeric' })).toBe('Oct 1');
  });

  it('the hint speaks only when the clocks really differ', () => {
    const at = Date.parse(EVENT);
    expect(zonesDisagree('Europe/Lisbon', 'Europe/London', at)).toBe(false); // same offset, two names
    expect(zonesDisagree('Europe/Lisbon', 'Europe/Paris', at)).toBe(true);
    expect(zoneHintText('Europe/Lisbon', 'Europe/Lisbon', at)).toBeNull();
    expect(zoneHintText(null, 'Europe/Paris', at)).toBeNull();
    expect(zoneHintText('Europe/Lisbon', 'Europe/Paris', at)).toBe(
      "Times are in Lisbon time, your calendar's zone — this device is set to Paris time.");
  });
});

// ── THE SWEEP: client render sites (components/**, app/** pages — never api routes) ───────────────
const ROOT = join(__dirname, '..', '..');
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!p.includes(`${join('app', 'api')}`)) walk(p, out); }
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}
// An EVENT field (start/end of a calendar event, transcript or proposal) formatted or bucketed with the
// device's clock, or the device's zone sent as the event's zone.
const DEVICE_EVENT_TIME = /new Date\(\s*[A-Za-z_.!?]*(?:start_time|end_time|startTime|endTime)\s*!?\)\.(?:toLocaleTimeString|toDateString|toLocaleDateString|toLocaleString|getHours|getMinutes)\b/;
const DEVICE_ZONE_AS_EVENT_ZONE = /const timezone = Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/;

describe('one reader zone — the render-site sweep', () => {
  it('no client surface formats an event time or day in the device zone', () => {
    const offenders: string[] = [];
    for (const f of [...walk(join(ROOT, 'components')), ...walk(join(ROOT, 'app'))]) {
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((l, i) => {
        if (DEVICE_EVENT_TIME.test(l) || DEVICE_ZONE_AS_EVENT_ZONE.test(l)) offenders.push(`${relative(ROOT, f)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('the shell serves the zone and the known surfaces read it', () => {
    const layout = readFileSync(join(ROOT, 'app', '(main)', 'layout.tsx'), 'utf8');
    expect(layout).toMatch(/<UserZoneProvider zone=\{userZone\}>/);
    expect(layout).toMatch(/servedUserTimezone\(/);
    for (const f of ['components/meetings/meetings-home.tsx', 'components/meetings/week-calendar.tsx', 'components/home/home-view.tsx']) {
      expect(readFileSync(join(ROOT, f), 'utf8'), f).toMatch(/useUserZone\(\)/);
    }
  });
});
