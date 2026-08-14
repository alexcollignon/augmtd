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
    const like = `%${q}%`;
    const limit = types.length === 1 ? 12 : 5;
    const results: MentionResult[] = [];

    // Coworkers
    if (types.includes('coworker')) {
      let cq = supabase.from('custom_agents').select('id, name, worker_role').eq('user_id', user.id).eq('is_worker', true).eq('is_active', true).limit(limit);
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

    // Documents — the indexed knowledge base (meetings, uploads, and generated docs).
    // Sourced from knowledge_files (lightweight + spans everything the chat can retrieve
    // via search_knowledge_base) rather than the heavy work_threads.artifacts blob, which
    // was both incomplete (no meetings/uploads) and slow (loaded full document bodies).
    if (types.includes('document')) {
      let dq = supabase
        .from('knowledge_files')
        .select('id, filename, provider_file_id')
        .eq('user_id', user.id)
        .order('indexed_at', { ascending: false })
        .limit(limit);
      if (q) dq = dq.ilike('filename', like);
      const { data } = await dq;
      for (const f of (data ?? []) as Array<{ id: string; filename: string; provider_file_id: string | null }>) {
        const isMeeting = /^meeting[: ]/i.test(f.filename) || (f.provider_file_id ?? '').startsWith('transcript::');
        results.push({ type: 'document', id: f.id, label: f.filename, subtitle: isMeeting ? 'meeting' : 'document' });
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    console.error('[workers/mentions] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
