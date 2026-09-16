// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CoS SEAT (docs/threads-plan.md — the identity law; RATIFIED Sep 6)
//
// The chief of staff is a SEAT on the worker registry, not a hardcoded name. Every engine voice —
// the pinned brief, the attention card, deltas, narration — binds to whoever holds the seat, so a
// workspace with a custom or re-branded roster reseats without code (the agnostic doctrine), and
// the voice is NEVER faceless: a missing seat-holder reseats deterministically.
//
// Resolution ladder (deterministic, zero AI):
//   1. an explicit seat stamp (item_plans kind 'cos_seat' → { agent_id }) — the future
//      workspace/superadmin control; nothing writes it yet, but the door exists so reseating is
//      a data change, not a release;
//   2. the personal_assistant worker (Clara — the default holder, owner-ratified);
//   3. the oldest active worker (a roster can lose Clara; it cannot lose the seat).
//
// ONE resolver. Rendering the CoS face/name/label anywhere else than through this module forks
// the identity — the same class as a second address producer.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { ROLE_AVATARS, ROLE_LABELS } from './roles';

export type CosSeat = {
  agentId: string;
  name: string;
  workerRole: string;
  /** The spoken seat label — constant regardless of who holds the seat. */
  seatLabel: 'chief of staff';
  avatar: string | null;
  roleLabel: string | null;
};

type WorkerRow = { id: string; name: string | null; worker_role: string | null; created_at: string };

function toSeat(w: WorkerRow): CosSeat {
  const role = w.worker_role ?? '';
  return {
    agentId: w.id,
    name: w.name || 'Your assistant',
    workerRole: role,
    seatLabel: 'chief of staff',
    avatar: ROLE_AVATARS[role] ?? null,
    roleLabel: ROLE_LABELS[role] ?? null,
  };
}

/** Resolve the user's CoS seat-holder. Never null while the user has ANY active worker; null only
 *  on a worker-less account (pre-seed) — callers render nothing rather than a faceless voice. */
export async function resolveCosSeat(client: SupabaseClient, userId: string): Promise<CosSeat | null> {
  const { data: workers } = await client
    .from('custom_agents')
    .select('id, name, worker_role, created_at')
    .eq('user_id', userId)
    .eq('is_worker', true)
    .eq('is_active', true)
    .order('created_at', { ascending: true });
  const roster = (workers ?? []) as WorkerRow[];
  if (roster.length === 0) return null;

  // 1 · the explicit stamp (must point at a live roster member, else it's ignored — a stale stamp
  //     must not resurrect a deactivated worker's face). Payload rides the `tasks` jsonb — the
  //     item_plans convention (the silent-column trap: `plan` does not exist on this table).
  //     A future writer upserts { user_id, kind: 'cos_seat', entity_id: 'seat', tasks: { agent_id } }.
  const { data: stampRows } = await client
    .from('item_plans')
    .select('tasks')
    .eq('user_id', userId)
    .eq('kind', 'cos_seat')
    .limit(1);
  const stampedId = ((stampRows?.[0]?.tasks ?? null) as { agent_id?: string } | null)?.agent_id;
  if (stampedId) {
    const stamped = roster.find((w) => w.id === stampedId);
    if (stamped) return toSeat(stamped);
  }

  // 2 · the default holder.
  const pa = roster.find((w) => w.worker_role === 'personal_assistant');
  if (pa) return toSeat(pa);

  // 3 · the seat cannot be empty while a roster exists.
  return toSeat(roster[0]);
}
