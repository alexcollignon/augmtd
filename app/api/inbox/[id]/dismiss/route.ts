import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/activity/log';
import { noteItemAction } from '@/lib/entities/on-action';

function inboxItemTitle(item: { title?: string | null; source_data?: Record<string, unknown> | null }): string {
  const sd = (item.source_data || {}) as Record<string, unknown>;
  const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  return pick(item.title) || pick(sd.subject) || pick(sd.from_name) || pick(sd.from) || 'item';
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
    const { reason, resolution_reason } = await request.json().catch(() => ({} as { reason?: string; resolution_reason?: string }));
    const allowedResolutionReasons = new Set(['dismissed', 'no_longer_relevant', 'already_handled', 'incorrect_suggestion']);
    const resolvedReason = allowedResolutionReasons.has(String(resolution_reason)) ? String(resolution_reason) : 'dismissed';

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

    // Mark as dismissed. Stamp source_data.resolved_at — the REAL resolution timestamp the Day-cleared
    // ring counts by (updated_at bumps on any sync/label/backfill write, over-counting old items).
    const nowIso = new Date().toISOString();
    const dismissSd = (item.source_data ?? {}) as Record<string, unknown>;
    const { error: updateError } = await supabase
      .from('inbox_items')
      .update({
        status: 'dismissed',
        source_data: { ...dismissSd, resolved_at: nowIso, resolution_reason: resolvedReason },
        updated_at: nowIso,
      })
      .eq('id', id)
      .eq('user_id', user.id);

    if (updateError) {
      console.error('Error dismissing inbox item:', updateError);
      return NextResponse.json(
        { error: 'Failed to dismiss item' },
        { status: 500 }
      );
    }

    // Log learning signal - important for understanding false positives
    const { error: signalError } = await supabase.from('learning_signals').insert({
      user_id: user.id,
      inbox_item_id: id,
      signal_type: 'item_dismissed',
      signal_data: {
        reason,
        work_state: item.work_state,
        visual_section: item.visual_section,
        suggestion_level: item.recipient_context?.suggestionLevel,
        detected_role: item.recipient_context?.detectedRole,
      },
    });

    if (signalError) {
      console.error('Error logging learning signal:', signalError);
      // Don't fail the request, just log the error
    }

    // Swap the mailbox label to AUGMTD/Done (a dismissed thread is resolved from the mailbox's POV).
    // Honors auto_label. Non-fatal, after() so it never blocks the response.
    after(async () => {
      // L2 ACTION EVENT — the brain hears this action (entity re-synthesis + brief-cache bust).
      await noteItemAction(supabase, user.id, { kind: 'inbox_item', id }).catch(() => {});
      const { reconcileItemLabel } = await import('@/lib/inbox/reconcile-item-label');
      await reconcileItemLabel({ userId: user.id, itemId: id, item, targetLabel: 'done', client: supabase });
    });

    // Activity timeline (non-fatal).
    await logActivity(supabase, user.id, {
      type: 'dismissed',
      title: `Dismissed: ${inboxItemTitle(item)}`,
      entityType: 'inbox_item',
      entityId: id,
      metadata: { ...(reason ? { reason } : {}), resolution_reason: resolvedReason },
    });

    return NextResponse.json({
      success: true,
      reason,
    });

  } catch (error) {
    console.error('Dismiss item error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
