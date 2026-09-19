// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE BULK-DEED PREVIEW DOOR (docs/attention-plan.md, A7).
//
// Thin by design: auth, then `prepareBulkDeed`. Every law — the member derivation, the honest
// unsubscribe breakdown, the stored-fact preview — lives in `lib/deeds/bulk.ts`, so the spoken door
// and this one cannot compute a different deed. ZERO AI on this path.
//
// A PREVIEW IS NOT A DEED: nothing here archives, trashes, unsubscribes or closes anything. The
// only thing that happens is a `bulk_deed` row coming into existence.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { prepareBulkDeed, BULK_VERBS, type BulkVerb } from '@/lib/deeds/bulk';
import type { HeldClassId } from '@/lib/home/attention';

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { verb?: string; classKey?: string | null; itemIds?: unknown } = {};
  try { body = await req.json(); } catch { /* an empty body is a bad request, handled below */ }

  const verb = String(body.verb ?? '') as BulkVerb;
  if (!(BULK_VERBS as readonly string[]).includes(verb)) {
    return NextResponse.json({ error: `verb must be one of ${BULK_VERBS.join(', ')}` }, { status: 400 });
  }
  const itemIds = Array.isArray(body.itemIds) ? body.itemIds.map(String).filter(Boolean) : undefined;

  const res = await prepareBulkDeed(supabase, user.id, {
    verb,
    classKey: (body.classKey ?? null) as HeldClassId | null,
    itemIds,
    selfEmail: user.email ?? null,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ deed: res.deed });
}
