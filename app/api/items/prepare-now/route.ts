import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { buildWorkItems } from '@/lib/work-items/model';
import { prepareOneItem } from '@/lib/prepare/pass';

export const maxDuration = 120; // one draft, or one coworker delegation dispatch

// POST /api/items/prepare-now — the ON-DEMAND trigger of THE ONE preparation engine (work-loop W4).
// { kind: 'inbox' | 'commitment', id } → runs prepareOneItem for that single spine row, right now.
// Same engine the cron pass walks; same idempotency; NOTHING sends (approve-before-commit holds).
// Returns { did, worker?, reason? } — honest about what happened, including "nothing applies".
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = (await request.json()) as { kind?: string; id?: string };
    const kind = body.kind === 'commitment' ? 'commit' : body.kind === 'inbox' ? 'inbox' : null;
    if (!kind || !body.id) return NextResponse.json({ error: 'kind (inbox|commitment) and id required' }, { status: 400 });

    // The engine writes cross-row artifacts (pool deliverables, delegation threads) — service role,
    // scoped to the AUTHED user's id everywhere (same posture as the cron walker).
    const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const todayStr = new Date().toISOString().slice(0, 10);
    const items = await buildWorkItems(admin, user.id, { todayStr, skipReconcile: true });
    const w = items.find((x) => x.id === `${kind}:${body.id}`);
    if (!w) return NextResponse.json({ error: 'item not found on your board' }, { status: 404 });

    const result = await prepareOneItem(admin, user.id, w);
    return NextResponse.json(result);
  } catch (e) {
    console.error('[items/prepare-now]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
