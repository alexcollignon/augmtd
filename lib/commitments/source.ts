// ════════════════════════════════════════════════════════════════════════════════════════════════
// A COMMITMENT'S SOURCE — THE ONE READ OF `commitments.source_id` (stabilization W7.3).
//
// `source_id` is NOT an inbox item id. The extractor writes the SOURCE ROW's own id:
//   · source='email'   → `emails.id`            (probe, Sep 23: 25/25 resolve in `emails`, 0 as inbox_items.id)
//   · source='meeting' → `meeting_transcripts.id`
// Recognition's provenance read took an email commitment's `source_id` as an inbox_item id, so the
// structural parent never resolved and email-born commitments re-guessed their project on topic.
// Every reader that needs the email's INBOX ITEM asks `inboxItemForEmail` (exact: the inbox row whose
// source_id IS that email; else the newest item on the email's own thread); every reader that needs
// the MEETING as a source object asks `meetingSourceOf`. Zero AI, bounded SELECTs.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
// W11.3 · a source card's excerpt is a DISPLAY clip — EXCERPT_MARK never renders.
import { clipForDisplay } from '@/lib/utils/clip-for-prompt';
// W16.4 · a source's words are plain text for every host (the page and the card alike) — decoded ONCE here.
import { decodeEntities } from '@/lib/core/text';

/** The source card's excerpt budget — clipped by THE ONE CLIPPER, the cut declared. */
export const MEETING_SOURCE_EXCERPT_CHARS = 280;

/** The inbox item an email-born commitment's source email lives on — or null. */
export async function inboxItemForEmail(
  client: SupabaseClient, userId: string, src: { emailId: string | null; threadId?: string | null },
): Promise<string | null> {
  try {
    if (src.emailId) {
      const { data: exact } = await client.from('inbox_items').select('id').eq('user_id', userId)
        .eq('source', 'email').eq('source_id', src.emailId).limit(1).maybeSingle();
      if (exact?.id) return String(exact.id);
    }
    let threadId = src.threadId ?? null;
    if (!threadId && src.emailId) {
      const { data: e } = await client.from('emails').select('thread_id').eq('id', src.emailId).eq('user_id', userId).maybeSingle();
      threadId = (e?.thread_id as string | null) ?? null;
    }
    if (threadId) {
      const { data: onThread } = await client.from('inbox_items').select('id').eq('user_id', userId)
        .eq('source_data->>thread_id', threadId)
        .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
      if (onThread?.id) return String(onThread.id);
    }
  } catch { /* an unreadable source is no source */ }
  return null;
}

/** A meeting as a SOURCE OBJECT — what the room's compact card needs, all served, nothing composed
 *  by the kit. `attendees` are display names minus the user (who is in the room already). */
export type MeetingSource = {
  id: string;
  /** The meeting page's own address key: the calendar event when linked (THE ONE NOTE ADDRESS). */
  addressId: string;
  title: string;
  startISO: string | null;
  attendees: string[];
  excerpt: string | null;
};

const labelOf = (a: unknown): string | null => {
  if (typeof a === 'string') return a.replace(/<[^>]*>/g, '').trim() || null;
  const o = (a ?? {}) as { name?: unknown; displayName?: unknown; email?: unknown };
  return String(o.name ?? o.displayName ?? '').trim() || String(o.email ?? '').trim() || null;
};

/** The meeting row + its calendar event, as the one reader selects them. */
const MEETING_SOURCE_COLS = 'id, title, start_time, created_at, attendees, calendar_event_id, summary';
const MEETING_EVENT_COLS = 'id, title, start_time, attendees';
type MeetingRow = Record<string, unknown>;

/** The pure shaping half (W16.4 — one shaper for the page's single read AND the deck's batched read). */
export function meetingSourceFromRows(
  mt: MeetingRow | null | undefined, ev: MeetingRow | null | undefined, isUser?: (who: string) => boolean,
): MeetingSource | null {
  if (!mt || !mt.id) return null;
  const names: string[] = [];
  for (const a of Array.isArray(mt.attendees) ? mt.attendees as unknown[] : []) { const l = labelOf(a); if (l) names.push(l); }
  let title = decodeEntities(String(mt.title ?? '').trim()) || 'Meeting';
  let startISO = (mt.start_time as string | null) ?? (mt.created_at as string | null) ?? null;
  if (ev) {
    if (ev.title) title = decodeEntities(String(ev.title));
    if (ev.start_time) startISO = String(ev.start_time);
    for (const a of Array.isArray(ev.attendees) ? ev.attendees as unknown[] : []) { const l = labelOf(a); if (l) names.push(l); }
  }
  const seen = new Set<string>();
  const attendees = names.filter((n) => {
    const k = n.toLowerCase();
    if (seen.has(k) || (isUser && isUser(n))) return false;
    seen.add(k); return true;
  });
  const summary = typeof mt.summary === 'string' ? decodeEntities(mt.summary).replace(/\s+/g, ' ').trim() : '';
  return {
    id: String(mt.id),
    addressId: String(mt.calendar_event_id ?? mt.id),
    title, startISO, attendees,
    excerpt: summary ? clipForDisplay(summary, MEETING_SOURCE_EXCERPT_CHARS) : null,
  };
}

/** Read a meeting-born commitment's source meeting (transcript row + its calendar event). */
export async function meetingSourceOf(
  client: SupabaseClient, userId: string, meetingId: string,
  isUser?: (who: string) => boolean,
): Promise<MeetingSource | null> {
  return (await meetingSourcesOf(client, userId, [meetingId], isUser)).get(meetingId) ?? null;
}

/** THE ONE READ, batched (W16.4 — the deck's handed set): two `in()` reads for the whole set,
 *  never one per card. Unreadable → absent from the map. Zero AI. */
export async function meetingSourcesOf(
  client: SupabaseClient, userId: string, meetingIds: string[],
  isUser?: (who: string) => boolean,
): Promise<Map<string, MeetingSource>> {
  const out = new Map<string, MeetingSource>();
  const ids = [...new Set(meetingIds.filter(Boolean))];
  if (!ids.length) return out;
  try {
    const { data: mts, error } = await client.from('meeting_transcripts').select(MEETING_SOURCE_COLS)
      .eq('user_id', userId).in('id', ids);
    if (error || !mts?.length) return out;
    const evIds = [...new Set((mts as MeetingRow[]).map((m) => m.calendar_event_id).filter((x): x is string => typeof x === 'string' && !!x))];
    const evById = new Map<string, MeetingRow>();
    if (evIds.length) {
      const { data: evs, error: evErr } = await client.from('calendar_events').select(MEETING_EVENT_COLS)
        .eq('user_id', userId).in('id', evIds);
      if (!evErr) for (const e of (evs ?? []) as MeetingRow[]) evById.set(String(e.id), e);
    }
    for (const mt of mts as MeetingRow[]) {
      const shaped = meetingSourceFromRows(mt, mt.calendar_event_id ? evById.get(String(mt.calendar_event_id)) : null, isUser);
      if (shaped) out.set(shaped.id, shaped);
    }
  } catch { /* an unreadable source is no source */ }
  return out;
}

// ── A COMMITMENT'S SOURCE MESSAGE IS ITS OWN (stabilization W11.1 · ONE OBJECT, ONE DOOR) ─────────
// Found live (owner walk, Sep 23): a commitment extracted from an Aug 28 email on a long client
// thread showed, as its source card, the thread's LATEST message (Sep 17) — the room mounted the
// thread's inbox item (`inboxItemForEmail` → the newest item on the thread) and the thread door serves
// that item's newest tail. The promise came from ONE message; the card shows THAT message, read by
// `source_id` here, and "later in this conversation" is the thread drawer's (the card's one door).

/** The excerpt budget for a source message's own words — the same budget as a meeting source. */
export const EMAIL_SOURCE_EXCERPT_CHARS = MEETING_SOURCE_EXCERPT_CHARS;

/** An email-born commitment's source MESSAGE, as its card needs it — all served, nothing composed by
 *  the kit. `excerpt` is the message's OWN words (quoted tails stripped), display-clipped. */
export type EmailSource = {
  id: string;
  threadId: string | null;
  subject: string | null;
  from: string | null;
  receivedAt: string | null;
  excerpt: string | null;
  /** W15.4 — the user wrote this message (the W7.6 authorship stamp); a quote's lead reads it. */
  authoredByUser: boolean;
};

/** The pure shaping half (the gate holds it): an `emails` row → the source message facts. */
export function emailSourceFromRow(row: Record<string, unknown> | null | undefined, ownWords: (body: string) => string): EmailSource | null {
  if (!row || !row.id) return null;
  // Decoded ONCE, before the quote strip and the clip (W5b/W16.4 — "wasn&#39;t" never reaches a card).
  const body = typeof row.body === 'string' ? ownWords(decodeEntities(row.body)) : '';
  const text = body.replace(/\s+/g, ' ').trim();
  return {
    id: String(row.id),
    threadId: (row.thread_id as string | null) ?? null,
    subject: decodeEntities((row.subject as string | null) || '') || null,
    from: decodeEntities((row.from_name as string | null) || '') || (row.from_address as string | null) || null,
    receivedAt: (row.received_at as string | null) ?? null,
    excerpt: text ? clipForDisplay(text, EMAIL_SOURCE_EXCERPT_CHARS) : null,
    authoredByUser: row.is_from_user === true,
  };
}

/** The columns THE ONE READ selects — the single and the batched read share them. */
const EMAIL_SOURCE_COLS = 'id, thread_id, subject, body, from_name, from_address, received_at, is_from_user';
/** The message's OWN words (the quoted tail stripped) — the one strip both reads use. */
const sourceOwnWords = async (): Promise<(b: string) => string> => {
  const { topMessageOf } = await import('@/lib/inbox/top-message');
  return (b: string) => topMessageOf(b) || b;
};

/** THE ONE READ of an email-born commitment's source message: `commitments.source_id` IS the
 *  `emails.id` (see the header). One bounded SELECT, zero AI; unreadable → null. */
export async function emailSourceOf(client: SupabaseClient, userId: string, emailId: string | null | undefined): Promise<EmailSource | null> {
  if (!emailId) return null;
  try {
    const { data, error } = await client.from('emails')
      .select(EMAIL_SOURCE_COLS)
      .eq('id', emailId).eq('user_id', userId).maybeSingle();
    if (error || !data) return null;
    return emailSourceFromRow(data as Record<string, unknown>, await sourceOwnWords());
  } catch { return null; }
}

/** THE SAME READ, batched (W16.4 — the deck's handed set): the SAME columns, the SAME shaper, the
 *  SAME own-words strip, each message BY ITS ID — one `in()` read for the whole set, never one per
 *  card and never the thread's newest. Unreadable → absent from the map. */
export async function emailSourcesOf(client: SupabaseClient, userId: string, emailIds: string[]): Promise<Map<string, EmailSource>> {
  const out = new Map<string, EmailSource>();
  const ids = [...new Set(emailIds.filter(Boolean))];
  if (!ids.length) return out;
  try {
    const { data, error } = await client.from('emails')
      .select(EMAIL_SOURCE_COLS)
      .eq('user_id', userId).in('id', ids);
    if (error || !data) return out;
    const own = await sourceOwnWords();
    for (const row of data as Record<string, unknown>[]) {
      const shaped = emailSourceFromRow(row, own);
      if (shaped) out.set(shaped.id, shaped);
    }
  } catch { /* an unreadable source is no source */ }
  return out;
}

// ── WHY THIS COMMITMENT EXISTS (stabilization W15.4 · A PROMISE IS QUOTED OR IT ISN'T A PROMISE) ──
// Found live (owner, Sep 24): "why items on my sent emails?" — the item never said why it existed.
// Every extracted commitment now carries the EXACT words of its source that make it
// (`commitments.source_quote`, code-verified at the write door — lib/commitments/extract.ts
// `promiseQuoteFloor`). This is THE ONE READ of it: hosts render `lead` + `text`
// ("You wrote: '…'" · "Sam asked: '…'" · "Said in the meeting: '…'") and compose nothing.

/** A commitment's quote, as a host renders it — all served. */
export type SourceQuote = {
  text: string;
  /** Who said it: the user (their own mail), the other party (received mail), or a meeting line. */
  by: 'user' | 'other' | 'meeting';
  /** The other party's display name, when `by === 'other'` and known. */
  name: string | null;
  /** The ready lead-in: "You wrote" · "<Name> asked" · "<Name> wrote" · "Said in the meeting". */
  lead: string;
  /** The one served line a host's quote slot prints (W15.1 `quote`): `<lead>: "<text>"`. */
  line: string;
};

/** The pure shaping half (the gate holds it). No quote → null (a pre-W15.4 row, or the migration pending). */
export function sourceQuoteFrom(f: {
  quote: string | null | undefined; source: string | null | undefined; direction: string | null | undefined;
  authoredByUser?: boolean | null; from?: string | null; counterparty?: string | null;
}): SourceQuote | null {
  const text = String(f.quote ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const done = (by: SourceQuote['by'], name: string | null, lead: string): SourceQuote => ({ text, by, name, lead, line: `${lead}: “${text}”` });
  if (f.source === 'meeting') return done('meeting', null, 'Said in the meeting');
  if (f.authoredByUser === true) return done('user', null, 'You wrote');
  const name = String(f.from ?? f.counterparty ?? '').replace(/<[^>]*>/g, '').replace(/^["']|["']$/g, '').trim() || null;
  const verb = f.direction === 'awaiting' ? 'wrote' : 'asked';
  return done('other', name, name ? `${name} ${verb}` : (verb === 'asked' ? 'They asked' : 'They wrote'));
}

/** THE ONE READ of a commitment's quote: its own row (tolerant of the pending `source_quote` column —
 *  an error is no quote, never a broken read) + its source message's author, when mail. Zero AI. */
export async function sourceQuoteOf(client: SupabaseClient, userId: string, commitmentId: string | null | undefined): Promise<SourceQuote | null> {
  if (!commitmentId) return null;
  try {
    const { data: c, error } = await client.from('commitments')
      .select('id, source_quote, source, source_id, direction, counterparty')
      .eq('id', commitmentId).eq('user_id', userId).maybeSingle();
    if (error || !c || !c.source_quote) return null;
    let authoredByUser: boolean | null = null;
    let from: string | null = null;
    if (c.source === 'email' && c.source_id) {
      const { data: e, error: eErr } = await client.from('emails').select('is_from_user, from_name, from_address')
        .eq('id', String(c.source_id)).eq('user_id', userId).maybeSingle();
      if (!eErr && e) { authoredByUser = e.is_from_user === true; from = (e.from_name as string | null) || (e.from_address as string | null) || null; }
    }
    return sourceQuoteFrom({ quote: c.source_quote as string, source: c.source as string, direction: c.direction as string, authoredByUser, from, counterparty: (c.counterparty as string | null) ?? null });
  } catch { return null; }
}

/** THE SAME READ, batched (W16.4 — the deck's handed set): the SAME columns, the SAME shaper, one
 *  `in()` over the commitments and one over their source messages' authors. Tolerant of the pending
 *  `source_quote` column the same way (an error is no quote). Commitments without a quote are absent. */
export async function sourceQuotesOf(client: SupabaseClient, userId: string, commitmentIds: string[]): Promise<Map<string, SourceQuote>> {
  const out = new Map<string, SourceQuote>();
  const ids = [...new Set(commitmentIds.filter(Boolean))];
  if (!ids.length) return out;
  try {
    const { data: cs, error } = await client.from('commitments')
      .select('id, source_quote, source, source_id, direction, counterparty')
      .eq('user_id', userId).in('id', ids);
    if (error || !cs) return out;
    const quoted = (cs as Record<string, unknown>[]).filter((c) => !!c.source_quote);
    const emailIds = [...new Set(quoted.filter((c) => c.source === 'email' && c.source_id).map((c) => String(c.source_id)))];
    const author = new Map<string, { authoredByUser: boolean; from: string | null }>();
    if (emailIds.length) {
      const { data: es, error: eErr } = await client.from('emails').select('id, is_from_user, from_name, from_address')
        .eq('user_id', userId).in('id', emailIds);
      if (!eErr) for (const e of (es ?? []) as Record<string, unknown>[]) {
        author.set(String(e.id), { authoredByUser: e.is_from_user === true, from: (e.from_name as string | null) || (e.from_address as string | null) || null });
      }
    }
    for (const c of quoted) {
      const a = c.source === 'email' && c.source_id ? author.get(String(c.source_id)) : undefined;
      const q = sourceQuoteFrom({ quote: c.source_quote as string, source: c.source as string, direction: c.direction as string,
        authoredByUser: a ? a.authoredByUser : null, from: a?.from ?? null, counterparty: (c.counterparty as string | null) ?? null });
      if (q) out.set(String(c.id), q);
    }
  } catch { /* additive — no quote */ }
  return out;
}
