// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SWEEP ROTATION — ONE implementation of the coverage-repair discipline (Aug 14), shared by
// every per-user cron that walks accounts under a wall-clock budget:
//   (1) ACTIVE USERS ONLY — a profile with no work signal at all has nothing to walk. Active = a
//       mail connection OR a recent item/meeting (THE SOVEREIGN TIER has no mailbox: its work
//       arrives from meetings/uploads/workflows, and a connections-only filter would silence those
//       accounts entirely).
//   (2) LEAST-RECENTLY-SERVED FIRST — the account longest without a pass leads, so a budget-killed
//       run self-balances instead of starving the same tail forever.
// The wall-clock guard and the leftBehind honesty stay with each route (they are its own budget).
//
// Forking this is how one sweep's rotation silently drifts from another's; both callers read here.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/utils/fetch-all';

export async function activeUserIds(sb: SupabaseClient, opts?: { windowDays?: number }): Promise<string[]> {
  const since = new Date(Date.now() - (opts?.windowDays ?? 60) * 86_400_000).toISOString();
  const [{ data: conns }, { data: recentItems }, { data: recentMeetings }] = await Promise.all([
    sb.from('connections').select('user_id'),
    sb.from('inbox_items').select('user_id').gte('created_at', since).limit(5000),
    sb.from('meeting_transcripts').select('user_id').gte('created_at', since).limit(2000),
  ]);
  return [...new Set([
    ...((conns ?? []) as Array<{ user_id: string }>).map((c) => c.user_id),
    ...((recentItems ?? []) as Array<{ user_id: string }>).map((r) => r.user_id),
    ...((recentMeetings ?? []) as Array<{ user_id: string }>).map((r) => r.user_id),
  ])].filter(Boolean);
}

/** Order users least-recently-served first, read off a per-user marker kind in item_plans (the
 *  newest marker row per user IS their last touch). An unseen user sorts first by construction. */
export async function orderLeastRecentlyServed(
  sb: SupabaseClient, users: string[], markerKind: string,
): Promise<string[]> {
  if (!users.length) return users;
  const lastServed = new Map<string, string>();
  try {
    const rows = await fetchAllRows<{ user_id: string; updated_at: string | null }>((from, to) =>
      sb.from('item_plans').select('user_id, updated_at')
        .eq('kind', markerKind).in('user_id', users)
        .order('updated_at', { ascending: false }).range(from, to), { maxRows: 5000 });
    for (const r of rows) if (!lastServed.has(r.user_id)) lastServed.set(r.user_id, String(r.updated_at ?? ''));
  } catch { /* an unordered walk is still guarded by the route's own budget */ }
  return [...users].sort((a, b) => (lastServed.get(a) ?? '').localeCompare(lastServed.get(b) ?? ''));
}

/** Stamp this user's marker — the rotation's own memory (zero-migration: item_plans). */
export async function stampServed(
  sb: SupabaseClient, userId: string, markerKind: string, facts: Record<string, unknown>,
): Promise<void> {
  try {
    await sb.from('item_plans').upsert({
      user_id: userId, kind: markerKind, entity_id: 'user',
      tasks: { ...facts, at: new Date().toISOString() }, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,kind,entity_id' });
  } catch { /* the rotation degrades to unordered, never fails the sweep */ }
}
