import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { listKbFiles, KB_PAGE, type KindFilter } from '@/lib/knowledge/overview';

export const maxDuration = 15;

const KINDS = new Set(['all', 'meeting', 'attachment', 'upload', 'generated']);

// GET /api/knowledge/files — one PAGE of the knowledge base. The overview never ships more than a
// bounded slice (the honest-numbers law: counts come from counts, rows come a page at a time), so
// this is the door every "expand a folder", "Show all N", and search hit comes back through.
//
//   ?folderId=<uuid>   files in that folder      ?folderId=none  files with no folder
//   ?kind=             the active source tab     ?q=             filename search (server-side —
//   ?ids=a,b,c         an explicit set (how the panel folds the SEMANTIC search hits in beside
//                      the name matches, since /api/drive/search returns ids only)
//   ?offset= &limit=
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sp = new URL(request.url).searchParams;
    const rawFolder = sp.get('folderId');
    const rawKind = sp.get('kind') ?? 'all';
    const ids = (sp.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

    const out = await listKbFiles(supabase, user.id, {
      ...(rawFolder === null ? {} : { folderId: rawFolder === 'none' ? null : rawFolder }),
      kind: (KINDS.has(rawKind) ? rawKind : 'all') as KindFilter,
      q: sp.get('q') ?? undefined,
      ...(ids.length ? { ids } : {}),
      offset: Number(sp.get('offset') ?? 0) || 0,
      limit: Number(sp.get('limit') ?? KB_PAGE) || KB_PAGE,
    });

    return NextResponse.json(out);
  } catch (e) {
    console.error('[knowledge/files]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
