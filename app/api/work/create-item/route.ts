import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { description, executionPlan } = body;

    if (!description || !executionPlan) {
      return NextResponse.json(
        { error: 'Description and execution plan are required' },
        { status: 400 }
      );
    }

    // Create inbox item with execution plan
    const { data: inboxItem, error: insertError } = await supabase
      .from('inbox_items')
      .insert({
        user_id: user.id,
        source: 'manual',
        work_state: 'action_required',
        work_title: executionPlan.deliverable_description,
        what_i_prepared: `Execute ${executionPlan.steps.length}-step plan to create ${executionPlan.deliverable_type}`,
        why_matters: description,
        visual_section: 'prepared',

        // Execution fields (Layer 2)
        is_executable: true,
        execution_plan: executionPlan,
        execution_status: 'queued',
        current_step: 0,
        artifacts: [],

        // Source data
        source_data: {
          description,
          created_via: 'manual_entry',
          deliverable_type: executionPlan.deliverable_type,
        },

        status: 'pending',
        needs_review: false,
        priority: 70,
      })
      .select()
      .single();

    if (insertError) {
      console.error('[API] Error creating inbox item:', insertError);
      return NextResponse.json(
        { error: 'Failed to create inbox item' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: 'Work item created successfully',
      item: inboxItem,
    });
  } catch (error) {
    console.error('[API] Error creating work item:', error);
    return NextResponse.json(
      { error: 'Failed to create work item' },
      { status: 500 }
    );
  }
}
