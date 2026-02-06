import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch inbox item
    const { data: item, error: itemError } = await supabase
      .from('inbox_items')
      .select('*')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single();

    if (itemError || !item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    if (item.status !== 'pending') {
      return NextResponse.json(
        { error: 'Item already processed' },
        { status: 400 }
      );
    }

    // Update inbox item status
    const { error: updateError } = await supabase
      .from('inbox_items')
      .update({
        status: 'rejected',
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', params.id);

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to update item status' },
        { status: 500 }
      );
    }

    // TODO: Log this rejection for learning (future: User Context Engine)
    // This will help the AI learn what kind of suggestions to avoid

    return NextResponse.json({
      success: true,
      message: 'Item rejected',
    });
  } catch (error) {
    console.error('Error rejecting item:', error);
    return NextResponse.json(
      {
        error: 'Failed to reject item',
        details: error instanceof Error ? error.message : 'Unknown',
      },
      { status: 500 }
    );
  }
}
