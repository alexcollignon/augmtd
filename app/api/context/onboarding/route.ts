import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { initializeUserContext } from '@/lib/context/profile-adapter';

export async function GET() {
  // Onboarding modal removed — always report completed
  return NextResponse.json({ completed: true });
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { fullName } = await request.json();

    if (!fullName?.trim()) {
      return NextResponse.json({ error: 'Full name is required' }, { status: 400 });
    }

    // Save name to profiles table
    await supabase.from('profiles').upsert({
      id: user.id,
      full_name: fullName.trim(),
      email: user.email,
    });

    // Initialize context profiles (name only — no department/role)
    try {
      await initializeUserContext(
        user.id,
        fullName.trim(),
        '',
        user.email || '',
        supabase
      );
    } catch (err) {
      console.error('[Onboarding] Failed to initialize context profiles:', err);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Onboarding] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
