// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PENDING-CHANGE STORE (stabilization W0.3b — HUMAN IN THE LOOP for state changes)
//
// Three verbs, one row shape:
//   prepareChange  a tool-bearing lane STORES what it would have done — tool + args + the summary
//                  CODE composed — and hands back the card spec + the model-facing sentence.
//                  It NEVER calls an executor. (The gate reads this function's body to prove it.)
//   applyChange    the ONE door's core: ownership re-checked, the row must still be pending and
//                  unexpired, the commit door claims `pending_change:<id>` (exactly-once), and THEN
//                  the SAME executor the tool would have used runs with the SAME arguments. The
//                  executor's own sentence is the result; the row settles as `applied`.
//   dismissChange  the quiet way out; the row settles as `dismissed`, nothing ran.
//
// STORAGE: `item_plans` kind `pending_change` — the frame_share / workflow_owner / dm_present
// precedent (no migration; typed stores arrive in W2.6). `entity_id` = the change id; `tasks`
// holds the one record. RLS is owner-only, and every read here is ALSO user-scoped explicitly, so a
// stranger's id and a missing one answer identically (not-yours is indistinguishable from not-there).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { confirmClassOf, describeChange, type ChangeFacts } from '@/lib/work/confirm-policy';
import {
  CHANGE_TTL_MS, changeToolResult, type ChangeLane, type ChangeSpec, type ChangeStatus,
} from '@/lib/present/change';
import { claimCommit, recordCommitResult, releaseCommitClaim } from '@/lib/work/commit-door';
import { logActivity } from '@/lib/activity/log';
import { insertPlan, readPlan, readPlans, updatePlan } from '@/lib/store/item-plans';

export const PENDING_CHANGE_KIND = 'pending_change';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** The stored record — the spec plus what the apply path needs and the card never sees. */
export type ChangeRecord = ChangeSpec & {
  args: Record<string, unknown>;
  /** The coworker whose lane prepared it (the executor's scope for by-agent tools). */
  agentId?: string | null;
  /** The DM thread / room it was prepared in, for the record. */
  threadId?: string | null;
  roomKey?: string | null;
  createdAt: string;
  appliedAt?: string | null;
  dismissedAt?: string | null;
};

const isRecord = (v: unknown): v is ChangeRecord => {
  const r = v as ChangeRecord | null;
  return !!r && typeof r === 'object' && typeof r.id === 'string' && typeof r.tool === 'string'
    && typeof r.summary === 'string' && r.args !== null && typeof r.args === 'object';
};

/** The spec is the record minus what the card must never see. Status is re-derived against the
 *  clock so a row nobody touched still reads `expired` after its TTL. */
export function specOf(rec: ChangeRecord, now = Date.now()): ChangeSpec {
  const expired = rec.status === 'pending' && Date.parse(rec.expiresAt) < now;
  return {
    id: rec.id, tool: rec.tool, summary: rec.summary, lines: rec.lines, lane: rec.lane,
    ...(rec.preparedBy ? { preparedBy: rec.preparedBy } : {}),
    status: expired ? 'expired' : rec.status,
    expiresAt: rec.expiresAt,
    ...(rec.result ? { result: rec.result } : {}),
  };
}

// ─── FACTS FOR THE SUMMARY (read-only lookups — the sentence names what the row names) ──────────

async function factsFor(
  admin: Admin, userId: string, tool: string, args: Record<string, unknown>, agentId?: string | null,
): Promise<ChangeFacts> {
  try {
    if (tool === 'slack_post_message') {
      // A READ of the channel's name (the card says "#general", not "C0123ABCD"). Never a write.
      const { slackChannelDisplayName } = await import('@/lib/tools/slack');
      return { channelName: await slackChannelDisplayName(admin, userId, agentId ?? undefined, String(args.channel ?? '')) };
    }
    if (tool === 'update_task' || tool === 'delete_task' || tool === 'share_task' || tool === 'run_task') {
      const { data } = await admin.from('workflows').select('name').eq('id', String(args.task_id ?? '')).eq('user_id', userId).maybeSingle();
      return { taskName: (data?.name as string) ?? null };
    }
    if (tool === 'steer_standing_task') {
      const { data: c } = await admin.from('commitments').select('source, source_id').eq('id', String(args.commitmentId ?? '')).eq('user_id', userId).maybeSingle();
      if (!c || c.source !== 'workflow' || !c.source_id) return {};
      const { data: wf } = await admin.from('workflows').select('name').eq('id', c.source_id).eq('user_id', userId).maybeSingle();
      return { taskName: (wf?.name as string) ?? null };
    }
    if (tool === 'remember_fact') {
      let entityId = typeof args.entityId === 'string' ? args.entityId : null;
      if (!entityId && typeof args.linkKind === 'string' && typeof args.itemId === 'string') {
        const { data: link } = await admin.from('entity_links').select('entity_id')
          .eq('user_id', userId).eq('item_kind', args.linkKind).eq('item_id', args.itemId).not('entity_id', 'is', null).maybeSingle();
        entityId = (link?.entity_id as string) ?? null;
      }
      if (!entityId) return {};
      const { data: ent } = await admin.from('work_entities').select('name').eq('id', entityId).eq('user_id', userId).maybeSingle();
      return { entityName: (ent?.name as string) ?? null };
    }
  } catch { /* a missing fact leaves a generic noun in the sentence; it never blocks the card */ }
  return {};
}

// ─── PREPARE ─────────────────────────────────────────────────────────────────────────────────────

export type PrepareInput = {
  tool: string;
  args: Record<string, unknown>;
  lane: ChangeLane;
  agentId?: string | null;
  preparedBy?: string | null;
  threadId?: string | null;
  roomKey?: string | null;
};

/**
 * Store what the lane would have done. Returns the spec for the card and the sentence for the
 * model. Refuses (null) when the tool is not class A — a lane must never park a change the policy
 * says may simply apply; that would be a second, silent decision table.
 */
export async function prepareChange(
  admin: Admin, userId: string, input: PrepareInput,
): Promise<{ spec: ChangeSpec; modelText: string } | null> {
  if (confirmClassOf(input.tool, input.args) !== 'confirm') return null;
  const facts = await factsFor(admin, userId, input.tool, input.args, input.agentId);
  const { summary, lines } = describeChange(input.tool, input.args, facts);
  const now = new Date();
  const rec: ChangeRecord = {
    id: crypto.randomUUID(),
    tool: input.tool, summary, lines, lane: input.lane,
    ...(input.preparedBy ? { preparedBy: input.preparedBy } : {}),
    status: 'pending',
    expiresAt: new Date(now.getTime() + CHANGE_TTL_MS).toISOString(),
    args: input.args,
    agentId: input.agentId ?? null, threadId: input.threadId ?? null, roomKey: input.roomKey ?? null,
    createdAt: now.toISOString(),
  };
  const { error } = await insertPlan(admin, userId, 'pending_change', rec.id, rec);
  if (error) { console.error('[pending-change] prepare failed', error); return null; }
  const spec = specOf(rec, now.getTime());
  return { spec, modelText: changeToolResult(spec) };
}

// ─── THE BOX LANE'S PREPARE (shared by the AgentOS internal routes) ──────────────────────────────
// Both internal routes (tasks · tools) prepare class-A changes the same way: lane `agentos_dm`, the
// coworker's first name on the meta line, the card handed back for the presentation side-channel.
// ONE helper so the two routes cannot drift.

/** The coworker's first name for the card's meta line — a read, never a guess. */
export async function agentFirstName(admin: Admin, agentId: string): Promise<string | null> {
  try {
    const { data } = await admin.from('custom_agents').select('name').eq('id', agentId).maybeSingle();
    const name = String((data as { name?: string } | null)?.name ?? '').trim();
    return name ? name.split(' ')[0] : null;
  } catch { return null; }
}

export async function prepareBoxChange(
  admin: Admin, userId: string,
  input: { tool: string; args: Record<string, unknown>; agentId?: string | null; threadId?: string | null },
): Promise<{ modelText: string; spec: ChangeSpec | null }> {
  const out = await prepareChange(admin, userId, {
    tool: input.tool, args: input.args, lane: 'agentos_dm',
    agentId: input.agentId ?? null, threadId: input.threadId || null,
    preparedBy: input.agentId ? await agentFirstName(admin, input.agentId) : null,
  });
  if (!out) return { modelText: 'That change could not be prepared — nothing was changed. Ask the user to try again.', spec: null };
  return { modelText: out.modelText, spec: out.spec };
}

// ─── READ ────────────────────────────────────────────────────────────────────────────────────────

export async function readChange(admin: Admin, userId: string, id: string): Promise<ChangeRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rec: unknown = (await readPlan(admin, userId, 'pending_change', id))?.tasks;
  return isRecord(rec) ? rec : null;
}

/** The user's live pending changes, newest first — for a surface that lists what awaits a click. */
export async function listPendingChanges(admin: Admin, userId: string, limit = 20): Promise<ChangeSpec[]> {
  const data = await readPlans(admin, userId, 'pending_change', {
    order: { by: 'created_at', ascending: false }, limit: Math.max(1, Math.min(100, limit)),
  });
  const now = Date.now();
  return data
    .map((r): unknown => r.tasks).filter(isRecord)
    .map((r) => specOf(r, now))
    .filter((s) => s.status === 'pending');
}

async function settle(admin: Admin, userId: string, rec: ChangeRecord, patch: Partial<ChangeRecord>): Promise<void> {
  const next = { ...rec, ...patch };
  await updatePlan(admin, userId, 'pending_change', rec.id, next);
}

// ─── APPLY (the door's core) ─────────────────────────────────────────────────────────────────────

export type ApplyOutcome =
  | { status: 'applied'; ok: boolean; result: string; spec: ChangeSpec }
  | { status: 'duplicate'; result: string | null; spec: ChangeSpec }
  | { status: 'not_pending' | 'expired'; spec: ChangeSpec }
  | { status: 'not_found' }
  | { status: 'failed'; reason: string; spec: ChangeSpec };

/** Did the executor's own sentence report a landed change? The same observed-outcome regexes the
 *  chat route reads — never a guess from the absence of an error. */
export function executorOk(tool: string, result: string): boolean {
  switch (tool) {
    case 'update_task': return !/^Failed |^Nothing to update|^Step "|^Task not found/.test(result);
    case 'delete_task': return /permanently deleted/.test(result);
    case 'share_task': return /is now shared|is now private/.test(result);
    case 'run_task': return /is now running|is already running/.test(result);
    // The executor's own success sentences: "Posted to Slack …" / "Replied in thread on Slack …" /
    // "Sent you a Slack DM." — anything else (off, not connected, Slack refused) posted nothing.
    case 'slack_post_message': return /^(Posted to Slack|Replied in thread on Slack|Sent you a Slack DM)/.test(result);
    default: return true;
  }
}

/**
 * THE SAME EXECUTOR, THE SAME ARGUMENTS. The dispatch table is the only place a pending change can
 * become real, and it is reachable ONLY through `applyChange` (which is reachable only through the
 * apply route). Adding a class-A tool = one row here + one row in the policy.
 */
async function runExecutor(admin: Admin, userId: string, rec: ChangeRecord): Promise<{ ok: boolean; result: string }> {
  const a = rec.args;
  switch (rec.tool) {
    case 'update_task': {
      const { executeUpdateTask } = await import('@/lib/tools/worker-tasks');
      const { task_id: _tid, ...fields } = a as { task_id?: string } & Record<string, unknown>;
      void _tid;
      const result = await executeUpdateTask(String(a.task_id ?? ''), fields as never, userId, admin);
      return { ok: executorOk(rec.tool, result), result };
    }
    case 'delete_task': {
      const { executeDeleteTask } = await import('@/lib/tools/worker-tasks');
      const result = await executeDeleteTask(String(a.task_id ?? ''), userId, admin);
      return { ok: executorOk(rec.tool, result), result };
    }
    case 'share_task': {
      const { executeShareTask } = await import('@/lib/tools/worker-tasks');
      const result = await executeShareTask(String(a.task_id ?? ''), a.action === 'unshare' ? 'unshare' : 'share', userId, admin);
      return { ok: executorOk(rec.tool, result), result };
    }
    case 'run_task': {
      const { executeRunTask } = await import('@/lib/tools/worker-tasks');
      const result = await executeRunTask(String(a.task_id ?? ''), userId, admin, rec.threadId ?? undefined);
      return { ok: executorOk(rec.tool, result), result };
    }
    case 'steer_standing_task': {
      const { executeSteerStandingTask } = await import('@/lib/workflows/standing');
      const r = await executeSteerStandingTask(admin as SupabaseClient, userId, {
        commitmentId: String(a.commitmentId ?? ''), instruction: String(a.instruction ?? ''),
      });
      return r.ok
        ? { ok: true, result: `Baked in — "${r.taskName}" carries that from the next run on.` }
        : { ok: false, result: `I couldn't apply that — ${r.error}.` };
    }
    case 'remember_fact': {
      const { executeRememberFact } = await import('@/lib/tools/item-actions');
      const r = await executeRememberFact({ client: admin as SupabaseClient, userId }, {
        fact: String(a.fact ?? ''),
        ...(typeof a.entityId === 'string' ? { entityId: a.entityId } : {}),
        ...(typeof a.linkKind === 'string' ? { linkKind: a.linkKind as 'inbox_item' | 'commitment' | 'meeting' } : {}),
        ...(typeof a.itemId === 'string' ? { itemId: a.itemId } : {}),
      });
      return r.ok
        ? { ok: true, result: `Noted${r.entityName ? ` on ${r.entityName}` : ''} — future drafts will respect it.` }
        : { ok: false, result: "This isn't tied to a project I can remember that on." };
    }
    case 'slack_post_message': {
      // THE SAME EXECUTOR the tool used, with the STORED args (target already resolved at prepare),
      // under the preparing coworker's own Slack app — so the attribution context block ("Sam's
      // Chief of Staff") is the one the direct post would have carried.
      const { executeSlackPostMessage } = await import('@/lib/tools/slack');
      const result = await executeSlackPostMessage({
        channel: String(a.channel ?? ''), text: String(a.text ?? ''),
        ...(typeof a.thread_ts === 'string' && a.thread_ts ? { thread_ts: a.thread_ts } : {}),
      }, userId, rec.agentId ?? undefined, admin);
      return { ok: executorOk(rec.tool, result), result };
    }
    default:
      return { ok: false, result: 'This change has no executor — nothing was applied.' };
  }
}

export async function applyChange(admin: Admin, userId: string, id: string): Promise<ApplyOutcome> {
  const rec = await readChange(admin, userId, id);
  if (!rec) return { status: 'not_found' };
  const spec = specOf(rec);
  if (spec.status === 'expired') return { status: 'expired', spec };
  if (spec.status !== 'pending') return { status: 'not_pending', spec };

  // EXACTLY-ONCE: the claim precedes the executor. A double-click serves the first result.
  const idempotencyKey = `pending_change:${rec.id}`;
  const claim = await claimCommit(admin as SupabaseClient, userId, {
    idempotencyKey, actionType: `change_${rec.tool}`,
    payload: { changeId: rec.id, tool: rec.tool, summary: rec.summary, args: rec.args },
  });
  if (claim.status === 'duplicate') return { status: 'duplicate', result: claim.priorResult, spec };

  let out: { ok: boolean; result: string };
  try {
    out = await runExecutor(admin, userId, rec);
  } catch (err) {
    console.error('[pending-change] executor threw', err);
    await releaseCommitClaim(admin as SupabaseClient, userId, idempotencyKey);
    return { status: 'failed', reason: "That didn't go through — nothing was changed. Try again.", spec };
  }
  if (!out.ok) {
    // The executor SAID nothing moved: release the claim so a retry can fire, keep the card open.
    await releaseCommitClaim(admin as SupabaseClient, userId, idempotencyKey);
    return { status: 'failed', reason: out.result, spec };
  }
  await recordCommitResult(admin as SupabaseClient, userId, idempotencyKey, out.result);
  const appliedAt = new Date().toISOString();
  await settle(admin, userId, rec, { status: 'applied' as ChangeStatus, result: out.result, appliedAt });
  // SETTLEMENT IS LOGGED (invariant 1's second clause). Not marked undoable: none of these executors
  // is in lib/activity/restore.ts's map, and a restore button that cannot restore is a standing lie.
  await logActivity(admin as SupabaseClient, userId, {
    type: 'change_applied', title: rec.summary,
    entityType: 'pending_change', entityId: rec.id,
    metadata: { tool: rec.tool, lane: rec.lane, ...(rec.agentId ? { agent_id: rec.agentId } : {}) },
  }).catch(() => {});
  return { status: 'applied', ok: true, result: out.result, spec: specOf({ ...rec, status: 'applied', result: out.result, appliedAt }) };
}

export async function dismissChange(admin: Admin, userId: string, id: string):
  Promise<{ status: 'dismissed' | 'not_pending' | 'not_found'; spec?: ChangeSpec }> {
  const rec = await readChange(admin, userId, id);
  if (!rec) return { status: 'not_found' };
  const spec = specOf(rec);
  if (spec.status !== 'pending') return { status: 'not_pending', spec };
  const dismissedAt = new Date().toISOString();
  await settle(admin, userId, rec, { status: 'dismissed', dismissedAt });
  return { status: 'dismissed', spec: specOf({ ...rec, status: 'dismissed', dismissedAt }) };
}
