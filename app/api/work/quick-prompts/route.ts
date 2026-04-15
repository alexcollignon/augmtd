import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const FALLBACKS = [
  'What should I work on today?',
  'Draft a client update email',
  'Summarize my recent emails',
  'Create a weekly status report',
];

// GET /api/work/quick-prompts — returns 4 personalized quick-start prompts
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: upcomingMeetings } = await adminClient
      .from('calendar_events')
      .select('title, start_time')
      .eq('user_id', user.id)
      .gt('start_time', new Date().toISOString())
      .order('start_time', { ascending: true })
      .limit(2);

    const specific: string[] = [];

    if (upcomingMeetings && upcomingMeetings.length > 0) {
      specific.push(`Prep me for my ${upcomingMeetings[0].title} meeting`);
    }

    const seen = new Set(specific);
    const prompts = [...specific];

    for (const fallback of FALLBACKS) {
      if (prompts.length >= 4) break;
      if (!seen.has(fallback)) {
        prompts.push(fallback);
        seen.add(fallback);
      }
    }

    return NextResponse.json({ prompts: prompts.slice(0, 4) });
  } catch (error) {
    console.error('[QuickPrompts] GET error:', error);
    return NextResponse.json({ prompts: FALLBACKS });
  }
}
