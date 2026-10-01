// lib/core/iso-dates.ts — THE ISO-DATE SERVE FLOOR (tier-1 #14 `time-truth`, W39 walk).
//
// Browser walk, Oct 1: model prose reached the page with machine dates in it — "Sam asked on
// 2026-09-30" — because the grounding the composers read carries ISO stamps and the model copies
// them. A machine date in a sentence is not a lie, but it is not how the app speaks a day anywhere
// else ("Wed, Sep 30"), and it is a wrong-language token in a French or German sentence.
//
// THE FLOOR (zero AI, pure, client-safe): every ISO date (YYYY-MM-DD, optionally with a time and a
// zone) standing in SERVED PROSE is rewritten into the reader's language and locale format, with a
// per-language weekday and month name — EN · FR · DE · PT · ES. A zoned instant is shown in the
// reader's zone when one is known. The year is spoken only when it is not the serving year.
//
// NEVER rewritten (they are not prose, or not ours):
//   · fenced code blocks and inline code spans,
//   · URLs and markdown link targets,
//   · filenames and identifiers (a date glued to a letter, digit, `-`, `_`, `/`, `.`: report-2026-09-30.pdf),
//   · quoted source text — blockquote lines and "double", “curly”, «guillemet», „low“ quoted spans.
//
// Hooked once, where every served cached sentence already passes: lib/core/relative-time
// serveTimeWords (room brief · entity state · Home briefing · Home brief line), and at render in the
// one chat markdown renderer (components/thread/markdown-view.tsx) for every chat answer.
//
// Imports only the pure stopword detector (no IO).
import { detectLanguage } from '@/lib/inbox/detect-language';

export type DateLang = 'en' | 'fr' | 'de' | 'pt' | 'es';
export const DATE_LANGS: readonly DateLang[] = ['en', 'fr', 'de', 'pt', 'es'];

const MONTHS: Record<DateLang, string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  de: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
  pt: ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'],
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
};
/** Sunday-first, the short form each locale writes. */
const WEEKDAYS: Record<DateLang, string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  fr: ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'],
  de: ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'],
  pt: ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'],
  es: ['dom.', 'lun.', 'mar.', 'mié.', 'jue.', 'vie.', 'sáb.'],
};

/** A day (and optional HH:MM) in the language's own format. Pure. */
export function localDateWords(day: string, lang: DateLang, opts: { servingYear?: string; time?: string | null } = {}): string {
  const [y, m, d] = day.split('-').map((x) => parseInt(x, 10));
  const wd = WEEKDAYS[lang][new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];
  const mon = MONTHS[lang][m - 1];
  const showYear = !opts.servingYear || opts.servingYear !== String(y);
  const t = opts.time ?? null;
  switch (lang) {
    case 'fr': return `${wd} ${d} ${mon}${showYear ? ` ${y}` : ''}${t ? ` à ${t}` : ''}`;
    case 'de': return `${wd}, ${d}. ${mon}${showYear ? ` ${y}` : ''}${t ? `, ${t} Uhr` : ''}`;
    case 'pt': return `${wd}, ${d} de ${mon}${showYear ? ` de ${y}` : ''}${t ? `, às ${t}` : ''}`;
    case 'es': return `${wd}, ${d} de ${mon}${showYear ? ` de ${y}` : ''}${t ? `, a las ${t}` : ''}`;
    default: return `${wd}, ${mon} ${d}${showYear ? `, ${y}` : ''}${t ? `, ${t}` : ''}`;
  }
}

const NAME_TO_LANG: Record<string, DateLang> = { English: 'en', French: 'fr', German: 'de', Portuguese: 'pt', Spanish: 'es' };

/** The preposition a sentence puts before a date is a strong language hint on a short sentence. */
const PREP_HINTS: Array<[RegExp, DateLang]> = [
  [/(?:^|[\s(])(?:on|since|by|until|before|after)\s*$/i, 'en'],
  [/(?:^|[\s(])(?:le|depuis|avant|apr[èe]s|jusqu['’]au)\s*$/i, 'fr'],
  [/(?:^|[\s(])(?:am|vom|seit|bis|zum|ab)\s*$/i, 'de'],
  [/(?:^|[\s(])(?:em|at[ée]|no dia|a partir de)\s*$/i, 'pt'],
  [/(?:^|[\s(])(?:el|hasta|antes del|despu[ée]s del)\s*$/i, 'es'],
];

/** The reader's language for a text: an explicit hint, else the text's own language (the composers
 *  write in the user's language), else the preposition before the date, else English. */
function langFor(text: string, head: string, hint?: DateLang | null): DateLang {
  if (hint && DATE_LANGS.includes(hint)) return hint;
  const named = detectLanguage(text);
  if (named && NAME_TO_LANG[named]) return NAME_TO_LANG[named];
  const tail = head.slice(-24);
  for (const [rx, l] of PREP_HINTS) if (rx.test(tail)) return l;
  return 'en';
}

// ── THE PROTECTED SPANS ────────────────────────────────────────────────────────────────────────
const PROTECTED: RegExp[] = [
  /```[\s\S]*?(?:```|$)/g,            // fenced code (an unclosed fence protects to the end — streaming)
  /~~~[\s\S]*?(?:~~~|$)/g,
  /`[^`\n]*`/g,                       // inline code
  /\]\([^)\s]*\)/g,                   // markdown link targets
  /(?:https?:\/\/|www\.)[^\s<>()"'“”]+/gi, // URLs
  /^[ \t]*>.*$/gm,                    // blockquote lines (quoted source)
  /"[^"\n]{1,600}"/g,                 // quoted spans
  /“[^”\n]{1,600}”/g,
  /«[^»\n]{1,600}»/g,
  /„[^“”\n]{1,600}[“”]/g,
];

function protectedRanges(s: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const rx of PROTECTED) {
    rx.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(s))) {
      out.push([m.index, m.index + m[0].length]);
      if (m[0].length === 0) rx.lastIndex++;
    }
  }
  return out;
}

// A date glued to an identifier character on either side is a filename / id / path, never prose.
const ISO = /(?<![\p{L}\p{N}_./\\:@#=?&%+-])(\d{4})-(\d{2})-(\d{2})(?:(?:T|[ \t](?=\d{2}:\d{2}))(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?(?![\p{L}\p{N}_/\\-]|\.[\p{L}\p{N}]|:\d)/gu;

function validDay(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function zoned(instant: Date, tz: string): { day: string; time: string } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(instant);
    const p = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
    return { day: `${p('year')}-${p('month')}-${p('day')}`, time: `${p('hour')}:${p('minute')}` };
  } catch {
    return null;
  }
}

function servingYearOf(now: Date, tz?: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric' }).format(now);
  } catch {
    return String(now.getUTCFullYear());
  }
}

export type IsoDateOpts = { lang?: DateLang | null; tz?: string | null; now?: Date };

/** Does served prose still carry a machine date outside the protected spans? (the gate's probe) */
export function hasProseIsoDate(text: string | null | undefined): boolean {
  const s = String(text ?? '');
  return localizeIsoDates(s, { lang: 'en' }) !== s;
}

/**
 * THE FLOOR: rewrite every ISO date in served prose into the reader's language + locale format.
 * Same input, same output; text with no ISO date is returned byte-identical. Pure.
 */
export function localizeIsoDates(text: string | null | undefined, opts: IsoDateOpts = {}): string {
  const s = String(text ?? '');
  if (!/\d{4}-\d{2}-\d{2}/.test(s)) return s;
  const ranges = protectedRanges(s);
  const inside = (i: number, j: number) => ranges.some(([a, b]) => i < b && j > a);
  const servingYear = servingYearOf(opts.now ?? new Date(), opts.tz);
  let out = '';
  let last = 0;
  ISO.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ISO.exec(s))) {
    const start = m.index; const end = start + m[0].length;
    if (inside(start, end)) continue;
    const y = +m[1]; const mo = +m[2]; const d = +m[3];
    if (!validDay(y, mo, d)) continue;
    let day = `${m[1]}-${m[2]}-${m[3]}`;
    let time: string | null = null;
    if (m[4] !== undefined) {
      const hh = +m[4]; const mm = +m[5];
      if (hh > 23 || mm > 59) continue;
      time = `${m[4]}:${m[5]}`;
      const zone = m[7];
      if (zone) {
        const iso = `${day}T${m[4]}:${m[5]}:${m[6] ?? '00'}${zone === 'Z' ? 'Z' : zone.length === 5 ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone}`;
        const instant = new Date(iso);
        const z = Number.isFinite(instant.getTime()) && opts.tz ? zoned(instant, opts.tz) : null;
        if (z) { day = z.day; time = z.time; }
        else if (zone === 'Z' || /^[+-]00:?00$/.test(zone)) time = `${time} UTC`;
        else time = `${time} (UTC${zone})`;
      }
    }
    const lang = langFor(s, s.slice(0, start), opts.lang);
    out += s.slice(last, start) + localDateWords(day, lang, { servingYear, time });
    last = end;
  }
  return last === 0 ? s : out + s.slice(last);
}
