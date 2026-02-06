import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Delete Gmail connection
    const { error: deleteError } = await supabase
      .from('connections')
      .delete()
      .eq('user_id', user.id)
      .eq('provider', 'gmail');

    if (deleteError) {
      console.error('Error disconnecting Gmail:', deleteError);
      return NextResponse.json(
        { error: 'Failed to disconnect Gmail' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Gmail disconnected successfully'
    });
  } catch (error) {
    console.error('Disconnect error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
