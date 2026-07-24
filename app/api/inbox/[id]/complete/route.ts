import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { executeResolveInboxItem } from '@/lib/tools/item-actions';

// Thin caller over the ONE registry executor (lib/tools/item-actions.ts — P6b). The mutation,
// learning signal, activity log, and brain/label tails all live there, shared with the conversation
// core and any agent that holds the tool.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const { action, resolution_reason } = await request.json().catch(() => ({}));
    const resolvedReason = resolution_reason === 'already_handled' ? 'already_handled' : 'completed';
    const res = await executeResolveInboxItem(
      { client: supabase, userId: user.id },
      { itemId: id, resolution: 'complete', resolutionReason: resolvedReason, reason: action ?? null },
    );
    if (!res.ok) return NextResponse.json({ error: res.error ?? 'Failed to complete item' }, { status: res.error === 'Item not found' ? 404 : 500 });
    return NextResponse.json({ success: true, action });
  } catch (error) {
    console.error('Complete item error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
