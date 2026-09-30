// ════════════════════════════════════════════════════════════════════════════════════════════════
// W28 — THE COWORKER TEAM on a probe host. The DM, hand-off, workflow-step and draft surfaces need
// the user's coworkers (Clara · Luca · Max). A probe host holds none by default, so the run seeds them
// through THE PRODUCT'S OWN SEED (lib/workers/seed.ts ensureWorkers — the same rows /api/workers/init
// writes) before the first unit and removes exactly the rows it added after the last (plus anything
// keyed to them: their threads, messages, memories, stored artifacts). A team that already existed is
// left untouched. Probe hosts only (the caller checks; every delete is scoped to the probe user).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';

export type Worker = { id: string; name: string; worker_role: string };
export type Team = { userId: string; workers: Worker[]; added: string[] };

const teams = new Map<string, Team>();

export async function ensureTeam(admin: SupabaseClient, userId: string): Promise<Team> {
  const hit = teams.get(userId);
  if (hit) return hit;
  const { ensureWorkers } = await import('../../../lib/workers/seed');
  const r = await ensureWorkers(admin, userId);
  const { data, error } = await admin.from('custom_agents').select('id, name, worker_role')
    .eq('user_id', userId).eq('is_worker', true).eq('is_active', true);
  if (error) throw new Error(`team read failed: ${error.message}`);
  const workers = ((data ?? []) as Array<{ id: string; name: string; worker_role: string | null }>).map((w) => ({ id: w.id, name: w.name, worker_role: String(w.worker_role ?? '') }));
  const added = workers.filter((w) => r.added.includes(w.worker_role)).map((w) => w.id);
  const team = { userId, workers, added };
  teams.set(userId, team);
  return team;
}

export function workerOf(team: Team, role: 'personal_assistant' | 'branding_expert' | 'research_analyst'): Worker {
  const w = team.workers.find((x) => x.worker_role === role);
  if (!w) throw new Error(`probe team has no ${role}`);
  return w;
}

/** Delete work threads (and their messages + stored artifacts) — scoped to the probe user. */
export async function deleteThreads(admin: SupabaseClient, userId: string, threadIds: string[]): Promise<string[]> {
  const errors: string[] = [];
  if (!threadIds.length) return errors;
  const { data: rows, error } = await admin.from('work_threads').select('id, artifacts').eq('user_id', userId).in('id', threadIds);
  if (error) { errors.push(`work_threads read: ${error.message}`); return errors; }
  const paths: string[] = [];
  for (const r of (rows ?? []) as Array<{ artifacts?: unknown }>) {
    for (const a of (Array.isArray(r.artifacts) ? r.artifacts : []) as Array<{ storage_path?: string }>) if (a?.storage_path) paths.push(a.storage_path);
  }
  if (paths.length) {
    const { error: sErr } = await admin.storage.from('work-artifacts').remove(paths);
    if (sErr) errors.push(`work-artifacts remove: ${sErr.message}`);
  }
  const ids = ((rows ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (ids.length) {
    const m = await admin.from('work_messages').delete().in('thread_id', ids);
    if (m.error) errors.push(`work_messages delete: ${m.error.message}`);
    const t = await admin.from('work_threads').delete().eq('user_id', userId).in('id', ids);
    if (t.error) errors.push(`work_threads delete: ${t.error.message}`);
  }
  return errors;
}

/** Threads the team's coworkers got on the probe since `since` (the unit's own writes — the account
 *  hosts one world at a time; e.g. a hand-off's standing "Handed to …" thread). */
export async function threadsSince(admin: SupabaseClient, userId: string, since: string, agentIds: string[]): Promise<string[]> {
  if (!agentIds.length) return [];
  const { data, error } = await admin.from('work_threads').select('id').eq('user_id', userId).gte('created_at', since).in('agent_id', agentIds);
  if (error) throw new Error(`work_threads read: ${error.message}`);
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
}

/** --sweep: the coworker rows a STOPPED run left on a probe host (the harness's own seed roles), with
 *  their threads/memories. Dry run lists; `apply` deletes. Probe hosts only (the caller checks). */
export async function sweepTeam(admin: SupabaseClient, userId: string, apply: boolean): Promise<{ workers: number; threads: number; errors: string[] }> {
  const { buildWorkers } = await import('../../../lib/workers/seed');
  const roles = buildWorkers(userId).map((w) => w.worker_role);
  const { data, error } = await admin.from('custom_agents').select('id').eq('user_id', userId).eq('is_worker', true).in('worker_role', roles);
  if (error) return { workers: 0, threads: 0, errors: [`custom_agents read: ${error.message}`] };
  const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  const { data: th, error: tErr } = ids.length ? await admin.from('work_threads').select('id').eq('user_id', userId).in('agent_id', ids) : { data: [], error: null };
  if (tErr) return { workers: ids.length, threads: 0, errors: [`work_threads read: ${tErr.message}`] };
  const tids = ((th ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (!apply || !ids.length) return { workers: ids.length, threads: tids.length, errors: [] };
  teams.set(userId, { userId, workers: [], added: ids });
  const errors = await removeTeams(admin);
  return { workers: ids.length, threads: tids.length, errors };
}

/** Remove the team rows this run added (and everything keyed to them). Returns problems, never throws. */
export async function removeTeams(admin: SupabaseClient): Promise<string[]> {
  const errors: string[] = [];
  for (const team of teams.values()) {
    if (!team.added.length) continue;
    try {
      const { data: th } = await admin.from('work_threads').select('id').eq('user_id', team.userId).in('agent_id', team.added);
      errors.push(...await deleteThreads(admin, team.userId, ((th ?? []) as Array<{ id: string }>).map((r) => r.id)));
      for (const t of ['agent_memories', 'agent_tool_settings', 'agent_skills']) {
        const r = await admin.from(t).delete().in('agent_id', team.added);
        if (r.error && !/does not exist|schema cache/i.test(r.error.message)) errors.push(`${t}: ${r.error.message}`);
      }
      const r = await admin.from('custom_agents').delete().eq('user_id', team.userId).in('id', team.added);
      if (r.error) errors.push(`custom_agents delete: ${r.error.message}`);
    } catch (e) { errors.push(`team ${team.userId.slice(0, 8)}: ${(e as Error).message}`); }
  }
  teams.clear();
  return errors;
}
