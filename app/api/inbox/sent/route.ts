import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/inbox/sent — returns the user's sent emails (is_from_user = true)
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: emails, error } = await supabase
      .from('emails')
      .select('id, from_address, from_name, to_addresses, subject, received_at, html_body, body, metadata')
      .eq('user_id', user.id)
      .eq('is_from_user', true)
      .order('received_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    return NextResponse.json({ emails: emails ?? [] });
  } catch (error) {
    console.error('[Sent] GET error:', error);
    return NextResponse.json({ error: 'Failed to load sent emails' }, { status: 500 });
  }
}
