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
    const { reason } = await request.json();

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

    // Mark as dismissed
    const { error: updateError } = await supabase
      .from('inbox_items')
      .update({
        status: 'dismissed',
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
