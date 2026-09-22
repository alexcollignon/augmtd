// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE RE-READ DOOR — a persisted collection card is a POINTER, never a snapshot.
//
// The bulk-deed precedent (attention-plan A7), one kind over: what a card shows on a reload must be
// what is TRUE now, not what was true when it was spoken. So a `collection_card` turn stores only
// `{kind, params}` and this door re-derives the rows through the ONE builder every surface uses.
//
// GET ONLY. Read-only, user-scoped, zero AI — a collection card's own VERBS go through the doors
// those objects already own (the workflows ledger's PATCH/run doors, the library's viewer). No
// mutation of any kind lives at this address.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isCollectionKind } from '@/lib/present/collection';
import { buildCollection } from '@/lib/present/build';

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const kind = sp.get('kind');
  if (!isCollectionKind(kind)) return NextResponse.json({ error: 'unknown collection' }, { status: 400 });

  // THE RE-READ KEY IS THE POINTER'S OWN PARAMS — every search param but `kind`, as the strings the
  // card stored. The builder owns what it understands; nothing here interprets them.
  const params: Record<string, string> = {};
  sp.forEach((v, k) => { if (k !== 'kind') params[k] = v; });

  try {
    const spec = await buildCollection(supabase, user.id, kind, params);
    if (!spec) return NextResponse.json({ error: 'that set is not on file' }, { status: 404 });
    return NextResponse.json({ spec });
  } catch {
    return NextResponse.json({ error: 'that set could not be read' }, { status: 500 });
  }
}
