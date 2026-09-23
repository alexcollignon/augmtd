// ════════════════════════════════════════════════════════════════════════════════════════════════
// "LOOKS DONE — CONFIRM" · NOT YET (W11.2 — lib/evidence/looks-done.ts).
//
// POST { kind: 'commitment' | 'inbox', id, action: 'not_yet' } — the user's sticky refusal for the
// evidence standing now: the item leaves the `looks_done` state until NEW evidence arrives. "Done" is
// never handled here — it is the item's own resolution door (logged, undoable), exactly as every
// other row's ✓. RLS client; zero AI.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { refuseLooksDone } from '@/lib/evidence/looks-done';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = (await req.json().catch(() => null)) as { kind?: unknown; id?: unknown; action?: unknown } | null;
    const kind = body?.kind === 'commitment' || body?.kind === 'inbox' ? body.kind : null;
    const id = typeof body?.id === 'string' && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null;
    if (!kind || !id || body?.action !== 'not_yet') return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    const r = await refuseLooksDone(supabase, user.id, kind, id);
    if (r.error === 'nothing to refuse') return NextResponse.json({ ok: true, noop: true });
    if (r.error) return NextResponse.json({ error: 'Could not save that' }, { status: 500 });
    import('@/lib/home/bust-brief').then(({ softBustBrief }) => softBustBrief(supabase, user.id)).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Could not save that' }, { status: 500 });
  }
}
