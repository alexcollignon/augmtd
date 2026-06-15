import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { WorkersPageClient } from '@/app/workers/workers-page-client';
import type { WorkersPageClientProps } from '@/app/workers/workers-page-client';

// Inline worker seed — avoids fragile self-HTTP fetch that can 401 silently
async function seedWorkersIfNeeded(userId: string, firstName: string) {
  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: existing } = await admin
    .from('custom_agents')
    .select('worker_role')
    .eq('user_id', userId)
    .eq('is_worker', true);

  const existingRoles = new Set((existing ?? []).map((r: { worker_role: string }) => r.worker_role));

  const PA_PROMPT = `Your name is Clara. You are ${firstName}'s Personal Assistant — their primary AI colleague for day-to-day work.

You have full access to their inbox, calendar, meetings, knowledge base, and the web. You use all of these proactively — you don't wait to be asked if you can see something worth surfacing.

Your job: keep them on top of what matters. Flag emails that need replies. Prep them for upcoming meetings. Draft communications in their voice. Surface action items. Handle anything a sharp, trusted assistant would handle.

When given a task, act — don't ask for clarification unless you're genuinely stuck. Make a reasonable assumption, state it briefly, and do the work. One question maximum if truly needed.`;

  const CONTENT_PROMPT = `Your name is Sofia. You are ${firstName}'s Content Strategist — their AI colleague for professional content creation and communications.

You understand their voice, expertise, and audience through their past communications, meetings, and knowledge base. Everything you write sounds like them, not like generic AI output.

Your job: help them create content that earns its place. Email drafts, client reports, proposals, presentations, internal communications. You find the raw material in their actual work — meetings, decisions, client interactions — and shape it into something they'd be proud to put their name on.

You have access to their inbox, meetings, calendar, web search, and knowledge base. Use them to find context and material before writing. Always show briefly where you pulled the material from.`;

  const LINKEDIN_PROMPT = `Your name is Luca. You are ${firstName}'s LinkedIn Post Drafter — their AI colleague for professional social content.

Your job: write LinkedIn posts that sound like ${firstName}, not like AI. You source material from their real work — meetings they had, emails they sent, decisions they made, things they're reading. You don't make things up or write generic thought leadership.

You know how LinkedIn works: hooks that earn the scroll, specific details that build credibility, a point of view that invites a reaction. You write concisely, avoid corporate clichés, and always anchor posts in something concrete.

When drafting, always show where you pulled the material from — a meeting, an email thread, a news story. Always offer 2 variants: one direct and punchy, one narrative. Let ${firstName} decide which direction works.

You have access to their inbox, calendar, meetings, knowledge base, and web search. Use them to find real material before you write a word.`;

  const RESEARCH_PROMPT = `Your name is Max. You are ${firstName}'s Research Analyst — their AI colleague for intelligence gathering and synthesis.

Your job: scan sources, filter for what matters, and produce structured, actionable briefings. You don't summarise everything — you identify what's relevant, explain why it matters, and surface the implications.

You're rigorous: you cite sources, flag uncertainty, distinguish between fact and inference. You write for a senior audience — no padding, no obvious observations, no fluff. Every sentence earns its place.

When given a research task, you: (1) pull from the specified sources, (2) filter ruthlessly for relevance, (3) structure findings clearly with headlines and brief explanations, (4) flag anything requiring immediate attention.

You have access to web search, RSS feeds, URL fetching, the inbox, calendar, and knowledge base. Use whichever combination of sources the task requires.`;

  const allWorkers = [
    {
      worker_role: 'personal_assistant',
      user_id: userId,
      name: 'Clara',
      description: 'Watches your inbox, preps meetings, surfaces what matters.',
      instructions: PA_PROMPT,
      color: 'indigo',
      icon: 'user',
      is_worker: true,
      is_active: true,
      is_enabled: false,
      web_enabled: true,
      conversation_starters: [
        'What emails need my attention today?',
        'Prep me for my next meeting',
        'What are my open action items?',
        'Draft a reply to the latest email from...',
      ],
    },
    {
      worker_role: 'content_manager',
      user_id: userId,
      name: 'Sofia',
      description: 'Drafts client emails, reports, and presentations in your voice.',
      instructions: CONTENT_PROMPT,
      color: 'violet',
      icon: 'pencil',
      is_worker: true,
      is_active: true,
      is_enabled: false,
      web_enabled: true,
      conversation_starters: [
        'Draft a follow-up email to my last client meeting',
        'Turn my meeting notes into a summary I can share',
        'Write a thought leadership piece on...',
        'Help me respond to this email professionally',
      ],
    },
    {
      worker_role: 'linkedin_drafter',
      user_id: userId,
      name: 'Luca',
      description: 'Writes LinkedIn posts from your real work — not generic AI content.',
      instructions: LINKEDIN_PROMPT,
      color: 'blue',
      icon: 'pencil-square',
      is_worker: true,
      is_active: true,
      is_enabled: false,
      web_enabled: true,
      conversation_starters: [
        "Write a LinkedIn post about what I've been working on this week",
        'Turn my last meeting into a LinkedIn post',
        "Draft a post on a trend I'm seeing in my industry",
        'Write 2 variants for a post about...',
      ],
    },
    {
      worker_role: 'research_analyst',
      user_id: userId,
      name: 'Max',
      description: 'Scans sources, filters for what matters, produces structured briefings.',
      instructions: RESEARCH_PROMPT,
      color: 'emerald',
      icon: 'magnifying-glass',
      is_worker: true,
      is_active: true,
      is_enabled: false,
      web_enabled: true,
      conversation_starters: [
        "What's happening in my industry this week?",
        'Research the latest on...',
        'Scan my inbox and give me a brief on open threads',
        'Prepare a briefing on...',
      ],
    },
  ];

  const toInsert = allWorkers.filter(w => !existingRoles.has(w.worker_role));
  if (toInsert.length > 0) {
    await admin.from('custom_agents').insert(toInsert);
  }
}

export default async function WorkersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single();

  const fullName = (profile as { full_name: string | null } | null)?.full_name ?? null;
  const firstName = fullName?.split(' ')[0] ?? 'you';

  // Seed workers directly — no self-HTTP fetch
  await seedWorkersIfNeeded(user.id, firstName);

  // Fetch ALL workers (enabled and disabled) so the setup view can show them
  const { data: workers } = await supabase
    .from('custom_agents')
    .select('id, name, description, color, icon, worker_role, is_enabled, conversation_starters')
    .eq('user_id', user.id)
    .eq('is_worker', true)
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  // SSR threads + messages for the first enabled worker's most recent thread
  const firstEnabled = (workers ?? []).find(w => w.is_enabled) ?? null;
  const { data: initialThreads } = firstEnabled
    ? await supabase
        .from('work_threads')
        .select('id, title, created_at, updated_at, agent_id')
        .eq('user_id', user.id)
        .eq('agent_id', firstEnabled.id)
        .eq('status', 'active')
        .or('is_temporary.eq.false,is_temporary.is.null')
        .is('workflow_id', null)
        .order('updated_at', { ascending: false })
        .limit(30)
    : { data: [] };

  const firstThread = (initialThreads ?? [])[0] ?? null;
  const { data: initialMessages } = firstThread
    ? await supabase
        .from('work_messages')
        .select('id, role, content, created_at, metadata')
        .eq('thread_id', firstThread.id)
        .order('created_at', { ascending: true })
    : { data: [] };

  return (
    <WorkersPageClient
      userId={user.id}
      userFirstName={firstName}
      initialWorkers={(workers ?? []) as Parameters<typeof WorkersPageClient>[0]['initialWorkers']}
      initialThreads={initialThreads ?? []}
      initialMessages={(initialMessages ?? []) as WorkersPageClientProps['initialMessages']}
    />
  );
}
