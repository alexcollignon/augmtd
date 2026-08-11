// ════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠️ PARKED (owner call, Aug 11 — THE HUMAN-IN-THE-LOOP LAW): "it's dangerous territory to have
// stuff done without human approval — I don't want us to be that yet." NOTHING references this
// module: the pass wiring, the Home ask, the Settings tab, and the API route were all removed
// the same day they were built (design + 10/10 decision-layer E2E recorded in plan entry UU).
// The outcome log keeps collecting (R1, collect-only, as before). Re-activating is a deliberate
// owner decision — never re-wire this from a refactor. The park is gate-enforced (AU1).
// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE AUTONOMY LEDGER (designed Aug 11 — earned, visible, revocable trust). The outcome log
// (proactive-team R1) has been collecting every prepared artifact's fate since July; this module
// was built to SPEND it:
//   • EVIDENCE — read the user's own behavior per action class ("you sent N prepared replies
//     unchanged"). Autonomous sends NEVER feed their own evidence (no feedback loop).
//   • THE STRATEGIC ASK — when evidence crosses the bar and nothing was granted or declined,
//     the Home asks ONCE, with the because. A decline STICKS (the correction law).
//   • THE GRANT — stored with its evidence snapshot; every grant is visible and revocable in
//     Settings → Autonomy; every autonomous act narrates with its because and lands in Activity.
// Storage: item_plans kind='autonomy' entity_id='ledger' (the zero-migration room-scope pattern).
// v1 ships ONE class — routine_replies — the shape scales by adding a class row.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';

export type AutonomyClass = 'routine_replies';

export type AutonomyGrant = {
  granted_at?: string | null;
  revoked_at?: string | null;
  declined_at?: string | null;
  /** The evidence snapshot the grant/ask was based on — shown in Settings, honest forever. */
  evidence?: { accepted: number; total: number; window_days: number };
};
export type AutonomyLedger = { grants: Partial<Record<AutonomyClass, AutonomyGrant>> };

export const AUTONOMY_CLASSES: Array<{ id: AutonomyClass; label: string; detail: string; bar: string }> = [
  {
    id: 'routine_replies',
    label: 'Send routine replies',
    detail: 'Prepared replies to people you already correspond with, sent without waiting for your approval. Every send is narrated in the item’s room and listed in Activity; hard-capped per day.',
    bar: '5 prepared replies sent unchanged, with a 70% acceptance rate',
  },
];

// The evidence bar (v1): ≥5 accepted-unchanged sends and ≥70% acceptance across outcomes.
export const EVIDENCE_MIN_ACCEPTED = 5;
export const EVIDENCE_MIN_RATE = 0.7;
export const EVIDENCE_WINDOW_DAYS = 60;
export const DAILY_SEND_CAP = 3;

const KIND = 'autonomy';
const ROW = 'ledger';

export async function readLedger(client: SupabaseClient, userId: string): Promise<AutonomyLedger> {
  try {
    const { data } = await client.from('item_plans').select('tasks')
      .eq('user_id', userId).eq('kind', KIND).eq('entity_id', ROW).maybeSingle();
    const t = (data?.tasks ?? {}) as { grants?: AutonomyLedger['grants'] };
    return { grants: t.grants ?? {} };
  } catch { return { grants: {} }; }
}

async function writeLedger(client: SupabaseClient, userId: string, ledger: AutonomyLedger): Promise<void> {
  await client.from('item_plans').upsert({
    user_id: userId, kind: KIND, entity_id: ROW, tasks: ledger as never, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,kind,entity_id' });
}

export function isGranted(ledger: AutonomyLedger, cls: AutonomyClass): boolean {
  const g = ledger.grants[cls];
  return !!g?.granted_at && !g.revoked_at;
}

/** The outcome-log read: how the user has ACTUALLY treated prepared replies. Autonomous sends
 *  are excluded by construction (they log activity, never prepared_* outcomes). */
export async function computeEvidence(client: SupabaseClient, userId: string, cls: AutonomyClass):
  Promise<{ accepted: number; edited: number; discarded: number; total: number; rate: number; eligible: boolean }> {
  void cls; // v1: one class, one artifact kind
  const since = new Date(Date.now() - EVIDENCE_WINDOW_DAYS * 86_400_000).toISOString();
  const { data } = await client.from('learning_signals')
    .select('signal_data')
    .eq('user_id', userId).eq('signal_type', 'action_taken')
    .gte('created_at', since).limit(500);
  let accepted = 0, edited = 0, discarded = 0;
  for (const r of (data ?? []) as Array<{ signal_data: { action?: string; artifact?: string } }>) {
    const d = r.signal_data ?? {};
    if (d.artifact !== 'reply_draft') continue;
    if (d.action === 'prepared_accepted') accepted++;
    else if (d.action === 'prepared_edited') edited++;
    else if (d.action === 'prepared_discarded') discarded++;
  }
  const total = accepted + edited + discarded;
  const rate = total ? accepted / total : 0;
  return { accepted, edited, discarded, total, rate, eligible: accepted >= EVIDENCE_MIN_ACCEPTED && rate >= EVIDENCE_MIN_RATE };
}

/** THE STRATEGIC ASK gate: evidence met, nothing granted, nothing declined — ask ONCE. */
export async function pendingAsk(client: SupabaseClient, userId: string):
  Promise<{ class: AutonomyClass; accepted: number; rate: number } | null> {
  const ledger = await readLedger(client, userId);
  const g = ledger.grants.routine_replies;
  if (g?.granted_at || g?.declined_at) return null;
  const ev = await computeEvidence(client, userId, 'routine_replies');
  return ev.eligible ? { class: 'routine_replies', accepted: ev.accepted, rate: Math.round(ev.rate * 100) / 100 } : null;
}

export async function grantAutonomy(client: SupabaseClient, userId: string, cls: AutonomyClass): Promise<void> {
  const ledger = await readLedger(client, userId);
  const ev = await computeEvidence(client, userId, cls);
  ledger.grants[cls] = {
    granted_at: new Date().toISOString(), revoked_at: null, declined_at: null,
    evidence: { accepted: ev.accepted, total: ev.total, window_days: EVIDENCE_WINDOW_DAYS },
  };
  await writeLedger(client, userId, ledger);
  try {
    const { logActivity } = await import('@/lib/activity/log');
    await logActivity(client, userId, {
      type: 'autonomy_granted', title: 'Autonomy granted: send routine replies',
      entityType: 'autonomy', entityId: cls, metadata: { evidence: ledger.grants[cls]!.evidence },
    });
  } catch { /* the grant itself is the record */ }
}

export async function declineAutonomy(client: SupabaseClient, userId: string, cls: AutonomyClass): Promise<void> {
  const ledger = await readLedger(client, userId);
  ledger.grants[cls] = { ...(ledger.grants[cls] ?? {}), declined_at: new Date().toISOString(), granted_at: null, revoked_at: null };
  await writeLedger(client, userId, ledger);
}

export async function revokeAutonomy(client: SupabaseClient, userId: string, cls: AutonomyClass): Promise<void> {
  const ledger = await readLedger(client, userId);
  const g = ledger.grants[cls];
  if (!g?.granted_at) return;
  ledger.grants[cls] = { ...g, revoked_at: new Date().toISOString() };
  await writeLedger(client, userId, ledger);
  try {
    const { logActivity } = await import('@/lib/activity/log');
    await logActivity(client, userId, {
      type: 'autonomy_revoked', title: 'Autonomy revoked: send routine replies',
      entityType: 'autonomy', entityId: cls,
    });
  } catch { /* revocation is in the ledger regardless */ }
}
