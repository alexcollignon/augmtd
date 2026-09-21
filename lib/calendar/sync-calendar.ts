/**
 * Calendar Sync
 *
 * Syncs calendar events from Gmail and Outlook using the same OAuth connections as email.
 * Events are stored in the calendar_events table.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { getOAuth2Client } from '@/lib/google/oauth';
import { getGraphClient } from '@/lib/microsoft/outlook';
import { logActivity } from '@/lib/activity/log';

interface Connection {
  id: string;
  user_id: string;
  provider: 'gmail' | 'outlook';
  provider_account_id: string;
  metadata: {
    tokens: string; // Encrypted base64 tokens
    max_emails_per_sync?: number;
    sync_window_days?: number;
  };
}

interface CalendarEvent {
  user_id: string;
  connection_id: string;
  event_id: string;
  calendar_id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  meeting_link?: string | null;
  start_time: string;
  end_time: string;
  timezone?: string | null;
  is_all_day: boolean;
  organizer?: string | null;
  attendees: Array<{
    email: string;
    name?: string | null;
    status?: 'accepted' | 'declined' | 'tentative' | 'needsAction';
  }>;
  status: 'confirmed' | 'cancelled' | 'tentative';
  provider: 'gmail' | 'outlook';
  metadata: any;
}

/** How many provider pages one sync will walk before calling the fetch INCOMPLETE. */
const MAX_PAGES = 5;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DEPARTURE LAW (Sep 21 — "I deleted it and it's still blocking my afternoon").
//
// THE INCIDENT: a pilot deleted an all-day block in their calendar app. Ten minutes and at least
// one sync later the row was still in `calendar_events`, still marked confirmed, still blocking
// every free slot the chat could propose — and the assistant, having no fact to offer, could only
// say its view "may need a moment to refresh". The sync was UPSERT-ONLY: neither provider reports
// a deleted event in a windowed list (Google omits it entirely without showDeleted; Graph likewise),
// so a row written once was written forever. Absence WAS the news, and nobody read it.
//
// THE LAW, borrowed whole from the member-spine arc: PRUNING ONLY AFTER A FULL FETCH. A partial
// pull must never mass-delete, so the decision is a pure function of whether the fetch actually
// covered its window — testable on its own, and refusing by default.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type CalendarPrunePlan =
  | { prune: false; reason: string }
  | { prune: true; keep: Set<string>; windowStartISO: string; windowEndISO: string; floorFromISO: string };

/** Above this share of the window's stored rows, a "departure" reads as a bad read, not a diary.
 *  BEING SLOW TO PRUNE IS SAFE; BEING FAST IS NOT — a genuine mass-cancellation drains over the
 *  next syncs (each batch under the floor), while one degraded read can never take the calendar. */
const PRUNE_MAX_SHARE = 0.5;
/** …but a share is meaningless on a handful of rows: below this batch size the share floor sleeps
 *  (deleting 2 of 3 genuinely-departed events must still work). */
const PRUNE_SHARE_FLOOR_MIN_BATCH = 5;

/**
 * May this fetch license the removal of the rows it did not return? PURE — no IO; the clock is an
 * argument. `complete` is true only when the provider's pagination actually ran out inside our page
 * budget.
 *
 * ⚠️ TWO REFUSALS THE FIRST CUT DID NOT HAVE (Sep 21, review):
 *  • A COMPLETE FETCH OF ZERO EVENTS IS NOT AN EMPTY DIARY. A 200-with-no-items is exactly what an
 *    auth-degraded read, a mis-resolved calendar id or a provider hiccup returns — indistinguishable
 *    from a genuinely empty fortnight, and the wrong reading deletes the whole window. The empty
 *    diary costs us one stale row until the next sync; the wrong reading costs the calendar.
 *  • ONLY THE FUTURE DEPARTS. A past event missing from a forward-looking listing is normal (the
 *    push webhooks fetch daysBehind:0), and a past event may already have been met and transcribed.
 *    The prune floor is therefore max(window start, now) — `floorFromISO`.
 */
export function planCalendarPrune(args: {
  complete: boolean;
  fetchedEventIds: string[];
  windowStartISO: string;
  windowEndISO: string;
  /** The clock, passed in so the decision stays pure and gateable. */
  nowISO: string;
}): CalendarPrunePlan {
  if (!args.complete) return { prune: false, reason: 'incomplete fetch — a truncated page never licenses a delete' };
  if (!args.windowStartISO || !args.windowEndISO || args.windowEndISO <= args.windowStartISO) {
    return { prune: false, reason: 'no well-formed window to scope the delete to' };
  }
  const keep = new Set(args.fetchedEventIds.filter(Boolean));
  if (!keep.size) {
    return { prune: false, reason: 'complete fetch returned ZERO events — indistinguishable from a degraded read' };
  }
  const floorFromISO = args.nowISO > args.windowStartISO ? args.nowISO : args.windowStartISO;
  if (floorFromISO >= args.windowEndISO) {
    return { prune: false, reason: 'the window holds no future — nothing here can be read as a departure' };
  }
  return { prune: true, keep, windowStartISO: args.windowStartISO, windowEndISO: args.windowEndISO, floorFromISO };
}

/**
 * THE PROPORTIONAL FLOOR — pure. A departure batch that would take most of the window is refused:
 * at that size the likelier story is a bad read, and the honest calendar is the one that is slow to
 * forget. Stated in constants above, not in a magic number here.
 */
export function decidePruneBatch(args: { goneCount: number; storedInWindow: number }): { prune: boolean; reason: string } {
  if (args.goneCount <= 0) return { prune: false, reason: 'nothing absent' };
  if (args.goneCount > PRUNE_SHARE_FLOOR_MIN_BATCH && args.goneCount > args.storedInWindow * PRUNE_MAX_SHARE) {
    return {
      prune: false,
      reason: `would remove ${args.goneCount} of ${args.storedInWindow} stored events (> ${Math.round(PRUNE_MAX_SHARE * 100)}%) — refused as a likely degraded read`,
    };
  }
  return { prune: true, reason: `${args.goneCount} of ${args.storedInWindow} stored events departed` };
}

/**
 * Remove the rows the provider no longer knows about — strictly FUTURE rows, strictly inside the
 * window this connection just fetched in full, strictly for this user + connection + provider.
 * Non-fatal by design: a failed prune leaves stale rows (the old behaviour), never a half-deleted
 * calendar.
 *
 * ⚠️ A DEPARTURE TAKES THE EVENT, NEVER THE WORK DERIVED FROM IT (Sep 21, review). This path used
 * to call `cleanupEventLinks`, which HARD-DELETES inbox_items — meeting action items and email-prep
 * rows that no later sync recreates, with no soft-delete and no undo. Absence from a windowed
 * listing is weak evidence (the very reason for the floors above); it may license correcting the
 * free-slot math, and nothing more. Explicit provider cancellations keep their own cleanup path.
 */
async function applyCalendarPrune(
  supabase: SupabaseClient,
  connection: Connection,
  provider: 'gmail' | 'outlook',
  plan: CalendarPrunePlan,
): Promise<number> {
  if (!plan.prune) {
    console.log(`[CalendarSync] No prune for ${provider}: ${plan.reason}`);
    return 0;
  }
  try {
    const { data, error } = await supabase
      .from('calendar_events')
      .select('id, event_id, title, start_time')
      .eq('user_id', connection.user_id)
      .eq('connection_id', connection.id)
      .eq('provider', provider)
      .gte('start_time', plan.floorFromISO)
      .lte('start_time', plan.windowEndISO);
    if (error) { console.error('[CalendarSync] prune read failed:', error.message); return 0; }
    const stored = (data ?? []) as Array<{ id: string; event_id: string; title: string | null }>;
    const gone = stored.filter((r) => !plan.keep.has(r.event_id));
    const call = decidePruneBatch({ goneCount: gone.length, storedInWindow: stored.length });
    if (!call.prune) {
      if (gone.length) console.warn(`[CalendarSync] prune REFUSED for ${provider}: ${call.reason}`);
      return 0;
    }
    const uuids = gone.map((r) => r.id);
    const { error: delErr } = await supabase.from('calendar_events').delete().in('id', uuids);
    if (delErr) { console.error('[CalendarSync] prune delete failed:', delErr.message); return 0; }
    // A DELETE THIS QUIET NEEDS A RECEIPT — the user's own timeline records what left and why.
    await logActivity(supabase, connection.user_id, {
      type: 'calendar_pruned',
      title: `Removed ${uuids.length} calendar event${uuids.length > 1 ? 's' : ''} no longer in ${provider}`,
      entityType: 'calendar',
      entityId: null,
      metadata: {
        provider, count: uuids.length, storedInWindow: stored.length,
        titles: gone.slice(0, 10).map((r) => (r.title ?? '(no title)').slice(0, 80)),
        from: plan.floorFromISO, to: plan.windowEndISO,
      },
    });
    console.log(`[CalendarSync] Pruned ${uuids.length} ${provider} event(s) the provider no longer returns`);
    return uuids.length;
  } catch (err: any) {
    console.error('[CalendarSync] prune error:', err?.message ?? err);
    return 0;
  }
}

/** Where the last SUCCESSFUL calendar read for a connection is recorded. Merge-written on the
 *  connection's own metadata (the branding-clobber lesson: re-read, merge, never replace). */
const SYNCED_AT_KEY = 'calendar_synced_at';

async function stampCalendarSync(supabase: SupabaseClient, connectionId: string): Promise<void> {
  try {
    const { data } = await supabase.from('connections').select('metadata').eq('id', connectionId).maybeSingle();
    const meta = (data?.metadata ?? {}) as Record<string, unknown>;
    await supabase.from('connections')
      .update({ metadata: { ...meta, [SYNCED_AT_KEY]: new Date().toISOString() } })
      .eq('id', connectionId);
  } catch { /* freshness is a fact we'd LIKE to have; failing to record it never fails the sync */ }
}

/**
 * Sync calendar events for a connection
 */
export async function syncCalendarForConnection(
  connection: Connection,
  supabase: SupabaseClient,
  options: {
    daysAhead?: number;
    daysBehind?: number;
  } = {}
): Promise<{ synced: number; pruned?: number; errors: string[] }> {
  const daysAhead = options.daysAhead || 14; // Next 2 weeks
  const daysBehind = options.daysBehind || 7; // Past week (for updates)

  console.log(`[CalendarSync] Starting sync for ${connection.provider} (${connection.provider_account_id})`);

  try {
    if (connection.provider === 'gmail' || connection.provider === 'outlook') {
      const res = connection.provider === 'gmail'
        ? await syncGmailCalendar(connection, supabase, daysAhead, daysBehind)
        : await syncOutlookCalendar(connection, supabase, daysAhead, daysBehind);
      // FRESHNESS IS A FACT: only a read that actually reached the provider stamps the clock, so
      // "last synced" can never be a timestamp for a sync that failed.
      if (res.pruned !== undefined) await stampCalendarSync(supabase, connection.id);
      return res;
    } else {
      return { synced: 0, errors: [`Unsupported provider: ${connection.provider}`] };
    }
  } catch (error: any) {
    console.error(`[CalendarSync] Error syncing ${connection.provider}:`, error);
    return { synced: 0, errors: [error.message] };
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// FRESHNESS IS A FACT, NOT A GUESS (Sep 21). The calendar cron runs ONCE A DAY, so "my calendar
// says you're busy" could be describing yesterday — and the only thing the chat could offer when
// challenged was "my view may need a moment to refresh", which is a shrug wearing a fact's clothes.
// Every calendar answer now STATES when each connection was last read, and a stale read is
// RE-READ before the answer is composed rather than apologised for afterwards.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type CalendarFreshness = { connectionId: string; provider: 'gmail' | 'outlook'; syncedAt: string | null };

/** When each of the user's calendar connections was last successfully read. */
export async function getCalendarFreshness(supabase: SupabaseClient, userId: string): Promise<CalendarFreshness[]> {
  try {
    const { data } = await supabase.from('connections')
      .select('id, provider, metadata')
      .eq('user_id', userId).in('provider', ['gmail', 'outlook']).eq('status', 'active');
    return ((data ?? []) as Array<{ id: string; provider: 'gmail' | 'outlook'; metadata: Record<string, unknown> | null }>)
      .map((c) => ({
        connectionId: c.id,
        provider: c.provider,
        syncedAt: typeof c.metadata?.[SYNCED_AT_KEY] === 'string' ? (c.metadata[SYNCED_AT_KEY] as string) : null,
      }));
  } catch { return []; }
}

/** The floor between two provider round-trips for the same connection — a chat that asks about the
 *  calendar three times in a minute reads it once. */
const MIN_REFRESH_INTERVAL_MS = 60_000;
/** In-process single-flight (the claimSync idiom, at the scale this lane needs): two concurrent
 *  calls on one instance share one round-trip. Across instances the work is idempotent anyway —
 *  the same upsert of the same window, and a prune of the same absences. */
const inFlight = new Map<string, Promise<number>>();

/**
 * Re-read the near calendar window for every connection whose last read is older than `maxAgeMs`.
 * Best-effort: a provider failure returns the stale view rather than an error, and the caller's
 * freshness line then tells the truth about what it is looking at.
 */
export async function refreshCalendarIfStale(
  supabase: SupabaseClient,
  userId: string,
  opts: { maxAgeMs: number; daysAhead?: number; daysBehind?: number } = { maxAgeMs: 15 * 60_000 },
): Promise<{ refreshed: number }> {
  let refreshed = 0;
  try {
    const { data } = await supabase.from('connections')
      .select('*').eq('user_id', userId).in('provider', ['gmail', 'outlook']).eq('status', 'active');
    for (const c of (data ?? []) as Connection[]) {
      const syncedAt = (c.metadata as unknown as Record<string, unknown>)?.[SYNCED_AT_KEY];
      const age = typeof syncedAt === 'string' ? Date.now() - Date.parse(syncedAt) : Number.POSITIVE_INFINITY;
      if (!(age > Math.max(opts.maxAgeMs, MIN_REFRESH_INTERVAL_MS))) continue;
      const running = inFlight.get(c.id);
      if (running) { await running.catch(() => 0); continue; }
      const p = syncCalendarForConnection(c, supabase, { daysAhead: opts.daysAhead ?? 21, daysBehind: opts.daysBehind ?? 1 })
        .then((r) => (r.pruned === undefined ? 0 : 1))
        .finally(() => { inFlight.delete(c.id); });
      inFlight.set(c.id, p);
      refreshed += await p.catch(() => 0);
    }
  } catch { /* a refresh we could not run is a staleness we STATE, never an answer we fail */ }
  return { refreshed };
}

/**
 * Sync Gmail calendar events
 */
async function syncGmailCalendar(
  connection: Connection,
  supabase: SupabaseClient,
  daysAhead: number,
  daysBehind: number
): Promise<{ synced: number; pruned?: number; errors: string[] }> {
  // Decrypt tokens (same as email sync)
  const tokens = JSON.parse(Buffer.from(connection.metadata.tokens, 'base64').toString());

  // Create and configure OAuth2 client
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(tokens);

  // Refresh proactively within 5 minutes of expiry and persist to DB
  if (tokens.expiry_date && tokens.expiry_date < Date.now() + 5 * 60 * 1000) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);
      const newEncryptedTokens = Buffer.from(JSON.stringify(credentials)).toString('base64');
      await supabase
        .from('connections')
        .update({ metadata: { ...connection.metadata, tokens: newEncryptedTokens } })
        .eq('id', connection.id);
      console.log(`✓ Updated refreshed Gmail tokens for connection ${connection.id}`);
    } catch (error) {
      console.error('[CalendarSync] Failed to refresh Gmail token:', error);
    }
  }

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const timeMin = new Date(Date.now() - daysBehind * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

  try {
    // PAGINATED — a single 100-row page silently truncates a busy fortnight, and a truncated fetch
    // can never license a prune (see planCalendarPrune). `complete` is the whole point of the loop.
    const events: any[] = [];
    let pageToken: string | undefined;
    let complete = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin,
        timeMax,
        maxResults: 250,
        singleEvents: true, // Expand recurring events
        orderBy: 'startTime',
        pageToken,
      });
      events.push(...(response.data.items || []));
      pageToken = response.data.nextPageToken || undefined;
      if (!pageToken) { complete = true; break; }
    }
    console.log(`[CalendarSync] Found ${events.length} Gmail events (complete=${complete})`);

    const errors: string[] = [];
    let synced = 0;
    const cancelledEventIds: string[] = [];
    const seenEventIds: string[] = [];

    for (const event of events) {
      try {
        // Skip events without start/end times
        if (!event.start || !event.end) {
          continue;
        }

        const eventStatus: 'confirmed' | 'cancelled' | 'tentative' = event.status as any || 'confirmed';
        if (eventStatus === 'cancelled') cancelledEventIds.push(event.id!);
        seenEventIds.push(event.id!);

        const calendarEvent: CalendarEvent = {
          user_id: connection.user_id,
          connection_id: connection.id,
          event_id: event.id!,
          calendar_id: 'primary',
          title: event.summary || '(No title)',
          description: event.description || null,
          location: event.location || null,
          meeting_link: extractMeetingLink(event.description, event.hangoutLink, event.location),
          start_time: event.start.dateTime || event.start.date!,
          end_time: event.end.dateTime || event.end.date!,
          timezone: event.start.timeZone,
          is_all_day: !event.start.dateTime,
          organizer: event.organizer?.email,
          attendees: (event.attendees || []).map((a: any) => ({
            email: a.email!,
            name: a.displayName,
            status: a.responseStatus as any,
          })),
          status: eventStatus,
          provider: 'gmail',
          metadata: event,
        };

        const { error } = await supabase
          .from('calendar_events')
          .upsert(calendarEvent, {
            onConflict: 'user_id,event_id,provider',
          });

        if (error) {
          errors.push(`Failed to save event ${event.id}: ${error.message}`);
        } else {
          synced++;
        }
      } catch (error: any) {
        errors.push(`Error processing event ${event.id}: ${error.message}`);
      }
    }

    await cleanupCancelledEvents(connection.user_id, cancelledEventIds, 'gmail', supabase);
    const pruned = await applyCalendarPrune(supabase, connection, 'gmail',
      planCalendarPrune({ complete, fetchedEventIds: seenEventIds, windowStartISO: timeMin, windowEndISO: timeMax, nowISO: new Date().toISOString() }));

    return { synced, pruned, errors };
  } catch (error: any) {
    console.error('[CalendarSync] Gmail API error:', error);
    return { synced: 0, errors: [error.message] };
  }
}

/**
 * Sync Outlook calendar events
 */
async function syncOutlookCalendar(
  connection: Connection,
  supabase: SupabaseClient,
  daysAhead: number,
  daysBehind: number
): Promise<{ synced: number; pruned?: number; errors: string[] }> {
  // Token refresh callback - updates database when tokens are refreshed
  const onTokenRefresh = async (newTokens: { accessToken: string; refreshToken: string; expiresOn: string }) => {
    const newEncryptedTokens = Buffer.from(JSON.stringify({
      accessToken: newTokens.accessToken,
      refreshToken: newTokens.refreshToken,
      expiresOn: newTokens.expiresOn,
    })).toString('base64');

    await supabase
      .from('connections')
      .update({
        metadata: {
          ...connection.metadata,
          tokens: newEncryptedTokens
        }
      })
      .eq('id', connection.id);

    console.log(`✓ Updated refreshed tokens for connection ${connection.id}`);
  };

  // Use the same getGraphClient as email sync (handles token decryption + refresh)
  const client = await getGraphClient(connection.metadata.tokens, onTokenRefresh);

  const timeMin = new Date(Date.now() - daysBehind * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

  try {
    const first = await client
      .api('/me/calendar/events')
      .select([
        'id',
        'subject',
        'bodyPreview',
        'body',
        'start',
        'end',
        'location',
        'attendees',
        'organizer',
        'isAllDay',
        'isCancelled',
        'onlineMeeting',
      ])
      .filter(`start/dateTime ge '${timeMin}' and start/dateTime le '${timeMax}'`)
      .orderby('start/dateTime')
      .top(250)
      .get();

    // PAGINATED through @odata.nextLink — same reason as the Gmail lane: only a COMPLETE fetch of
    // the window may license a prune, and a truncated page is not one.
    const events: any[] = [...(first.value || [])];
    let next: string | undefined = first['@odata.nextLink'];
    let complete = !next;
    for (let page = 1; page < MAX_PAGES && next; page++) {
      const more: any = await client.api(next).get();
      events.push(...(more.value || []));
      next = more['@odata.nextLink'];
      if (!next) complete = true;
    }
    console.log(`[CalendarSync] Found ${events.length} Outlook events (complete=${complete})`);

    const errors: string[] = [];
    let synced = 0;
    const cancelledEventIds: string[] = [];
    const seenEventIds: string[] = [];

    for (const event of events) {
      try {
        if (event.isCancelled) cancelledEventIds.push(event.id);
        seenEventIds.push(event.id);

        const calendarEvent: CalendarEvent = {
          user_id: connection.user_id,
          connection_id: connection.id,
          event_id: event.id,
          calendar_id: 'primary',
          title: event.subject || '(No title)',
          description: event.body?.content || event.bodyPreview || null,
          location: event.location?.displayName || null,
          meeting_link: event.onlineMeeting?.joinUrl || extractMeetingLink(event.body?.content, null, event.location?.displayName),
          start_time: event.start.dateTime,
          end_time: event.end.dateTime,
          timezone: event.start.timeZone,
          is_all_day: event.isAllDay || false,
          organizer: event.organizer?.emailAddress?.address,
          attendees: (event.attendees || []).map((a: any) => ({
            email: a.emailAddress.address,
            name: a.emailAddress.name,
            status: a.status?.response?.toLowerCase(),
          })),
          status: event.isCancelled ? 'cancelled' : 'confirmed',
          provider: 'outlook',
          metadata: event,
        };

        const { error } = await supabase
          .from('calendar_events')
          .upsert(calendarEvent, {
            onConflict: 'user_id,event_id,provider',
          });

        if (error) {
          errors.push(`Failed to save event ${event.id}: ${error.message}`);
        } else {
          synced++;
        }
      } catch (error: any) {
        errors.push(`Error processing event ${event.id}: ${error.message}`);
      }
    }

    await cleanupCancelledEvents(connection.user_id, cancelledEventIds, 'outlook', supabase);
    const pruned = await applyCalendarPrune(supabase, connection, 'outlook',
      planCalendarPrune({ complete, fetchedEventIds: seenEventIds, windowStartISO: timeMin, windowEndISO: timeMax, nowISO: new Date().toISOString() }));

    return { synced, pruned, errors };
  } catch (error: any) {
    console.error('[CalendarSync] Outlook API error:', error);
    return { synced: 0, errors: [error.message] };
  }
}

/**
 * Clean up inbox_items linked to cancelled calendar events.
 * Called after each sync to remove stale meeting prep and action items.
 *
 * Covers two link paths:
 *  1. bot/recording action items: inbox_items.source_meeting_transcript_id → meeting_transcripts.calendar_event_id
 *  2. email-prep items:           inbox_items.source_data->>'calendar_event_id'
 */
async function cleanupCancelledEvents(
  userId: string,
  cancelledEventIds: string[], // external event_id strings (e.g. Google/Outlook IDs)
  provider: 'gmail' | 'outlook',
  supabase: SupabaseClient
): Promise<void> {
  if (cancelledEventIds.length === 0) return;

  // Resolve external event_ids → internal calendar_events.id UUIDs
  const { data: cancelledRows } = await supabase
    .from('calendar_events')
    .select('id')
    .eq('user_id', userId)
    .eq('provider', provider)
    .in('event_id', cancelledEventIds)
    .eq('status', 'cancelled');

  await cleanupEventLinks(userId, (cancelledRows ?? []).map((r) => r.id), supabase);
}

/** The links a calendar event leaves behind — dropped whether the event was cancelled at the
 *  provider or deleted outright (THE DEPARTURE LAW's other half: a gone event owns nothing). */
async function cleanupEventLinks(
  userId: string,
  calendarEventUuids: string[],
  supabase: SupabaseClient,
): Promise<void> {
  if (calendarEventUuids.length === 0) return;

  // 1. Delete action items via meeting_transcripts
  const { data: transcripts } = await supabase
    .from('meeting_transcripts')
    .select('id')
    .eq('user_id', userId)
    .in('calendar_event_id', calendarEventUuids);

  const transcriptIds = (transcripts ?? []).map((t) => t.id);
  if (transcriptIds.length > 0) {
    await supabase
      .from('inbox_items')
      .delete()
      .eq('user_id', userId)
      .in('source_meeting_transcript_id', transcriptIds);
  }

  // 2. Delete email-prep items linked via source_data->>'calendar_event_id'
  for (const uuid of calendarEventUuids) {
    await supabase
      .from('inbox_items')
      .delete()
      .eq('user_id', userId)
      .eq('source_data->>calendar_event_id', uuid);
  }

  console.log(`[CalendarSync] Cleaned up inbox items for ${calendarEventUuids.length} cancelled event(s)`);
}

/**
 * Extract meeting link from various sources
 */
function extractMeetingLink(description?: string | null, hangoutLink?: string | null, location?: string | null): string | null {
  // Google Meet link
  if (hangoutLink) {
    return hangoutLink;
  }

  // Check description for links
  if (description) {
    // Zoom
    const zoomMatch = description.match(/https:\/\/[\w-]+\.zoom\.us\/j\/[\d\w?=&]+/i);
    if (zoomMatch) return zoomMatch[0];

    // Google Meet
    const meetMatch = description.match(/https:\/\/meet\.google\.com\/[\w-]+/i);
    if (meetMatch) return meetMatch[0];

    // Microsoft Teams
    const teamsMatch = description.match(/https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[\w\-\.%]+/i);
    if (teamsMatch) return teamsMatch[0];
  }

  // Check location for links
  if (location) {
    const urlMatch = location.match(/https?:\/\/[^\s]+/i);
    if (urlMatch) return urlMatch[0];
  }

  return null;
}
