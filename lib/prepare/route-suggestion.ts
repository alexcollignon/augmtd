// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ROSTER JUDGE (orchestrated-loop O2) — ONE reasoned router: which TEAMMATE prepares a task,
// with the user's ACTUAL roster in view (each coworker's name, role, description, and skills).
//
// This replaced two prior mechanisms, each a doctrine violation:
//   • client-side keyword regexes (deleted in work-loop W2) — blind;
//   • the hardcoded SHAPE_TO_ROLE map (deleted here) — a map is not a judgment, and it froze the
//     roster: a new vertical coworker or skill was invisible to routing.
// Now routing READS the roster. Add a coworker, assign a skill, ship a vertical pack — the judge
// sees it on the next call, zero routing-code changes. That is the capability invariant.
//
// Conservative by design: human-only work (replying, deciding, calling, scheduling, paying, admin)
// routes to NO ONE; sending an EXISTING document is flagged (`sendDoc`) for the system's own
// doc-send preparation, not a teammate. The cache is STRUCTURAL: the verdict rides next_move
// (routedWorker + routeSig keyed to the judged title) — state synthesis rewrites next_move
// wholesale, so a new move re-judges by construction; repeat loads cost zero AI.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { aiCall } from '@/lib/ai/call';

export type RosterEntry = {
  id: string; name: string; role: string; description: string;
  skills: Array<{ name: string; whenToUse: string | null }>;
};
export type TaskRoute = { worker: RosterEntry | null; sendDoc: boolean };
export type SuggestedWorker = { id: string; name: string; role: string };

/** The user's live roster — coworkers + their assigned skills (the judge's context). */
export async function loadRoster(supabase: SupabaseClient, userId: string): Promise<RosterEntry[]> {
  const { data: workers } = await supabase.from('custom_agents')
    .select('id, name, worker_role, description').eq('user_id', userId).eq('is_worker', true).eq('is_active', true);
  const list = ((workers ?? []) as Array<Record<string, unknown>>).map((w) => ({
    id: w.id as string, name: String(w.name), role: String(w.worker_role ?? ''),
    description: String(w.description ?? ''), skills: [] as Array<{ name: string; whenToUse: string | null }>,
  }));
  if (list.length) {
    const { data: sk } = await supabase.from('agent_skills')
      .select('agent_id, skills(name, when_to_use)').in('agent_id', list.map((w) => w.id));
    for (const row of (sk ?? []) as unknown as Array<{ agent_id: string; skills: { name: string; when_to_use: string | null } | { name: string; when_to_use: string | null }[] | null }>) {
      const w = list.find((x) => x.id === row.agent_id);
      if (!w || !row.skills) continue;
      // PostgREST returns the joined row as an object or an array depending on the FK shape — accept both.
      for (const s of Array.isArray(row.skills) ? row.skills : [row.skills]) {
        if (s?.name) w.skills.push({ name: s.name, whenToUse: s.when_to_use });
      }
    }
  }
  return list;
}

const renderRoster = (roster: RosterEntry[]): string =>
  roster.map((w) => {
    const skills = w.skills.length
      ? ` Skills: ${w.skills.map((s) => s.whenToUse ? `${s.name} (use when: ${s.whenToUse.slice(0, 80)})` : s.name).join('; ')}.`
      : '';
    return `- ${w.name} — ${w.role.replace(/_/g, ' ')}. ${w.description}${skills}`;
  }).join('\n');

/** ONE reasoned routing pass over a batch of tasks, roster in view. Never throws; failures → no route. */
export async function routeTasks(
  supabase: SupabaseClient, userId: string, titles: string[], preloadedRoster?: RosterEntry[],
): Promise<TaskRoute[]> {
  const none: TaskRoute = { worker: null, sendDoc: false };
  if (!titles.length) return [];
  try {
    const roster = preloadedRoster ?? await loadRoster(supabase, userId);
    if (!roster.length) return titles.map(() => none);
    const list = titles.map((t, i) => `${i}. ${t.slice(0, 110)}`).join('\n');
    const res = await aiCall<{ routes?: Record<string, { teammate?: string; send_doc?: boolean }> }>({
      userId, supabase, shape: { output: 'json' }, temperature: 0, maxTokens: 300, source: 'task_preparation',
      prompt: `You are a chief of staff routing PREPARATION work to the right teammate — or to no one.\n\n` +
        `THE TEAM:\n${renderRoster(roster)}\n\n` +
        `For each task, decide who PREPARES it:\n` +
        `- Route to a teammate ONLY when doing the task is genuinely their craft (their description/skills).\n` +
        `- Replying to a thread, deciding, approving, calling, scheduling, paying, admin — the USER's own work → "none".\n` +
        `- Sending/sharing a document that ALREADY EXISTS (send/forward/share the X) → "none" with send_doc true (the system resolves the file and drafts the send itself).\n` +
        `- But a task to PREPARE/create/put-together something and then send it → route to the teammate whose craft CREATES it; the send is a separate approved step either way.\n` +
        `- Unsure → "none". A wrong route costs trust; no route costs nothing.\n\nTASKS:\n${list}\n\n` +
        `JSON only: {"routes":{"<index>":{"teammate":"<exact team name or none>","send_doc":true|false}}}`,
    });
    return titles.map((_, i) => {
      const r = res.json?.routes?.[String(i)];
      const worker = r?.teammate && r.teammate.toLowerCase() !== 'none'
        ? roster.find((w) => w.name.toLowerCase() === String(r.teammate).toLowerCase()) ?? null
        : null;
      return { worker, sendDoc: r?.send_doc === true };
    });
  } catch { return titles.map(() => none); }
}

type NextMove = { title?: string; entityRef?: string | null; routedWorker?: { id: string; name: string; role: string } | 'none'; routeSig?: string };

const sigOf = (t: string): string => { let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return String(h); };

/** The served suggestion for an entity's next move — the roster judge's verdict, sig-cached on
 *  next_move. Non-fatal by design: any failure → null (no chip). */
export async function suggestWorkerForMove(
  supabase: SupabaseClient, userId: string, entityId: string,
  preloaded?: { next_move?: unknown } | null,
): Promise<SuggestedWorker | null> {
  try {
    let nmRaw = preloaded?.next_move;
    if (nmRaw === undefined) {
      const { data } = await supabase.from('work_entities').select('next_move')
        .eq('id', entityId).eq('user_id', userId).maybeSingle();
      nmRaw = data?.next_move;
    }
    const nm = ((nmRaw ?? {}) as NextMove);
    const title = nm.title?.trim();
    if (!title) return null;

    const sig = sigOf(title);
    if (nm.routeSig === sig && nm.routedWorker !== undefined) {
      return nm.routedWorker === 'none' ? null : (nm.routedWorker ?? null); // cached verdict (incl. cached "no")
    }
    const [route] = await routeTasks(supabase, userId, [title]);
    const verdict: NextMove['routedWorker'] = route?.worker
      ? { id: route.worker.id, name: route.worker.name, role: route.worker.role } : 'none';
    await supabase.from('work_entities')
      .update({ next_move: { ...nm, routedWorker: verdict, routeSig: sig } })
      .eq('id', entityId).eq('user_id', userId).then(() => {}, () => {});
    return verdict === 'none' ? null : verdict;
  } catch { return null; }
}
