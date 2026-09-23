// ════════════════════════════════════════════════════════════════════════════════════════════════
// EVIDENCE SETTLES — THE NOMINATOR (stabilization W3.1, invariant 7; docs/stabilization-plan.md).
//
// R3, verbatim: "settlement listens to same-thread replies only." Live on Sep 22: 342 of 544 open
// you_owe commitments and 267 of 684 open actionable inbox items had LATER evidence the user had
// already acted — a meeting held with the counterparty, an email to them on another thread, a
// booked slot, a transcript — and every one of them still stood on the deck as a debt.
//
// THE LAW: a later deed by the user on ANY source (mail on any thread, calendar, meeting) is
// NOMINATED against open work within one sync cycle. This module is the NOMINATION half and only
// that — ZERO AI, deterministic address matching, bounded reads. The DISPOSITION stays with the
// reasoned fulfillment judge (lib/commitments/fulfillment.ts): only `delivered` closes; `unclear`
// and failure change nothing (the fulfillment-law asymmetry). Nominate → judge → settle.
//
// Two entry points, one pure core (`matchEvidence`):
//   • FORWARD  — for an open item/commitment: what evidence AFTER it exists with its counterparty?
//   • REVERSE  — for a NEW evidence event (a sent email, a synced calendar event, a processed
//                transcript): which open items could it settle? (the sync-time heartbeat)
// Address matching is the ONLY key: the counterparty resolves to an email address through facts
// the house already holds (the "Name <email>" form, the person registry's aliases, the thread's
// inbound sender, the meeting's attendee list) — never a keyword, never a name-similarity guess
// against free text. No address → no nomination (showing costs less than hiding).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeEmail, isEmail } from '@/lib/core/email';
import { parseWho, findPersonEntity, type PersonEntity } from '@/lib/entities/people';
import { sameAttendee } from '@/lib/projects/identity';

export type EvidenceType = 'email' | 'calendar' | 'transcript';

/** One nominated piece of evidence — what the judge reads. `at` is the evidence's OWN time (the
 *  settle stamps resolved_at from it, never from the sweep's clock — the Day-cleared ring lesson). */
export type Evidence = {
  type: EvidenceType;
  id: string;
  at: string;
  title: string;
  /** email only: the message's own words are hydrated by the settle module (bodies stay out of the pool). */
  body?: string;
  attachmentCount?: number | null;
  /** calendar/transcript: has the slot already taken place? */
  status?: 'held' | 'booked';
  threadId?: string | null;
  /** email: who wrote it — the user (a you_owe deed) or the counterparty (an awaiting deed). */
  by?: 'user' | 'counterparty';
};

export type PoolEmail = { id: string; at: string; subject: string; from: string | null; to: string[]; threadId: string | null; attachmentCount: number | null; fromUser: boolean };
export type PoolEvent = { id: string; at: string; end: string | null; title: string; attendees: string[]; cancelled: boolean };
export type PoolTranscript = { id: string; at: string; title: string; attendees: string[] };

/** Everything the matcher reads for ONE user — loaded once per user per sweep, bounded. */
export type EvidencePool = { emails: PoolEmail[]; events: PoolEvent[]; transcripts: PoolTranscript[] };

export type OpenWork = {
  kind: 'commitment' | 'inbox';
  id: string;
  /** evidence must be strictly AFTER this moment (commitment: created_at · inbox: last activity). */
  afterISO: string;
  counterpartyEmail: string | null;
  threadId?: string | null;
  /** who must act for the work to settle — the user (you_owe / a reply owed) or the counterparty (awaiting). */
  fulfiller: 'user' | 'counterparty';
  description: string;
};

export const EVIDENCE_PER_TYPE = 3;          // top N per type, newest first — the judge is token-tight
export const POOL_MAX_PER_SOURCE = 400;      // bounded reads; the sweep is budgeted anyway
export const REVERSE_MAX_WORK = 300;         // open rows read per user on the event path
export const REVERSE_MAX_NOMINATIONS = 8;    // judgments one event may trigger (bounded spend)

// ── PURE CORES (unit-tested; zero IO) ───────────────────────────────────────────────────────────

/** Every email address a raw attendee/recipient list carries, normalized. Accepts the calendar
 *  shape ({email,name}), the transcript shape (strings or objects), and "Name <email>" forms. */
export function addressesOf(raw: unknown): string[] {
  const out = new Set<string>();
  for (const a of Array.isArray(raw) ? raw : []) {
    const s = typeof a === 'string' ? a : String((a as { email?: unknown; address?: unknown })?.email ?? (a as { address?: unknown })?.address ?? '');
    const { email } = parseWho(s);
    const e = email ? normalizeEmail(email) : (isEmail(normalizeEmail(s)) ? normalizeEmail(s) : null);
    if (e) out.add(e);
  }
  return [...out];
}

/** The ONE address-equality test — deterministic, case-blind, no fuzz. */
export const sameAddress = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && normalizeEmail(a) === normalizeEmail(b);

/**
 * THE MATCH — pure. Evidence strictly after `work.afterISO`, with `work.counterpartyEmail` as a
 * participant (or, for email, on the work's own thread — the same-thread reply the old resolvers
 * already trusted); newest first; top EVIDENCE_PER_TYPE per type. `nowISO` decides held vs booked.
 */
export function matchEvidence(pool: EvidencePool, work: OpenWork, nowISO: string): Evidence[] {
  const cp = work.counterpartyEmail ? normalizeEmail(work.counterpartyEmail) : null;
  const after = work.afterISO;
  if (!after) return [];
  const wantFromUser = work.fulfiller === 'user';

  const emails: Evidence[] = pool.emails
    .filter((m) => m.at > after && m.fromUser === wantFromUser)
    .filter((m) => {
      if (work.threadId && m.threadId && m.threadId === work.threadId) return true;
      if (!cp) return false;
      // the user's deed = a message TO the counterparty; the counterparty's deed = a message FROM them
      return wantFromUser ? m.to.some((t) => sameAddress(t, cp)) : sameAddress(m.from, cp);
    })
    .map((m) => ({ type: 'email' as const, id: m.id, at: m.at, title: m.subject, threadId: m.threadId, attachmentCount: m.attachmentCount, by: m.fromUser ? 'user' as const : 'counterparty' as const }));

  const events: Evidence[] = cp ? pool.events
    .filter((e) => !e.cancelled && e.at > after && e.attendees.some((a) => sameAddress(a, cp)))
    .map((e) => ({ type: 'calendar' as const, id: e.id, at: e.at, title: e.title, status: (e.end ?? e.at) < nowISO ? 'held' as const : 'booked' as const })) : [];

  const transcripts: Evidence[] = cp ? pool.transcripts
    .filter((t) => t.at > after && t.attendees.some((a) => sameAddress(a, cp)))
    .map((t) => ({ type: 'transcript' as const, id: t.id, at: t.at, title: t.title, status: 'held' as const })) : [];

  const top = (xs: Evidence[]) => xs.sort((a, b) => b.at.localeCompare(a.at)).slice(0, EVIDENCE_PER_TYPE);
  return [...top(emails), ...top(events), ...top(transcripts)];
}

/** A stable identity for a set of evidence — the judge's cache sig: a NEW piece re-judges, the same
 *  set never re-spends. Order-independent. */
export const evidenceSig = (ev: Evidence[]): string =>
  ev.map((e) => `${e.type[0]}${e.id}`).sort().join(',');

/** Pick the counterparty's address out of an attendee list by name (alias-aware, conservative:
 *  exactly one match or nothing). Pure. */
export function attendeeAddressByName(attendees: unknown, name: string | null | undefined): string | null {
  if (!name) return null;
  const hits = new Set<string>();
  for (const a of Array.isArray(attendees) ? attendees : []) {
    const email = typeof a === 'string' ? (parseWho(a).email ?? '') : String((a as { email?: unknown })?.email ?? '');
    const display = typeof a === 'string' ? (parseWho(a).name ?? '') : String((a as { name?: unknown; displayName?: unknown })?.name ?? (a as { displayName?: unknown })?.displayName ?? '');
    if (!email) continue;
    if ((display && sameAttendee(display, name)) || sameAttendee(email, name)) hits.add(normalizeEmail(email));
  }
  return hits.size === 1 ? [...hits][0] : null;
}

/** The registry's answer for a raw counterparty string: the person's first alias that is an
 *  address (the person entity is an alias registry — one row per human). Pure over a loaded list. */
export function registryAddress(list: PersonEntity[], raw: string | null | undefined): string | null {
  const { email, name } = parseWho(raw);
  if (email) return normalizeEmail(email);
  const p = findPersonEntity(list, null, name);
  if (!p) return null;
  const alias = p.aliases.find((a) => isEmail(a));
  return alias ? normalizeEmail(alias) : null;
}

// ── LOADERS (bounded SELECTs; no writes) ────────────────────────────────────────────────────────

const meta = (m: unknown): number | null => {
  const a = (m as { attachments?: unknown } | null)?.attachments;
  return Array.isArray(a) ? a.length : null;
};

/** Load one user's evidence pool from `sinceISO` on. Bodies are NOT loaded here (the settle module
 *  hydrates the ≤3 chosen candidates); attendee lists are pre-resolved (a transcript without its
 *  own attendees borrows its calendar event's). */
export async function loadEvidencePool(client: SupabaseClient, userId: string, sinceISO: string): Promise<EvidencePool> {
  const [em, ev, tr] = await Promise.all([
    client.from('emails').select('id, received_at, subject, from_address, to_addresses, cc_addresses, thread_id, metadata, is_from_user')
      .eq('user_id', userId).gt('received_at', sinceISO)
      .order('received_at', { ascending: false }).limit(POOL_MAX_PER_SOURCE),
    // Bounded ABOVE too (Sep 22 review): newest-first with no ceiling let far-future recurring
    // instances crowd the near meetings — the ones that actually settle work — out of the cap.
    client.from('calendar_events').select('id, start_time, end_time, title, attendees, status')
      .eq('user_id', userId).gt('start_time', sinceISO)
      .lte('start_time', new Date(Date.now() + 21 * 86_400_000).toISOString())
      .order('start_time', { ascending: false }).limit(POOL_MAX_PER_SOURCE),
    client.from('meeting_transcripts').select('id, start_time, created_at, title, attendees, calendar_event_id')
      .eq('user_id', userId).gt('start_time', sinceISO)
      .order('start_time', { ascending: false }).limit(POOL_MAX_PER_SOURCE),
  ]);
  const emails: PoolEmail[] = ((em.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), at: String(r.received_at ?? ''), subject: String(r.subject ?? ''),
    from: r.from_address ? normalizeEmail(String(r.from_address)) : null,
    to: [...((r.to_addresses as string[]) ?? []), ...((r.cc_addresses as string[]) ?? [])].map((x) => normalizeEmail(String(x))),
    threadId: (r.thread_id as string) ?? null, attachmentCount: meta(r.metadata), fromUser: !!r.is_from_user,
  }));
  const events: PoolEvent[] = ((ev.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), at: String(r.start_time ?? ''), end: (r.end_time as string) ?? null, title: String(r.title ?? ''),
    attendees: addressesOf(r.attendees), cancelled: String(r.status ?? '') === 'cancelled',
  }));
  const byEventId = new Map(events.map((e) => [e.id, e.attendees]));
  const trRows = (tr.data ?? []) as Array<Record<string, unknown>>;
  // Transcripts whose calendar event sits outside the pool window still borrow its attendees.
  const missing = trRows.map((r) => r.calendar_event_id as string | null).filter((x): x is string => !!x && !byEventId.has(x));
  if (missing.length) {
    const { data } = await client.from('calendar_events').select('id, attendees').eq('user_id', userId).in('id', [...new Set(missing)].slice(0, 200));
    for (const r of (data ?? []) as Array<Record<string, unknown>>) byEventId.set(String(r.id), addressesOf(r.attendees));
  }
  const transcripts: PoolTranscript[] = trRows.map((r) => {
    const own = addressesOf(r.attendees);
    const borrowed = r.calendar_event_id ? (byEventId.get(String(r.calendar_event_id)) ?? []) : [];
    return { id: String(r.id), at: String(r.start_time ?? r.created_at ?? ''), title: String(r.title ?? ''), attendees: [...new Set([...own, ...borrowed])] };
  });
  return { emails, events, transcripts };
}

type CommitmentRow = { id: string; counterparty?: string | null; thread_id?: string | null; source?: string | null; source_id?: string | null };

/**
 * Resolve each commitment's counterparty to ONE address from facts the house holds, in order:
 * the stored "Name <email>" form → the person registry → the thread's inbound sender → the
 * meeting's attendee list (by name, alias-aware). Null when nothing resolves — no nomination.
 * BATCHED: ≤4 reads for any number of rows (the event door runs this per sent email).
 */
export async function resolveCommitmentAddresses(
  client: SupabaseClient, userId: string, rows: CommitmentRow[], registry: PersonEntity[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const pending: CommitmentRow[] = [];
  for (const c of rows) {
    const a = registryAddress(registry, c.counterparty);
    if (a) out.set(c.id, a); else pending.push(c);
  }
  // the thread's newest inbound sender
  const threadIds = [...new Set(pending.map((c) => c.thread_id).filter((t): t is string => !!t))].slice(0, 300);
  const senderByThread = new Map<string, string>();
  if (threadIds.length) {
    const { data } = await client.from('emails').select('thread_id, from_address, received_at')
      .eq('user_id', userId).eq('is_from_user', false).in('thread_id', threadIds)
      .order('received_at', { ascending: false }).limit(1000);
    for (const r of (data ?? []) as Array<{ thread_id: string; from_address: string | null }>) {
      if (r.from_address && !senderByThread.has(r.thread_id)) senderByThread.set(r.thread_id, normalizeEmail(r.from_address));
    }
  }
  const still: CommitmentRow[] = [];
  for (const c of pending) {
    const a = c.thread_id ? senderByThread.get(c.thread_id) ?? null : null;
    if (a) out.set(c.id, a); else still.push(c);
  }
  // the meeting's attendee list, by name
  const meeting = still.filter((c) => c.source === 'meeting' && c.source_id && c.counterparty);
  const tIds = [...new Set(meeting.map((c) => String(c.source_id)))].slice(0, 300);
  const tById = new Map<string, { attendees: unknown; calendar_event_id: string | null }>();
  if (tIds.length) {
    const { data } = await client.from('meeting_transcripts').select('id, attendees, calendar_event_id').eq('user_id', userId).in('id', tIds);
    for (const r of (data ?? []) as Array<{ id: string; attendees: unknown; calendar_event_id: string | null }>) tById.set(r.id, r);
  }
  const evIds = [...new Set([...tById.values()].map((t) => t.calendar_event_id).filter((x): x is string => !!x))].slice(0, 300);
  const evById = new Map<string, unknown>();
  if (evIds.length) {
    const { data } = await client.from('calendar_events').select('id, attendees').eq('user_id', userId).in('id', evIds);
    for (const r of (data ?? []) as Array<{ id: string; attendees: unknown }>) evById.set(r.id, r.attendees);
  }
  for (const c of still) {
    const t = c.source_id ? tById.get(String(c.source_id)) : undefined;
    const a = t ? (attendeeAddressByName(t.attendees, c.counterparty) ?? (t.calendar_event_id ? attendeeAddressByName(evById.get(t.calendar_event_id), c.counterparty) : null)) : null;
    out.set(c.id, a);
  }
  return out;
}

/** The single-row form of the batch resolver. */
export async function resolveCommitmentAddress(
  client: SupabaseClient, userId: string, c: CommitmentRow, registry: PersonEntity[],
): Promise<string | null> {
  return (await resolveCommitmentAddresses(client, userId, [c], registry)).get(c.id) ?? null;
}

/** The open work the reverse path reads — bounded, newest first. Commitment mirrors (source=
 *  'commitment') are excluded: they settle with their commitment, never on their own. */
export async function loadOpenWork(client: SupabaseClient, userId: string, registry: PersonEntity[]): Promise<OpenWork[]> {
  const [cRes, iRes] = await Promise.all([
    client.from('commitments').select('id, description, counterparty, thread_id, source, source_id, created_at, direction')
      .eq('user_id', userId).eq('status', 'open').in('direction', ['you_owe', 'awaiting'])
      .order('created_at', { ascending: false }).limit(REVERSE_MAX_WORK),
    client.from('inbox_items').select('id, work_title, source_data, created_at, last_activity_at, type_override')
      .eq('user_id', userId).eq('status', 'pending').eq('source', 'email')
      .or('work_state.in.(work_prepared,decision_required,action_required),rule_type.eq.needs_reply')
      .order('created_at', { ascending: false }).limit(REVERSE_MAX_WORK),
  ]);
  const out: OpenWork[] = [];
  // THE STANDING/HANDOFF FLOORS: a workflow's promise or a parked run's gate is never settled by mail.
  const cRows = ((cRes.data ?? []) as Array<Record<string, unknown>>).filter((c) => !['workflow', 'handoff'].includes(String(c.source ?? '')));
  const addresses = await resolveCommitmentAddresses(client, userId, cRows as CommitmentRow[], registry);
  for (const c of cRows) {
    const cp = addresses.get(String(c.id)) ?? null;
    out.push({
      kind: 'commitment', id: String(c.id), afterISO: String(c.created_at ?? ''), counterpartyEmail: cp,
      threadId: (c.thread_id as string) ?? null, fulfiller: String(c.direction) === 'awaiting' ? 'counterparty' : 'user',
      description: String(c.description ?? ''),
    });
  }
  for (const it of (iRes.data ?? []) as Array<Record<string, unknown>>) {
    if (it.type_override === 'waiting_on' || it.type_override === 'fyi') continue;
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    const from = sd.from_address ? normalizeEmail(String(sd.from_address)) : null;
    const ask = (sd.understanding as { ask?: string } | null)?.ask;
    out.push({
      kind: 'inbox', id: String(it.id), afterISO: String(it.last_activity_at ?? it.created_at ?? ''), counterpartyEmail: from,
      threadId: (sd.thread_id as string) ?? null, fulfiller: 'user',
      description: String(ask || it.work_title || sd.subject || ''),
    });
  }
  return out;
}

export type NewEvidenceEvent =
  | { type: 'email'; id: string }
  | { type: 'calendar'; eventIds: string[]; provider?: string }
  | { type: 'transcript'; id: string };

/**
 * THE REVERSE ENTRY (the heartbeat): a NEW evidence event just landed — which open work could it
 * settle? Address-keyed, bounded (REVERSE_MAX_WORK rows read, REVERSE_MAX_NOMINATIONS returned).
 * Returns each nominated work with the FULL evidence set the forward matcher finds for it (the
 * judge must see the whole picture, not just the trigger).
 */
export async function nominateForEvent(
  client: SupabaseClient, userId: string, event: NewEvidenceEvent, registry: PersonEntity[], nowISO = new Date().toISOString(),
): Promise<Array<{ work: OpenWork; evidence: Evidence[] }>> {
  // The event's participants + its moment.
  let addresses: string[] = [];
  let at = '';
  let fromUser: boolean | null = null;
  if (event.type === 'email') {
    const { data } = await client.from('emails').select('received_at, from_address, to_addresses, cc_addresses, is_from_user').eq('id', event.id).eq('user_id', userId).maybeSingle();
    if (!data) return [];
    fromUser = !!data.is_from_user;
    addresses = fromUser
      ? addressesOf([...((data.to_addresses as string[]) ?? []), ...((data.cc_addresses as string[]) ?? [])])
      : addressesOf([data.from_address]);
    at = String(data.received_at ?? '');
  } else if (event.type === 'calendar') {
    const ids = [...new Set(event.eventIds)].slice(0, 50);
    if (!ids.length) return [];
    let q = client.from('calendar_events').select('start_time, attendees, status').eq('user_id', userId).in('event_id', ids);
    if (event.provider) q = q.eq('provider', event.provider);
    const { data } = await q;
    const rows = ((data ?? []) as Array<Record<string, unknown>>).filter((r) => String(r.status ?? '') !== 'cancelled');
    addresses = [...new Set(rows.flatMap((r) => addressesOf(r.attendees)))];
    at = rows.map((r) => String(r.start_time ?? '')).sort().pop() ?? '';
  } else {
    const { data } = await client.from('meeting_transcripts').select('start_time, created_at, attendees, calendar_event_id').eq('id', event.id).eq('user_id', userId).maybeSingle();
    if (!data) return [];
    addresses = addressesOf(data.attendees);
    if (!addresses.length && data.calendar_event_id) {
      const { data: ev } = await client.from('calendar_events').select('attendees').eq('id', data.calendar_event_id).maybeSingle();
      addresses = addressesOf(ev?.attendees);
    }
    at = String(data.start_time ?? data.created_at ?? '');
  }
  if (!addresses.length || !at) return [];

  const open = await loadOpenWork(client, userId, registry);
  const touched = open.filter((w) => w.afterISO < at && w.counterpartyEmail && addresses.some((a) => sameAddress(a, w.counterpartyEmail)))
    // an inbound (counterparty) email is only evidence for AWAITING work; a sent one for the user's own debts
    .filter((w) => fromUser === null || (fromUser ? w.fulfiller === 'user' : w.fulfiller === 'counterparty'))
    .slice(0, REVERSE_MAX_NOMINATIONS);
  if (!touched.length) return [];
  const since = touched.map((w) => w.afterISO).sort()[0];
  const pool = await loadEvidencePool(client, userId, since);
  return touched
    .map((work) => ({ work, evidence: matchEvidence(pool, work, nowISO) }))
    .filter((n) => n.evidence.length > 0);
}
