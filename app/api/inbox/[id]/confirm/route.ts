import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ContextService } from '@/lib/context/context-service';

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
    const { action } = await request.json();

    if (!['confirm_as_mine', 'not_my_task'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action' },
        { status: 400 }
      );
    }

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

    const now = new Date().toISOString();

    // Update user confirmation
    const confirmationUpdate: Record<string, any> = {
      user_confirmation: {
        status: action === 'confirm_as_mine' ? 'confirmed' : 'rejected',
        confirmedAt: now,
        confirmedAction: action,
        previousSuggestionLevel: item.recipient_context?.suggestionLevel,
      },
      // If confirmed, move to "prepared" section; if rejected, dismiss like the dismiss button
      visual_section: action === 'confirm_as_mine' ? 'prepared' : item.visual_section,
      updated_at: now,
      // not_my_task dismisses the item — stamp source_data.resolved_at (the REAL resolution timestamp
      // the Day-cleared ring counts by) alongside the status flip.
      ...(action === 'not_my_task' && {
        status: 'dismissed',
        source_data: { ...((item.source_data ?? {}) as Record<string, any>), resolved_at: now },
      }),
    };

    const { error: updateError } = await supabase
      .from('inbox_items')
      .update(confirmationUpdate)
      .eq('id', id)
      .eq('user_id', user.id);

    if (updateError) {
      console.error('Error updating confirmation:', updateError);
      return NextResponse.json(
        { error: 'Failed to update confirmation' },
        { status: 500 }
      );
    }

    // Log learning signal and trigger context update
    await ContextService.logConfirmation(
      user.id,
      id,
      action,
      {
        role: item.recipient_context?.detectedRole,
        position_in_to: item.recipient_context?.position,
        confidence_score: item.recipient_context?.responsibilityConfidence,
        previous_section: item.visual_section,
        has_mention: item.recipient_context?.hasMention,
        has_explicit_assignment: item.recipient_context?.hasExplicitAssignment,
      }
    );

    return NextResponse.json({
      success: true,
      action,
      newSection: confirmationUpdate.visual_section,
    });

  } catch (error) {
    console.error('Confirmation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
