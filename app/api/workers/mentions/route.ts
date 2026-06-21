import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Mention sources for the coworker chat composer: coworkers, tasks, documents.
// Shape mirrors /api/work/mentions → { results: [{ type, id, label, subtitle }] }.
interface MentionResult {
  type: 'coworker' | 'task' | 'document';
  id: string;
  label: string;
  subtitle?: string;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = request.nextUrl;
    const q = (searchParams.get('q') ?? '').trim();
    const all = ['coworker', 'task', 'document'] as const;
    const types = (searchParams.get('types')?.split(',').filter(t => (all as readonly string[]).includes(t)) as typeof all[number][] | undefined) ?? [...all];
    const ql = q.toLowerCase();
    const like = `%${q}%`;
    const limit = types.length === 1 ? 12 : 5;
    const results: MentionResult[] = [];

    // Coworkers
    if (types.includes('coworker')) {
      let cq = supabase.from('custom_agents').select('id, name, worker_role').eq('user_id', user.id).eq('is_worker', true).limit(limit);
      if (q) cq = cq.ilike('name', like);
      const { data } = await cq;
      for (const a of (data ?? []) as Array<{ id: string; name: string; worker_role: string | null }>) {
        results.push({ type: 'coworker', id: a.id, label: a.name, subtitle: (a.worker_role ?? '').replace(/_/g, ' ') || 'coworker' });
      }
    }

    // Tasks (workflows)
    if (types.includes('task')) {
      let tq = supabase.from('workflows').select('id, name, status').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(limit);
      if (q) tq = tq.ilike('name', like);
      const { data } = await tq;
      for (const w of (data ?? []) as Array<{ id: string; name: string; status: string }>) {
        results.push({ type: 'task', id: w.id, label: w.name, subtitle: w.status === 'paused' ? 'task · paused' : 'task' });
      }
    }

    // Documents (artifacts produced by the user's coworkers)
    if (types.includes('document')) {
      const { data: agents } = await supabase.from('custom_agents').select('id, name').eq('user_id', user.id).eq('is_worker', true);
      const nameById = new Map((agents ?? []).map((a: { id: string; name: string }) => [a.id, a.name]));
      const workerIds = (agents ?? []).map((a: { id: string }) => a.id);
      if (workerIds.length > 0) {
        const { data: threads } = await supabase
          .from('work_threads').select('agent_id, artifacts, updated_at')
          .eq('user_id', user.id).in('agent_id', workerIds).not('artifacts', 'is', null)
          .order('updated_at', { ascending: false }).limit(40);
        for (const t of (threads ?? []) as Array<{ agent_id: string; artifacts: Array<{ id?: string; title?: string }> | null }>) {
          const arts = Array.isArray(t.artifacts) ? t.artifacts : [];
          for (const a of arts) {
            if (!a.id || !a.title) continue;
            if (q && !a.title.toLowerCase().includes(ql)) continue;
            results.push({ type: 'document', id: a.id, label: a.title, subtitle: `by ${nameById.get(t.agent_id) ?? 'a coworker'}` });
            if (results.filter(r => r.type === 'document').length >= limit) break;
          }
          if (results.filter(r => r.type === 'document').length >= limit) break;
        }
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    console.error('[workers/mentions] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
