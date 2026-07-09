import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { getSystemClient } from '@/lib/ai/factory';
import { logAIUsage } from '@/lib/ai/log-usage';

export const runtime = 'nodejs';
export const maxDuration = 30;

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function timeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'soon';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.floor(hours / 24)}d`;
}

function formatDuration(ms: number | null): string {
  if (!ms || ms <= 0) return '';
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
}

function triggerLabel(triggeredBy: string): string {
  if (triggeredBy === 'schedule') return 'scheduled (automatic)';
  if (triggeredBy === 'manual') return 'user-triggered from chat';
  return triggeredBy;
}

function sseStream(text: string): Response {
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text_delta', text })}\n\n`));
      controller.enqueue(encoder.encode('data: {"type":"done","cached":true}\n\n'));
      controller.close();
    },
  });
  return new Response(readable, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: workerId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  // Fetch worker identity + cached briefing
  const { data: worker } = await supabase
    .from('custom_agents')
    .select('name, description, instructions, worker_role, home_briefing')
    .eq('id', workerId)
    .eq('user_id', user.id)
    .eq('is_worker', true)
    .single();
  if (!worker) return new Response('Not found', { status: 404 });

  // ── Staleness check ────────────────────────────────────────────────────────
  // Find the most recent activity: last task run completed_at OR last thread updated_at.
  const [{ data: lastRunRow }, { data: lastThreadRow }] = await Promise.all([
    supabase
      .from('workflow_runs')
      .select('completed_at, workflows!inner(agent_id)')
      .eq('workflows.agent_id', workerId)
      .in('status', ['succeeded', 'failed'])
      .order('completed_at', { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from('work_threads')
      .select('updated_at')
      .eq('agent_id', workerId)
      .eq('user_id', user.id)
      .is('workflow_id', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single(),
  ]);

  const lastRunAt = (lastRunRow as any)?.completed_at ?? null;
  const lastThreadAt = lastThreadRow?.updated_at ?? null;
  const lastActivityAt = [lastRunAt, lastThreadAt]
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  const cached = worker.home_briefing as { text: string; generated_at: string } | null;
  if (cached?.text && cached?.generated_at) {
    // Cache is fresh if briefing was generated after the last meaningful activity
    const isFresh = !lastActivityAt || cached.generated_at > lastActivityAt;
    if (isFresh) return sseStream(cached.text);
  }

  // ── Generate new briefing ──────────────────────────────────────────────────
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single();
  const firstName = (profile as { full_name: string | null } | null)?.full_name?.split(' ')[0] ?? '';

  const body = await req.json().catch(() => ({}));
  const homeData = body.homeData as {
    recentRuns: {
      workflowName: string;
      status: string;
      triggeredBy: string;
      startedAt: string | null;
      completedAt: string | null;
      durationMs: number | null;
      stepOutputs: { label: string; output: string; error?: string }[];
      artifacts: { id: string; title: string }[];
    }[];
    upcomingRuns: { workflowName: string; nextRunAt: string }[];
    threadCount: number;
    recentThreadTitles: string[];
  } | null;

  const isFirstVisit = !homeData?.threadCount && !homeData?.recentRuns?.length;

  // Build context block
  const lines: string[] = [];

  if (homeData?.recentRuns?.length) {
    lines.push('RECENT TASK RUNS:');
    for (const run of homeData.recentRuns) {
      const time = relativeTime(run.completedAt);
      const duration = formatDuration(run.durationMs);
      const trigger = triggerLabel(run.triggeredBy);
      const statusStr = run.status === 'succeeded' ? 'succeeded' : 'failed';

      lines.push(`- Task: "${run.workflowName}"`);
      lines.push(`  Trigger: ${trigger}`);
      lines.push(`  Status: ${statusStr}${duration ? ` (took ${duration})` : ''}${time ? `, completed ${time}` : ''}`);

      const meaningful = run.stepOutputs.filter(s => s.label);
      if (meaningful.length > 0) {
        lines.push('  Steps:');
        for (const step of meaningful) {
          const out = step.output ? ` → ${step.output.slice(0, 100)}` : '';
          const err = step.error ? ` [error: ${step.error}]` : '';
          lines.push(`    • ${step.label}${out}${err}`);
        }
      }
      if (run.artifacts.length > 0) {
        lines.push(`  Output: ${run.artifacts.map(a => `"${a.title}"`).join(', ')}`);
      }
    }
    lines.push('');
  }

  if (homeData?.upcomingRuns?.length) {
    lines.push('UPCOMING SCHEDULED TASKS:');
    for (const r of homeData.upcomingRuns) {
      lines.push(`- "${r.workflowName}": ${timeUntil(r.nextRunAt)}`);
    }
    lines.push('');
  }

  const threadCount = homeData?.threadCount ?? 0;
  const recentTitles = homeData?.recentThreadTitles ?? [];
  if (threadCount > 0 || recentTitles.length > 0) {
    lines.push('CONVERSATION HISTORY:');
    lines.push(`- Total threads with ${firstName || 'the user'}: ${threadCount}`);
    if (recentTitles.length > 0) {
      lines.push(`- Recent topics: ${recentTitles.map(t => `"${t}"`).join(', ')}`);
    }
    lines.push('');
  }

  const contextBlock = lines.join('\n');

  const systemPrompt = `You are ${worker.name}. ${worker.description ?? ''}

Your role and working style:
${worker.instructions ? worker.instructions.split('\n').slice(0, 8).join('\n') : ''}

---

CONTEXT FOR THIS CHECK-IN:
${contextBlock || '(No task history or conversations yet.)'}

---

IMPORTANT CONTEXT NOTES:
- "Scheduled (automatic)" runs = tasks you executed autonomously without being asked
- "User-triggered from chat" runs = the user explicitly asked you to run that task in a conversation — this is NOT a retry, it is a separate user-initiated action
- If the same task appears multiple times with different triggers, they are distinct events
- Duration reflects how long each run actually took

---

TASK:
${firstName || 'The user'} just opened your home page.${isFirstVisit ? ' This is their first time visiting.' : ''}

Write a brief, natural check-in in first person. 2–4 sentences. Rules:
- Use the factual context above — do not invent or assume anything not stated
- Distinguish clearly between work you did autonomously vs. what the user explicitly asked you to run
- Be direct. No "I noticed", "It seems", "I wanted to let you know"
- Don't summarise everything — lead with what's most relevant right now
- Sound like a colleague giving a quick update, not a system generating a report
${isFirstVisit ? '- This is a first meeting: introduce yourself and what you can help with' : `- Address ${firstName ? `"${firstName}"` : 'the user'} by name if it feels natural`}`;

  const { client, model, endpoint, tier } = getSystemClient('conversation');

  const stream = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: systemPrompt }],
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: 220,
    temperature: 0.65,
  });

  const encoder = new TextEncoder();
  let fullText = '';
  let promptTokens = 0;
  let completionTokens = 0;
  const generatedAt = new Date().toISOString();

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (chunk.usage) {
            promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
            completionTokens = chunk.usage.completion_tokens ?? completionTokens;
          }
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text_delta', text: delta })}\n\n`));
          }
          if (chunk.choices[0]?.finish_reason) {
            controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'));
          }
        }
      } catch {
        controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'));
      } finally {
        controller.close();
        // Persist to DB after stream closes
        if (fullText.trim()) {
          const admin = createAdmin(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
          );
          admin.from('custom_agents')
            .update({ home_briefing: { text: fullText.trim(), generated_at: generatedAt } })
            .eq('id', workerId)
            .then(() => {}, () => {});
          logAIUsage(admin, {
            userId: user.id, agentId: workerId, source: 'worker_briefing', provider: endpoint.provider, model, tier, taskType: 'conversation',
            usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
          }).catch(() => {});
        }
      }
    },
  });

  return new Response(readable, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  });
}
