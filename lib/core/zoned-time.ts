// ════════════════════════════════════════════════════════════════════════════════════════════════
// A STATED ZONE IS A PLACE, NOT AN OFFSET (stabilization W20.B · invariant 14 TIME TRUTH).
//
// THE INCIDENT (owner walk, Sep 28): a counterparty wrote "Oct 12, 9.30 am CET"; the invite stored
// 08:30Z. On Oct 12 Central Europe is on SUMMER time (CEST, UTC+2), so the sender's 9:30 is 07:30Z —
// the invite was an hour late, and read "right" only because the user's own zone (Lisbon) happens
// to sit one hour behind. People write the zone's WINTER name all year round ("CET", "GMT", "EST");
// what they mean is THEIR REGION'S LOCAL TIME ON THAT DATE.
//
// THE LAW: a named zone abbreviation resolves to its IANA region (CET → Europe/Paris, WET →
// Europe/Lisbon, GMT/BST → Europe/London, EST/EDT/ET → America/New_York, PT → America/Los_Angeles …)
// and the wall-clock time is converted with THAT REGION'S offset ON THAT DATE (DST included). Code
// computes it — never a model, never a fixed offset.
//
// Two consumers:
//   · `correctStatedZone` — the invite grounding's post-model floor (lib/home/prepare-action.ts):
//     a model-returned instant that equals the stated wall time read with the abbreviation's FIXED
//     offset (or the user's zone) is re-resolved to the region's true instant.
//   · `statedMeetingTime` — the deterministic "a concrete date + time is stated" parser the
//     schedule-offer lane reads (lib/prepare/schedule-offer.ts): narrow by design (an explicit date
//     AND a clock time in one short clause, near a meeting word) — a missed catch costs one un-offered invite, a false catch
//     would propose a meeting nobody set.
//
// PURE, zero IO, client-safe (Intl only).
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** An abbreviation's REGION and the fixed offset (minutes east of UTC) its name literally denotes. */
export type ZoneAbbr = { iana: string; fixedOffsetMin: number | null };

/** THE ONE TABLE. `fixedOffsetMin` is what a naive reader would apply (CET = +60) — kept only so the
 *  floor can RECOGNISE that mistake; the answer always comes from `iana` on the date. A generic name
 *  (ET, PT…) has no fixed offset. UTC/Z are not regions: they mean UTC. */
export const ZONE_ABBREVIATIONS: Readonly<Record<string, ZoneAbbr>> = {
  CET: { iana: 'Europe/Paris', fixedOffsetMin: 60 },
  CEST: { iana: 'Europe/Paris', fixedOffsetMin: 120 },
  MEZ: { iana: 'Europe/Berlin', fixedOffsetMin: 60 },
  MESZ: { iana: 'Europe/Berlin', fixedOffsetMin: 120 },
  WET: { iana: 'Europe/Lisbon', fixedOffsetMin: 0 },
  WEST: { iana: 'Europe/Lisbon', fixedOffsetMin: 60 },
  GMT: { iana: 'Europe/London', fixedOffsetMin: 0 },
  BST: { iana: 'Europe/London', fixedOffsetMin: 60 },
  EET: { iana: 'Europe/Athens', fixedOffsetMin: 120 },
  EEST: { iana: 'Europe/Athens', fixedOffsetMin: 180 },
  EST: { iana: 'America/New_York', fixedOffsetMin: -300 },
  EDT: { iana: 'America/New_York', fixedOffsetMin: -240 },
  ET: { iana: 'America/New_York', fixedOffsetMin: null },
  CST: { iana: 'America/Chicago', fixedOffsetMin: -360 },
  CDT: { iana: 'America/Chicago', fixedOffsetMin: -300 },
  CT: { iana: 'America/Chicago', fixedOffsetMin: null },
  MST: { iana: 'America/Denver', fixedOffsetMin: -420 },
  MDT: { iana: 'America/Denver', fixedOffsetMin: -360 },
  MT: { iana: 'America/Denver', fixedOffsetMin: null },
  PST: { iana: 'America/Los_Angeles', fixedOffsetMin: -480 },
  PDT: { iana: 'America/Los_Angeles', fixedOffsetMin: -420 },
  PT: { iana: 'America/Los_Angeles', fixedOffsetMin: null },
  UTC: { iana: 'UTC', fixedOffsetMin: 0 },
};

const ABBR_ALT = Object.keys(ZONE_ABBREVIATIONS).sort((a, b) => b.length - a.length).join('|');

/** Minutes east of UTC that `tz` observes at the instant `ms`. */
export function zoneOffsetMin(ms: number, tz: string): number {
  try {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ms));
    const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? '0');
    const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') === 24 ? 0 : g('hour'), g('minute'), g('second'));
    return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
  } catch { return 0; }
}

/** The UTC instant of a WALL-CLOCK time in a region on a date ("2026-10-12", 9, 30, Europe/Paris →
 *  07:30Z). DST-true: the region's own offset at that local time. null on a bad date. */
export function wallTimeToUtc(dateStr: string, hour: number, minute: number, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, minute);
  if (!Number.isFinite(guess)) return null;
  let ms = guess - zoneOffsetMin(guess, tz) * 60000;
  // One refinement: across a DST edge the offset at the answer may differ from the guess's.
  const off2 = zoneOffsetMin(ms, tz);
  ms = guess - off2 * 60000;
  return new Date(ms).toISOString();
}

/** The local calendar day (YYYY-MM-DD) of an instant in a zone. */
function localDay(ms: number, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  } catch { return new Date(ms).toISOString().slice(0, 10); }
}

export type ZonedMention = { hour: number; minute: number; abbr: string; zone: ZoneAbbr; index: number };

/** Clock times written WITH a zone abbreviation ("9.30 am CET", "14:00 CEST", "10am (BST)", "3pm ET").
 *  The abbreviation is matched CASE-SENSITIVELY (upper case, as written) so ordinary words never
 *  read as zones ("est" in Portuguese, "pt" in a sentence). */
export function zonedTimesInText(text: string): ZonedMention[] {
  const out: ZonedMention[] = [];
  const re = new RegExp(`(?<![\\d:.])(\\d{1,2})(?:[:.h](\\d{2}))?\\s*([AaPp]\\.?[Mm]\\.?)?\\s*\\(?(${ABBR_ALT})(?![A-Za-z])`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text ?? ''))) !== null) {
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    const ap = (m[3] || '').toLowerCase().replace(/\./g, '');
    if (h > 23 || min > 59) continue;
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    out.push({ hour: h, minute: min, abbr: m[4], zone: ZONE_ABBREVIATIONS[m[4]], index: m.index });
  }
  return out;
}

/**
 * THE ZONE FLOOR for a model-resolved instant. When the text states "<time> <ABBR>" and `startISO`
 * is that wall time read with the abbreviation's FIXED offset, or in the user's own zone, or already
 * in the abbreviation's region — the region's DST-true instant for that date is returned. Anything
 * else (a different time, no zoned mention) → null: nothing is changed.
 */
export function correctStatedZone(startISO: string, text: string, userTz?: string | null): string | null {
  const t = Date.parse(String(startISO ?? ''));
  if (!Number.isFinite(t)) return null;
  for (const z of zonedTimesInText(text)) {
    const days = new Set<string>([localDay(t, z.zone.iana)]);
    if (z.zone.fixedOffsetMin !== null) days.add(new Date(t + z.zone.fixedOffsetMin * 60000).toISOString().slice(0, 10));
    if (userTz) days.add(localDay(t, userTz));
    for (const day of days) {
      const truth = wallTimeToUtc(day, z.hour, z.minute, z.zone.iana);
      if (!truth) continue;
      const readings: number[] = [Date.parse(truth)];
      if (z.zone.fixedOffsetMin !== null) {
        const [y, mo, d] = day.split('-').map(Number);
        readings.push(Date.UTC(y, mo - 1, d, z.hour, z.minute) - z.zone.fixedOffsetMin * 60000);
      }
      if (userTz) { const u = wallTimeToUtc(day, z.hour, z.minute, userTz); if (u) readings.push(Date.parse(u)); }
      if (readings.includes(t)) return truth;
    }
  }
  return null;
}

// ── THE STATED MEETING TIME (the schedule-offer lane's trigger) ──────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

/** Words that make a stated time a MEETING (a call, a session) rather than a deadline. */
export const MEETING_WORDS = /\b(call|meeting|meet|catch[- ]?up|chat|sync|session|demo|appointment|interview|workshop|kick-?off|walkthrough|zoom|teams|google meet|video|reunião|réunion|termin|visio|llamada|reunión)\b/i;

export type StatedMeetingTime = {
  /** The instant, UTC ISO. */
  startISO: string;
  /** The zone the wall time was read in (the stated region, else the caller's fallback). */
  timezone: string;
  /** The words that stated it (for provenance). */
  quote: string;
  /** Whether the zone came from the text (an abbreviation) or the caller's fallback. */
  zoneStated: boolean;
};

type DateHit = { month: number; day: number; year: number | null; start: number; end: number };

function datesIn(s: string): DateHit[] {
  const out: DateHit[] = [];
  const md = new RegExp(`\\b(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'gi');
  const dm = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_ALT})\\.?(?:,?\\s+(\\d{4}))?\\b`, 'gi');
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = md.exec(s)) !== null) out.push({ month: MONTHS[m[1].toLowerCase()], day: Number(m[2]), year: m[3] ? Number(m[3]) : null, start: m.index, end: m.index + m[0].length });
  while ((m = dm.exec(s)) !== null) out.push({ month: MONTHS[m[2].toLowerCase()], day: Number(m[1]), year: m[3] ? Number(m[3]) : null, start: m.index, end: m.index + m[0].length });
  while ((m = iso.exec(s)) !== null) out.push({ month: Number(m[2]), day: Number(m[3]), year: Number(m[1]), start: m.index, end: m.index + m[0].length });
  return out.filter((d) => d.month >= 1 && d.month <= 12 && d.day >= 1 && d.day <= 31);
}

type TimeHit = { hour: number; minute: number; abbr: string | null; start: number; end: number };

function timesIn(s: string): TimeHit[] {
  const out: TimeHit[] = [];
  // "9.30 am", "9:30", "14h30", "9am", "9 a.m." — a bare number is never a time.
  const re = new RegExp(`(?<![\\d:./-])(\\d{1,2})(?:([:.h])(\\d{2}))?\\s*([AaPp]\\.?[Mm]\\.?)?(?:\\s*\\(?(${ABBR_ALT})(?![A-Za-z]))?`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const hasMin = !!m[3];
    const ap = (m[4] || '').toLowerCase().replace(/\./g, '');
    if (!hasMin && !ap) continue;
    let h = Number(m[1]);
    const min = hasMin ? Number(m[3]) : 0;
    if (h > 23 || min > 59) continue;
    if (ap && h > 12) continue;
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    out.push({ hour: h, minute: min, abbr: m[5] ?? null, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/**
 * A CONCRETE MEETING TIME stated in a text: an explicit calendar date and a clock time in the SAME
 * short clause (≤40 chars apart), with a meeting word nearby. The year is the anchor's (the message's own date),
 * rolled forward when the date would otherwise sit before it. The zone is the stated abbreviation's
 * region, else `fallbackTz`. Returns the LAST such statement (the newest words win in a reply that
 * restates), or null. Pure.
 */
export function statedMeetingTime(text: string, anchorISO: string, fallbackTz: string): StatedMeetingTime | null {
  const anchor = Date.parse(anchorISO);
  if (!Number.isFinite(anchor)) return null;
  const s = String(text ?? '').replace(/\s+/g, ' ');
  const dates = datesIn(s);
  if (!dates.length) return null;
  const times = timesIn(s).filter((t) => !dates.some((d) => t.start >= d.start && t.start < d.end));
  if (!times.length) return null;
  let found: StatedMeetingTime | null = null;
  for (const d of dates.sort((a, b) => a.start - b.start)) {
    // The clock time belongs to THIS date: right after it ("Oct 12, 9.30 am") or just before it
    // ("at 9:30 on Oct 12") — within one short clause, never across the message.
    const near = times
      .map((t) => ({ t, gap: t.start >= d.end ? t.start - d.end : d.start - t.start }))
      .filter((x) => x.gap >= 0 && x.gap <= 40)
      .sort((a, b) => a.gap - b.gap)[0]?.t;
    if (!near) continue;
    // …and the statement is about a MEETING (a deadline "by Oct 12, 5pm" is not a time to meet).
    const window = s.slice(Math.max(0, d.start - 160), Math.min(s.length, d.end + 160));
    if (!MEETING_WORDS.test(window)) continue;
    const zone = near.abbr ? ZONE_ABBREVIATIONS[near.abbr] : null;
    const tz = zone?.iana ?? fallbackTz ?? 'UTC';
    const anchorDay = localDay(anchor, tz);
    let year = d.year ?? Number(anchorDay.slice(0, 4));
    const pad = (n: number) => String(n).padStart(2, '0');
    if (!d.year && `${year}-${pad(d.month)}-${pad(d.day)}` < anchorDay) year += 1;
    const dateStr = `${year}-${pad(d.month)}-${pad(d.day)}`;
    // A day that does not exist (Feb 30) is not a date.
    const probe = new Date(`${dateStr}T12:00:00Z`);
    if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== dateStr) continue;
    const iso = wallTimeToUtc(dateStr, near.hour, near.minute, tz);
    if (!iso) continue;
    const q0 = Math.min(d.start, near.start);
    found = { startISO: iso, timezone: tz, quote: s.slice(q0, Math.max(d.end, near.end)).trim().slice(0, 120), zoneStated: !!zone };
  }
  return found;
}
