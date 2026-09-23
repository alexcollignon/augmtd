// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE EVIDENCE SOURCE REGISTRY (stabilization W8.1 EVIDENCE FROM EVERYWHERE · invariant 7).
//
// THE CATALOGUE LAW (the trigger-source idiom, lib/workflows/trigger-sources.ts): evidence sources
// are ROWS. The nominator, the settle, the per-account sweep, the reverse (sync-time) door and the
// census all read EVIDENCE_SOURCES; nothing outside this file may hardcode a source list. Each row
// emits the ONE shape (`EvidenceEvent`, lib/evidence/types.ts) and the ONE matcher
// (lib/evidence/match.ts) never learns which tool a deed came from.
//
// ROWS TODAY (each loads bounded, reports its caps — NO SILENT CAPS):
//   mail       — the `emails` table: a message sent by the user (authorship law: `is_from_user`), by a
//                TEAMMATE (the actor ladder), or by the counterparty. Scoped lanes by the people +
//                threads in play, the newest-first window beside them (a pool is a superset).
//   calendar   — `calendar_events`: a meeting held (its end is past) or booked; CANCELLED events and
//                DECLINED attendees never count.
//   transcript — `meeting_transcripts`: a meeting held and recorded; attendees from the recording, its
//                linked calendar event, or the ONE calendar event the recording sat inside.
//   deeds      — `action_commits` (THE COMMIT DOOR's ledger): what the user did THROUGH AUGMTD —
//                replies, sends, invites, event changes — the moment it happened, before any sync.
//
// SKIPPED, STATED (no stored source that can connect a deed to a counterparty or an object):
//   · `email_sends` (the coworker Resend log) stores a recipient COUNT and a subject, never who — it
//     cannot be matched; the coworker sends that matter already land in `action_commits`
//     ('coworker_email') and are read by the `deeds` row.
//   · workflow deliverables carry no counterparty and no work-object link — a deliverable is surfaced
//     by its run, not settled as evidence (revisit when runs carry `entity_id`).
//   · Slack / Drive / Nango tools: nothing is stored per message or per file today (`slack_identities`
//     is a user mapping, `drive_folders` a folder config). No stub rows are registered for them.
//
// HOW A FUTURE TOOL PLUGS IN (ONE row, ZERO matcher/judge/UI edits):
//   1. store its deeds (a table the tool's sync writes, or read the provider on demand);
//   2. add a row: { source, type, label, feature: <a TOOL_FEATURE key | null — THE GATING RULE>, deeds: [...],
//      loadPool(client, userId, scope) → EvidenceEvent[], loadByIds?, hydrateBody?, entityLink? };
//      map each stored deed to the one shape — `deed` from the vocabulary, `actor` through
//      `actorRole(...)` (the ladder), `participants` as addresses / person ids, `objects` as the
//      thread / event / file / entity it touched;
//   3. fire `settleForEvent(client, userId, { type: <row.type>, ... })` from its sync (void, .catch)
//      if it should settle at sync time; the per-account sweep already reads every row.
//
// THE GATING RULE (owner decision, W8.7): a row is gated on its DATA, not on a UI module. A row's
// `feature` is set ONLY when that workspace feature genuinely means "this source is NOT COLLECTED"
// (`email` off = no mailbox is connected, nothing is synced — the sovereign/no-OAuth workspace).
// A feature that only shows or hides a surface never switches evidence off: the user's own synced
// calendar and their stored recordings are evidence whichever modules are displayed, so `calendar`
// and `transcript` carry `feature: null` and are gated by their rows existing (no connected
// calendar → no `calendar_events` rows → an empty lane; no recordings → no `meeting_transcripts`).
// The `meetings` flag (the recording/meetings SURFACE) therefore gates nothing here. A sovereign
// (email-off) workspace has no calendar connection, so it has no calendar rows and nothing changes.
//   The fulfillment judge renders any deed it has never seen as a dated DEED FACT naming the actor —
//   a new source is judged on day one, and scripts/smoke-evidence-sources.ts proves a test-only row
//   nominates with no matcher edit.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeEmail } from '@/lib/core/email';
import { parseWho, type PersonEntity } from '@/lib/entities/people';
import { fetchAllRows } from '@/lib/utils/fetch-all';
import { isToolAllowed } from '@/lib/workspace/tool-capabilities';
import type { WorkspaceFeatures } from '@/lib/workspace/types';
import { actorRole } from './actor';
import { addressesOf, chunked } from './identity';
import type { ActorContext, EvidenceEvent, EvidenceLoadScope, EvidenceParty, EvidenceSourceDef } from './types';

export const POOL_MAX_PER_SOURCE = 400;      // bounded reads; the sweep is budgeted anyway
/** The people-scoped email lane's bounds: addresses/threads per `in()`/`overlaps()` filter (URL
 *  length) and the ceiling on rows the whole scoped lane may hold (a stated bound, reported in stats). */
export const SCOPE_CHUNK = 40;
export const POOL_SCOPED_MAX = 6000;
/** The calendar lane's forward reach (a booked slot further out than this is not "done"). */
export const CALENDAR_HORIZON_DAYS = 21;

// ── PURE ROW MAPPERS (unit-tested; every adapter's output is the one shape) ─────────────────────

const meta = (m: unknown): number | null => {
  const a = (m as { attachments?: unknown } | null)?.attachments;
  return Array.isArray(a) ? a.length : null;
};

/** THE SYNC-TIME MAIL DOOR (W8.7) — does a just-stored message fire the reverse door? A message the
 *  user AUTHORED (the authorship law) or one a TEAMMATE sent (the actor ladder, through `mailEventOf`
 *  — the ONE derivation, never re-derived at the call site); RECENT only (a backfill of old mail is
 *  history the budgeted sweep already reads). Pure; the sync's one helper calls it. */
export const MAIL_DOOR_RECENT_MS = 7 * 86_400_000;
export function mailOpensReverseDoor(
  row: Record<string, unknown>, actors: ActorContext | null, nowMs: number = Date.now(),
): 'user' | 'teammate' | null {
  const at = Date.parse(String(row.received_at ?? ''));
  if (!row.id || !Number.isFinite(at) || at <= nowMs - MAIL_DOOR_RECENT_MS) return null;
  const role = mailEventOf(toPoolEmail(row), actors).actor.role;
  return role === 'user' || role === 'teammate' ? role : null;
}

/** A legacy lane row (the mail adapter's intermediate — kept for the merge core and its tests). */
export type PoolEmail = { id: string; at: string; subject: string; from: string | null; to: string[]; threadId: string | null; attachmentCount: number | null; fromUser: boolean; fromName?: string | null };

/** Merge lanes — pure: dedupe by id (first occurrence wins), newest first. */
export function mergePoolEmails<T extends { id: string; at: string }>(...lanes: T[][]): T[] {
  const byId = new Map<string, T>();
  for (const lane of lanes) for (const m of lane) if (!byId.has(m.id)) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

export const EMAIL_COLS = 'id, received_at, subject, from_address, from_name, to_addresses, cc_addresses, thread_id, metadata, is_from_user';
export const toPoolEmail = (r: Record<string, unknown>): PoolEmail => ({
  id: String(r.id), at: String(r.received_at ?? ''), subject: String(r.subject ?? ''),
  from: r.from_address ? normalizeEmail(String(r.from_address)) : null,
  to: [...((r.to_addresses as string[]) ?? []), ...((r.cc_addresses as string[]) ?? [])].map((x) => normalizeEmail(String(x))),
  threadId: (r.thread_id as string) ?? null, attachmentCount: meta(r.metadata), fromUser: !!r.is_from_user,
  fromName: (r.from_name as string | null) ?? null,
});

/** MAIL → the one shape. Authorship is `is_from_user` (the authorship law); a non-authored message is
 *  never the user's, whatever its `from` (a relayed invite keeps its organizer). */
export function mailEventOf(m: PoolEmail, actors: ActorContext | null): EvidenceEvent {
  const ladder = m.fromUser ? 'user' : actorRole({ address: m.from ?? undefined }, actors);
  return {
    source: 'mail', type: 'email', id: m.id, at: m.at, deed: 'message_sent',
    actor: { role: m.fromUser ? 'user' : (ladder === 'user' ? 'unknown' : ladder), ...(m.from ? { address: m.from } : {}), ...(m.fromName ? { name: m.fromName } : {}) },
    participants: m.to.map((a) => ({ address: a })),
    objects: m.threadId ? { threadId: m.threadId } : {},
    title: m.subject, attachmentCount: m.attachmentCount, loadBody: true,
  };
}

const partiesOf = (raw: unknown): EvidenceParty[] => {
  const out: EvidenceParty[] = [];
  for (const a of Array.isArray(raw) ? raw : []) {
    const status = String((a as { status?: unknown; responseStatus?: unknown })?.status ?? (a as { responseStatus?: unknown })?.responseStatus ?? '').toLowerCase();
    if (status === 'declined') continue; // a declined attendee was never in the meeting
    const [address] = addressesOf([a]);
    const name = typeof a === 'string' ? (parseWho(a).name ?? undefined) : ((a as { name?: string; displayName?: string })?.name ?? (a as { displayName?: string })?.displayName ?? undefined);
    if (address || name) out.push({ ...(address ? { address } : {}), ...(name ? { name: String(name) } : {}) });
  }
  return out;
};

/** CALENDAR → the one shape (null for a cancelled event — it never happened). */
export function calendarEventOf(r: Record<string, unknown>, actors: ActorContext | null, nowISO: string): EvidenceEvent | null {
  if (String(r.status ?? '') === 'cancelled') return null;
  const at = String(r.start_time ?? '');
  const end = (r.end_time as string | null) ?? null;
  const orgRaw = r.organizer;
  const [orgAddr] = addressesOf([typeof orgRaw === 'string' ? orgRaw : (orgRaw as { email?: string } | null)?.email ?? '']);
  return {
    source: 'calendar', type: 'calendar', id: String(r.id), at, end,
    deed: (end ?? at) < nowISO ? 'meeting_held' : 'meeting_booked',
    actor: { role: orgAddr ? actorRole({ address: orgAddr }, actors) : 'unknown', ...(orgAddr ? { address: orgAddr } : {}) },
    participants: partiesOf(r.attendees),
    objects: { eventId: String(r.id) },
    title: String(r.title ?? ''),
  };
}

/** TRANSCRIPT → the one shape. `attendees` = the meeting's own list (resolved by the adapter). */
export function transcriptEventOf(r: Record<string, unknown>, attendees: unknown, eventId: string | null): EvidenceEvent {
  return {
    source: 'transcript', type: 'transcript', id: String(r.id), at: String(r.start_time ?? r.created_at ?? ''),
    deed: 'meeting_held', actor: { role: 'user' },
    participants: partiesOf(attendees),
    objects: { ...(eventId ? { eventId } : {}), externalRef: `meeting:${String(r.id)}` },
    title: String(r.title ?? ''),
  };
}

/** THE COMMIT DOOR's verbs → deeds. An action type not listed here is not evidence (internal changes). */
export const DEED_ACTIONS: Record<string, EvidenceEvent['deed']> = {
  send_reply: 'message_sent', send_email: 'message_sent', compose_send: 'message_sent',
  coworker_email: 'message_sent', nudge: 'message_sent', calendar_invite: 'meeting_booked',
};
const FAILED_RESULT = /^(Cannot|Failed)\b/;

/** A deed in words for the views (the judge's LATER EVIDENCE block, the room's evidence lines) — the
 *  deed vocabulary, never a keyword read of the title. ONE copy, pure (W8.7). */
export function deedWords(e: { deed?: string | null; status?: string | null }): string {
  if (e.deed === 'message_sent') return 'sent';
  if (e.deed === 'meeting_booked' || e.deed === 'meeting_held') return `booked a meeting${e.status === 'held' ? ' (held)' : ''}`;
  if (e.deed === 'status_changed') return 'changed the event';
  return String(e.deed ?? 'acted').replace(/_/g, ' ');
}

/** DEEDS (action_commits) → the one shape (null for an unfinished/failed claim or a non-deed verb). */
export function deedEventOf(r: Record<string, unknown>): EvidenceEvent | null {
  const type = String(r.action_type ?? '');
  const result = r.result == null ? null : String(r.result);
  if (!result || FAILED_RESULT.test(result)) return null; // an unrecorded or failed claim is not a deed
  const p = (r.payload ?? {}) as Record<string, unknown>;
  const deed = DEED_ACTIONS[type] ?? (type.startsWith('event_') ? 'status_changed' : null);
  if (!deed) return null;
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v ? [v] : []);
  const participants = partiesOf([...list(p.to), ...list(p.cc), ...list(p.attendees), ...(type === 'nudge' ? list(p.counterparty) : [])]);
  const objects: EvidenceEvent['objects'] = {};
  if (type === 'send_reply' && p.itemId) objects.externalRef = `inbox:${String(p.itemId)}`;
  else if (type === 'nudge' && p.commitmentId) objects.externalRef = `commitment:${String(p.commitmentId)}`;
  else if (type === 'coworker_email' && p.threadId) objects.externalRef = `thread:${String(p.threadId)}`;
  if (type.startsWith('event_') && p.eventId) objects.eventId = String(p.eventId);
  const verb = type.startsWith('event_') ? `${type.slice(6)} the event` : type.replace(/_/g, ' ');
  return {
    source: 'deeds', type: 'deed', id: String(r.id), at: String(r.created_at ?? ''), deed,
    actor: { role: 'user' }, participants, objects,
    title: String(p.subject ?? p.title ?? verb),
  };
}

// ── THE ADAPTERS (bounded SELECTs; explicit columns; errors degrade to an empty lane) ──────────────

/**
 * THE PEOPLE-SCOPED EMAIL LANE (W7.1): every email since `sinceISO` that the scope's people or
 * threads are IN — the user's own mail TO/CC them, their mail FROM them, a TEAMMATE's mail to them
 * (W8.1), anything on the work's own threads — paged (NO SILENT CAPS) under one stated ceiling.
 */
async function loadScopedEmails(client: SupabaseClient, userId: string, scope: EvidenceLoadScope): Promise<{ rows: PoolEmail[]; capped: boolean }> {
  const seen = new Map<string, PoolEmail>();
  let capped = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lane = async (filter: (q: any) => any) => {
    if (seen.size >= POOL_SCOPED_MAX) { capped = true; return; }
    const room = POOL_SCOPED_MAX - seen.size;
    const rows = await fetchAllRows<Record<string, unknown>>((from, to) =>
      filter(client.from('emails').select(EMAIL_COLS).eq('user_id', userId).gt('received_at', scope.sinceISO))
        .order('received_at', { ascending: false }).order('id', { ascending: true }).range(from, to), { maxRows: room });
    if (rows.length >= room) capped = true;
    for (const r of rows) { const m = toPoolEmail(r); if (!seen.has(m.id)) seen.set(m.id, m); }
  };
  const mates = scope.actors.teammates;
  for (const addrs of chunked(scope.addresses, SCOPE_CHUNK)) {
    await lane((q) => q.eq('is_from_user', true).overlaps('to_addresses', addrs));
    await lane((q) => q.eq('is_from_user', true).overlaps('cc_addresses', addrs));
    await lane((q) => q.eq('is_from_user', false).in('from_address', addrs));
    // a TEAMMATE writing to the counterparty on a thread the user is copied on
    for (const team of chunked(mates, SCOPE_CHUNK)) {
      await lane((q) => q.eq('is_from_user', false).in('from_address', team).overlaps('to_addresses', addrs));
    }
  }
  for (const threads of chunked(scope.threadIds, SCOPE_CHUNK * 2)) {
    await lane((q) => q.in('thread_id', threads));
  }
  return { rows: [...seen.values()], capped };
}

const mailRow: EvidenceSourceDef = {
  source: 'mail', type: 'email', label: 'Mail', feature: 'get_emails', deeds: ['message_sent'],
  async loadPool(client, userId, scope) {
    const scoped = scope.addresses.length || scope.threadIds.length
      ? loadScopedEmails(client, userId, scope).catch(() => ({ rows: [] as PoolEmail[], capped: false }))
      : Promise.resolve({ rows: [] as PoolEmail[], capped: false });
    const [em, sc] = await Promise.all([
      client.from('emails').select(EMAIL_COLS)
        .eq('user_id', userId).gt('received_at', scope.sinceISO)
        .order('received_at', { ascending: false }).limit(POOL_MAX_PER_SOURCE),
      scoped,
    ]);
    const newest: PoolEmail[] = em.error ? [] : ((em.data ?? []) as Array<Record<string, unknown>>).map(toPoolEmail);
    const merged = mergePoolEmails(sc.rows, newest);
    const unscoped = !scope.addresses.length && !scope.threadIds.length;
    return {
      events: merged.map((m) => mailEventOf(m, scope.actors)),
      capped: sc.capped || (unscoped && newest.length >= POOL_MAX_PER_SOURCE),
      stats: { scopedEmails: sc.rows.length, newestEmails: newest.length },
    };
  },
  async loadByIds(client, userId, ids, scope) {
    const out: EvidenceEvent[] = [];
    for (const chunk of chunked([...new Set(ids)], 100)) {
      const { data, error } = await client.from('emails').select(EMAIL_COLS).eq('user_id', userId).in('id', chunk);
      if (error) continue;
      for (const r of (data ?? []) as Array<Record<string, unknown>>) out.push(mailEventOf(toPoolEmail(r), scope.actors));
    }
    return out;
  },
  async hydrateBody(client, userId, ids) {
    const bodies = new Map<string, string>();
    for (const chunk of chunked([...new Set(ids)], 50)) {
      const { data, error } = await client.from('emails').select('id, body').eq('user_id', userId).in('id', chunk);
      if (error) continue;
      for (const r of (data ?? []) as Array<{ id: string; body: string | null }>) bodies.set(r.id, String(r.body ?? ''));
    }
    return bodies;
  },
  entityLink: { itemKind: 'email_thread', itemIdOf: (e) => e.objects.threadId },
};

const CAL_COLS = 'id, start_time, end_time, title, attendees, organizer, status';
const calendarRow: EvidenceSourceDef = {
  // DATA-GATED (W8.7): the user's synced calendar is evidence whatever modules the workspace shows —
  // no connected calendar means no rows, which IS the gate. Never the `meetings` surface flag.
  source: 'calendar', type: 'calendar', label: 'Calendar', feature: null, deeds: ['meeting_held', 'meeting_booked'],
  async loadPool(client, userId, scope) {
    // Bounded ABOVE too (Sep 22 review): newest-first with no ceiling let far-future recurring
    // instances crowd the near meetings — the ones that actually settle work — out of the cap.
    const { data, error } = await client.from('calendar_events').select(CAL_COLS)
      .eq('user_id', userId).gt('start_time', scope.sinceISO)
      .lte('start_time', new Date(Date.parse(scope.nowISO) + CALENDAR_HORIZON_DAYS * 86_400_000).toISOString())
      .order('start_time', { ascending: false }).limit(POOL_MAX_PER_SOURCE);
    if (error) return { events: [] };
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    return {
      events: rows.map((r) => calendarEventOf(r, scope.actors, scope.nowISO)).filter((e): e is EvidenceEvent => !!e),
      capped: rows.length >= POOL_MAX_PER_SOURCE,
    };
  },
  async loadByIds(client, userId, ids, scope, opts) {
    // the sync hands over PROVIDER event ids (calendar_events.event_id)
    const out: EvidenceEvent[] = [];
    for (const chunk of chunked([...new Set(ids)], 50)) {
      let q = client.from('calendar_events').select(CAL_COLS).eq('user_id', userId).in('event_id', chunk);
      if (opts?.provider) q = q.eq('provider', opts.provider);
      const { data, error } = await q;
      if (error) continue;
      for (const r of (data ?? []) as Array<Record<string, unknown>>) { const e = calendarEventOf(r, scope.actors, scope.nowISO); if (e) out.push(e); }
    }
    return out;
  },
  entityLink: { itemKind: 'calendar_event', itemIdOf: (e) => e.objects.eventId },
};

/** Resolve each transcript's own attendee list — own → linked event → the ONE containing event. */
async function transcriptEvents(client: SupabaseClient, userId: string, trRows: Array<Record<string, unknown>>): Promise<EvidenceEvent[]> {
  const needLinked = [...new Set(trRows.filter((r) => !addressesOf(r.attendees).length && r.calendar_event_id).map((r) => String(r.calendar_event_id)))];
  const byEventId = new Map<string, unknown>();
  for (const chunk of chunked(needLinked, 150)) {
    const { data, error } = await client.from('calendar_events').select('id, attendees').eq('user_id', userId).in('id', chunk);
    if (error) continue;
    for (const r of (data ?? []) as Array<Record<string, unknown>>) byEventId.set(String(r.id), r.attendees);
  }
  // THE CONTAINING EVENT: recordings with no attendee facts borrow from the ONE calendar event whose
  // window holds their start — one bounded read over the recordings' span.
  const orphans = trRows.filter((r) => !addressesOf(r.attendees).length && !addressesOf(r.calendar_event_id ? byEventId.get(String(r.calendar_event_id)) : null).length && r.start_time);
  const containing = new Map<string, { id: string; attendees: unknown }>();
  if (orphans.length) {
    const starts = orphans.map((r) => String(r.start_time)).sort();
    const lo = new Date(Date.parse(starts[0]) - 86_400_000).toISOString();
    const hi = starts[starts.length - 1];
    const cal = await fetchAllRows<Record<string, unknown>>((from, to) =>
      client.from('calendar_events').select('id, start_time, end_time, attendees, status')
        .eq('user_id', userId).gte('start_time', lo).lte('start_time', hi)
        .order('start_time', { ascending: true }).order('id', { ascending: true }).range(from, to), { maxRows: 5000 }).catch(() => []);
    for (const r of orphans) {
      const t = String(r.start_time);
      const hits = cal.filter((e) => String(e.status ?? '') !== 'cancelled' && String(e.start_time ?? '') <= t && String(e.end_time ?? '') >= t);
      if (hits.length === 1) containing.set(String(r.id), { id: String(hits[0].id), attendees: hits[0].attendees });
    }
  }
  return trRows.map((r) => {
    const own = Array.isArray(r.attendees) ? (r.attendees as unknown[]) : [];
    const linked = r.calendar_event_id ? byEventId.get(String(r.calendar_event_id)) : undefined;
    const box = containing.get(String(r.id));
    const attendees = own.length ? [...own, ...(Array.isArray(linked) ? linked : [])] : (Array.isArray(linked) && linked.length ? linked : (box?.attendees ?? []));
    return transcriptEventOf(r, attendees, (r.calendar_event_id as string | null) ?? box?.id ?? null);
  });
}

const TR_COLS = 'id, start_time, created_at, title, attendees, calendar_event_id';
const transcriptRow: EvidenceSourceDef = {
  // DATA-GATED (W8.7): stored recordings are evidence whether or not the meetings surface is shown.
  source: 'transcript', type: 'transcript', label: 'Recorded meetings', feature: null, deeds: ['meeting_held'],
  async loadPool(client, userId, scope) {
    const { data, error } = await client.from('meeting_transcripts').select(TR_COLS)
      .eq('user_id', userId).gt('start_time', scope.sinceISO)
      .order('start_time', { ascending: false }).limit(POOL_MAX_PER_SOURCE);
    if (error) return { events: [] };
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    return { events: await transcriptEvents(client, userId, rows), capped: rows.length >= POOL_MAX_PER_SOURCE };
  },
  async loadByIds(client, userId, ids) {
    const rows: Array<Record<string, unknown>> = [];
    for (const chunk of chunked([...new Set(ids)], 50)) {
      const { data, error } = await client.from('meeting_transcripts').select(TR_COLS).eq('user_id', userId).in('id', chunk);
      if (!error) rows.push(...((data ?? []) as Array<Record<string, unknown>>));
    }
    return transcriptEvents(client, userId, rows);
  },
  entityLink: { itemKind: 'meeting', itemIdOf: (e) => e.id },
};

const deedsRow: EvidenceSourceDef = {
  source: 'deeds', type: 'deed', label: 'Done through AUGMTD', feature: null,
  deeds: ['message_sent', 'meeting_booked', 'status_changed'],
  async loadPool(client, userId, scope) {
    const { data, error } = await client.from('action_commits').select('id, action_type, payload, result, created_at')
      .eq('user_id', userId).gt('created_at', scope.sinceISO).not('result', 'is', null)
      .order('created_at', { ascending: false }).limit(POOL_MAX_PER_SOURCE);
    if (error) return { events: [] }; // pre-migration: the ledger may not exist
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    return { events: rows.map(deedEventOf).filter((e): e is EvidenceEvent => !!e), capped: rows.length >= POOL_MAX_PER_SOURCE };
  },
  async loadByIds(client, userId, ids) {
    const out: EvidenceEvent[] = [];
    for (const chunk of chunked([...new Set(ids)], 50)) {
      const { data, error } = await client.from('action_commits').select('id, action_type, payload, result, created_at').eq('user_id', userId).in('id', chunk);
      if (!error) out.push(...((data ?? []) as Array<Record<string, unknown>>).map(deedEventOf).filter((e): e is EvidenceEvent => !!e));
    }
    return out;
  },
};

/** THE REGISTRY. Order = the order evidence types are presented to the judge. */
export const EVIDENCE_SOURCES: EvidenceSourceDef[] = [mailRow, calendarRow, transcriptRow, deedsRow];

export function evidenceSource(key: string | null | undefined): EvidenceSourceDef | null {
  return EVIDENCE_SOURCES.find((s) => s.source === key || s.type === key) ?? null;
}

/** Is a row on for this workspace? (null feature = data-gated, always read; unknown features map =
 *  everything on.) See THE GATING RULE in the header: a feature gates only a source it stops collecting. */
export function sourceEnabled(row: Pick<EvidenceSourceDef, 'feature'>, features: WorkspaceFeatures | null | undefined): boolean {
  if (!row.feature || !features) return true;
  return isToolAllowed(row.feature, features);
}

// ── THE ONE LOADER ──────────────────────────────────────────────────────────────────────────────

export type EvidenceLoadStats = {
  scopedEmails: number; newestEmails: number; capped: boolean;
  bySource: Record<string, number>;
  /** rows switched off by the workspace feature map */
  gated: string[];
  /** rows whose stated bound was reached */
  cappedSources: string[];
};

/** address → person id, over every address alias of the registry (built once per pool). Pure. */
export function personIndex(registry: PersonEntity[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of registry) for (const a of p.aliases) if (a.includes('@') && !m.has(a)) m.set(normalizeEmail(a), p.id);
  return m;
}

/** Stamp person ids onto every party with an address the registry knows. Pure (returns new events). */
export function attachPersons(events: EvidenceEvent[], index: Map<string, string>): EvidenceEvent[] {
  if (!index.size) return events;
  const tag = <T extends EvidenceParty>(p: T): T => (p.address && !p.personId && index.has(normalizeEmail(p.address)) ? { ...p, personId: index.get(normalizeEmail(p.address)) } : p);
  return events.map((e) => ({ ...e, actor: tag(e.actor), participants: e.participants.map(tag) }));
}

/**
 * Load every enabled row's events for one user — the pool every door reads. Rows load in parallel;
 * each degrades to an empty lane on error; the stats say what was gated and what hit a bound.
 * `entityIds` (optional) = the entities of the work in play: their entity_links are read ONCE
 * (chunked, paged, bounded) and stamped as `objects.entityId` on matching events.
 */
export async function loadEvidenceEvents(
  client: SupabaseClient, userId: string, scope: EvidenceLoadScope,
  opts: { features?: WorkspaceFeatures | null; registry?: PersonEntity[]; entityIds?: string[]; sources?: EvidenceSourceDef[] } = {},
): Promise<{ events: EvidenceEvent[]; stats: EvidenceLoadStats }> {
  const rows = opts.sources ?? EVIDENCE_SOURCES;
  const on = rows.filter((r) => sourceEnabled(r, opts.features));
  const gated = rows.filter((r) => !on.includes(r)).map((r) => r.source);
  const results = await Promise.all(on.map((r) => r.loadPool(client, userId, scope).catch(() => ({ events: [] as EvidenceEvent[] }) as { events: EvidenceEvent[]; capped?: boolean; stats?: Record<string, number> })));
  let events: EvidenceEvent[] = [];
  const stats: EvidenceLoadStats = { scopedEmails: 0, newestEmails: 0, capped: false, bySource: {}, gated, cappedSources: [] };
  on.forEach((r, i) => {
    const res = results[i];
    events.push(...res.events);
    stats.bySource[r.source] = res.events.length;
    if (res.capped) { stats.capped = true; stats.cappedSources.push(r.source); }
    stats.scopedEmails += Number(res.stats?.scopedEmails ?? 0);
    stats.newestEmails += Number(res.stats?.newestEmails ?? 0);
  });
  if (opts.registry?.length) events = attachPersons(events, personIndex(opts.registry));
  const ents = [...new Set(opts.entityIds ?? [])];
  if (ents.length) {
    const kinds = on.filter((r) => r.entityLink).map((r) => r.entityLink!.itemKind);
    const linkOf = new Map<string, string>(); // `${kind}:${item}` → entity
    for (const chunk of chunked(ents, 100)) {
      const links = await fetchAllRows<{ item_kind: string; item_id: string; entity_id: string }>((from, to) =>
        client.from('entity_links').select('item_kind, item_id, entity_id')
          .eq('user_id', userId).in('entity_id', chunk).in('item_kind', kinds)
          .order('item_id', { ascending: true }).order('item_kind', { ascending: true }).range(from, to), { maxRows: 20000 }).catch(() => []);
      if (links.length >= 20000) { stats.capped = true; stats.cappedSources.push('entity_links'); }
      for (const l of links) if (!linkOf.has(`${l.item_kind}:${l.item_id}`)) linkOf.set(`${l.item_kind}:${l.item_id}`, String(l.entity_id));
    }
    if (linkOf.size) {
      const kindOf = new Map(on.filter((r) => r.entityLink).map((r) => [r.source, r.entityLink!]));
      events = events.map((e) => {
        const el = kindOf.get(e.source);
        const item = el?.itemIdOf(e);
        const ent = item ? linkOf.get(`${el!.itemKind}:${item}`) : undefined;
        return ent && !e.objects.entityId ? { ...e, objects: { ...e.objects, entityId: ent } } : e;
      });
    }
  }
  return { events, stats };
}
