import type { SupabaseClient } from '@supabase/supabase-js';

// ─── AI Operations dashboard — v1 metric definitions ──────────────────────────
// There is no real token/cost or task-duration telemetry anywhere in the app yet
// (see lib/ai/factory.ts — aiCreate does not log usage). "Hours saved" / "€ value"
// below are a transparent, documented ESTIMATE — not a measured number — so they
// are always rendered with an "estimated" label in the UI. Replace
// MINUTES_SAVED_PER_RUN with a per-capability estimate once real duration data
// exists; that's a fast-follow, not this v1.

/** Conservative estimate: a completed automation run replaced ~15 minutes of manual work. */
export const MINUTES_SAVED_PER_RUN = 15;

/** Blended hourly rate used to translate hours saved into a € value estimate. */
export const BLENDED_HOURLY_RATE_EUR = 50;

/** Admin-editable range for the rate — sanity bounds, not a real business limit. */
export const MIN_HOURLY_RATE_EUR = 1;
export const MAX_HOURLY_RATE_EUR = 1000;

export type Period = 'week' | 'month' | 'quarter';

const PERIOD_DAYS: Record<Period, number> = { week: 7, month: 30, quarter: 90 };

export function periodRange(period: Period, endingAt: Date = new Date()) {
  const days = PERIOD_DAYS[period];
  const end = endingAt;
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const prevEnd = start;
  const prevStart = new Date(start.getTime() - days * 24 * 60 * 60 * 1000);
  return { start, end, prevStart, prevEnd };
}

interface WorkerAgentRow {
  id: string;
  user_id: string;
  worker_role: string;
  name: string;
  color: string;
  icon: string;
}

export interface AgentWorkRow {
  workerRole: string;
  name: string;
  color: string;
  icon: string;
  runs: number;
  /** Runs whose task did a real lookup/action — the only ones counted toward hoursSaved. */
  groundedRuns: number;
  /** Runs that were pure AI generation (coaching, brainstorming, etc.) — real value, no time-saved claim. */
  insightRuns: number;
  distinctUsers: number;
  emailsSent: number;
  messages: number;
  hoursSaved: number;
  topTasks: { name: string; count: number; hoursSaved: number; grounded: boolean }[];
  topTools: { name: string; count: number }[];
  /** Per-user run counts, sorted high→low. `slot` is an anonymous rank (0, 1, 2…)
   *  assigned per real user_id, consistent ACROSS every coworker's row this
   *  period — so if the same real person is a heavy Clara user AND a heavy Max
   *  user, both bars show the same slot/color, without ever naming them. */
  usageDistribution: { slot: number; count: number }[];
}

export interface AIOperationsSummary {
  memberCount: number;
  agentRuns: number;
  agentRunsPrev: number;
  /** Of agentRuns, how many actually looked something up or took an action —
   *  the basis for hoursSaved. The rest were pure AI generation (insightRuns). */
  groundedRuns: number;
  insightRuns: number;
  activeAgents: number;
  activeAgentsPrev: number;
  adoptionUsers: number;
  adoptionUsersPrev: number;
  hoursSaved: number;
  hoursSavedPrev: number;
  valueEstimateEur: number;
  hourlyRateEur: number;
  agentWork: AgentWorkRow[];
  signals: {
    emails: number;
    meetings: number;
    documents: number;
  };
}

async function getMemberUserIds(admin: SupabaseClient, companyId: string): Promise<string[]> {
  const { data } = await admin
    .from('company_members')
    .select('user_id')
    .eq('company_id', companyId)
    .eq('status', 'active');
  return (data ?? []).map((m: { user_id: string }) => m.user_id);
}

async function getWorkerAgents(admin: SupabaseClient, memberIds: string[]): Promise<WorkerAgentRow[]> {
  if (memberIds.length === 0) return [];
  const { data } = await admin
    .from('custom_agents')
    .select('id, user_id, worker_role, name, color, icon')
    .in('user_id', memberIds)
    .eq('is_worker', true)
    .not('worker_role', 'is', null);
  return (data ?? []) as WorkerAgentRow[];
}

interface WorkflowMeta {
  agentId: string;
  name: string;
  /** Did this task's steps do any real lookup/action (tool or delegated-agent
   *  step), or is it pure `ai` generation (a prompt in, text out — no grounding
   *  in real data)? Only `grounded` runs count toward "hours saved": a coaching
   *  or brainstorming task doesn't have a manual-labor equivalent it replaced,
   *  even though it ran successfully and produced real value. See
   *  MINUTES_SAVED_PER_RUN doc comment. */
  grounded: boolean;
}

interface WorkflowStepRow {
  type?: string;
}

async function getAgentWorkflows(admin: SupabaseClient, agentIds: string[]): Promise<Map<string, WorkflowMeta>> {
  // workflow id -> { agent id, workflow name, grounded }
  const map = new Map<string, WorkflowMeta>();
  if (agentIds.length === 0) return map;
  const { data } = await admin.from('workflows').select('id, agent_id, name, steps').in('agent_id', agentIds);
  (data ?? []).forEach((w: { id: string; agent_id: string; name: string; steps: unknown }) => {
    const steps = Array.isArray(w.steps) ? (w.steps as WorkflowStepRow[]) : [];
    const grounded = steps.some(s => s?.type === 'tool' || s?.type === 'agent');
    map.set(w.id, { agentId: w.agent_id, name: w.name, grounded });
  });
  return map;
}

interface RunCounts {
  totalRuns: number;
  distinctUsers: Set<string>;
  /** agentId -> userId -> run count (per-user, never surfaced with identity — see usageDistribution). */
  byAgentId: Map<string, Map<string, number>>;
  byWorkflowId: Map<string, number>;
}

function sumUserCounts(byUser: Map<string, number> | undefined): number {
  if (!byUser) return 0;
  let total = 0;
  for (const c of byUser.values()) total += c;
  return total;
}

async function countRuns(
  admin: SupabaseClient,
  workflowMeta: Map<string, WorkflowMeta>,
  start: Date,
  end: Date,
): Promise<RunCounts> {
  const result: RunCounts = { totalRuns: 0, distinctUsers: new Set(), byAgentId: new Map(), byWorkflowId: new Map() };
  const workflowIds = Array.from(workflowMeta.keys());
  if (workflowIds.length === 0) return result;

  const { data } = await admin
    .from('workflow_runs')
    .select('workflow_id, user_id')
    .in('workflow_id', workflowIds)
    .eq('status', 'succeeded')
    .gte('created_at', start.toISOString())
    .lt('created_at', end.toISOString());

  for (const row of (data ?? []) as { workflow_id: string; user_id: string }[]) {
    const meta = workflowMeta.get(row.workflow_id);
    if (!meta) continue;
    result.totalRuns += 1;
    result.distinctUsers.add(row.user_id);
    const byUser = result.byAgentId.get(meta.agentId) ?? new Map<string, number>();
    byUser.set(row.user_id, (byUser.get(row.user_id) ?? 0) + 1);
    result.byAgentId.set(meta.agentId, byUser);
    result.byWorkflowId.set(row.workflow_id, (result.byWorkflowId.get(row.workflow_id) ?? 0) + 1);
  }
  return result;
}

interface MessageStats {
  byAgentId: Map<string, { messages: number; toolCounts: Map<string, number> }>;
}

/** Chat usage — separate from scheduled workflow_runs, since a lot of real
 *  usage is ad-hoc chat rather than a formal task. tool_calls[].name is
 *  already persisted per assistant message (work_messages.metadata), so tool
 *  usage needs no new instrumentation. Best-effort: metadata shape can vary
 *  across older messages, so a bad row is skipped rather than failing the page. */
async function countMessagesAndTools(
  admin: SupabaseClient,
  agentIds: string[],
  memberIds: string[],
  start: Date,
  end: Date,
): Promise<MessageStats> {
  const result: MessageStats = { byAgentId: new Map() };
  if (agentIds.length === 0) return result;

  const { data: threads } = await admin
    .from('work_threads')
    .select('id, agent_id')
    .in('agent_id', agentIds)
    .in('user_id', memberIds);
  const threadToAgent = new Map((threads ?? []).map((t: { id: string; agent_id: string }) => [t.id, t.agent_id]));
  const threadIds = Array.from(threadToAgent.keys());
  if (threadIds.length === 0) return result;

  const { data: messages } = await admin
    .from('work_messages')
    .select('thread_id, metadata')
    .in('thread_id', threadIds)
    .eq('role', 'assistant')
    .gte('created_at', start.toISOString())
    .lt('created_at', end.toISOString());

  for (const msg of (messages ?? []) as { thread_id: string; metadata: Record<string, unknown> | null }[]) {
    const agentId = threadToAgent.get(msg.thread_id);
    if (!agentId) continue;
    const bucket = result.byAgentId.get(agentId) ?? { messages: 0, toolCounts: new Map<string, number>() };
    bucket.messages += 1;
    const toolCalls = msg.metadata?.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const call of toolCalls) {
        const name = (call as { name?: string })?.name;
        if (typeof name === 'string' && name.length > 0) {
          bucket.toolCounts.set(name, (bucket.toolCounts.get(name) ?? 0) + 1);
        }
      }
    }
    result.byAgentId.set(agentId, bucket);
  }
  return result;
}

async function countEmailsSent(
  admin: SupabaseClient,
  agentIds: string[],
  start: Date,
  end: Date,
): Promise<Map<string, number>> {
  const byAgent = new Map<string, number>();
  if (agentIds.length === 0) return byAgent;
  const { data } = await admin
    .from('email_sends')
    .select('agent_id')
    .in('agent_id', agentIds)
    .eq('status', 'sent')
    .gte('created_at', start.toISOString())
    .lt('created_at', end.toISOString());
  for (const row of (data ?? []) as { agent_id: string | null }[]) {
    if (!row.agent_id) continue;
    byAgent.set(row.agent_id, (byAgent.get(row.agent_id) ?? 0) + 1);
  }
  return byAgent;
}

async function countSignal(
  admin: SupabaseClient,
  table: string,
  dateColumn: string,
  memberIds: string[],
  start: Date,
  end: Date,
): Promise<number> {
  if (memberIds.length === 0) return 0;
  const { count } = await admin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .in('user_id', memberIds)
    .gte(dateColumn, start.toISOString())
    .lt(dateColumn, end.toISOString());
  return count ?? 0;
}

export async function getAIOperationsSummary(
  admin: SupabaseClient,
  companyId: string,
  period: Period,
  hourlyRateEur: number = BLENDED_HOURLY_RATE_EUR,
): Promise<AIOperationsSummary> {
  const { start, end, prevStart, prevEnd } = periodRange(period);

  const memberIds = await getMemberUserIds(admin, companyId);
  const workerAgents = await getWorkerAgents(admin, memberIds);
  const agentIds = workerAgents.map(a => a.id);
  const workflowMeta = await getAgentWorkflows(admin, agentIds);

  const [current, previous, emailsByAgent, messageStats, signalEmails, signalMeetings, signalDocuments] = await Promise.all([
    countRuns(admin, workflowMeta, start, end),
    countRuns(admin, workflowMeta, prevStart, prevEnd),
    countEmailsSent(admin, agentIds, start, end),
    countMessagesAndTools(admin, agentIds, memberIds, start, end),
    countSignal(admin, 'emails', 'received_at', memberIds, start, end),
    countSignal(admin, 'meeting_transcripts', 'created_at', memberIds, start, end),
    countSignal(admin, 'knowledge_files', 'indexed_at', memberIds, start, end),
  ]);

  // workflow id -> worker_role, so per-role top tasks can be aggregated across
  // every agent (one per user) that shares a role, not just a single agent id.
  const workflowIdToRole = new Map<string, string>();
  const roleByAgentId = new Map(workerAgents.map(a => [a.id, a.worker_role]));
  for (const [workflowId, meta] of workflowMeta) {
    const role = roleByAgentId.get(meta.agentId);
    if (role) workflowIdToRole.set(workflowId, role);
  }

  // Grounded vs insight runs — a property of the TASK's own steps (did it look
  // something up or take an action, vs. pure AI generation), not something we
  // guess per-run. Only grounded runs count toward hoursSaved.
  const groundedRunsByRole = new Map<string, number>();
  let totalGroundedRuns = 0;
  for (const [workflowId, count] of current.byWorkflowId) {
    if (!workflowMeta.get(workflowId)?.grounded) continue;
    totalGroundedRuns += count;
    const role = workflowIdToRole.get(workflowId);
    if (role) groundedRunsByRole.set(role, (groundedRunsByRole.get(role) ?? 0) + count);
  }
  let totalGroundedRunsPrev = 0;
  for (const [workflowId, count] of previous.byWorkflowId) {
    if (workflowMeta.get(workflowId)?.grounded) totalGroundedRunsPrev += count;
  }

  // Anonymous, cross-coworker-consistent user ranking: sum each real user_id's
  // total runs across EVERY coworker (any role), rank descending, assign a slot
  // index. The slot (never the user_id) is what reaches the client, so the
  // same real person's usage correlates visually across different coworkers'
  // bars without ever naming them.
  const totalByUser = new Map<string, number>();
  for (const byUser of current.byAgentId.values()) {
    for (const [userId, count] of byUser) {
      totalByUser.set(userId, (totalByUser.get(userId) ?? 0) + count);
    }
  }
  const slotByUser = new Map(
    Array.from(totalByUser.keys())
      .sort((a, b) => totalByUser.get(b)! - totalByUser.get(a)!)
      .map((userId, i) => [userId, i]),
  );

  const agentWork: AgentWorkRow[] = workerAgents
    .reduce((rows, agent) => {
      let row = rows.find(r => r.workerRole === agent.worker_role);
      if (!row) {
        row = {
          workerRole: agent.worker_role, name: agent.name, color: agent.color, icon: agent.icon,
          runs: 0, groundedRuns: 0, insightRuns: 0, distinctUsers: 0, emailsSent: 0, messages: 0, hoursSaved: 0,
          topTasks: [], topTools: [], usageDistribution: [],
        };
        rows.push(row);
      }
      const byUser = current.byAgentId.get(agent.id);
      if (byUser) {
        row.runs += sumUserCounts(byUser);
        row.distinctUsers += byUser.size;
        for (const [userId, count] of byUser) {
          row.usageDistribution.push({ slot: slotByUser.get(userId) ?? 0, count });
        }
      }
      row.emailsSent += emailsByAgent.get(agent.id) ?? 0;
      row.messages += messageStats.byAgentId.get(agent.id)?.messages ?? 0;
      return rows;
    }, [] as AgentWorkRow[])
    .sort((a, b) => b.runs - a.runs);

  // Top tasks per role: sum run counts by workflow NAME (several agents/users
  // can each own a workflow with the same name — e.g. everyone's default
  // "Vendor Reply" task), then take the top 5 by count. Each name also tracks
  // its grounded-vs-total split so a coaching/insight task shows honestly
  // (no fabricated hours) instead of being lumped in with real automation.
  for (const row of agentWork) {
    row.groundedRuns = groundedRunsByRole.get(row.workerRole) ?? 0;
    row.insightRuns = row.runs - row.groundedRuns;
    row.hoursSaved = Math.round(((row.groundedRuns * MINUTES_SAVED_PER_RUN) / 60) * 10) / 10;

    const countsByName = new Map<string, { count: number; groundedCount: number }>();
    for (const [workflowId, count] of current.byWorkflowId) {
      if (workflowIdToRole.get(workflowId) !== row.workerRole) continue;
      const meta = workflowMeta.get(workflowId);
      const name = meta?.name ?? 'Untitled task';
      const entry = countsByName.get(name) ?? { count: 0, groundedCount: 0 };
      entry.count += count;
      if (meta?.grounded) entry.groundedCount += count;
      countsByName.set(name, entry);
    }
    row.topTasks = Array.from(countsByName, ([name, a]) => ({
      name,
      count: a.count,
      hoursSaved: Math.round(((a.groundedCount * MINUTES_SAVED_PER_RUN) / 60) * 10) / 10,
      grounded: a.groundedCount > 0,
    }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Top tools per role: merge tool_calls tallies across every agent sharing this role.
    const toolCounts = new Map<string, number>();
    for (const agent of workerAgents) {
      if (agent.worker_role !== row.workerRole) continue;
      const bucket = messageStats.byAgentId.get(agent.id);
      if (!bucket) continue;
      for (const [name, count] of bucket.toolCounts) toolCounts.set(name, (toolCounts.get(name) ?? 0) + count);
    }
    row.topTools = Array.from(toolCounts, ([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    row.usageDistribution.sort((a, b) => b.count - a.count);
  }

  const activeAgentRoles = new Set(agentWork.filter(r => r.runs > 0).map(r => r.workerRole));
  const activeAgentRolesPrev = new Set(
    workerAgents.filter(a => sumUserCounts(previous.byAgentId.get(a.id)) > 0).map(a => a.worker_role),
  );

  const hoursSaved = Math.round((totalGroundedRuns * MINUTES_SAVED_PER_RUN) / 60 * 10) / 10;
  const hoursSavedPrev = Math.round((totalGroundedRunsPrev * MINUTES_SAVED_PER_RUN) / 60 * 10) / 10;

  return {
    memberCount: memberIds.length,
    agentRuns: current.totalRuns,
    groundedRuns: totalGroundedRuns,
    insightRuns: current.totalRuns - totalGroundedRuns,
    agentRunsPrev: previous.totalRuns,
    activeAgents: activeAgentRoles.size,
    activeAgentsPrev: activeAgentRolesPrev.size,
    adoptionUsers: current.distinctUsers.size,
    adoptionUsersPrev: previous.distinctUsers.size,
    hoursSaved,
    hoursSavedPrev,
    valueEstimateEur: Math.round(hoursSaved * hourlyRateEur),
    hourlyRateEur,
    agentWork,
    signals: { emails: signalEmails, meetings: signalMeetings, documents: signalDocuments },
  };
}
