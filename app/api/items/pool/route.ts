// GET /api/items/pool?kind=email|commitment|meeting&id=<itemId> — the item's PREPARED deliverables
// (Prepared-Work: what the pass/coworkers already produced), so the deep-dive can LEAD with the artifact.
// Read-only over the per-item deliverable pool; RLS-safe (own rows via the session client).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { readPool, type Deliverable } from '@/lib/home/deliverable-pool';
import type { ItemPlanKind } from '@/lib/home/item-plan';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const kind = request.nextUrl.searchParams.get('kind') as ItemPlanKind | null;
    const id = request.nextUrl.searchParams.get('id');
    if (!kind || !id) return NextResponse.json({ error: 'kind and id required' }, { status: 400 });
    const pool = await readPool(supabase, user.id, kind, id);
    // The PREPARED slice: pass/coworker-produced work (not user uploads) — newest first for the lead card.
    const prepared = pool
      .filter((d: Deliverable) => d.task_id === 'prepare-pass' || (d.metadata as { source?: string } | null)?.source === 'run' || (d.metadata as { worker?: string } | null)?.worker)
      .reverse();
    return NextResponse.json({ prepared });
  } catch (e) {
    console.error('[items/pool]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
