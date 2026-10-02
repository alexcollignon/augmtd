// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CARD HEADER ROW — ONE FORMATTER (law `one-component-one-behaviour`, owner walk Oct 2: a stacked
// header read `Words to paste  Prepared — "Arrange payment transfer with …"` — the kind said twice,
// a status word dressed as a title, and quotes around the work).
//
// Every surface's header row is: the kind's glyph + its noun ONCE (lib/present/behaviour.ts
// CARD_SUMMARY) + the work's PLAIN title + who it is for / its state where that says something. The
// producers' card LABELS ("Prepared — "…"", "Nudge ready — waiting on Sam: "…"", "Reply drafted —
// ready to review") are status sentences for a row, not titles: this formatter reads the work out of
// them, moves a stated counterparty into the detail, and drops a label that is only a status.
//
// PURE and client-safe (type + table imports only).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { CARD_SUMMARY, type CardDescriptor } from '@/lib/present/behaviour';

export type CardHeader = { noun: string; title: string | null; detail: string | null };

/** Status-only labels the producers write — they carry no title of their own. */
const STATUS_ONLY = /^(?:(?:calendar\s+)?invite|reply|follow-?up|forward|email|nudge|message|draft|words?)\s+(?:drafted|prepared|ready)\b.*$|^(?:your (?:reply|follow-?up)|email\s*[—-]\s*ready to write|invite drafted\s*[—-].*)$/i;
/** A leading status phrase before the work ("Prepared — ", "Draft ready — ", "Nudge ready — waiting on Sam: "). */
const LEAD = /^(?:prepared|draft ready|ready|drafted|words ready|nudge ready|follow-?up ready|reply ready)\s*[—–:-]\s*(?:waiting on ([^:"“]+?)\s*:\s*)?/i;
const QUOTES = /^["“'‘]+|["”'’]+$/g;

/** The work's plain title out of a card label, and a counterparty the label states (pure). */
export function plainTitleOf(label: string | null | undefined): { title: string | null; who: string | null } {
  let t = String(label ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return { title: null, who: null };
  let who: string | null = null;
  // A status phrase LEADING the work ("Prepared — "…"") gives way to the work it names…
  const m = LEAD.exec(t);
  if (m && t.slice(m[0].length).trim()) { who = m[1]?.trim() || null; t = t.slice(m[0].length); }
  // …and a label that is ONLY a status ("Reply drafted — ready to review") is no title at all.
  else if (STATUS_ONLY.test(t)) return { title: null, who: null };
  t = t.trim().replace(QUOTES, '').trim();
  return { title: t || null, who };
}

/** THE HEADER ROW for a card (pure): the noun once, the plain title (never repeating the noun), the
 *  detail — recipient (its name, not a bare mailbox when a name is known) and state. */
export function cardHeaderOf(d: Pick<CardDescriptor, 'kind' | 'title' | 'recipient' | 'state'>): CardHeader {
  const noun = CARD_SUMMARY[d.kind].noun;
  const { title: raw, who } = plainTitleOf(d.title);
  const title = raw && raw.toLowerCase() !== noun.toLowerCase() ? raw : null;
  const recipient = (d.recipient ?? '').trim() || who || '';
  const parts = [recipient, (d.state ?? '').trim()].filter(Boolean);
  return { noun, title, detail: parts.length ? parts.join(' · ') : null };
}

/** The one-line words for a card (a chip, a quote, a question): the title, else the noun. */
export function cardLineOf(d: Pick<CardDescriptor, 'kind' | 'title' | 'recipient' | 'state'>): string {
  const h = cardHeaderOf(d);
  return h.title ?? h.noun;
}
