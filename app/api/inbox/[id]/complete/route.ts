import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/activity/log';

// Derive a human title for an inbox item from its stored source_data.
function inboxItemTitle(item: { title?: string | null; source_data?: Record<string, unknown> | null }): string {
  const sd = (item.source_data || {}) as Record<string, unknown>;
  const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  return (
    pick(item.title) ||
    pick(sd.subject) ||
    pick(sd.from_name) ||
    pick(sd.from) ||
    'item'
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { action, notes } = await request.json();

    // Get current inbox item
    const { data: item, error: fetchError } = await supabase
      .from('inbox_items')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !item) {
      return NextResponse.json(
        { error: 'Inbox item not found' },
        { status: 404 }
      );
    }

    // Mark as completed. Stamp source_data.resolved_at — the REAL resolution timestamp the Day-cleared
    // ring counts by (updated_at is a leaky proxy: it bumps on any sync/label/backfill write).
    const nowIso = new Date().toISOString();
    const completeSd = (item.source_data ?? {}) as Record<string, unknown>;
    const { error: updateError } = await supabase
      .from('inbox_items')
      .update({
        status: 'completed',
        source_data: { ...completeSd, resolved_at: nowIso },
        updated_at: nowIso,
      })
      .eq('id', id)
      .eq('user_id', user.id);

    if (updateError) {
      console.error('Error completing inbox item:', updateError);
      return NextResponse.json(
        { error: 'Failed to complete item' },
        { status: 500 }
      );
    }

    // Log learning signal
    const { error: signalError } = await supabase.from('learning_signals').insert({
      user_id: user.id,
      inbox_item_id: id,
      signal_type: 'item_completed',
      signal_data: {
        action: action || 'marked_complete',
        completion_notes: notes,
        work_state: item.work_state,
        visual_section: item.visual_section,
        suggestion_level: item.recipient_context?.suggestionLevel,
        had_notes: !!notes,
        completed_at: new Date().toISOString(),
      },
    });

    if (signalError) {
      console.error('Error logging learning signal:', signalError);
      // Don't fail the request, just log the error
    }

    // Swap the mailbox label to AUGMTD/Done (honors auto_label). Non-fatal, after() so it never
    // blocks the response.
    after(async () => {
      const { reconcileItemLabel } = await import('@/lib/inbox/reconcile-item-label');
      await reconcileItemLabel({ userId: user.id, itemId: id, item, targetLabel: 'done', client: supabase });
    });

    // Activity timeline (non-fatal).
    await logActivity(supabase, user.id, {
      type: 'marked_done',
      title: `Marked done: ${inboxItemTitle(item)}`,
      entityType: 'inbox_item',
      entityId: id,
      metadata: { action: action || 'marked_complete' },
    });

    return NextResponse.json({
      success: true,
      action,
    });

  } catch (error) {
    console.error('Complete item error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
