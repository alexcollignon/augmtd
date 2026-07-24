// ONE BRAIN — LIVE SHADOW HOOK (Phase B). Recognizes newly-synced work items into the entity memory as
// they arrive, so the shadow store stays current while it's evaluated. SELF-GATING: runs ONLY for users
// whose memory already exists (a work_entities row — i.e. the backfilled evaluation users); everyone else
// is a no-op with one cheap cached count. Non-fatal everywhere; nothing user-facing reads the store yet.
//
// Cost profile per sync (the "natural and fast" contract): already-seen/thread items ≈ one lookup
// (~85-370ms, zero AI); only genuinely NEW matter pays one background Haiku judgment (~2.2s). Capped.

import type { SupabaseClient } from '@supabase/supabase-js';
import { recognizeItem } from './recognize';
import { itemFromInbox, itemFromCommitment, itemFromMeeting, itemFromCalendar } from './sources';

const MAX_PER_SYNC = 8;

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

/** Shadow-recognize the work items + commitments touched by a sync window. Fire-and-forget from the
 *  sync's tail. Commitments carry thread_id → mostly STRUCTURAL inheritance (zero AI). */
export async function shadowRecognizeTouched(supabase: SupabaseClient, userId: string, sinceIso: string): Promise<{ ran: number } | null> {
  try {
    if (!(await memoryExists(supabase, userId))) return null;
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
    let ran = 0;
    for (const item of [...work, ...commitItems]) {
      await recognizeItem(supabase, userId, item).catch(() => {});
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
    return { ran };
  } catch { return null; }
}

/** BOOTSTRAP — fill a user's memory incrementally (the onboarding path for users who never got a manual
 *  backfill). Each call recognizes up to `cap` recent work items that have NO membership verdict yet;
 *  idempotent (links + refusals persist), so it self-completes over a few Home loads and then becomes a
 *  cheap no-op (the unlinked query returns nothing). This is what lets the label-era fallbacks die: every
 *  user converges to entity memory without a manual step. */
export async function bootstrapMemory(supabase: SupabaseClient, userId: string, cap = 15): Promise<{ ran: number } | null> {
  try {
    const { data: items } = await supabase.from('inbox_items')
      .select('id, work_title, source_data, created_at')
      .eq('user_id', userId).eq('source', 'email')
      .order('created_at', { ascending: false }).limit(200);
    const work = ((items ?? []) as Array<Record<string, any>>).filter((it) => {
      const sd = it.source_data ?? {}; const rel = sd.understanding?.relevance;
      return rel === 'reply' || rel === 'action' || !!sd.understanding?.initiative;
    });
    if (!work.length) return { ran: 0 };
    const { data: links } = await supabase.from('entity_links')
      .select('item_id').eq('user_id', userId).eq('item_kind', 'inbox_item').in('item_id', work.map((w) => w.id));
    const seen = new Set((links ?? []).map((l) => l.item_id as string));
    // Oldest-first among the unseen (chronological — the memory's spine), capped per run.
    const todo = work.filter((w) => !seen.has(w.id as string)).reverse().slice(0, cap);
    let ran = 0;
    for (const it of todo) {
      await recognizeItem(supabase, userId, itemFromInbox(it)).catch(() => {});
      ran++;
    }
    return { ran };
  } catch { return null; }
}

// A calendar-CANCELLATION event whose title is the raw provider string is not a meeting to remember.
const isCancelledTitle = (t: string): boolean =>
  /^(canceled|cancelled)( event)?:/i.test(String(t || '').trimStart());

/** Shadow-recognize recent + upcoming CALENDAR EVENTS into the memory (the gap that made a scheduled
 *  meeting invisible to its deal: only email sync and meeting insights had live hooks — a NEW calendar
 *  event was never recognized after the one-time bootstrap). Idempotent (links + refusals persist);
 *  only events with real attendees (an identity signal) are judged; solo blocks are skipped. Called
 *  from the sync tail + the 2-hourly cron so coverage never depends on one path. */
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
    const cands = ((evs ?? []) as Array<Record<string, any>>).filter((e) =>
      !isCancelledTitle(e.title) && Array.isArray(e.attendees) && e.attendees.length >= 2);
    if (!cands.length) return { ran: 0 };
    const { data: links } = await supabase.from('entity_links')
      .select('item_id').eq('user_id', userId).eq('item_kind', 'calendar_event').in('item_id', cands.map((c) => c.id));
    const seen = new Set((links ?? []).map((l) => l.item_id as string));
    let ran = 0;
    for (const ev of cands.filter((c) => !seen.has(c.id as string)).slice(0, cap)) {
      await recognizeItem(supabase, userId, itemFromCalendar(ev)).catch(() => {});
      ran++;
    }
    return { ran };
  } catch { return null; }
}

/** Shadow-recognize a just-processed MEETING transcript into the memory. Called from the insights tail. */
export async function shadowRecognizeMeeting(supabase: SupabaseClient, userId: string, transcriptId: string): Promise<void> {
  try {
    if (!(await memoryExists(supabase, userId))) return;
    const { data: m } = await supabase.from('meeting_transcripts')
      .select('id, title, summary, attendees, start_time, created_at')
      .eq('id', transcriptId).eq('user_id', userId).maybeSingle();
    if (m?.summary) await recognizeItem(supabase, userId, itemFromMeeting(m)).catch(() => {});
  } catch { /* non-fatal */ }
}
