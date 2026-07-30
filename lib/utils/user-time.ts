// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE USER'S CLOCK (proactive-team T-class — "the brain has a clock, in the user's zone").
// One shared source for "what time is it FOR THIS USER": their home timezone is derived from their
// own calendar (the most common event timezone — the same law the Home brief already applies),
// memoized per user, UTC when unknown. Every engine that reasons about time — the judge's mootness,
// state synthesis, deixis resolution — reads THIS, never the server's clock in disguise.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';

const tzMemo = new Map<string, { at: number; tz: string }>();

export async function userTimezone(client: SupabaseClient, userId: string): Promise<string> {
  const hit = tzMemo.get(userId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.tz;
  let tz = 'UTC';
  try {
    const { data } = await client.from('calendar_events').select('timezone')
      .eq('user_id', userId).not('timezone', 'is', null).limit(300);
    const freq = new Map<string, number>();
    for (const r of (data ?? []) as Array<{ timezone: string | null }>) {
      if (r.timezone) freq.set(r.timezone, (freq.get(r.timezone) ?? 0) + 1);
    }
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (top) { new Intl.DateTimeFormat('en-US', { timeZone: top }); tz = top; } // throws on junk → keep UTC
  } catch { /* fallback UTC */ }
  tzMemo.set(userId, { at: Date.now(), tz });
  return tz;
}

export type LocalNow = {
  tz: string;
  dateStr: string;   // YYYY-MM-DD in the user's zone — THE day boundary for time laws
  hhmm: string;      // HH:MM (24h) in the user's zone
  pretty: string;    // "Tuesday, July 28, 2026, 20:34" — for prompts
};

export function localNow(tz: string, d: Date = new Date()): LocalNow {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const dateStr = `${get('year')}-${get('month')}-${get('day')}`;
    const hhmm = `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`;
    const pretty = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d);
    return { tz, dateStr, hhmm, pretty };
  } catch {
    const iso = d.toISOString();
    return { tz: 'UTC', dateStr: iso.slice(0, 10), hhmm: iso.slice(11, 16), pretty: `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` };
  }
}

/** Times of day stated in a text ("12:30", "12.30 PM", "9h30"), normalized to HH:MM 24h — the
 *  deterministic half of same-day mootness (a claimed event time must actually appear in the item). */
export function timesInText(text: string): string[] {
  const out = new Set<string>();
  const re = /\b(\d{1,2})[:h.](\d{2})\s*(am|pm)?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h > 23 || min > 59) continue;
    const ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    out.add(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  }
  return [...out];
}

/** THE STATED-DATE CHECK (P27 hardening, July 29 — the hallucinated-expiry hole): a past
 *  `expired_on` used to be accepted on the model's word alone, so a fabricated yesterday defeated
 *  the whole same-day protection. Same grammar as timesInText: render the claimed date in the
 *  common ways mail states it (ISO · "July 28" · "28 July" · short month · D/M and M/D · its
 *  weekday name, which covers relative deadlines like "by Thursday") and require ONE to appear in
 *  the item's own text — the model supplies judgment, the text supplies the fact. A miss keeps
 *  the item live (wrongly resolving live work costs trust; judging it costs nothing). */
export function dateStatedInText(text: string, iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const t = text.toLowerCase();
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  const day = Number(m[3]);
  const mon = Number(m[2]);
  const monthLong = d.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }).toLowerCase();
  const monthShort = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toLowerCase();
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }).toLowerCase();
  const candidates = [
    iso,
    `${monthLong} ${day}`, `${day} ${monthLong}`, `${monthShort} ${day}`, `${day} ${monthShort}`,
    `${day}/${mon}`, `${mon}/${day}`,
    `${String(day).padStart(2, '0')}/${String(mon).padStart(2, '0')}`,
    `${String(mon).padStart(2, '0')}/${String(day).padStart(2, '0')}`,
    weekday,
  ];
  return candidates.some((c) => t.includes(c));
}
