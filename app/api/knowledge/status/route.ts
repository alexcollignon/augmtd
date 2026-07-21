// GET /api/knowledge/status — the KNOWLEDGE panel's verification surface (Prepared-Work D1): what the
// system holds and where it came from. Counts by ORIGIN (email attachments / uploads / transcripts /
// generated / connected drives), total indexed, freshest ingest, and connected-source health. This is the
// regulated-SME trust answer to "what does it have?" — status, not a file manager.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const [{ data: files }, { data: conns }] = await Promise.all([
      supabase.from('knowledge_files').select('origin, provider_file_id, indexed_at').eq('user_id', user.id).limit(3000),
      supabase.from('connections').select('provider, status').eq('user_id', user.id),
    ]);

    const byOrigin: Record<string, number> = {};
    let freshest = '';
    for (const f of (files ?? []) as Array<{ origin: { kind?: string } | null; provider_file_id: string | null; indexed_at: string | null }>) {
      // Origin when stamped (post-Phase-A); legacy rows classified by their provider_file_id shape.
      const kind = f.origin?.kind
        ?? (f.provider_file_id?.startsWith('transcript::') ? 'transcript' : 'upload');
      byOrigin[kind] = (byOrigin[kind] ?? 0) + 1;
      if (f.indexed_at && f.indexed_at > freshest) freshest = f.indexed_at;
    }
    const sources = ((conns ?? []) as Array<{ provider: string; status: string }>).map((c) => ({
      provider: c.provider, active: c.status === 'active',
      // The mailbox token carries the drive scope (native clients) — one connection powers both.
      capabilities: c.provider === 'gmail' ? ['email attachments', 'Google Drive'] : c.provider === 'outlook' ? ['email attachments', 'OneDrive'] : [c.provider],
    }));

    return NextResponse.json({ total: (files ?? []).length, byOrigin, freshest: freshest || null, sources });
  } catch (e) {
    console.error('[knowledge/status]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
