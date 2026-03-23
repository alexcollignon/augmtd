/**
 * On Your Desk — Sync Engine (Phase 65)
 *
 * Surfaces work items onto the desk:
 *   - Emails: grouped by thread → one card per thread, work_title as title
 *   - Meeting actions: one card per inbox_item (source='meeting')
 *   - Process steps: one card per assigned step
 *
 * Rule-based surfacing — fast. AI synthesis runs async afterward.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { DeskUrgency, DeskSourceRef } from '@/lib/types/desk';

export interface SyncDeskResult {
  surfaced: number;
  needsSynthesis: string[]; // desk_item IDs that need AI synthesis
}

export async function syncDeskForUser(userId: string, adminClient: SupabaseClient): Promise<SyncDeskResult> {
  // 1. Load existing desk state
  const { data: existing } = await adminClient
    .from('desk_items')
    .select('id, source_type, source_id, thread_key, kanban_column, email_count')
    .eq('user_id', userId);

  // Lookup maps
  const existingBySource = new Map<string, { id: string; column: string }>();
  const existingByThread = new Map<string, { id: string; column: string; emailCount: number }>();
  const doneSourceKeys = new Set<string>();
  const doneThreadKeys = new Set<string>();

  for (const r of existing ?? []) {
    if (r.thread_key) {
      existingByThread.set(r.thread_key, { id: r.id, column: r.kanban_column, emailCount: r.email_count ?? 1 });
      if (r.kanban_column === 'done') doneThreadKeys.add(r.thread_key);
    } else {
      const k = `${r.source_type}:${r.source_id}`;
      existingBySource.set(k, { id: r.id, column: r.kanban_column });
      if (r.kanban_column === 'done') doneSourceKeys.add(k);
    }
  }

  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: Array<{ id: string; fields: Record<string, unknown> }> = [];
  const needsSynthesis: string[] = [];

  // ── 2. Emails — group by thread_id ────────────────────────────────────────
  const { data: emailItems, error: emailErr } = await adminClient
    .from('inbox_items')
    .select('id, work_title, what_i_prepared, why_matters, source_data, item_type, status')
    .eq('user_id', userId)
    .eq('source', 'email')
    .not('status', 'in', '("completed","dismissed")')
    .order('created_at', { ascending: false })
    .limit(60);

  if (emailErr) console.error('[SyncDesk] email query error:', emailErr.message);

  type EmailRow = NonNullable<typeof emailItems>[number];

  // Group by thread_id (fall back to item id for threadless emails)
  const threadGroups = new Map<string, EmailRow[]>();
  for (const item of emailItems ?? []) {
    const tid = item.source_data?.thread_id ?? item.id;
    if (!threadGroups.has(tid)) threadGroups.set(tid, []);
    threadGroups.get(tid)!.push(item);
  }

  console.log(`[SyncDesk] email threads: ${threadGroups.size}`);

  for (const [threadId, items] of threadGroups) {
    const threadKey = `email:${threadId}`;
    if (doneThreadKeys.has(threadKey)) continue;

    // Most recent item is first (ordered desc)
    const lead = items[0];
    const urgency: DeskUrgency =
      items.some((i) => i.item_type === 'reply' || i.item_type === 'decision') ? 'high' : 'medium';
    const hasPrepared = items.some((i) => !!i.what_i_prepared);
    const emailCount = items.length;
    const sourceRefs: DeskSourceRef[] = items.map((i) => ({ type: 'email', id: i.id }));
    const title = lead.work_title || lead.source_data?.subject || '(No subject)';
    const description = lead.why_matters || `From ${lead.source_data?.from_name || lead.source_data?.from_address || 'Unknown'}`;
    const sourceUrl = `/inbox`;

    const existingThread = existingByThread.get(threadKey);

    if (existingThread) {
      // Card already exists — update if thread grew
      const threadGrew = emailCount > existingThread.emailCount;
      if (threadGrew) {
        toUpdate.push({
          id: existingThread.id,
          fields: {
            title,
            description,
            source_id: lead.id,
            source_refs: sourceRefs,
            email_count: emailCount,
            has_prepared: hasPrepared,
            urgency,
            synthesis: null, // re-queue synthesis
            synthesis_at: null,
            updated_at: new Date().toISOString(),
          },
        });
        needsSynthesis.push(existingThread.id);
      }
    } else {
      toInsert.push({
        user_id: userId,
        source_type: 'email',
        source_id: lead.id,
        thread_key: threadKey,
        source_refs: sourceRefs,
        kanban_column: 'todo',
        position: 0,
        title,
        description,
        source_url: sourceUrl,
        urgency,
        email_count: emailCount,
        has_prepared: hasPrepared,
        synthesis: null,
        synthesis_at: null,
        updated_at: new Date().toISOString(),
      });
    }
  }

  // ── 3. Meeting action items (source='meeting') ─────────────────────────────
  const { data: meetingItems, error: meetingErr } = await adminClient
    .from('inbox_items')
    .select('id, work_title, source_data, status')
    .eq('user_id', userId)
    .eq('source', 'meeting')
    .not('status', 'in', '("completed","dismissed")')
    .order('created_at', { ascending: false })
    .limit(30);

  if (meetingErr) console.error('[SyncDesk] meeting query error:', meetingErr.message);

  for (const item of meetingItems ?? []) {
    const key = `meeting_action:${item.id}`;
    if (doneSourceKeys.has(key) || existingBySource.has(key)) continue;

    const meetingTitle = item.source_data?.meeting_title ?? 'Meeting';
    toInsert.push({
      user_id: userId,
      source_type: 'meeting_action',
      source_id: item.id,
      thread_key: null,
      source_refs: [{ type: 'meeting_action', id: item.id }],
      kanban_column: 'todo',
      position: 0,
      title: item.work_title || item.source_data?.action_item || '(Action item)',
      description: `From: ${meetingTitle}`,
      source_url: '/meetings',
      urgency: 'high' as DeskUrgency,
      email_count: 1,
      has_prepared: false,
      synthesis: null,
      synthesis_at: null,
      updated_at: new Date().toISOString(),
    });
  }

  // ── 4. Process steps assigned to the user ─────────────────────────────────
  const { data: procSteps, error: procErr } = await adminClient
    .from('process_steps')
    .select('id, title, description, status, processes(id, title)')
    .eq('assignee_id', userId)
    .neq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(20);

  if (procErr) console.error('[SyncDesk] process_step query error:', procErr.message);

  for (const step of procSteps ?? []) {
    const key = `process_step:${step.id}`;
    if (doneSourceKeys.has(key) || existingBySource.has(key)) continue;

    const processTitle = (step.processes as any)?.title ?? 'Process';
    const processId = (step.processes as any)?.id;
    toInsert.push({
      user_id: userId,
      source_type: 'process_step',
      source_id: step.id,
      thread_key: null,
      source_refs: [{ type: 'process_step', id: step.id }],
      kanban_column: step.status === 'in_progress' ? 'in_progress' : 'todo',
      position: 0,
      title: step.title || '(Unnamed step)',
      description: processTitle,
      source_url: processId ? `/processes/${processId}` : '/processes',
      urgency: 'medium' as DeskUrgency,
      email_count: 1,
      has_prepared: false,
      synthesis: null,
      synthesis_at: null,
      updated_at: new Date().toISOString(),
    });
  }

  console.log(`[SyncDesk] inserting ${toInsert.length}, updating ${toUpdate.length}`);

  // ── 5. Write to DB ─────────────────────────────────────────────────────────
  // Split by thread_key presence: threaded rows need onConflict:'user_id,thread_key',
  // non-threaded rows need onConflict:'user_id,source_type,source_id'.
  // Using separate upserts avoids the partial-index ON CONFLICT mismatch in PostgREST.
  const toInsertThreaded = toInsert.filter(r => r.thread_key != null);
  const toInsertSingle = toInsert.filter(r => r.thread_key == null);

  if (toInsertThreaded.length > 0) {
    const { error: insertErr } = await adminClient
      .from('desk_items')
      .upsert(toInsertThreaded, { onConflict: 'user_id,thread_key', ignoreDuplicates: true });
    if (insertErr) console.error('[SyncDesk] Insert (threaded) error:', insertErr.message);
  }

  if (toInsertSingle.length > 0) {
    const { error: insertErr } = await adminClient
      .from('desk_items')
      .upsert(toInsertSingle, { onConflict: 'user_id,source_type,source_id', ignoreDuplicates: true });
    if (insertErr) console.error('[SyncDesk] Insert (single) error:', insertErr.message);
  }

  for (const { id, fields } of toUpdate) {
    const { error } = await adminClient
      .from('desk_items')
      .update(fields)
      .eq('id', id);
    if (error) console.error('[SyncDesk] Update error:', error.message);
  }

  // ── 6. Collect all items that still need synthesis (new + existing unsynthesized) ──
  const { data: pendingSynthesis } = await adminClient
    .from('desk_items')
    .select('id')
    .eq('user_id', userId)
    .is('synthesis', null)
    .is('synthesis_at', null)
    .limit(20); // cap per sync cycle

  return {
    surfaced: toInsert.length + toUpdate.length,
    needsSynthesis: (pendingSynthesis ?? []).map((r: { id: string }) => r.id),
  };
}
