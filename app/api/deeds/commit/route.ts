// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE BULK COMMIT DOOR (docs/attention-plan.md, A7: "ONE commit door").
//
// Thin: auth, then `commitBulkDeed`. Exactly-once lives in the engine's atomic claim, so a double
// click or a retried request returns the FIRST result rather than acting twice — this route needs
// no idempotency logic of its own, and must never grow any.
//
// The deed acted on is the STORED one. A request carries a deed id and nothing else: there is no
// way to hand this door a list of items, so nothing can be committed that was never previewed.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { commitBulkDeed } from '@/lib/deeds/bulk';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { deedId?: string } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const deedId = String(body.deedId ?? '').trim();
  if (!deedId) return NextResponse.json({ error: 'deedId is required' }, { status: 400 });

  const res = await commitBulkDeed(supabase, user.id, deedId);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 404 });
  return NextResponse.json({ deed: res.deed, alreadyCommitted: res.alreadyCommitted });
}
