// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE APPLY DOOR (stabilization W0.3b — the ONE way a prepared change becomes real)
//
// Four promises, the event deeds door's, one object over:
//   1. THE CLIENT'S WORD IS NEVER TRUSTED. The row is re-read under the session user; ownership is
//      the read itself (a stranger's id is a 404, byte-identical to a missing one).
//   2. THE ARGUMENTS ARE THE STORED ONES. The door takes nothing but the id — what applies is what
//      the card showed, and the model that prepared it cannot widen it from here.
//   3. EXACTLY-ONCE. `applyChange` claims `pending_change:<id>` on the commit door before the
//      executor runs; a double-click returns the first result. A failure releases the claim.
//   4. THE ANSWER IS THE TRUTH AFTERWARDS. The fresh spec comes back so the card settles from it.
//
// The user's own session is the only caller: no bearer, no user_id in the body, no admin client.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { applyChange } from '@/lib/work/pending-change';

export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const out = await applyChange(supabase, user.id, id);
  switch (out.status) {
    case 'not_found':
      return NextResponse.json({ error: 'that change is not on file' }, { status: 404 });
    case 'expired':
      return NextResponse.json({ error: 'expired', reason: 'That one expired — ask again and I’ll prepare it afresh.', spec: out.spec }, { status: 409 });
    case 'not_pending':
      return NextResponse.json({ error: 'not_pending', reason: 'This change has already been settled.', spec: out.spec }, { status: 409 });
    case 'duplicate':
      // IN FLIGHT IS NOT DONE: a claim with no result yet is on its way; a recorded one is served.
      return out.result == null
        ? NextResponse.json({ error: 'in_progress', reason: 'That is already on its way — give it a moment.', spec: out.spec }, { status: 409 })
        : NextResponse.json({ ok: true, duplicate: true, result: out.result, spec: out.spec });
    case 'failed':
      return NextResponse.json({ error: 'failed', reason: out.reason, spec: out.spec }, { status: 502 });
    case 'applied':
      return NextResponse.json({ ok: true, result: out.result, spec: out.spec });
  }
}
