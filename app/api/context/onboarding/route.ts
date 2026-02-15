import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { initializeUserContext } from '@/lib/context/profile-adapter';

interface OnboardingRequest {
  fullName: string;
  role: string;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const { fullName, role }: OnboardingRequest = await request.json();

    if (!fullName?.trim() || !role?.trim()) {
      return NextResponse.json(
        { error: 'Full name and role are required' },
        { status: 400 }
      );
    }

    // Save to profiles table
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: user.id,
        full_name: fullName.trim(),
        email: user.email,
      });

    if (profileError) {
      console.error('[Onboarding] Failed to update profile:', profileError);
      // Continue anyway - not critical
    }

    // Initialize modular context profiles
    try {
      await initializeUserContext(
        user.id,
        fullName.trim(),
        role.trim(),
        user.email || '',
        supabase
      );
    } catch (saveError) {
      console.error('[Onboarding] Failed to initialize context profiles:', saveError);
      return NextResponse.json(
        { error: 'Failed to save information' },
        { status: 500 }
      );
    }

    console.log('[Onboarding] Successfully saved user info for', user.id, '- Role:', role);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Onboarding] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
