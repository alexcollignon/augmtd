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

    // 1. Fetch active processes
    const { data: processes } = await adminClient
      .from('processes')
      .select('id, title, current_step_index')
      .eq('user_id', user.id)
      .in('status', ['active', 'in_progress'])
      .limit(3);

    const activeProcessIds = (processes ?? []).map((p: { id: string }) => p.id);

    // 2 & 3 — fetch in parallel (steps depend on process ids, meetings are independent)
    const [stepsResult, meetingsResult] = await Promise.all([
      activeProcessIds.length > 0
        ? adminClient
            .from('process_steps')
            .select('title, description, step_type')
            .in('process_id', activeProcessIds)
            .eq('status', 'in_progress')
            .limit(3)
        : Promise.resolve({ data: [] }),
      adminClient
        .from('calendar_events')
        .select('title, start_time')
        .eq('user_id', user.id)
        .gt('start_time', new Date().toISOString())
        .order('start_time', { ascending: true })
        .limit(2),
    ]);

    const inProgressSteps: { title: string }[] = stepsResult.data ?? [];
    const upcomingMeetings: { title: string; start_time: string }[] = meetingsResult.data ?? [];

    // Build prompts — specific ones first, fallbacks fill the rest
    const specific: string[] = [];

    if (inProgressSteps.length > 0) {
      specific.push(`Help me complete "${inProgressSteps[0].title}"`);
    }

    if (processes && processes.length > 0) {
      specific.push(`What's the next step in "${processes[0].title}"?`);
    }

    if (upcomingMeetings.length > 0) {
      specific.push(`Prep me for my ${upcomingMeetings[0].title} meeting`);
    }

    // Deduplicate and pad with fallbacks to reach exactly 4
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
