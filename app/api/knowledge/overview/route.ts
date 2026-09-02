import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildKnowledgeOverview, type KindFilter } from '@/lib/knowledge/overview';

export const maxDuration = 15;

const KINDS = new Set(['all', 'meeting', 'attachment', 'upload', 'generated']);

// GET /api/knowledge/overview?kind=all — THE SLIM KNOWLEDGE PANEL's one read.
// The whole computation lives in lib/knowledge/overview.ts so the numbers have ONE definition
// (and a smoke can assert them without an HTTP session). This route is the door, nothing more.
// ⚠️ It used to list 400 rows and report `rows.length` as the inventory — every number here is a
// real COUNT query now; folder counts and the loose section come back from the same module.
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const raw = new URL(request.url).searchParams.get('kind') ?? 'all';
    const kind = (KINDS.has(raw) ? raw : 'all') as KindFilter;

    return NextResponse.json(await buildKnowledgeOverview(supabase, user.id, { kind }));
  } catch (e) {
    console.error('[knowledge/overview]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
