import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';

const PA_PROMPT = (name: string) => `You are ${name}'s Personal Assistant — their primary AI colleague for day-to-day work.

You have full access to their inbox, calendar, meetings, knowledge base, and the web. You use all of these proactively — you don't wait to be asked if you can see something worth surfacing.

Your job: keep them on top of what matters. Flag emails that need replies. Prep them for upcoming meetings. Draft communications in their voice. Surface action items. Handle anything a sharp, trusted assistant would handle.

When given a task, act — don't ask for clarification unless you're genuinely stuck. Make a reasonable assumption, state it briefly, and do the work. One question maximum if truly needed.`;

const CONTENT_PROMPT = (name: string) => `You are ${name}'s Content and Communications Manager — their AI colleague for professional content creation.

You understand their voice, expertise, and audience through their past communications, meetings, and knowledge base. Everything you write sounds like them, not like generic AI output.

Your job: help them create content that's worth sharing. LinkedIn posts, email drafts, reports, presentations. You find the raw material in their actual work — meetings, decisions, client interactions — and shape it into something they'd be proud to put their name on.

You have access to their inbox, meetings, calendar, web search, and knowledge base. Use them to find context and material before writing. Always show briefly where you pulled the material from.`;

// POST /api/workers/init — idempotent seed of pre-built workers for the current user
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const adminClient = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Check if user already has workers
  const { data: existing } = await adminClient
    .from('custom_agents')
    .select('id')
    .eq('user_id', user.id)
    .eq('is_worker', true)
    .limit(1);

  if (existing && existing.length > 0) {
    return NextResponse.json({ seeded: false });
  }

  // Fetch user's full name for personalised prompts
  const { data: profile } = await adminClient
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single();

  const name = (profile as { full_name: string | null } | null)?.full_name?.split(' ')[0] ?? 'you';

  await adminClient.from('custom_agents').insert([
    {
      user_id: user.id,
      name: 'Personal Assistant',
      description: 'Watches your inbox, preps meetings, surfaces what matters.',
      instructions: PA_PROMPT(name),
      color: 'indigo',
      icon: 'user',
      worker_role: 'personal_assistant',
      is_worker: true,
      is_active: true,
      web_enabled: true,
      conversation_starters: [
        'What emails need my attention today?',
        'Prep me for my next meeting',
        'What are my open action items?',
        'Draft a reply to the latest email from...',
      ],
    },
    {
      user_id: user.id,
      name: 'Content Manager',
      description: 'Writes in your voice — LinkedIn posts, emails, drafts.',
      instructions: CONTENT_PROMPT(name),
      color: 'violet',
      icon: 'pencil',
      worker_role: 'content_manager',
      is_worker: true,
      is_active: true,
      web_enabled: true,
      conversation_starters: [
        'Write a LinkedIn post about what I\'ve been working on',
        'Draft a follow-up email to my last client meeting',
        'Turn my meeting notes into a summary I can share',
        'Write a thought leadership piece on...',
      ],
    },
  ]);

  return NextResponse.json({ seeded: true });
}
