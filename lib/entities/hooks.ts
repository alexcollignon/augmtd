// ONE BRAIN — LIVE RECOGNITION HOOKS. Recognizes newly-synced work items (mail, commitments, calendar
// events, meeting transcripts) into the entity memory as they arrive. SELF-GATED on an initiative
// entity existing — and (W9.3 PROJECTS FOLLOW THE MAIL) a user with NO memory yet no longer waits for a
// Home load: the email-sync tail BOOTSTRAPS it (bootstrapMemory — chunked, idempotent, budgeted,
// per-process cooled down), so every account converges from its own sync. Non-fatal everywhere.
//
// W9.3 also closes the loop recognition left open: when a hook links a NEW member to an entity, the
// entity's state refresh is SCHEDULED (lib/entities/refresh-schedule.ts — one coalesced, claimed,
// budgeted, sig-gated refresh per entity per window; what a call cannot run is marked dirty and drained
// by the next sync tail). Before, a deal's state moved only on a user action or the 2-hourly catch-all.
//
// Cost profile per sync (the "natural and fast" contract): already-seen/thread items ≈ one lookup
// (~85-370ms, zero AI); only genuinely NEW matter pays one background Haiku judgment (~2.2s). Capped.

import type { SupabaseClient } from '@supabase/supabase-js';
import { recognizeItem, type RecogItem } from './recognize';
import { itemFromInbox, itemFromCommitment, itemFromMeeting, itemFromCalendar } from './sources';
import { scheduleEntityRefresh } from './refresh-schedule';

const MAX_PER_SYNC = 8;

/** The sync tail's bootstrap: items per sync, and the start deadline (no recognition starts past it). */
export const SYNC_BOOTSTRAP_CAP = 6;
export const SYNC_BOOTSTRAP_BUDGET_MS = 20_000;
/** Per-process cool-down between two sync-tail bootstraps for one user (a no-memory account whose mail
 *  is all refusals must not pay the two bootstrap reads on every 15-minute tick in a warm process). */
const BOOTSTRAP_COOLDOWN_MS = 10 * 60_000;
/** The calendar sync's recognition bound — per sync, and its start deadline. */
export const CALENDAR_SYNC_RECOGNIZE_CAP = 3;
export const CALENDAR_SYNC_RECOGNIZE_BUDGET_MS = 8_000;

// Per-process memory-exists cache (5 min) — the self-gate.
const gate = new Map<string, { at: number; on: boolean }>();
async function memoryExists(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const c = gate.get(userId);
  if (c && Date.now() - c.at < 5 * 60 * 1000) return c.on;
  let on = false;
  try {
    // Gate on INITIATIVE memory specifically — person entities (migrated for more users) must not open
    // the recognition gate for a user whose initiative backfill hasn't run.
    const { count } = await supabase.from('work_entities').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('kind', 'initiative');
    on = (count ?? 0) > 0;
  } catch { on = false; }
  gate.set(userId, { at: Date.now(), on });
  return on;
}

/** Recognize one item; a NEW member link lands its entity in `fresh` (the refresh schedule's input). */
async function recognizeInto(supabase: SupabaseClient, userId: string, item: RecogItem, fresh: Set<string>): Promise<void> {
  const r = await recognizeItem(supabase, userId, item).catch(() => null);
  if (r?.linked && r.entityId) fresh.add(r.entityId);
}

// ── THE SYNC-TAIL BOOTSTRAP (W9.3 item 2) ─────────────────────────────────────────────────────────
const bootstrapAt = new Map<string, number>();
const bootstrapInFlight = new Set<string>();

/** PURE — may this sync tail bootstrap the user now? (single-flight + cool-down, per process) */
export function syncBootstrapDue(args: { lastAt: number | undefined; inFlight: boolean; nowMs: number; cooldownMs?: number }): boolean {
  if (args.inFlight) return false;
  return args.lastAt == null || args.nowMs - args.lastAt >= (args.cooldownMs ?? BOOTSTRAP_COOLDOWN_MS);
}

/** Bootstrap from the sync tail for a user whose memory gate is closed. Budgeted, reports what it left. */
async function bootstrapFromSync(supabase: SupabaseClient, userId: string): Promise<{ ran: number; left: number } | null> {
  const now = Date.now();
  if (!syncBootstrapDue({ lastAt: bootstrapAt.get(userId), inFlight: bootstrapInFlight.has(userId), nowMs: now })) return null;
  bootstrapInFlight.add(userId);
  bootstrapAt.set(userId, now);
  try {
    const r = await bootstrapMemory(supabase, userId, SYNC_BOOTSTRAP_CAP, { deadlineAt: now + SYNC_BOOTSTRAP_BUDGET_MS });
    if (!r) return null;
    if (r.ran > 0) gate.delete(userId); // memory may exist now — the next tail re-reads the gate
    if (r.entityIds.length) await scheduleEntityRefresh(supabase, userId, r.entityIds, { maxRun: 1 });
    if (r.left > 0) console.log(`[bootstrap] ${userId.slice(0, 8)}: recognized ${r.ran}, ${r.left} unseen item(s) left for the next sync tail`);
    return { ran: r.ran, left: r.left };
  } finally { bootstrapInFlight.delete(userId); }
}

/** Shadow-recognize the work items + commitments touched by a sync window, then SCHEDULE the refresh of
 *  every entity that gained a member (and drain dirty ones). Awaited from the sync's tail. Commitments
 *  carry thread_id → mostly STRUCTURAL inheritance (zero AI). A user with no memory yet is BOOTSTRAPPED
 *  here instead (W9.3) — the Home load is no longer the only door into entity memory. */
export async function shadowRecognizeTouched(supabase: SupabaseClient, userId: string, sinceIso: string): Promise<{ ran: number; bootstrapped?: number } | null> {
  try {
    if (!(await memoryExists(supabase, userId))) {
      const b = await bootstrapFromSync(supabase, userId);
      return b ? { ran: 0, bootstrapped: b.ran } : null;
    }
    const [{ data: touched }, { data: commits }] = await Promise.all([
      supabase.from('inbox_items')
        .select('id, work_title, source_data, created_at')
        .eq('user_id', userId).eq('source', 'email')
        .gte('updated_at', sinceIso).limit(50),
      supabase.from('commitments')
        .select('id, description, counterparty, thread_id, source, source_id, created_at')
        .eq('user_id', userId).gte('created_at', sinceIso).limit(20),
    ]);
    const work = ((touched ?? []) as Array<Record<string, any>>).filter((it) => {
      const sd = it.source_data ?? {}; const rel = sd.understanding?.relevance;
      return rel === 'reply' || rel === 'action' || !!sd.understanding?.initiative;
    }).slice(0, MAX_PER_SYNC).map(itemFromInbox);
    const commitItems = ((commits ?? []) as Array<Record<string, any>>).map(itemFromCommitment);
    const fresh = new Set<string>();
    let ran = 0;
    for (const item of [...work, ...commitItems]) {
      await recognizeInto(supabase, userId, item, fresh);
      ran++;
    }
    // FILE SPINE (Prepared-Work A3): ingest the touched items' email attachments into the KB — runs
    // AFTER recognition so the file inherits the item's fresh entity link. Idempotent (content-hash),
    // noise-filtered, capped, non-fatal.
    try {
      const { ingestItemAttachments } = await import('@/lib/knowledge/ingest');
      const withAtts = ((touched ?? []) as Array<Record<string, any>>)
        .filter((it) => Array.isArray(it.source_data?.attachments) && it.source_data.attachments.length).slice(0, 6);
      for (const it of withAtts) await ingestItemAttachments(supabase, userId, { id: it.id, source_data: it.source_data }).catch(() => {});
    } catch { /* non-fatal */ }
    // W9.3 — the entities this sync moved re-synthesize (coalesced, claimed, budgeted); the call runs
    // even with nothing fresh, because it DRAINS the dirty markers earlier tails/doors left behind.
    await scheduleEntityRefresh(supabase, userId, [...fresh]);
    return { ran };
  } catch { return null; }
}

/** BOOTSTRAP — fill a user's memory incrementally (the onboarding path for users who never got a manual
 *  backfill). Each call recognizes up to `cap` recent work items that have NO membership verdict yet;
 *  idempotent (links + refusals persist), so it self-completes over a few calls and then becomes a
 *  cheap no-op (the unlinked query returns nothing). Called from the Home load, first-look AND (W9.3)
 *  the email-sync tail. `deadlineAt` bounds the loop; `left` REPORTS what it did not reach (no silent
 *  caps); `entityIds` = the entities that gained a member (the refresh schedule's input). */
export async function bootstrapMemory(
  supabase: SupabaseClient, userId: string, cap = 15, opts: { deadlineAt?: number } = {},
): Promise<{ ran: number; left: number; entityIds: string[] } | null> {
  try {
    const { data: items } = await supabase.from('inbox_items')
      .select('id, work_title, source_data, created_at')
      .eq('user_id', userId).eq('source', 'email')
      .order('created_at', { ascending: false }).limit(200);
    const work = ((items ?? []) as Array<Record<string, any>>).filter((it) => {
      const sd = it.source_data ?? {}; const rel = sd.understanding?.relevance;
      return rel === 'reply' || rel === 'action' || !!sd.understanding?.initiative;
    });
    if (!work.length) return { ran: 0, left: 0, entityIds: [] };
    const { data: links } = await supabase.from('entity_links')
      .select('item_id').eq('user_id', userId).eq('item_kind', 'inbox_item').in('item_id', work.map((w) => w.id));
    const seen = new Set((links ?? []).map((l) => l.item_id as string));
    // Oldest-first among the unseen (chronological — the memory's spine), capped per run.
    const unseen = work.filter((w) => !seen.has(w.id as string)).reverse();
    const todo = unseen.slice(0, cap);
    const fresh = new Set<string>();
    let ran = 0;
    for (const it of todo) {
      if (opts.deadlineAt && Date.now() > opts.deadlineAt) break;
      await recognizeInto(supabase, userId, itemFromInbox(it), fresh);
      ran++;
    }
    return { ran, left: unseen.length - ran, entityIds: [...fresh] };
  } catch { return null; }
}

// A calendar-CANCELLATION event whose title is the raw provider string is not a meeting to remember.
const isCancelledTitle = (t: string): boolean =>
  /^(canceled|cancelled)( event)?:/i.test(String(t || '').trimStart());

/** PURE — a calendar row recognition may judge: confirmed, not a raw cancellation, ≥2 attendees (an
 *  identity signal; solo blocks are skipped). ONE predicate for both calendar hooks. */
export function isRecognizableEvent(e: { title?: unknown; attendees?: unknown; status?: unknown }): boolean {
  return (e.status == null || e.status === 'confirmed')
    && !isCancelledTitle(String(e.title ?? ''))
    && Array.isArray(e.attendees) && e.attendees.length >= 2;
}

/** Shadow-recognize recent + upcoming CALENDAR EVENTS into the memory (the gap that made a scheduled
 *  meeting invisible to its deal: only email sync and meeting insights had live hooks — a NEW calendar
 *  event was never recognized after the one-time bootstrap). Idempotent (links + refusals persist);
 *  only events with real attendees (an identity signal) are judged; solo blocks are skipped. Called
 *  from the email-sync tail + the 2-hourly cron so coverage never depends on one path. A new member
 *  MARKS its entity for refresh (maxRun 0 — the next email-sync tail drains it; this hook's callers
 *  are budget-tight). */
export async function shadowRecognizeCalendar(supabase: SupabaseClient, userId: string, cap = 6): Promise<{ ran: number } | null> {
  try {
    if (!(await memoryExists(supabase, userId))) return null;
    const now = Date.now();
    const { data: evs } = await supabase.from('calendar_events')
      .select('id, title, attendees, start_time, created_at')
      .eq('user_id', userId).eq('status', 'confirmed')
      .gte('start_time', new Date(now - 4 * 86_400_000).toISOString())
      .lte('start_time', new Date(now + 21 * 86_400_000).toISOString())
      .order('start_time', { ascending: true }).limit(80);
    const cands = ((evs ?? []) as Array<Record<string, any>>).filter(isRecognizableEvent);
    if (!cands.length) return { ran: 0 };
    const { data: links } = await supabase.from('entity_links')
      .select('item_id').eq('user_id', userId).eq('item_kind', 'calendar_event').in('item_id', cands.map((c) => c.id));
    const seen = new Set((links ?? []).map((l) => l.item_id as string));
    const fresh = new Set<string>();
    let ran = 0;
    for (const ev of cands.filter((c) => !seen.has(c.id as string)).slice(0, cap)) {
      await recognizeInto(supabase, userId, itemFromCalendar(ev), fresh);
      ran++;
    }
    if (fresh.size) await scheduleEntityRefresh(supabase, userId, [...fresh], { maxRun: 0 });
    return { ran };
  } catch { return null; }
}

/** PURE — the calendar sync's recognition plan: recognizable rows not yet seen, soonest first, capped.
 *  `unseen` is the whole unseen count, so the caller reports what the cap left behind. */
export function planCalendarRecognition<T extends { id?: unknown; title?: unknown; attendees?: unknown; status?: unknown; start_time?: unknown }>(
  rows: T[], seen: Set<string>, cap: number,
): { todo: T[]; unseen: number } {
  const unseen = rows.filter((r) => isRecognizableEvent(r) && !seen.has(String(r.id)))
    .sort((a, b) => String(a.start_time ?? '').localeCompare(String(b.start_time ?? '')));
  return { todo: unseen.slice(0, Math.max(0, cap)), unseen: unseen.length };
}

/** W9.3 item 3 — the CALENDAR SYNC's own recognition (the hourly calendar cron, the push webhooks and
 *  the manual sync all land here through lib/calendar/sync-calendar.ts): the events THIS read upserted
 *  (provider event ids) are recognized, bounded by a cap + a start deadline, the remainder REPORTED as
 *  `left` (the next sync, and the email-sync tail's window hook, reach them — recognition is idempotent).
 *  A new member MARKS its entity for refresh (maxRun 0): the calendar path never pays a synthesis. */
export async function shadowRecognizeCalendarEvents(
  supabase: SupabaseClient, userId: string, args: { provider: string; eventIds: string[] },
  opts: { cap?: number; budgetMs?: number } = {},
): Promise<{ ran: number; left: number } | null> {
  try {
    if (!args.eventIds.length) return { ran: 0, left: 0 };
    if (!(await memoryExists(supabase, userId))) return null;
    const started = Date.now();
    const cap = opts.cap ?? CALENDAR_SYNC_RECOGNIZE_CAP;
    const budget = opts.budgetMs ?? CALENDAR_SYNC_RECOGNIZE_BUDGET_MS;
    // Chunked `in()` over the provider ids this read landed (never one giant filter).
    const rows: Array<Record<string, any>> = [];
    const ids = [...new Set(args.eventIds)];
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await supabase.from('calendar_events')
        .select('id, title, attendees, start_time, created_at, status')
        .eq('user_id', userId).eq('provider', args.provider).in('event_id', ids.slice(i, i + 100));
      if (error) return null;
      rows.push(...((data ?? []) as Array<Record<string, any>>));
    }
    const cands = rows.filter(isRecognizableEvent);
    if (!cands.length) return { ran: 0, left: 0 };
    const seen = new Set<string>();
    for (let i = 0; i < cands.length; i += 200) {
      const { data: links } = await supabase.from('entity_links')
        .select('item_id').eq('user_id', userId).eq('item_kind', 'calendar_event').in('item_id', cands.slice(i, i + 200).map((c) => c.id));
      for (const l of (links ?? []) as Array<{ item_id: string }>) seen.add(l.item_id);
    }
    const { todo, unseen } = planCalendarRecognition(cands, seen, cap);
    const fresh = new Set<string>();
    let ran = 0;
    for (const ev of todo) {
      if (Date.now() - started > budget) break;
      await recognizeInto(supabase, userId, itemFromCalendar(ev), fresh);
      ran++;
    }
    if (fresh.size) await scheduleEntityRefresh(supabase, userId, [...fresh], { maxRun: 0 });
    const left = unseen - ran;
    if (left > 0) console.log(`[calendar-recognize] ${userId.slice(0, 8)}: recognized ${ran}, ${left} unseen event(s) left for the next sync`);
    return { ran, left };
  } catch { return null; }
}

/** Shadow-recognize a just-processed MEETING transcript into the memory. Called from the insights tail.
 *  A new member schedules its entity's refresh (one run — the insights pipeline is background work). */
export async function shadowRecognizeMeeting(supabase: SupabaseClient, userId: string, transcriptId: string): Promise<void> {
  try {
    if (!(await memoryExists(supabase, userId))) return;
    const { data: m } = await supabase.from('meeting_transcripts')
      .select('id, title, summary, attendees, start_time, created_at')
      .eq('id', transcriptId).eq('user_id', userId).maybeSingle();
    if (!m?.summary) return;
    const fresh = new Set<string>();
    await recognizeInto(supabase, userId, itemFromMeeting(m), fresh);
    if (fresh.size) await scheduleEntityRefresh(supabase, userId, [...fresh], { maxRun: 1 });
  } catch { /* non-fatal */ }
}
