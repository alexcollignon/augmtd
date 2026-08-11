// ─── GET /api/workers/presence — the team facepile's live state (coherence slice #4) ─────────
// One line of REAL state per coworker, read from run checkpoints and today's runs — presence
// makes proactivity legible ("Max — running your briefing · step 8 of 13"). Everything shown is
// true state; nothing is theater.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let { data: workers } = await supabase.from('custom_agents')
    .select('id, name, description, worker_role')
    .eq('user_id', user.id).eq('is_worker', true).eq('is_active', true)
    .order('created_at', { ascending: true });
  // THE SEEDING SELF-HEAL (Aug 11, found live: an iScore user with ZERO coworkers — seeding was
  // coupled to the email bootstrap, which a sovereign user never triggers; the /workers page
  // that used to backstop it is retired). Any authed visit with an empty roster seeds the team
  // idempotently — the facepile can never again show a dead "no team" to a fresh member.
  if (!workers?.length) {
    try {
      const { createClient: createAdmin } = await import('@supabase/supabase-js');
      const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const { ensureWorkers } = await import('@/lib/workers/seed');
      await ensureWorkers(admin, user.id);
      ({ data: workers } = await supabase.from('custom_agents')
        .select('id, name, description, worker_role')
        .eq('user_id', user.id).eq('is_worker', true).eq('is_active', true)
        .order('created_at', { ascending: true }));
    } catch { /* seeding is best-effort here — the join door and the Home CTA also seed */ }
  }
  const roster = (workers ?? []) as Array<{ id: string; name: string; description: string | null; worker_role: string | null }>;
  if (!roster.length) return NextResponse.json({ team: [] });

  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const [{ data: running }, { data: today }, { data: wfs }] = await Promise.all([
    supabase.from('workflow_runs')
      .select('workflow_id, step_outputs')
      .eq('user_id', user.id).eq('status', 'running')
      .order('created_at', { ascending: false }).limit(10),
    supabase.from('workflow_runs')
      .select('workflow_id, status')
      .eq('user_id', user.id).eq('status', 'succeeded')
      .gte('created_at', dayStart.toISOString()).limit(50),
    supabase.from('workflows').select('id, name, agent_id, steps').eq('user_id', user.id),
  ]);
  const wfById = new Map(((wfs ?? []) as Array<{ id: string; name: string; agent_id: string | null; steps: unknown[] | null }>).map((w) => [w.id, w]));

  const team = roster.map((w) => {
    const run = ((running ?? []) as Array<{ workflow_id: string; step_outputs: unknown[] | null }>)
      .find((r) => wfById.get(r.workflow_id)?.agent_id === w.id);
    if (run) {
      const wf = wfById.get(run.workflow_id)!;
      const total = Array.isArray(wf.steps) ? wf.steps.length : 0;
      const done = Array.isArray(run.step_outputs) ? run.step_outputs.length : 0;
      return { ...w, state: `Running “${wf.name}”${total ? ` · step ${Math.min(done + 1, total)} of ${total}` : ''}` };
    }
    const delivered = ((today ?? []) as Array<{ workflow_id: string }>)
      .filter((r) => wfById.get(r.workflow_id)?.agent_id === w.id).length;
    return { ...w, state: delivered > 0 ? `Delivered ${delivered} today` : 'Ready' };
  });

  return NextResponse.json({ team });
}
