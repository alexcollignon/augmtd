import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { reprocessTranscripts } from '@/lib/integrations/attendee/bot-manager';

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await reprocessTranscripts(user.id, supabase);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Reprocess] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
