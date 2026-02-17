import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { decomposeManualWork } from '@/lib/execution/work-decomposition';

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
    const { description, deadline } = body;

    if (!description || typeof description !== 'string') {
      return NextResponse.json(
        { error: 'Description is required' },
        { status: 400 }
      );
    }

    // Use admin client for work decomposition
    const { createClient: createAdminClient } = await import('@supabase/supabase-js');
    const adminSupabase = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Decompose the work using existing Layer 2
    const executionPlan = await decomposeManualWork(
      description,
      user.id,
      adminSupabase,
      deadline
    );

    if (!executionPlan) {
      return NextResponse.json({
        message: 'This doesn\'t appear to be executable work',
        executionPlan: null,
      });
    }

    return NextResponse.json({
      message: 'Work analyzed successfully',
      executionPlan,
    });
  } catch (error) {
    console.error('[API] Error processing work:', error);
    return NextResponse.json(
      { error: 'Failed to process work' },
      { status: 500 }
    );
  }
}
