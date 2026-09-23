// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SWEEP ROTATION — ONE implementation of the coverage-repair discipline (Aug 14), shared by
// every per-user cron that walks accounts under a wall-clock budget:
//   (1) ACTIVE USERS ONLY — a profile with no work signal at all has nothing to walk. Active = a
//       LIVE connection (status 'active') OR a recent item/meeting (THE SOVEREIGN TIER has no
//       mailbox: its work arrives from meetings/uploads/workflows, and a connections-only filter
//       would silence those accounts entirely). W9.5 THE CLOCKS: a connection that is
//       needs_reconnect / disconnected / revoked / error is NOT a work signal — it used to count,
//       so an account whose only mailbox died took a sweep slot (and a fan-out dispatch) every
//       run forever. Such an account still qualifies through its recent items/transcripts.
//   (2) LEAST-RECENTLY-SERVED FIRST — the account longest without a pass leads, so a budget-killed
//       run self-balances instead of starving the same tail forever.
// The wall-clock guard and the leftBehind honesty stay with each route (they are its own budget).
//
// Forking this is how one sweep's rotation silently drifts from another's; both callers read here.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/utils/fetch-all';
import { readPlansForUsers, upsertPlan } from '@/lib/store/item-plans';

/** The rotation-marker kinds (lib/store/item-plans registry, role 'marker'). */
export type SweepMarkerKind = 'judgment_sweep' | 'draft_sweep' | 'label_sweep' | 'evidence_sweep';

/** The one connection status that is a live work signal (sync-calendar / fetch-emails read the same). */
export const LIVE_CONNECTION_STATUS = 'active';

export async function activeUserIds(sb: SupabaseClient, opts?: { windowDays?: number }): Promise<string[]> {
  const since = new Date(Date.now() - (opts?.windowDays ?? 60) * 86_400_000).toISOString();
  // NO SILENT CAPS (W1.6): `.limit(5000)`/`.limit(2000)` on an UNORDERED query still returns
  // PostgREST's hard 1000-row page — a request for 5000 silently came back as an arbitrary 1000,
  // which was quietly halving judge reach (docs/stabilization-plan.md R3/invariant 10). Paged +
  // ordered via fetchAllRows so every active user is actually counted.
  const [conns, recentItems, recentMeetings] = await Promise.all([
    fetchAllRows<{ user_id: string }>((from, to) =>
      sb.from('connections').select('user_id').eq('status', LIVE_CONNECTION_STATUS)
        .order('user_id', { ascending: true }).range(from, to)),
    fetchAllRows<{ user_id: string }>((from, to) =>
      sb.from('inbox_items').select('user_id').gte('created_at', since)
        .order('created_at', { ascending: false }).range(from, to), { maxRows: 5000 }),
    fetchAllRows<{ user_id: string }>((from, to) =>
      sb.from('meeting_transcripts').select('user_id').gte('created_at', since)
        .order('created_at', { ascending: false }).range(from, to), { maxRows: 2000 }),
  ]);
  return [...new Set([
    ...conns.map((c) => c.user_id),
    ...recentItems.map((r) => r.user_id),
    ...recentMeetings.map((r) => r.user_id),
  ])].filter(Boolean);
}

/** Order users least-recently-served first, read off a per-user marker kind in item_plans (the
 *  newest marker row per user IS their last touch). An unseen user sorts first by construction. */
export async function orderLeastRecentlyServed(
  sb: SupabaseClient, users: string[], markerKind: SweepMarkerKind,
): Promise<string[]> {
  if (!users.length) return users;
  const lastServed = new Map<string, string>();
  try {
    const rows = await readPlansForUsers(sb, users, markerKind, { maxRows: 5000 });
    for (const r of rows) if (!lastServed.has(r.user_id)) lastServed.set(r.user_id, String(r.updated_at ?? ''));
  } catch { /* an unordered walk is still guarded by the route's own budget */ }
  return [...users].sort((a, b) => (lastServed.get(a) ?? '').localeCompare(lastServed.get(b) ?? ''));
}

/** Stamp this user's marker — the rotation's own memory (zero-migration: item_plans). */
export async function stampServed(
  sb: SupabaseClient, userId: string, markerKind: SweepMarkerKind, facts: Record<string, unknown>,
): Promise<void> {
  try {
    await upsertPlan(sb, userId, markerKind, 'user', { ...facts, at: new Date().toISOString() });
  } catch { /* the rotation degrades to unordered, never fails the sweep */ }
}
