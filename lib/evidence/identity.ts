// ════════════════════════════════════════════════════════════════════════════════════════════════
// IDENTITY MATCHING (W8.1 EVIDENCE FROM EVERYWHERE). The matcher keys on PERSON IDENTITY and on the
// OBJECTS a deed touched — never on a keyword, never on a name-similarity guess against free text.
//
// A work item's keys (`WorkKeys`):
//   • PERSON — the counterparty text resolves to ONE person: its stored address ("Name <email>"), the
//     person registry (aliases, accent-folded name), the thread's inbound sender, and — for a BARE NAME
//     from a meeting ("Sam") — the meeting's OWN attendee list (its own attendees → its linked calendar
//     event → the single calendar event the recording sat inside), matched with `sameAttendee`
//     (conservative: exactly one attendee or nothing). The person then contributes EVERY address alias
//     and its person id — a deed to their other address is still a deed to them.
//   • OBJECT — the work's own thread, the meeting it came from, its entity membership (entity_links),
//     and our own house reference (`inbox:<id>` / `commitment:<id>`).
// Resolution is BATCHED (bounded reads for any number of rows); the pure helpers are unit-tested.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeEmail, isEmail } from '@/lib/core/email';
import { parseWho, findPersonEntity, type PersonEntity } from '@/lib/entities/people';
import { sameAttendee, foldAccents } from '@/lib/projects/identity';
import { fetchAllRows } from '@/lib/utils/fetch-all';

/** Every nomination key a work item carries. */
export type WorkKeys = {
  addresses: string[];
  personIds: string[];
  threadIds: string[];
  eventIds: string[];
  fileIds: string[];
  entityIds: string[];
  externalRefs: string[];
};

export const emptyKeys = (): WorkKeys => ({ addresses: [], personIds: [], threadIds: [], eventIds: [], fileIds: [], entityIds: [], externalRefs: [] });

/** Merge key sets — pure, deduped, addresses normalized. */
export function mergeKeys(...parts: Array<Partial<WorkKeys> | null | undefined>): WorkKeys {
  const out = emptyKeys();
  for (const p of parts) {
    if (!p) continue;
    for (const k of Object.keys(out) as Array<keyof WorkKeys>) {
      for (const v of p[k] ?? []) {
        if (!v) continue;
        const s = k === 'addresses' ? normalizeEmail(String(v)) : String(v);
        if (k === 'addresses' && !isEmail(s)) continue;
        if (!out[k].includes(s)) out[k].push(s);
      }
    }
  }
  return out;
}

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

/** Split a list into fixed-size chunks — pure (every element lands in exactly one chunk, in order). */
export function chunked<T>(xs: readonly T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

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

const fold = (s: string) => foldAccents(String(s ?? '')).toLowerCase().replace(/\s+/g, ' ').trim();

/** The registry's ONE person for a raw counterparty string — address alias, exact name/alias, then
 *  the ACCENT-FOLDED exact name/alias (never a partial or similarity match). Pure. */
export function registryPerson(list: PersonEntity[], raw: string | null | undefined): PersonEntity | null {
  const { email, name } = parseWho(raw);
  const hit = findPersonEntity(list, email, name);
  if (hit) return hit;
  const f = fold(email ?? name ?? '');
  if (!f) return null;
  const folded = list.filter((p) => fold(p.name) === f || p.aliases.some((a) => fold(a) === f));
  return folded.length === 1 ? folded[0] : null;
}

/** The person that owns an address (alias containment). Pure. */
export function personByAddress(list: PersonEntity[], address: string | null | undefined): PersonEntity | null {
  if (!address) return null;
  return findPersonEntity(list, normalizeEmail(address), null);
}

/** Every address alias of a person, normalized. Pure. */
export const personAddresses = (p: PersonEntity | null | undefined): string[] =>
  (p?.aliases ?? []).filter((a) => isEmail(a)).map((a) => normalizeEmail(a));

/** The registry's answer for a raw counterparty string: the stored address, else the person's first
 *  address alias. Pure over a loaded list. (Kept for the one-address callers.) */
export function registryAddress(list: PersonEntity[], raw: string | null | undefined): string | null {
  const { email } = parseWho(raw);
  if (email) return normalizeEmail(email);
  const p = registryPerson(list, raw);
  return personAddresses(p)[0] ?? null;
}

/** PURE — the meeting's own attendee list for a transcript: its own attendees, else its linked
 *  calendar event's, else the ONE calendar event whose window contains the recording's start. */
export function meetingAttendeesOf(
  t: { attendees?: unknown; calendar_event_id?: string | null; start_time?: string | null },
  eventsById: Map<string, unknown>,
  overlapping: Array<{ attendees: unknown }>,
): unknown[] {
  const own = Array.isArray(t.attendees) ? (t.attendees as unknown[]) : [];
  if (own.length) return own;
  const linked = t.calendar_event_id ? eventsById.get(t.calendar_event_id) : undefined;
  if (Array.isArray(linked) && linked.length) return linked as unknown[];
  return overlapping.length === 1 && Array.isArray(overlapping[0].attendees) ? (overlapping[0].attendees as unknown[]) : [];
}

export type CommitmentIdentityRow = { id: string; counterparty?: string | null; thread_id?: string | null; source?: string | null; source_id?: string | null };

/** One resolved identity: the PRIMARY address (the one-address callers' answer) + every key. */
export type ResolvedIdentity = { primary: string | null; keys: WorkKeys; via: 'stored' | 'registry' | 'thread' | 'meeting' | 'none' };

/** Person keys for one resolved address — the person's every alias + id when the registry knows them. */
function personKeysFor(registry: PersonEntity[], address: string | null, person?: PersonEntity | null): Partial<WorkKeys> {
  const p = person ?? personByAddress(registry, address);
  return { addresses: [...(address ? [address] : []), ...personAddresses(p)], personIds: p ? [p.id] : [] };
}

/**
 * Resolve each commitment's counterparty to a PERSON IDENTITY from facts the house holds, in order:
 * the stored "Name <email>" form → the person registry (alias / accent-folded name) → the thread's
 * inbound sender → the meeting's own attendee list (by name, `sameAttendee`, exactly one). Plus the
 * OBJECT keys (thread, the source meeting's calendar event, the house ref). BATCHED: a handful of
 * reads for any number of rows. Rows with nothing resolved keep their object keys (a same-thread
 * deed still nominates).
 */
export async function resolveCommitmentIdentities(
  client: SupabaseClient, userId: string, rows: CommitmentIdentityRow[], registry: PersonEntity[],
): Promise<Map<string, ResolvedIdentity>> {
  const out = new Map<string, ResolvedIdentity>();
  const objectKeys = (c: CommitmentIdentityRow): Partial<WorkKeys> => ({
    threadIds: c.thread_id ? [String(c.thread_id)] : [], externalRefs: [`commitment:${c.id}`],
  });
  const pending: CommitmentIdentityRow[] = [];
  for (const c of rows) {
    const { email } = parseWho(c.counterparty);
    if (email) {
      const a = normalizeEmail(email);
      out.set(c.id, { primary: a, keys: mergeKeys(personKeysFor(registry, a), objectKeys(c)), via: 'stored' });
      continue;
    }
    const p = registryPerson(registry, c.counterparty);
    const addrs = personAddresses(p);
    if (p && addrs.length) {
      out.set(c.id, { primary: addrs[0], keys: mergeKeys(personKeysFor(registry, addrs[0], p), objectKeys(c)), via: 'registry' });
      continue;
    }
    pending.push(c);
  }
  // the thread's newest inbound sender — CHUNKED, never sliced (NO SILENT CAPS).
  const threadIds = [...new Set(pending.map((c) => c.thread_id).filter((t): t is string => !!t))];
  const senderByThread = new Map<string, string>();
  for (const chunk of chunked(threadIds, 100)) {
    const data = await fetchAllRows<{ thread_id: string; from_address: string | null }>((from, to) =>
      client.from('emails').select('thread_id, from_address, received_at')
        .eq('user_id', userId).eq('is_from_user', false).in('thread_id', chunk)
        .order('received_at', { ascending: false }).order('id', { ascending: true }).range(from, to), { maxRows: 5000 });
    for (const r of data) {
      if (r.from_address && !senderByThread.has(r.thread_id)) senderByThread.set(r.thread_id, normalizeEmail(r.from_address));
    }
  }
  const still: CommitmentIdentityRow[] = [];
  for (const c of pending) {
    const a = c.thread_id ? senderByThread.get(c.thread_id) ?? null : null;
    if (a) out.set(c.id, { primary: a, keys: mergeKeys(personKeysFor(registry, a), objectKeys(c)), via: 'thread' });
    else still.push(c);
  }
  // THE MEETING'S OWN ATTENDEE LIST, by name — own attendees → linked event → the one event the
  // recording sat inside (a structural time fact, never a guess across the calendar).
  const meeting = still.filter((c) => c.source === 'meeting' && c.source_id && c.counterparty);
  const tIds = [...new Set(meeting.map((c) => String(c.source_id)))];
  const tById = new Map<string, { attendees: unknown; calendar_event_id: string | null; start_time: string | null }>();
  for (const chunk of chunked(tIds, 150)) {
    const { data, error } = await client.from('meeting_transcripts').select('id, attendees, calendar_event_id, start_time').eq('user_id', userId).in('id', chunk);
    if (error) continue;
    for (const r of (data ?? []) as Array<{ id: string; attendees: unknown; calendar_event_id: string | null; start_time: string | null }>) tById.set(r.id, r);
  }
  const evIds = [...new Set([...tById.values()].map((t) => t.calendar_event_id).filter((x): x is string => !!x))];
  const evById = new Map<string, unknown>();
  for (const chunk of chunked(evIds, 150)) {
    const { data, error } = await client.from('calendar_events').select('id, attendees').eq('user_id', userId).in('id', chunk);
    if (error) continue;
    for (const r of (data ?? []) as Array<{ id: string; attendees: unknown }>) evById.set(r.id, r.attendees);
  }
  // the containing event for recordings with no attendee facts of their own — one bounded read per transcript
  const overlapByT = new Map<string, Array<{ id: string; attendees: unknown }>>();
  for (const t of [...tById.entries()]) {
    const [id, row] = t;
    const own = Array.isArray(row.attendees) && (row.attendees as unknown[]).length > 0;
    const linked = row.calendar_event_id && Array.isArray(evById.get(row.calendar_event_id)) && (evById.get(row.calendar_event_id) as unknown[]).length > 0;
    if (own || linked || !row.start_time) continue;
    const { data, error } = await client.from('calendar_events').select('id, attendees, status')
      .eq('user_id', userId).lte('start_time', row.start_time).gte('end_time', row.start_time).limit(5);
    if (error) continue;
    overlapByT.set(id, ((data ?? []) as Array<{ id: string; attendees: unknown; status: string | null }>).filter((e) => String(e.status ?? '') !== 'cancelled'));
  }
  for (const c of still) {
    const t = c.source_id ? tById.get(String(c.source_id)) : undefined;
    const overlap = c.source_id ? (overlapByT.get(String(c.source_id)) ?? []) : [];
    const att = t ? meetingAttendeesOf(t, evById, overlap) : [];
    const a = t ? attendeeAddressByName(att, c.counterparty) : null;
    const meetingEvent = t?.calendar_event_id ?? (overlap.length === 1 ? overlap[0].id : null);
    const obj = mergeKeys(objectKeys(c), { eventIds: meetingEvent ? [meetingEvent] : [] });
    out.set(c.id, a
      ? { primary: a, keys: mergeKeys(personKeysFor(registry, a), obj), via: 'meeting' }
      : { primary: null, keys: obj, via: 'none' });
  }
  return out;
}

/**
 * ENTITY MEMBERSHIP for a set of work rows — `entity_links` (item_kind 'commitment' / 'inbox_item').
 * Chunked, never sliced. Returns `<kind>:<id>` → entity ids.
 */
export async function loadWorkEntities(
  client: SupabaseClient, userId: string, work: Array<{ kind: 'commitment' | 'inbox'; id: string }>,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const kind of ['commitment', 'inbox'] as const) {
    const ids = [...new Set(work.filter((w) => w.kind === kind).map((w) => w.id))];
    for (const chunk of chunked(ids, 150)) {
      const { data, error } = await client.from('entity_links').select('item_id, entity_id')
        .eq('user_id', userId).eq('item_kind', kind === 'commitment' ? 'commitment' : 'inbox_item').in('item_id', chunk);
      if (error) continue;
      for (const r of (data ?? []) as Array<{ item_id: string; entity_id: string }>) {
        const k = `${kind}:${r.item_id}`;
        out.set(k, [...new Set([...(out.get(k) ?? []), String(r.entity_id)])]);
      }
    }
  }
  return out;
}
