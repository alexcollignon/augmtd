// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE OWNER ≠ THE CREATOR (processes arc Phase B2 — docs/processes-plan.md, THE PEOPLE SLICE).
//
// THE SPLIT LAW: execution identity stays the CREATOR (`workflows.user_id` — whose mailbox, AI
// tier, coworkers and connections every run uses; moving that is never on the table). OWNER is the
// ACCOUNTABILITY layer: who carries the standing binding's debt on their deck, whose approval a
// park defaults to, whose room hears the process speak, and whose name attribution says.
//
// STORE (build decision, Aug 19 — no migration): `item_plans` kind='workflow_owner'
// entity_id=<workflowId>, tasks={ownerUserId, ownerName, by, at} — the `workflow_scope` precedent.
// The row is keyed under the CREATOR's user_id so one workflow has exactly ONE owner row under the
// (user_id, kind, entity_id) unique key, whoever the owner currently is. ABSENT = the creator owns
// (no backfill, no migration; promotable to a column if the read gets hot).
//
// LAWS HELD HERE:
//   • AN ACCOUNTABILITY TRANSFER IS NEVER SILENT — a change narrates into the standing room (both
//     sides: the room that is losing it and the room that is gaining it) and logs to the ledger.
//   • THE CREATOR KEEPS OWNER RIGHTS — execution identity retains control of its own runs; the
//     accountability owner GAINS them. `canResumeRun` reads "creator OR owner", never "owner only".
//   • THE DISMISSAL STICKS across a move (see syncStandingCommitment): the old row closes honestly
//     ('ownership moved'), a dismissed row is never resurrected.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';

export const OWNER_KIND = 'workflow_owner';

export interface WorkflowOwner {
  userId: string;
  name: string | null;
  /** false = the creator owns by default (no stored row) — the absence IS the answer. */
  explicit: boolean;
}

type OwnerRow = { ownerUserId?: string; ownerName?: string | null; by?: string; at?: string };

/** WHO IS ACCOUNTABLE for this workflow. Absent store → the creator, marked non-explicit.
 *  Never throws: a store read that fails must degrade to the creator, never break a run. */
export async function ownerOf(
  admin: SupabaseClient, workflowId: string, creatorUserId: string,
): Promise<WorkflowOwner> {
  try {
    const { data } = await admin.from('item_plans').select('tasks')
      .eq('user_id', creatorUserId).eq('kind', OWNER_KIND).eq('entity_id', workflowId)
      .maybeSingle();
    const t = (data?.tasks ?? null) as OwnerRow | null;
    if (t?.ownerUserId) {
      return { userId: t.ownerUserId, name: t.ownerName ?? null, explicit: true };
    }
  } catch { /* the creator owns until the store says otherwise */ }
  return { userId: creatorUserId, name: null, explicit: false };
}

/** The batch read (one query for a whole ledger). Keyed by workflow id; every requested workflow
 *  gets an entry, falling back to its creator. */
export async function ownersFor(
  admin: SupabaseClient, workflows: Array<{ id: string; user_id: string }>,
): Promise<Map<string, WorkflowOwner>> {
  const out = new Map<string, WorkflowOwner>();
  for (const w of workflows) out.set(w.id, { userId: w.user_id, name: null, explicit: false });
  const ids = workflows.map((w) => w.id);
  if (!ids.length) return out;
  try {
    const { data } = await admin.from('item_plans').select('entity_id, tasks')
      .eq('kind', OWNER_KIND).in('entity_id', ids).limit(ids.length * 2);
    for (const r of (data ?? []) as Array<{ entity_id: string; tasks: OwnerRow | null }>) {
      const t = r.tasks;
      if (!t?.ownerUserId || !out.has(r.entity_id)) continue;
      out.set(r.entity_id, { userId: t.ownerUserId, name: t.ownerName ?? null, explicit: true });
    }
  } catch { /* every workflow already carries its creator-fallback */ }
  return out;
}

/** The open standing commitment for a workflow — resolved against its OWNER (the debt moved with
 *  the accountability). Shared by every narration door in standing.ts / handoffs.ts, so a single
 *  ownership change re-points all of them at once. */
export async function openStandingCommitment(
  admin: SupabaseClient, wf: { id: string; user_id: string },
): Promise<{ id: string; userId: string } | null> {
  try {
    const owner = await ownerOf(admin, wf.id, wf.user_id);
    const { data } = await admin.from('commitments').select('id')
      .eq('user_id', owner.userId).eq('source', 'workflow').eq('source_id', wf.id)
      .eq('status', 'open').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!data?.id) return null;
    return { id: String(data.id), userId: owner.userId };
  } catch { return null; }
}

/** Narrate into the standing room of ONE user (the room the standing commitment lives in).
 *  Best-effort — the run status is always the truth; a narration never gates a decision. */
export async function narrateInStandingRoomOf(
  admin: SupabaseClient, userId: string, workflowId: string, text: string, dedupeKey: string,
): Promise<void> {
  try {
    const { data: c } = await admin.from('commitments').select('id')
      .eq('user_id', userId).eq('source', 'workflow').eq('source_id', workflowId)
      .eq('status', 'open').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!c?.id) return;
    const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
    const roomKey = await roomKeyForItem(admin, userId, 'commitment', String(c.id));
    await writeRoomTurn(admin, userId, roomKey, { role: 'system', text, dedupeKey });
  } catch { /* narration is a surface */ }
}

/** THE RUN ROOM (B2 rider): every process gets a spoken decision trail even with NO standing
 *  binding — the `run:<runId>` loose room is the designated home (no second room). */
export async function narrateInRunRoom(
  admin: SupabaseClient, userId: string, runId: string, text: string, dedupeKey: string,
): Promise<void> {
  try {
    const { writeRoomTurn } = await import('@/lib/room/turns');
    await writeRoomTurn(admin, userId, `run:${runId}`, { role: 'system', text, dedupeKey });
  } catch { /* the run row carries the decision */ }
}

async function displayNameOf(admin: SupabaseClient, userId: string, fallback: string): Promise<string> {
  try {
    const { data } = await admin.from('profiles').select('full_name, email').eq('id', userId).maybeSingle();
    const row = data as { full_name?: string | null; email?: string | null } | null;
    const full = String(row?.full_name ?? '').trim();
    if (full) return full;
    const local = String(row?.email ?? '').split('@')[0].trim();
    return local || fallback;
  } catch { return fallback; }
}

/** THE OWNERSHIP TRANSFER. Writes the store, MOVES the standing debt (via the convergent
 *  syncStandingCommitment door, so the deck is correct immediately rather than within the hour),
 *  narrates BOTH rooms, and logs. Every limb after the store write is best-effort. */
export async function setWorkflowOwner(
  admin: SupabaseClient,
  args: {
    workflowId: string; creatorUserId: string; byUserId: string;
    newOwnerUserId: string; newOwnerName?: string | null;
  },
): Promise<{ ok: true; owner: WorkflowOwner } | { ok: false; error: string }> {
  const { workflowId, creatorUserId, byUserId, newOwnerUserId } = args;
  try {
    const prev = await ownerOf(admin, workflowId, creatorUserId);
    if (prev.userId === newOwnerUserId) return { ok: false, error: 'they already own this' };

    const { data: wfRow } = await admin.from('workflows')
      .select('id, user_id, name, status, trigger, next_run_at, agent_id')
      .eq('id', workflowId).maybeSingle();
    const wfName = String((wfRow as { name?: string } | null)?.name ?? 'this workflow');

    const newName = (args.newOwnerName ?? '').trim() || await displayNameOf(admin, newOwnerUserId, 'a teammate');
    const prevName = prev.name?.trim() || await displayNameOf(admin, prev.userId, 'the previous owner');

    const nowIso = new Date().toISOString();
    const { error: upErr } = await admin.from('item_plans').upsert({
      user_id: creatorUserId, kind: OWNER_KIND, entity_id: workflowId,
      tasks: { ownerUserId: newOwnerUserId, ownerName: newName, by: byUserId, at: nowIso },
      updated_at: nowIso,
    }, { onConflict: 'user_id,kind,entity_id' });
    if (upErr) return { ok: false, error: 'the owner change could not be saved' };

    // (1) The room that is LOSING it hears first — while its standing row still exists.
    await narrateInStandingRoomOf(
      admin, prev.userId, workflowId,
      `Ownership of "${wfName}" moved to ${newName}. The runs still happen here; the accountability doesn't.`,
      `owner-changed:${workflowId}:${nowIso.slice(0, 10)}`,
    );

    // (2) THE DEBT FOLLOWS THE OWNER — the convergent door moves the open standing row (and the
    //     dismissal-sticks law rides inside it).
    if (wfRow) {
      try {
        const { syncStandingCommitment } = await import('./standing');
        await syncStandingCommitment(admin, wfRow as Parameters<typeof syncStandingCommitment>[1]);
      } catch { /* the hourly convergent door heals it */ }
    }

    // (3) The room that is GAINING it (the row exists only after the move).
    await narrateInStandingRoomOf(
      admin, newOwnerUserId, workflowId,
      `You now own "${wfName}" — ${prevName} handed the accountability over. It runs on their setup; the decisions are yours.`,
      `owner-received:${workflowId}:${nowIso.slice(0, 10)}`,
    );

    try {
      const { logActivity } = await import('@/lib/activity/log');
      await logActivity(admin, creatorUserId, {
        type: 'workflow_owner_changed',
        title: `Ownership of "${wfName}" moved to ${newName}`,
        entityType: 'workflow', entityId: workflowId,
        metadata: { workflowId, from: prev.userId, to: newOwnerUserId, by: byUserId },
      });
    } catch { /* the ledger is a receipt, never a gate */ }

    return { ok: true, owner: { userId: newOwnerUserId, name: newName, explicit: true } };
  } catch {
    return { ok: false, error: 'the owner change failed' };
  }
}
