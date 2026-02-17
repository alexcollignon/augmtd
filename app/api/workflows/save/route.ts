import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/workflows/save - Save a workflow for reuse
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      name,
      description,
      category,
      inputs,
      steps,
      outputs,
      estimatedTime,
      department,
      sourceType,
      templateId,
    } = body;

    // Validate required fields
    if (!name || !category || !steps || !Array.isArray(steps)) {
      return NextResponse.json(
        { error: 'Missing required fields: name, category, steps' },
        { status: 400 }
      );
    }

    // Create workflow
    const { data: workflow, error } = await supabase
      .from('user_workflows')
      .insert({
        user_id: user.id,
        name,
        description,
        category,
        inputs: inputs || [],
        steps,
        outputs: outputs || [],
        estimated_time: estimatedTime,
        department,
        source_type: sourceType || 'user_created',
        template_id: templateId,
      })
      .select()
      .single();

    if (error) {
      console.error('[Workflows API] Error creating workflow:', error);
      return NextResponse.json(
        { error: 'Failed to create workflow' },
        { status: 500 }
      );
    }

    return NextResponse.json({ workflow }, { status: 201 });
  } catch (error) {
    console.error('[Workflows API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
