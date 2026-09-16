import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { reindexKbFile } from '@/lib/knowledge/reindex';

// THE RETRY DOOR (W9) — the exit for a pending row that must not be removed (a meeting note lives
// with its meeting) and that nothing else will ever pick up (`indexArtifact` swallows its failures).
// Ownership is proven on the COOKIE session; the deed then runs with the service role, because
// indexing writes chunks the way every other ingest path does.
//
// The budget: chunk summaries run in batches of 8 and the embed is one batched call, so a ~40KB
// document is a couple of AI round-trips — well inside 120s, and honestly short of the 300s the
// bulk ingest routes claim (this is ONE file, fired by a person who is watching a spinner).
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const fileId = typeof body?.fileId === 'string' ? body.fileId.trim() : '';
    if (!fileId) return NextResponse.json({ error: 'fileId required' }, { status: 400 });

    // The row must be THIS user's — read through the cookie client so RLS answers the question.
    const { data: owned } = await supabase
      .from('knowledge_files').select('id').eq('id', fileId).eq('user_id', user.id).maybeSingle();
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const result = await reindexKbFile(admin, user.id, fileId);
    // An honest refusal is a 200 with `ok:false` — the caller renders the reason; it is an outcome,
    // not a transport failure.
    return NextResponse.json(result);
  } catch (e) {
    console.error('[knowledge/reindex]', e);
    return NextResponse.json({ ok: false, reason: 'indexing failed' }, { status: 500 });
  }
}
