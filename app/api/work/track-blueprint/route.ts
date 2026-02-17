import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { trackBlueprintUsage } from '@/lib/context/work-patterns-service';

/**
 * Track blueprint usage
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Auth check
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { blueprintId } = await request.json();

    if (!blueprintId) {
      return NextResponse.json(
        { error: 'Blueprint ID required' },
        { status: 400 }
      );
    }

    // Track usage
    await trackBlueprintUsage(user.id, blueprintId, supabase);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Blueprint Tracking API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to track blueprint usage' },
      { status: 500 }
    );
  }
}
