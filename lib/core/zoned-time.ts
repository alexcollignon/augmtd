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
//   · `statedMeetingTime` — the deterministic "a concrete day + time is stated" parser the
//     schedule-offer lane reads (lib/prepare/schedule-offer.ts): a DAY (a date, a weekday, tomorrow)
//     AND a clock time in one short clause, near a meeting word, never after a deadline word —
//     language-agnostic by data tables (W27.B). A missed catch costs one un-offered invite; a false
//     catch proposes a meeting nobody set (the card is still the user's click — nothing books).
//   · `wallClockToInstant` + `resolveStatedZone` (W27.B) — the invite grounding's conversion: the
//     model reports the wall clock AS STATED and the zone the source names; code does the arithmetic.
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

// ── THE WALL CLOCK IS THE MODEL'S, THE INSTANT IS CODE'S (W27.B · TIME TRUTH) ─────────────────────
// Found by the W26 eval: the invite grounding asked the model for "ISO 8601 datetimes … in the user's
// timezone" and parsed an OFFSET-LESS reply with `new Date()` — i.e. in the SERVER's zone (UTC on
// Vercel), so a Lisbon user's "Tuesday 3pm" became 15:00Z = 16:00 local; and the model's own zone
// arithmetic ("2.30 pm BST", "17:00 CET" the Monday after the clock change) came back an hour off.
// THE LAW: the model reports the WALL-CLOCK time exactly as the source states it, plus the zone the
// source names (or none); code resolves that zone — only when the source's own words carry it — and
// converts through the region's rules ON THAT DATE. No stated zone → the user's zone. Pure.

/** A zone the model says the source stated — resolved and EVIDENCED against the source text. */
export type ResolvedZone = { tz: string; fixedOffsetMin: null } | { tz: null; fixedOffsetMin: number };

const cityOf = (iana: string) => iana.split('/').pop()!.replace(/_/g, ' ').toLowerCase();
const isIana = (tz: string): boolean => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz.includes('/') || tz === 'UTC'; } catch { return false; }
};

/**
 * The zone a source STATES, as the model named it ("CET", "Europe/Lisbon", "UTC+2", "BST") — accepted
 * only when the source's own words carry it (the abbreviation as written, the region's city, or the
 * offset); anything else is null, and the caller reads the wall time in the user's zone. Pure.
 */
export function resolveStatedZone(stated: unknown, sourceText: string): ResolvedZone | null {
  const z = String(stated ?? '').trim();
  if (!z) return null;
  const text = String(sourceText ?? '');
  const off = /^(?:UTC|GMT)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i.exec(z);
  if (off) {
    const min = (Number(off[2]) * 60 + Number(off[3] ?? 0)) * (off[1] === '-' ? -1 : 1);
    const said = new RegExp(`(?:UTC|GMT)\\s*\\${off[1]}\\s*0?${Number(off[2])}(?::?${off[3] ?? '00'})?(?![\\d])`, 'i').test(text);
    return said && Math.abs(min) <= 14 * 60 ? { tz: null, fixedOffsetMin: min } : null;
  }
  const abbr = ZONE_ABBREVIATIONS[z.toUpperCase()];
  if (abbr) {
    // The abbreviation as WRITTEN (upper case — "est"/"pt" in a sentence are words, never zones).
    return new RegExp(`(?<![A-Za-z])${z.toUpperCase()}(?![A-Za-z])`).test(text) ? { tz: abbr.iana, fixedOffsetMin: null } : null;
  }
  if (isIana(z) && z !== 'UTC') {
    const city = cityOf(z);
    if (city.length >= 3 && text.toLowerCase().includes(city)) return { tz: z, fixedOffsetMin: null };
    // The model named the REGION of an abbreviation the text wrote ("9.30 CET" → "Europe/Paris"): the
    // text's own abbreviation decides — when it names exactly one region.
    const regions = new Set(zonedTimesInText(text).map((x) => x.zone.iana));
    return regions.size === 1 ? { tz: [...regions][0], fixedOffsetMin: null } : null;
  }
  return null;
}

/**
 * The instant of a model-reported wall-clock slot ("2026-10-06T15:00", seconds/offset ignored — the
 * wall time is what the source said). The zone is the STATED one when evidenced, else `userTz`.
 * '' when unparseable. Pure — the invite grounding's one conversion (lib/home/prepare-action.ts).
 */
export function wallClockToInstant(local: unknown, userTz: string, zone: ResolvedZone | null = null): string {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})/.exec(String(local ?? '').trim());
  if (!m) return '';
  const h = Number(m[2]);
  const min = Number(m[3]);
  if (zone && zone.tz === null) {
    const [y, mo, d] = m[1].split('-').map(Number);
    const ms = Date.UTC(y, mo - 1, d, h, min) - zone.fixedOffsetMin * 60000;
    return Number.isFinite(ms) && h <= 23 && min <= 59 ? new Date(ms).toISOString() : '';
  }
  const tz = zone?.tz ?? userTz ?? 'UTC';
  const iso = wallTimeToUtc(m[1], h, min, tz);
  if (!iso) return '';
  // A day that does not exist (Feb 30) is not a date.
  const probe = new Date(`${m[1]}T12:00:00Z`);
  return !Number.isNaN(probe.getTime()) && probe.toISOString().slice(0, 10) === m[1] ? iso : '';
}

// ── THE STATED MEETING TIME (the schedule-offer lane's trigger) ──────────────────────────────────

// W27.B · THE TRIGGER IS LANGUAGE-AGNOSTIC (found by the W26 eval: English-only months, no weekday or
// relative day, no "review"/"prep" — FR "vendredi 2 octobre", PT "quinta-feira, 1 de outubro", DE
// "06.10.", "next Tuesday at 10", "tomorrow at 3" were never offered). The word tables below are DATA
// (EN · FR · PT · DE · ES); the grammar is one: a DAY (a calendar date, a weekday, or tomorrow/today)
// and a CLOCK TIME (24h or am/pm; "9:30" · "9.30" · "9h30" · "15h" · "15 Uhr") in one short clause, near a
// meeting word, and never after a deadline word ("by", "avant", "até", "bis", "antes de").
const MONTHS: Record<string, number> = {
  // EN
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
  // FR
  janvier: 1, janv: 1, 'février': 2, fevrier: 2, 'févr': 2, fevr: 2, mars: 3, avril: 4, avr: 4, mai: 5, juin: 6,
  juillet: 7, juil: 7, 'août': 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, 'décembre': 12, decembre: 12, 'déc': 12,
  // PT (the three-letter "set"/"out"/"ago" are English words — left out on purpose)
  janeiro: 1, fevereiro: 2, fev: 2, 'março': 3, marco: 3, abril: 4, abr: 4, maio: 5, junho: 6, julho: 7,
  agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12, dez: 12,
  // DE
  januar: 1, 'jänner': 1, februar: 2, 'märz': 3, maerz: 3, juni: 6, juli: 7, oktober: 10, okt: 10, dezember: 12,
  // ES
  enero: 1, ene: 1, febrero: 2, marzo: 3, mayo: 5, junio: 6, julio: 7, septiembre: 9, setiembre: 9,
  octubre: 10, noviembre: 11, diciembre: 12, dic: 12,
};
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

/** Weekday names → 0 (Sunday) … 6. Portuguese weekdays count only with "-feira" ("a segunda reunião"
 *  is "the second meeting"); sábado/domingo stand alone. */
const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
  domingo: 0, 'segunda-feira': 1, 'terça-feira': 2, 'terca-feira': 2, 'quarta-feira': 3, 'quinta-feira': 4, 'sexta-feira': 5, 'sábado': 6, sabado: 6,
  'segunda feira': 1, 'terça feira': 2, 'terca feira': 2, 'quarta feira': 3, 'quinta feira': 4, 'sexta feira': 5,
  sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6, sonnabend: 6,
  lunes: 1, martes: 2, 'miércoles': 3, miercoles: 3, jueves: 4, viernes: 5,
};
const WEEKDAY_ALT = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join('|');
/** "next Tuesday" — the occurrence strictly after the message's own day. */
const NEXT_WORDS = String.raw`(?:next|coming|prochain|prochaine|próxima|proxima|próximo|proximo|nächsten|nächster|naechsten|kommenden|el próximo|el proximo)`;
/** Relative days → offset from the message's own day ("la mañana"/"Guten Morgen" are mornings, not days). */
const RELATIVE_DAYS: Array<{ re: RegExp; offset: number }> = [
  { re: /(?<![\p{L}\p{N}])(today|aujourd'hui|aujourd’hui|hoje|heute|hoy)(?![\p{L}\p{N}])/giu, offset: 0 },
  { re: /(?<![\p{L}\p{N}])(tomorrow|demain|amanhã|amanha|(?<!guten\s)(?<!\p{L})morgen|(?<!la\s)(?<!de\s)(?<!por\s)mañana)(?![\p{L}\p{N}])/giu, offset: 1 },
];

/** Words that make a stated time a MEETING (a call, a session) rather than a deadline. EN·FR·PT·DE·ES. */
export const MEETING_WORDS = new RegExp(String.raw`(?<![\p{L}\p{N}])(` + [
  'call', 'calls', 'meeting', 'meetings', 'meet', 'catch[- ]?up', 'chat', 'sync', 'session', 'demo', 'appointment',
  'interview', 'workshop', 'kick-?off', 'walk-?through', 'review', 'prep', 'preparation', 'briefing', 'debrief',
  'discussion', 'conversation', 'presentation', 'stand-?up', 'one-on-one', '1:1', 'lunch', 'breakfast', 'coffee',
  'dinner', 'zoom', 'teams', 'google meet', 'video', 'webinar',
  'réunion', 'reunion', 'rendez-vous', 'rdv', 'entretien', 'appel', 'visio', 'visioconférence', 'déjeuner',
  'reunião', 'reuniao', 'chamada', 'encontro', 'conversa', 'videochamada', 'almoço', 'almoco', 'apresentação',
  'termin', 'besprechung', 'treffen', 'gespräch', 'telefonat', 'anruf', 'videocall', 'mittagessen',
  'llamada', 'reunión', 'cita', 'videollamada', 'junta', 'almuerzo',
].join('|') + String.raw`)(?![\p{L}\p{N}])`, 'iu');

/** A deadline, not an appointment: "by Oct 12, 5pm", "avant vendredi 17h", "até sexta-feira", "bis Freitag". */
const DEADLINE_BEFORE = /(?<![\p{L}\p{N}])(by|before|until|till|no later than|deadline|due|avant|jusqu'?à|jusqu’à|d'ici|até|ate|bis|spätestens|antes de|hasta)\s*(?:the\s+|le\s+|o\s+|el\s+|zum\s+|am\s+)?$/iu;

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

/** A day stated in text: an absolute month/day (year optional) or a day RELATIVE to the message. */
type DateHit = { start: number; end: number } & (
  | { month: number; day: number; year: number | null; rel?: undefined }
  | { rel: { weekday: number; next: boolean } | { offset: number }; month?: undefined; day?: undefined; year?: undefined }
);

function datesIn(s: string): DateHit[] {
  const out: DateHit[] = [];
  const B = String.raw`(?<![\p{L}\p{N}])`;
  const E = String.raw`(?![\p{L}\p{N}])`;
  const md = new RegExp(`${B}(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?${E}`, 'giu');
  const dm = new RegExp(`${B}(\\d{1,2})(?:st|nd|rd|th|er|º|°|\\.)?\\s+(?:of\\s+|de\\s+)?(${MONTH_ALT})\\.?(?:,?\\s+(?:de\\s+)?(\\d{4}))?${E}`, 'giu');
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  // DD.MM. / DD.MM.YYYY (the German numeric date — the trailing dot or the year is what tells it from "9.30").
  const dotted = /(?<![\d.:])(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?(?!\d)/g;
  const wd = new RegExp(`${B}(?:(${NEXT_WORDS})\\s+)?(${WEEKDAY_ALT})${E}`, 'giu');
  let m: RegExpExecArray | null;
  while ((m = md.exec(s)) !== null) out.push({ month: MONTHS[m[1].toLowerCase()], day: Number(m[2]), year: m[3] ? Number(m[3]) : null, start: m.index, end: m.index + m[0].length });
  while ((m = dm.exec(s)) !== null) out.push({ month: MONTHS[m[2].toLowerCase()], day: Number(m[1]), year: m[3] ? Number(m[3]) : null, start: m.index, end: m.index + m[0].length });
  while ((m = iso.exec(s)) !== null) out.push({ month: Number(m[2]), day: Number(m[3]), year: Number(m[1]), start: m.index, end: m.index + m[0].length });
  while ((m = dotted.exec(s)) !== null) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
    out.push({ month: Number(m[2]), day: Number(m[1]), year: y, start: m.index, end: m.index + m[0].length });
  }
  while ((m = wd.exec(s)) !== null) {
    const w = WEEKDAYS[m[2].toLowerCase()];
    if (w === undefined) continue;
    out.push({ rel: { weekday: w, next: !!m[1] }, start: m.index, end: m.index + m[0].length });
  }
  for (const { re, offset } of RELATIVE_DAYS) {
    re.lastIndex = 0;
    while ((m = re.exec(s)) !== null) out.push({ rel: { offset }, start: m.index, end: m.index + m[0].length });
  }
  // An absolute date's own weekday ("Friday, Oct 2") is ONE statement: the weekday defers to the date.
  const abs = out.filter((d) => d.month !== undefined);
  return out
    .filter((d) => d.month === undefined || (d.month >= 1 && d.month <= 12 && d.day >= 1 && d.day <= 31))
    .filter((d) => d.month !== undefined || !abs.some((a) => Math.abs(a.start - d.end) <= 4 || Math.abs(d.start - a.end) <= 4));
}

type TimeHit = { hour: number; minute: number; abbr: string | null; start: number; end: number };

/** A clock time needs a preposition when it is a bare "15h" (else "a 2h workshop" reads as 02:00). */
const TIME_PREP_BEFORE = /(?<![\p{L}\p{N}])(at|à|às|pelas|um|ab|a las|alle|vers|around)\s*$/iu;

function timesIn(s: string): TimeHit[] {
  const out: TimeHit[] = [];
  // "9.30 am", "9:30", "14h30", "9am", "9 a.m.", "15h", "15 Uhr", "15.30 Uhr" — a bare number is never a time.
  const re = new RegExp(`(?<![\\d:./-])(\\d{1,2})(?:([:.hH])(\\d{2}))?(\\s*[hH](?![\\p{L}\\p{N}])|\\s*Uhr(?![\\p{L}]))?\\s*([AaPp]\\.?[Mm]\\.?)?(?:\\s*\\(?(${ABBR_ALT})(?![A-Za-z]))?`, 'gu');
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const hasMin = !!m[3];
    const suffix = (m[4] || '').trim();
    const ap = (m[5] || '').toLowerCase().replace(/\./g, '');
    let h = Number(m[1]);
    const min = hasMin ? Number(m[3]) : 0;
    if (h > 23 || min > 59) continue;
    if (ap && h > 12) continue;
    const prep = TIME_PREP_BEFORE.test(s.slice(Math.max(0, m.index - 8), m.index));
    const workingHour = h >= 7 && h <= 21;
    // A bare number is a time only as "at 10" — after a time preposition, inside the working day.
    if (!hasMin && !ap && !suffix && !(prep && workingHour)) continue;
    // A bare "15h" is a time only after a time preposition or inside the working day ("a 2h workshop").
    if (!hasMin && !ap && /^h$/i.test(suffix) && !prep && !workingHour) continue;
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    out.push({ hour: h, minute: min, abbr: m[6] ?? null, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** The calendar day a DateHit names, from the message's own local day (anchorDay, YYYY-MM-DD). */
function dayOfHit(d: DateHit, anchorDay: string): string | null {
  const [ay, am, ad] = anchorDay.split('-').map(Number);
  const anchorMs = Date.UTC(ay, am - 1, ad);
  if (d.rel) {
    let add: number;
    if ('offset' in d.rel) add = d.rel.offset;
    else {
      const dow = new Date(anchorMs).getUTCDay();
      add = (d.rel.weekday - dow + 7) % 7;
      if (d.rel.next && add === 0) add = 7;
    }
    return new Date(anchorMs + add * 86_400_000).toISOString().slice(0, 10);
  }
  let year = d.year ?? ay;
  if (!d.year && `${year}-${pad2(d.month)}-${pad2(d.day)}` < anchorDay) year += 1;
  const dateStr = `${year}-${pad2(d.month)}-${pad2(d.day)}`;
  // A day that does not exist (Feb 30) is not a date.
  const probe = new Date(`${dateStr}T12:00:00Z`);
  return !Number.isNaN(probe.getTime()) && probe.toISOString().slice(0, 10) === dateStr ? dateStr : null;
}

/**
 * A CONCRETE MEETING TIME stated in a text: a day (an explicit calendar date, a weekday, or a
 * relative day) and a clock time in the SAME short clause (≤40 chars apart), with a meeting word
 * nearby and no deadline word right before it. The year / the weekday resolve from the anchor (the
 * message's own date, in the stated zone): a month/day before it rolls forward a year, a weekday is
 * the next such day at or after it ("next <weekday>": strictly after). The zone is the stated
 * abbreviation's region, else `fallbackTz`. Returns the LAST such statement (the newest words win in
 * a reply that restates), or null. Pure.
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
    // The clock time belongs to THIS day: right after it ("Oct 12, 9.30 am") or just before it
    // ("at 9:30 on Oct 12") — within one short clause, never across the message.
    const near = times
      .map((t) => ({ t, gap: t.start >= d.end ? t.start - d.end : d.start - t.end }))
      .filter((x) => x.gap >= 0 && x.gap <= 40)
      .sort((a, b) => a.gap - b.gap)[0]?.t;
    if (!near) continue;
    // …the statement is about a MEETING (a deadline "by Oct 12, 5pm" is not a time to meet)…
    const window = s.slice(Math.max(0, d.start - 160), Math.min(s.length, d.end + 160));
    if (!MEETING_WORDS.test(window)) continue;
    // …and no deadline word stands right before it ("review it by Friday 5pm" is a due time).
    const q0 = Math.min(d.start, near.start);
    if (DEADLINE_BEFORE.test(s.slice(Math.max(0, q0 - 24), q0))) continue;
    const zone = near.abbr ? ZONE_ABBREVIATIONS[near.abbr] : null;
    const tz = zone?.iana ?? fallbackTz ?? 'UTC';
    const dateStr = dayOfHit(d, localDay(anchor, tz));
    if (!dateStr) continue;
    const iso = wallTimeToUtc(dateStr, near.hour, near.minute, tz);
    if (!iso) continue;
    found = { startISO: iso, timezone: tz, quote: s.slice(q0, Math.max(d.end, near.end)).trim().slice(0, 120), zoneStated: !!zone };
  }
  return found;
}
