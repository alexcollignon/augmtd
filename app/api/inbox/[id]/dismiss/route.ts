import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { executeResolveInboxItem } from '@/lib/tools/item-actions';

// Thin caller over the ONE registry executor (lib/tools/item-actions.ts — P6b). See complete/route.ts.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const { reason, resolution_reason } = await request.json().catch(() => ({}));
    const resolvedReason = resolution_reason === 'no_longer_relevant' ? 'no_longer_relevant' : 'dismissed';
    const res = await executeResolveInboxItem(
      { client: supabase, userId: user.id },
      { itemId: id, resolution: 'dismiss', resolutionReason: resolvedReason, reason: reason ?? null },
    );
    if (!res.ok) return NextResponse.json({ error: res.error ?? 'Failed to dismiss item' }, { status: res.error === 'Item not found' ? 404 : 500 });
    return NextResponse.json({ success: true, reason });
  } catch (error) {
    console.error('Dismiss item error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
