// GET /api/items/pool?kind=email|commitment&id=<itemId> — the item's PREPARED work via THE ONE READER
// (lib/prepare/read.ts): coworker deliverables + nudge drafts, normalized. Reply drafts are excluded
// here on purpose — the deep-dive composer owns them (showing them twice would duplicate the artifact).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getPrepared } from '@/lib/prepare/read';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const kind = request.nextUrl.searchParams.get('kind');
    const id = request.nextUrl.searchParams.get('id');
    if (!kind || !id) return NextResponse.json({ error: 'kind and id required' }, { status: 400 });
    const itemKind = kind === 'commitment' ? 'commitment' as const : 'inbox_item' as const;
    const all = await getPrepared(supabase, user.id, { kind: itemKind, id });
    const prepared = all
      .filter((a) => a.kind !== 'reply_draft') // the composer owns reply drafts
      .map((a, i) => ({ id: `${a.kind}-${i}`, title: a.title ?? (a.kind === 'nudge_draft' ? 'Follow-up draft' : 'Deliverable'), content: a.content, metadata: { worker: a.by, provenance: a.provenance, attachment: a.attachment } }));
    return NextResponse.json({ prepared });
  } catch (e) {
    console.error('[items/pool]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
