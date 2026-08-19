// ─── POST /api/workflows/runs/[id]/nudge — THE CHASE ON DEMAND (processes arc Phase B) ────────
// The owner's "still waiting?" button. ONE VERB, ONE DOOR: it fires the exact behaviour the SLA
// sweep fires (`nudgeHandoff` → the coworker emails the assignee, the owner's room records it),
// under the exact same ≤1/day cap — a button that could out-chase the cron would be a second
// implementation of the same deed. Owner-only; an assignee nudging themselves is meaningless and
// anyone else gets nothing.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFeature, handleWorkspaceError } from '@/lib/workspace/require-feature';

export const maxDuration = 30;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

    const { createClient: createAdmin } = await import('@supabase/supabase-js');
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { nudgeHandoff } = await import('@/lib/workflows/handoffs');
    const r = await nudgeHandoff(admin, runId, { byUserId: user.id });
    if (r.capped) return NextResponse.json({ ok: false, capped: true });
    if (!r.ok) return NextResponse.json({ error: 'nothing to nudge' }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[runs/nudge]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
