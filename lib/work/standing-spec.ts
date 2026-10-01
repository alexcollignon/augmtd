// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SPEC CARD (Arc 2 stage 2 — docs/one-surface-plan.md: "I want a weekly report on X", said
// anywhere, becomes a CONFIRMED standing commitment). Two halves, one law — SAYING PREPARES,
// COMMITTING STAYS EXPLICIT:
//   • buildStandingSpec — one reasoned pass turns the user's words into an explicit spec
//     (name · deliverable · cadence · owner), CODE-VALIDATED (the cron must parse and yield a
//     real first run; the owner must be a real coworker). The spec lands as a durable
//     `standing_spec` component turn in the work's room — the card. NOTHING is created.
//   • confirmStandingSpec — fires ONLY from the card's Confirm (or the user's explicit word):
//     generate-config builds the method, the workflow row is born ACTIVE with its schedule, and
//     THE STANDING BINDING (stage 1) gives it its one commitment. The card flips to confirmed.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { nextRunFromTrigger } from '@/lib/workflows/schedule';

export type StandingSpec = {
  name: string;           // ≤6 words, the deliverable's name
  deliverable: string;    // one sentence: what arrives each time
  cron: string;           // 5-field, code-validated
  cadenceLabel: string;   // "every Monday 08:00"
  ownerName: string;      // the coworker who produces it
  ownerRole: string;
  agentId: string;
  firstRun: string | null; // ISO date of the first scheduled run (from the validated cron)
};

export const proposeStandingTaskDefinition = {
  name: 'propose_standing_task',
  description:
    'The user asks for a RECURRING deliverable ("a weekly report on X", "a daily digest of Y", "every Monday send me…"). ' +
    'Builds the standing-task spec and places the CONFIRMATION CARD in the room — creates NOTHING by itself; ' +
    'the user confirms on the card. Use only for recurring asks, never one-off work.',
  input_schema: {
    type: 'object' as const,
    properties: {
      request: { type: 'string', description: "The user's ask in their own words (deliverable + cadence + any named project)" },
    },
    required: ['request'],
  },
};

/** W37 · THE CRON OR-TRAP (found by the plan.standing eval: "the first Monday of each month at 9" became
 *  `0 9 1-7 * 1`, which standard cron reads as "days 1–7 OR every Monday" — a weekly schedule with a first
 *  run on a Friday, and every model, plain or not, wrote it). A cron that restricts BOTH day-of-month and
 *  day-of-week fires on either; it is never what a person asked for, so it is refused and repaired. Pure. */
export function cronOrTrap(cron: string): boolean {
  const f = String(cron ?? '').trim().split(/\s+/);
  return f.length === 5 && f[2] !== '*' && f[2] !== '?' && f[4] !== '*' && f[4] !== '?';
}

/** The honest fallback when the repair still ORs its days: keep the month day (its first value), drop the
 *  weekday, and SAY so in code's own words — a schedule that runs on a stated date beats no card. Pure. */
export function orTrapFallback(cron: string): { cron: string; note: string } | null {
  if (!cronOrTrap(cron)) return null;
  const f = cron.trim().split(/\s+/);
  const day = Number(f[2].split(/[-,/]/)[0]);
  if (!Number.isInteger(day) || day < 1 || day > 28) return null;
  return { cron: [f[0], f[1], String(day), f[3], '*'].join(' '), note: `runs on day ${day} of the month — a schedule can't name a weekday within the month` };
}

export async function buildStandingSpec(
  admin: SupabaseClient, userId: string, request: string,
): Promise<StandingSpec | { error: string }> {
  try {
    const { data: workers } = await admin.from('custom_agents')
      .select('id, name, worker_role').eq('user_id', userId).eq('is_worker', true).eq('is_active', true).limit(10);
    if (!workers?.length) return { error: 'no coworkers are set up yet — the team produces standing work' };

    const { aiCall } = await import('@/lib/ai/call');
    const day = new Date().toISOString().slice(0, 10);
    const roster = workers.map((w) => `${w.name} (${w.worker_role})`).join(', ');
    const ask = async (repair?: string) => aiCall<{ name?: string; deliverable?: string; cron?: string; cadence_label?: string; owner_role?: string }>({
      userId, supabase: admin, shape: { output: 'json' }, temperature: 0, maxTokens: 220, source: 'task_preparation',
      prompt:
        `Today is ${day}. The user asked for a recurring deliverable:\n"${request.slice(0, 400)}"\n\n` +
        `THE TEAM: ${roster}\n\n` +
        `Produce the standing-task spec. Rules: "name" ≤6 words; "deliverable" = ONE sentence, the user's ` +
        `own intent (never embellished); "cron" = standard 5-field cron matching the STATED cadence ` +
        `(unstated time of day → 08:00; unstated weekday for "weekly" → Monday); "cadence_label" = the ` +
        `human phrasing ("every Monday 08:00"); "owner_role" = the team role whose CRAFT fits (research → ` +
        `research_analyst, writing/reports/admin/prep → personal_assistant, LinkedIn/social presence → branding_expert). ` +
        `What has to be FOUND OUT decides it: a deliverable about competitors, markets, news, prices or regulation is research ` +
        `(research_analyst) even when it arrives as a report; a report built from the user's own material is personal_assistant.` +
        `\nStandard cron ORs day-of-month and day-of-week, so never restrict both; a cadence cron cannot say ` +
        `exactly ("the first Monday of the month") gets the closest honest cron (e.g. the 1st of each month) and ` +
        `a cadence_label that says so ("monthly on the 1st, 09:00 — cron can't say 'first Monday'"). Write ` +
        `cadence_label and name in the user's language. The cron is in the user's LOCAL time: the stated hour goes in as said, never converted to UTC.` +
        (repair ? `\nYOUR PREVIOUS CRON WAS INVALID (${repair}) — fix it.` : '') +
        `\nJSON only: {"name":"…","deliverable":"…","cron":"0 8 * * 1","cadence_label":"…","owner_role":"…"}`,
    });

    let res = await ask();
    let cron = (res.json?.cron ?? '').trim();
    let first = cron && !cronOrTrap(cron) ? nextRunFromTrigger({ type: 'schedule', cron }) : null;
    if (!first) {
      res = await ask(cron ? (cronOrTrap(cron) ? `${cron} restricts both day-of-month and day-of-week, which cron ORs` : cron) : 'missing');
      cron = (res.json?.cron ?? '').trim();
      const fb = orTrapFallback(cron);
      if (fb) { cron = fb.cron; res = { ...res, json: { ...(res.json ?? {}), cron: fb.cron, cadence_label: `${String(res.json?.cadence_label ?? '').trim() || fb.cron} (${fb.note})` } }; }
      first = cron && !cronOrTrap(cron) ? nextRunFromTrigger({ type: 'schedule', cron }) : null;
      if (!first) return { error: 'could not derive a valid schedule from the request' };
    }
    const j = res.json ?? {};
    const owner = workers.find((w) => w.worker_role === j.owner_role)
      ?? workers.find((w) => w.worker_role === 'personal_assistant') ?? workers[0];
    const name = String(j.name ?? '').trim().slice(0, 60);
    const deliverable = String(j.deliverable ?? '').trim().slice(0, 240);
    if (!name || !deliverable) return { error: 'could not derive the deliverable from the request' };
    return {
      name, deliverable, cron,
      cadenceLabel: String(j.cadence_label ?? cron).slice(0, 140),
      ownerName: String(owner.name), ownerRole: String(owner.worker_role ?? ''), agentId: String(owner.id),
      firstRun: first.toISOString(),
    };
  } catch { return { error: 'the spec could not be built right now' }; }
}

/** The COMMIT half — fires only on the user's explicit confirm. Reuses the ONE task-creation
 *  door (executeCreateTask → generate-config → active workflow) and the stage-1 binding. */
export async function confirmStandingSpec(
  admin: SupabaseClient, userSupabase: SupabaseClient, userId: string, spec: StandingSpec,
): Promise<{ workflowId: string; name: string; firstRun: string | null } | { error: string }> {
  try {
    const { executeCreateTask } = await import('@/lib/tools/worker-tasks');
    const description =
      `${spec.deliverable} Deliver it ${spec.cadenceLabel} (cron: ${spec.cron}). Task name: ${spec.name}.`;
    await executeCreateTask(description, spec.agentId, userId, userSupabase, admin);
    const { data: wf } = await admin.from('workflows')
      .select('id, name, next_run_at, status, trigger, user_id, agent_id')
      .eq('user_id', userId).eq('agent_id', spec.agentId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!wf) return { error: 'the task was generated but could not be found after saving' };
    const { syncStandingCommitment } = await import('@/lib/workflows/standing');
    await syncStandingCommitment(admin, {
      id: String(wf.id), user_id: userId, name: String(wf.name), status: String(wf.status),
      trigger: wf.trigger as { type?: string } | null, next_run_at: (wf.next_run_at as string) ?? null,
      agent_id: (wf.agent_id as string) ?? null,
    }, spec.ownerName);
    return { workflowId: String(wf.id), name: String(wf.name), firstRun: (wf.next_run_at as string) ?? null };
  } catch { return { error: 'the task could not be created — nothing was scheduled' }; }
}
