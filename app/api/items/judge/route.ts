import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { judgeWork, type JudgeInput } from '@/lib/work/judge';

export const maxDuration = 30;

// GET /api/items/judge?kind=inbox|commitment&id=… — THE ONE WORK JUDGMENT, served (judged-room J1/J2).
// Cached on the item (sig on activity + pool), so repeat loads cost zero AI. Every surface mounts
// from THIS verdict — no local inference.
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const kind = request.nextUrl.searchParams.get('kind');
    const id = request.nextUrl.searchParams.get('id');
    if ((kind !== 'inbox' && kind !== 'commitment') || !id) {
      return NextResponse.json({ error: 'kind (inbox|commitment) and id required' }, { status: 400 });
    }
    const verdict = await judgeWork(supabase, user.id, { kind, id } as JudgeInput);
    // The verdict MOVES the posture (read-time reconcile precedent): an expired/answered none
    // resolves the item right here — the user opens a moot item and finds it honestly filed,
    // with the narration + undo in place, instead of a dead task pretending to be work.
    const { applyVerdictConsequences } = await import('@/lib/work/apply-verdict');
    const applied = await applyVerdictConsequences(supabase, user.id, { kind, id } as JudgeInput, verdict);
    return NextResponse.json({ verdict, applied });
  } catch (e) {
    console.error('[items/judge]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
