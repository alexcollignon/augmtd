import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 15;

// GET /api/knowledge/overview — THE SLIM KNOWLEDGE PANEL's one read (one-surface plan: the
// sovereignty/audit surface that replaced the Drive folder grid). Everything the brain can
// read, in one page: counts by STRUCTURAL kind (meeting note · email attachment · upload ·
// generated), indexing status, where each file lives (its project), and the recent tail.
// Kind derives from the row itself — provider_file_id prefixes + the augmtd source — never
// from a stored label.
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const [filesRes, augmtdRes, mailRes] = await Promise.all([
      supabase.from('knowledge_files')
        .select('id, filename, mime_type, size_bytes, indexed_at, provider_file_id, source_id, entity_id, storage_path, knowledge_chunks(count)')
        .eq('user_id', user.id).order('indexed_at', { ascending: false }).limit(400),
      supabase.from('knowledge_sources').select('id').eq('user_id', user.id).eq('provider', 'augmtd').maybeSingle(),
      supabase.from('connections').select('provider, metadata').eq('user_id', user.id).eq('status', 'active').in('provider', ['gmail', 'outlook']),
    ]);

    const augmtdSourceId = augmtdRes.data?.id ?? null;
    type Row = {
      id: string; filename: string | null; mime_type: string | null; size_bytes: number | null;
      indexed_at: string | null; provider_file_id: string | null; source_id: string | null;
      entity_id: string | null; storage_path: string | null; knowledge_chunks: Array<{ count: number }>;
    };
    const rows = (filesRes.data ?? []) as unknown as Row[];

    const kindOf = (r: Row): 'meeting' | 'attachment' | 'generated' | 'upload' => {
      const p = String(r.provider_file_id ?? '');
      if (p.startsWith('transcript::')) return 'meeting';
      if (p.startsWith('email_attachment::')) return 'attachment';
      if (augmtdSourceId && r.source_id === augmtdSourceId) return 'generated';
      return 'upload';
    };

    // Where each file LIVES — its project, when stamped (the entity_id spine).
    const entIds = [...new Set(rows.map((r) => r.entity_id).filter((x): x is string => !!x))];
    const entName = new Map<string, string>();
    if (entIds.length) {
      const { data: ents } = await supabase.from('work_entities').select('id, name').in('id', entIds).eq('user_id', user.id);
      for (const e of (ents ?? []) as Array<{ id: string; name: string }>) entName.set(e.id, e.name);
    }

    const counts = { meeting: 0, attachment: 0, upload: 0, generated: 0, total: rows.length, indexed: 0, pending: 0 };
    const files = rows.map((r) => {
      const kind = kindOf(r);
      counts[kind]++;
      const chunks = r.knowledge_chunks?.[0]?.count ?? 0;
      const indexed = chunks > 0;
      if (indexed) counts.indexed++; else counts.pending++;
      return {
        id: r.id, filename: r.filename ?? 'Untitled', kind,
        sizeBytes: r.size_bytes ?? null, indexedAt: r.indexed_at ?? null, chunks,
        indexed, project: r.entity_id ? entName.get(r.entity_id) ?? null : null,
        // A meeting note lives with its meeting — it leaves the KB from there, never here.
        deletable: kind !== 'meeting',
      };
    });

    const mail = ((mailRes.data ?? []) as Array<{ provider: string; metadata: { email?: string } | null }>)
      .map((c) => ({ provider: c.provider, email: c.metadata?.email ?? '' }));

    return NextResponse.json({ counts, files, mail });
  } catch (e) {
    console.error('[knowledge/overview]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
