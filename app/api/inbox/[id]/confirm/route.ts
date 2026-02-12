import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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

    // Update user confirmation
    const confirmationUpdate = {
      user_confirmation: {
        status: action === 'confirm_as_mine' ? 'confirmed' : 'rejected',
        confirmedAt: new Date().toISOString(),
        confirmedAction: action,
        previousSuggestionLevel: item.recipient_context?.suggestionLevel,
      },
      // If confirmed, move to "prepared" section
      visual_section: action === 'confirm_as_mine' ? 'prepared' : item.visual_section,
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

    // Log learning signal for future improvements
    await supabase.from('learning_signals').insert({
      user_id: user.id,
      inbox_item_id: id,
      signal_type: action === 'confirm_as_mine' ? 'suggestion_confirmed' : 'suggestion_rejected',
      signal_data: {
        action,
        previous_section: item.visual_section,
        new_section: confirmationUpdate.visual_section,
        suggestion_level: item.recipient_context?.suggestionLevel,
        detected_role: item.recipient_context?.detectedRole,
        confidence: item.recipient_context?.responsibilityConfidence,
        position: item.recipient_context?.position,
      },
    });

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
