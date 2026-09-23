// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE INVITE → EVENT LINK, BY IDENTITY (W7.4 — INVITES ARE EVENTS).
//
// An invitation email and the calendar row it created are the same meeting because they carry the
// same UID — not because the sender organises the next thing on the calendar. The heuristic that
// used to live in lib/email-sync/sync-emails.ts ("same organizer + next confirmed future start") is
// DEAD; this is its only replacement, and it has exactly three rungs, each an identity:
//
//   1. Graph's own pointer — an Outlook eventMessage names the user's calendar event id
//      (`calendar_events.event_id`, provider outlook). Nothing is matched; it is read.
//   2. THE UID — Google rows keep the provider's full event as `metadata` (`iCalUID`); Outlook rows
//      keep `metadata.iCalUId` (the calendar sync selects it). An Exchange id that EMBEDS an external
//      UID matches that UID (`uidKeys`, lib/calendar/ics.ts). Candidates are CONFIRMED in code with
//      `sameMeetingUid` — a containment query only nominates.
//   3. Nothing → null. An event beyond the calendar sync horizon has no row; the invite's OWN facts
//      ride on the inbox item (`source_data.invite`) and the card renders from them, read-only.
//
// Within ONE identity a recurring series can have several rows (Google expands instances). The
// occurrence is picked by the message's RECURRENCE-ID when it names one, else the instance at the
// invite's own start, else the next one still ahead — never a different meeting.
//
// READ-ONLY. Zero AI. Never throws: a failed read is "no link", which is honest.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { hexOf, sameMeetingUid, type InviteFacts } from '@/lib/calendar/ics';

const SELECT = 'id, event_id, connection_id, provider, start_time, end_time, status, gcal_uid:metadata->>iCalUID, ocal_uid:metadata->>iCalUId, orig_start:metadata->originalStartTime';

type Row = {
  id: string; event_id: string | null; connection_id: string | null; provider: string | null;
  start_time: string | null; end_time: string | null; status: string | null;
  gcal_uid: string | null; ocal_uid: string | null; orig_start: { dateTime?: string; date?: string } | null;
};

/** LIKE-escape a literal (a UID may carry `_` or `%`). */
const likeLiteral = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const ms = (v: string | null | undefined): number => {
  const s = String(v ?? '');
  if (!s) return NaN;
  // Outlook rows store Graph's zone-less UTC wall time; read it as UTC.
  return Date.parse(/[zZ]$|[+-]\d{2}:\d{2}$/.test(s) || /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : `${s}Z`);
};

/** PURE: among rows that share the invite's identity, the ONE this message speaks for. */
export function pickOccurrence(rows: Row[], invite: Pick<InviteFacts, 'recurrenceId' | 'startISO' | 'startDate'>, opts: { now: Date; connectionId?: string | null }): Row | null {
  if (!rows.length) return null;
  // The same mailbox's own calendar first — a meeting on two connected calendars is two rows.
  const own = opts.connectionId ? rows.filter((r) => r.connection_id === opts.connectionId) : [];
  const pool = own.length ? own : rows;
  if (pool.length === 1) return pool[0];
  const target = invite.recurrenceId ?? invite.startISO ?? invite.startDate;
  if (target) {
    const t = ms(target);
    const hit = pool.find((r) => {
      const orig = r.orig_start?.dateTime ?? r.orig_start?.date ?? null;
      return (orig && ms(orig) === t) || ms(r.start_time) === t;
    });
    if (hit) return hit;
  }
  const now = opts.now.getTime();
  const ahead = pool
    .filter((r) => (Number.isFinite(ms(r.end_time)) ? ms(r.end_time) : ms(r.start_time)) >= now)
    .sort((a, b) => ms(a.start_time) - ms(b.start_time));
  if (ahead.length) return ahead[0];
  return [...pool].sort((a, b) => ms(b.start_time) - ms(a.start_time))[0] ?? null;
}

/** The candidate rows for ONE identity. Three narrow reads, all user-scoped, confirmed in code. */
export async function eventRowsForUid(client: SupabaseClient, userId: string, uid: string): Promise<Row[]> {
  const u = String(uid ?? '').trim();
  if (!u) return [];
  const reads = [
    client.from('calendar_events').select(SELECT).eq('user_id', userId).eq('metadata->>iCalUID', u).limit(50),
    client.from('calendar_events').select(SELECT).eq('user_id', userId).ilike('metadata->>iCalUId', likeLiteral(u)).limit(50),
    // An Outlook row for a meeting born OUTSIDE Exchange embeds the external UID's bytes.
    client.from('calendar_events').select(SELECT).eq('user_id', userId).ilike('metadata->>iCalUId', `%${hexOf(u)}%`).limit(50),
  ];
  const out = new Map<string, Row>();
  const settled = await Promise.allSettled(reads);
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    for (const r of ((s.value as { data: unknown }).data ?? []) as Row[]) {
      if (sameMeetingUid(r.gcal_uid, u) || sameMeetingUid(r.ocal_uid, u)) out.set(r.id, r);
    }
  }
  return [...out.values()];
}

/**
 * THE LINK. Returns the user's `calendar_events.id` this invite IS, or null. Never a heuristic.
 */
export async function linkInviteToEvent(
  client: SupabaseClient, userId: string, invite: InviteFacts | null | undefined,
  opts: { connectionId?: string | null; now?: Date } = {},
): Promise<string | null> {
  if (!invite?.uid) return null;
  try {
    // Rung 1 — Graph named the event itself.
    if (invite.providerEventId) {
      const { data } = await client.from('calendar_events').select('id')
        .eq('user_id', userId).eq('provider', 'outlook').eq('event_id', invite.providerEventId).limit(1).maybeSingle();
      if ((data as { id?: string } | null)?.id) return String((data as { id: string }).id);
    }
    // Rung 2 — the UID.
    const rows = await eventRowsForUid(client, userId, invite.uid);
    const hit = pickOccurrence(rows, invite, { now: opts.now ?? new Date(), connectionId: opts.connectionId ?? null });
    return hit ? String(hit.id) : null;
  } catch {
    return null;
  }
}

/** What an inbox item keeps of an invite — the facts a card renders, capped, nothing else. */
export function compactInvite(i: InviteFacts | null | undefined): InviteFacts | null {
  if (!i?.uid) return null;
  return {
    ...i,
    summary: i.summary ? i.summary.slice(0, 300) : null,
    location: i.location ? i.location.slice(0, 300) : null,
    rrule: i.rrule ? i.rrule.slice(0, 200) : null,
    attendees: (i.attendees ?? []).slice(0, 40),
  };
}
