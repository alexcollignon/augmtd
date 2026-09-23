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

/**
 * THE STATED-DATE CHECK (P27 hardening, July 29 — the hallucinated-expiry hole): a past `expired_on`
 * used to be accepted on the model's word alone, so a fabricated yesterday defeated the whole
 * same-day protection. Same grammar as timesInText: render the claimed date in the common ways mail
 * states it (ISO · "July 28" · "28 July" · short month · D/M and M/D · its weekday name, which covers
 * relative deadlines like "by Thursday") and require ONE to appear in the item's own text — the model
 * supplies judgment, the text supplies the fact. A miss keeps the item live (wrongly resolving live
 * work costs trust; judging it costs nothing).
 *
 * THE AGNOSTIC CLAUSE, applied to an existing floor (proactive-reach LAW 3, Sep 13 — found live).
 *
 * This check was ENGLISH-ONLY: month and weekday names were rendered with `en-US` alone. A real item
 * on the reference account states its date in French ("jeudi … 11h"), so the verification failed, the
 * `expired` disposition was DROPPED, and a lapsed obligation kept nagging — the floor silently did
 * not exist for non-English mail.
 *
 * THE FLOOR IS NOW TWO LAYERS (owner, Sep 13: "why isn't this reasoned? that would get any type of
 * language?" — and he is right: a lexicon is a language list, and a language list is the site-list
 * decay class wearing a different hat):
 *
 *   LAYER 1 — DETERMINISTIC AND FREE (this function). Language-independent numeric forms, plus the
 *     name-bearing renderings GENERATED from `Intl` for the corpus locales (never a hand-authored
 *     month/weekday table — one locale list, zero maintenance). Catches the overwhelming majority at
 *     zero cost and zero latency, which is what keeps layer 2 rare enough to afford.
 *   LAYER 2 — REASONED, QUOTE-THEN-VERIFY (`dateStatedInTextVerified`). Language-UNIVERSAL: any
 *     language, any rendering, including ones no lexicon would hold.
 *
 * ADDITIVE ONLY: every rendering the English version accepted is still accepted. The asymmetry the
 * P27 hardening bought is untouched — a fabricated date that appears nowhere in the text still fails.
 */
const DATE_LOCALES = ['en-US', 'pt-PT', 'de-DE', 'fr-FR'] as const;

/** Strip diacritics + collapse separators, so an accented rendering matches an unaccented corpus. */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function dateStatedInText(text: string, iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const t = fold(text);
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  const day = Number(m[3]);
  const mon = Number(m[2]);
  const candidates: string[] = [
    iso,
    // Numeric renderings are language-independent.
    `${day}/${mon}`, `${mon}/${day}`,
    `${String(day).padStart(2, '0')}/${String(mon).padStart(2, '0')}`,
    `${String(mon).padStart(2, '0')}/${String(day).padStart(2, '0')}`,
    `${day}.${mon}.`, `${String(day).padStart(2, '0')}.${String(mon).padStart(2, '0')}.`, // DE: 11.09.
  ];
  // "Sept" — the EN abbreviation mail writes that Intl's "Sep" never renders (additive, W3.4).
  if (mon === 9) candidates.push(`sept ${day}`, `sept. ${day}`, `${day} sept`);
  for (const loc of DATE_LOCALES) {
    let monthLong: string, monthShort: string, weekday: string;
    try {
      monthLong = d.toLocaleDateString(loc, { month: 'long', timeZone: 'UTC' });
      monthShort = d.toLocaleDateString(loc, { month: 'short', timeZone: 'UTC' });
      weekday = d.toLocaleDateString(loc, { weekday: 'long', timeZone: 'UTC' });
    } catch { continue; } // a runtime without this locale's data simply contributes nothing
    candidates.push(
      `${monthLong} ${day}`, `${day} ${monthLong}`,          // "September 11" · "11 septembre"
      `${monthShort} ${day}`, `${day} ${monthShort}`,        // "sep 11" · "11 set"
      `${day} de ${monthLong}`, `${day} de ${monthShort}`,   // PT: "11 de setembro"
      `${day}. ${monthLong}`, `${day}. ${monthShort}`,       // DE: "11. September"
      `${day}er ${monthLong}`,                               // FR: "1er septembre"
      weekday,                                               // covers "by Thursday" / "jeudi" / "quinta-feira"
    );
  }
  return candidates.some((c) => t.includes(fold(c)));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// LAYER 2 — THE REASONED STATED-DATE CHECK (proactive-reach LAW 3, owner amendment Sep 13).
//
// THE EVIDENCE LAW, applied to a date: THE MODEL PROPOSES A QUOTE, CODE DISPOSES.
//
// A lexicon can only verify the languages someone remembered to list — and the corpus is not a list
// (the same reason the matching capability's evidence law makes a match quote the profile's own
// text). So when layer 1 finds nothing, ONE cheap classification-tier call is asked a single,
// answerable question: "quote the exact contiguous span of this text that states <ISO>, or NONE".
// The model never gets to ASSERT that a date is stated — it can only hand back a span, and the span
// is then CODE-CHECKED three ways before it counts:
//
//   1. it must be a VERBATIM substring of the source (accent/whitespace-folded, never fuzzy),
//   2. it must contain the date's DAY NUMBER as digits — the one token no rendering of a date can
//      omit and no paraphrase can invent,
//   3. it must contain the MONTH as digits or as a month name in some locale we can render, so a
//      quote of the wrong month's "11th" cannot pass.
//
// Anything else — NONE, a call failure, a hallucinated span, a span that verifies nothing — returns
// FALSE. THE ASYMMETRY IS DELIBERATE AND STRUCTURAL: this floor exists to stop a fabricated date
// from retiring live work, so the ONLY path to `true` runs through a code-verified substring. A miss
// keeps the item live and judged again tomorrow (showing costs less than hiding).
//
// Cached per (text, date) in the house cache idiom (`item_plans`, kind 'date_stated'), so a sweep
// re-walking the same backlog never re-spends.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Stable short hash of a text — the cache key's content half (FNV-1a, the house's own). */
function textKey(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/** Fold for substring verification: diacritics stripped, whitespace collapsed, lowercased. */
const foldSpan = (s: string) => fold(s).replace(/\s+/g, ' ').trim();

/**
 * CODE'S HALF of the quote-then-verify contract. Exported so the gate can assert the asymmetry
 * directly on the function that owns it — never on a prompt.
 */
export function quoteProvesDate(text: string, quote: string, iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const q = foldSpan(quote);
  if (q.length < 2 || q.length > 200) return false;
  // (1) VERBATIM: the span must really exist in the source.
  if (!foldSpan(text).includes(q)) return false;
  const day = Number(m[3]), mon = Number(m[2]);
  // (2) the day number, as digits, on its own (so "21" never satisfies a claim about the 1st).
  if (!new RegExp(`(?<!\\d)0?${day}(?!\\d)`).test(q)) return false;
  // (3) the month. As DIGITS it must appear as a date-like PAIR with the day (either order, any of
  // the separators the world writes) or as the full ISO — never as a bare number, because a bare
  // number can be the day itself re-read as the month ("le 11 septembre" would otherwise "prove"
  // 2026-11-11). Otherwise: the month's NAME in some locale we can render.
  const D = `0?${day}`, M = `0?${mon}`;
  if (new RegExp(`(?<!\\d)(?:${D}[./-]${M}|${M}[./-]${D})(?!\\d)`).test(q)) return true;
  if (q.includes(iso)) return true;
  const d = new Date(`${iso}T12:00:00Z`);
  for (const loc of DATE_LOCALES) {
    try {
      for (const style of ['long', 'short'] as const) {
        const name = fold(d.toLocaleDateString(loc, { month: style, timeZone: 'UTC' })).replace(/\.$/, '');
        if (name.length >= 3 && q.includes(name)) return true;
      }
    } catch { /* locale unavailable — contributes nothing */ }
  }
  return false;
}

/**
 * THE TWO-LAYER STATED-DATE CHECK. Layer 1 (free, deterministic) first; only a miss pays for the
 * reasoned quote. Never throws — every failure path is `false`.
 */
export async function dateStatedInTextVerified(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any, userId: string, text: string, iso: string,
): Promise<boolean> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const src = String(text ?? '');
  if (!src.trim()) return false;
  if (dateStatedInText(src, iso)) return true;      // LAYER 1 — free
  // A date the text cannot possibly state: no digit of the day appears anywhere. Skips the call.
  const day = Number(iso.slice(8, 10));
  if (!new RegExp(`(?<!\\d)0?${day}(?!\\d)`).test(src)) return false;

  const cacheKey = `date_stated:${iso}:${textKey(src.slice(0, 4000))}`;
  try {
    const { data } = await client.from('item_plans').select('tasks')
      .eq('user_id', userId).eq('kind', 'date_stated').eq('entity_id', cacheKey).maybeSingle();
    const hit = (data?.tasks ?? null) as { stated?: boolean } | null;
    if (hit && typeof hit.stated === 'boolean') return hit.stated;
  } catch { /* cache miss is never fatal */ }

  let stated = false;
  try {
    const { getAIClient, aiCreate } = await import('@/lib/ai/factory');
    const { client: ai, model } = await getAIClient(userId, 'classification', client);
    const res = await aiCreate(ai, {
      model, max_tokens: 120, temperature: 0,
      messages: [{ role: 'user', content:
        `Below is a text, in whatever language it was written. Does it state the date ${iso}?\n` +
        `Answer by QUOTING the exact contiguous span of the text that states that date — copied ` +
        `character-for-character from the text, nothing added, nothing paraphrased, nothing translated. ` +
        `A weekday name, a written-out date, a numeric date, any language: all fine, as long as the span ` +
        `is verbatim. If the text does not state that date, answer exactly NONE.\n\n` +
        `TEXT:\n"""\n${src.slice(0, 4000)}\n"""\n\n` +
        `JSON only: {"quote":"<verbatim span>"} or {"quote":null}` }],
    });
    const raw = res.choices?.[0]?.message?.content ?? '';
    const j = raw.match(/\{[\s\S]*\}/);
    const quote = j ? String((JSON.parse(j[0]) as { quote?: unknown }).quote ?? '') : '';
    // CODE DISPOSES — the model's answer is only ever a candidate span.
    stated = !!quote && !/^none$/i.test(quote.trim()) && quoteProvesDate(src, quote, iso);
  } catch { return false; } // a failure is NOT evidence — fail safe, never cache a non-verdict

  try {
    await client.from('item_plans').upsert({
      user_id: userId, kind: 'date_stated', entity_id: cacheKey,
      tasks: { stated, iso }, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,kind,entity_id' }).then(() => {}, () => {});
  } catch { /* non-fatal */ }
  return stated;
}
