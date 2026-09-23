// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE RESTORE FLIP — the ONE reopen of an inbox item / commitment (the status half of POST
// /api/restore). The route (the Undo toast + the Activity-log Undo) and the guarded repair scripts
// (scripts/repair-authorship.ts --reopen) share it, so a machine reopen is byte-identical to the
// user's own Undo: status back to pending/open, resolved_at/resolved_reason cleared (the item leaves
// the Day-cleared ring), a named `restored` activity row.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { logActivity } from '@/lib/activity/log';

export type ReopenResult = { ok: true } | { ok: false; error: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export async function reopenInboxItem(client: Client, userId: string, id: string, opts: { note?: string } = {}): Promise<ReopenResult> {
  const { data: pre } = await client.from('inbox_items').select('source_data').eq('id', id).eq('user_id', userId).maybeSingle();
  const preSd = { ...((pre?.source_data ?? {}) as Record<string, unknown>) };
  delete preSd.resolved_at;
  delete preSd.resolved_reason;
  delete preSd.resolution_reason;
  const { error } = await client
    .from('inbox_items')
    .update({ status: 'pending', source_data: preSd, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId);
  if (error) return { ok: false, error: error.message };
  // Name the specific item so the log reads "Restored: <subject>" (not a vague "Restored an item").
  const { data: it } = await client.from('inbox_items').select('work_title, source_data').eq('id', id).eq('user_id', userId).maybeSingle();
  const itemTitle = (it?.work_title || (it?.source_data as { subject?: string } | null)?.subject || 'an item') as string;
  await logActivity(client, userId, {
    type: 'restored', title: `Restored: ${itemTitle}`, entityType: 'inbox_item', entityId: id,
    ...(opts.note ? { metadata: { reason: opts.note } } : {}),
  });
  return { ok: true };
}

export async function reopenCommitment(client: Client, userId: string, id: string, opts: { note?: string } = {}): Promise<ReopenResult> {
  // resolved_at/resolved_reason may not exist on older schemas → retry status-only on error.
  let error;
  ({ error } = await client
    .from('commitments')
    .update({ status: 'open', resolved_at: null, resolved_reason: null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId));
  if (error) {
    ({ error } = await client
      .from('commitments')
      .update({ status: 'open', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId));
  }
  if (error) return { ok: false, error: error.message };
  const { data: c } = await client.from('commitments').select('description').eq('id', id).eq('user_id', userId).maybeSingle();
  await logActivity(client, userId, {
    type: 'restored', title: `Restored: ${c?.description || 'a commitment'}`, entityType: 'commitment', entityId: id,
    ...(opts.note ? { metadata: { reason: opts.note } } : {}),
  });
  return { ok: true };
}

/**
 * THE BATCH FLIP (stabilization W8.6 — a bulk deed undoes AS ONE). The same flip as
 * `reopenInboxItem` (status back to pending, resolved_at / resolved_reason / resolution_reason
 * cleared) over a whole deed's members, read in chunks (never one giant `in()`), each write
 * CONDITIONAL on the status the read saw — a row the user moved again since is never clobbered.
 * `onlyReasons` narrows to rows still carrying the resolution reason the deed stamped. It writes NO
 * per-item activity row: the caller logs the ONE `restored` record for the deed.
 */
export async function reopenInboxItems(
  client: Client, userId: string, ids: string[], opts: { onlyReasons?: string[] } = {},
): Promise<{ reopened: number; skipped: number; failed: number }> {
  const out = { reopened: 0, skipped: 0, failed: 0 };
  const uniq = [...new Set(ids.map(String))];
  const CHUNK = 200;
  const CONCURRENCY = 8;
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const chunk = uniq.slice(i, i + CHUNK);
    const { data, error } = await client.from('inbox_items').select('id, status, source_data')
      .eq('user_id', userId).in('id', chunk);
    if (error) { out.failed += chunk.length; continue; }
    const rows = (data ?? []) as Array<{ id: string; status: string; source_data: Record<string, unknown> | null }>;
    out.skipped += chunk.length - rows.length; // gone since the deed ran
    const todo = rows.filter((r) => {
      const sd = (r.source_data ?? {}) as Record<string, unknown>;
      const ok = (r.status === 'dismissed' || r.status === 'completed')
        && (!opts.onlyReasons || opts.onlyReasons.includes(String(sd.resolution_reason ?? '')));
      if (!ok) out.skipped++;
      return ok;
    });
    let next = 0;
    const worker = async () => {
      for (;;) {
        const r = todo[next++];
        if (!r) return;
        const sd = { ...((r.source_data ?? {}) as Record<string, unknown>) };
        delete sd.resolved_at; delete sd.resolved_reason; delete sd.resolution_reason;
        const { data: upd, error: uerr } = await client.from('inbox_items')
          .update({ status: 'pending', source_data: sd, updated_at: new Date().toISOString() })
          .eq('id', r.id).eq('user_id', userId).eq('status', r.status)
          .select('id');
        if (uerr) out.failed++;
        else if (((upd ?? []) as unknown[]).length) out.reopened++;
        else out.skipped++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) || 1 }, worker));
  }
  return out;
}
