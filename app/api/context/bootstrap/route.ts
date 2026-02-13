import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServerClient } from '@supabase/supabase-js';
import { bootstrapFromSentEmails } from '@/lib/context/sent-email-analyzer';

/**
 * POST - Bootstrap user context from historical sent emails
 * Useful for existing users to get immediate personalization
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { limit } = await request.json().catch(() => ({ limit: 50 }));

    // Use service role to bypass RLS for operations
    const adminSupabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    console.log(`[Bootstrap] Starting context bootstrap for user ${user.id}...`);

    const processed = await bootstrapFromSentEmails(user.id, adminSupabase, limit);

    return NextResponse.json({
      success: true,
      message: `Bootstrapped context from ${processed} sent emails`,
      emailsProcessed: processed,
    });

  } catch (error) {
    console.error('Context bootstrap error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
