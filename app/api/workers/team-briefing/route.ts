import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { getSystemClient } from '@/lib/ai/factory';

export const runtime = 'nodejs';
export const maxDuration = 30;

function sseStream(text: string): Response {
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text_delta', text })}\n\n`));
      controller.enqueue(encoder.encode('data: {"type":"done","cached":true}\n\n'));
      controller.close();
    },
  });
  return new Response(readable, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } });
}

function relTime(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(Math.abs(diff) / 60000);
  const past = diff >= 0;
  if (m < 60) return past ? `${m}m ago` : `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return past ? `${h}h ago` : `in ${h}h`;
  const d = Math.floor(h / 24);
  return past ? `${d}d ago` : `in ${d}d`;
}

// POST /api/workers/team-briefing — conversational, first-team-member narration
// of what the user's AI coworkers have been doing. The team-level analogue of
// /api/workers/[id]/briefing. Strictly grounded in the passed homeData; the
// model is told not to invent. Distinguishes scheduled (autonomous) vs.
// user-asked work so reasoning stays honest.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single();
  const firstName = (profile as { full_name: string | null } | null)?.full_name?.split(' ')[0] ?? '';

  // Cache read — tolerant of the team_briefing column not existing yet (migration
  // not applied → degrades to no-cache, still works).
  let cached: { text: string; generated_at: string } | null = null;
  try {
    const { data: cacheRow } = await supabase.from('profiles').select('team_briefing').eq('id', user.id).single();
    cached = (cacheRow as { team_briefing?: { text: string; generated_at: string } | null } | null)?.team_briefing ?? null;
  } catch { /* column missing — no cache */ }

  const body = await req.json().catch(() => ({}));
  const home = body.homeData as {
    workers?: { name: string }[];
    recentActivity?: { workflowName: string; workerName: string | null; status: string; triggeredBy: string; completedAt: string | null }[];
    needsReview?: { title: string; type: string; workerName: string | null; createdAt: string }[];
    upcoming?: { workflowName: string; workerName: string | null; nextRunAt: string }[];
  } | null;

  // ── Cache: regenerate only when there's newer activity than the last briefing ──
  const activityTimes = [
    ...(home?.recentActivity ?? []).map(a => a.completedAt),
    ...(home?.needsReview ?? []).map(r => r.createdAt),
  ].filter(Boolean) as string[];
  const lastActivityAt = activityTimes.sort().at(-1) ?? null;
  if (cached?.text && cached?.generated_at) {
    const fresh = !lastActivityAt || cached.generated_at > lastActivityAt;
    if (fresh) return sseStream(cached.text);
  }

  const teamNames = (home?.workers ?? []).map(w => w.name);
  const lines: string[] = [];

  if (home?.recentActivity?.length) {
    lines.push('WHAT YOUR COWORKERS DID (most recent first):');
    for (const a of home.recentActivity) {
      const trigger = a.triggeredBy === 'manual' ? 'because the user asked them to in chat' : 'on its own schedule (autonomous)';
      const status = a.status === 'succeeded' ? 'completed' : 'failed';
      lines.push(`- ${a.workerName ?? 'A coworker'} ${status} "${a.workflowName}" ${trigger}${a.completedAt ? `, ${relTime(a.completedAt)}` : ''}`);
    }
    lines.push('');
  }

  if (home?.needsReview?.length) {
    lines.push('DELIVERABLES READY FOR THE USER:');
    for (const r of home.needsReview.slice(0, 6)) {
      lines.push(`- "${r.title}" (${r.type})${r.workerName ? ` by ${r.workerName}` : ''}, ${relTime(r.createdAt)}`);
    }
    lines.push('');
  }

  if (home?.upcoming?.length) {
    lines.push('COMING UP:');
    for (const u of home.upcoming) {
      lines.push(`- ${u.workerName ?? 'A coworker'} will run "${u.workflowName}" ${relTime(u.nextRunAt)}`);
    }
    lines.push('');
  }

  const context = lines.join('\n');
  const nothing = !home?.recentActivity?.length && !home?.needsReview?.length && !home?.upcoming?.length;

  const prompt = `You are the voice of ${firstName ? `${firstName}'s` : 'the'} AI coworker team${teamNames.length ? ` (${teamNames.join(', ')})` : ''}. You're giving ${firstName || 'them'} a warm, brief update on what the team has been up to.

CONTEXT (the only facts you may use — do not invent anything):
${context || '(The team has not done anything yet.)'}

Write a short, conversational team update. Rules:
- 2–4 sentences, natural and warm, like a chief-of-staff briefing a principal.
- Refer to coworkers by name and say what they did AND briefly why (scheduled vs. the user asked) — make it feel like real colleagues, not a log.
- Lead with what matters most (anything ready for review).
- Plain text only — no markdown, asterisks, bullet symbols, or headings.
- Do NOT invent tasks, outcomes, or reasoning beyond the context. No "I noticed", "it seems".
${nothing ? '- The team is new with no activity yet: in one or two sentences, warmly introduce the team and invite them to delegate their first piece of work.' : `- Address ${firstName ? `"${firstName}"` : 'them'} by name if natural.`}`;

  const { client, model } = getSystemClient('conversation');

  const stream = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: true,
    max_tokens: 240,
    temperature: 0.6,
  });

  const encoder = new TextEncoder();
  let fullText = '';
  const generatedAt = new Date().toISOString();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) { fullText += delta; controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text_delta', text: delta })}\n\n`)); }
          if (chunk.choices[0]?.finish_reason) controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'));
        }
      } catch {
        controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'));
      } finally {
        controller.close();
        // Cache so we don't regenerate until there's new activity.
        if (fullText.trim()) {
          const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
          admin.from('profiles')
            .update({ team_briefing: { text: fullText.trim(), generated_at: generatedAt } })
            .eq('id', user.id)
            .then(() => {}, () => {});
        }
      }
    },
  });

  return new Response(readable, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  });
}
