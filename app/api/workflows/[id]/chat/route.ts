// POST /api/workflows/[id]/chat
// AI assistant that can answer questions about the workflow and return patches to apply.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAIClient } from '@/lib/ai/factory';
import { requireFeature, handleWorkspaceError } from '@/lib/workspace/require-feature';
import type { Workflow } from '@/lib/workflows/types';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM = `You are an AI assistant embedded in a workflow builder called Studio. You help users build, understand, and improve their automation workflows.

You can:
1. Answer questions about how the workflow works
2. Make changes by returning a patch object

Always respond with valid JSON (no markdown wrapper) in this exact shape:
{
  "reply": "Your message to the user — plain text, no markdown",
  "patch": { /* optional Partial<Workflow> */ }
}

Patch rules:
- Only include "patch" if you're making a change the user asked for
- For step changes, return the COMPLETE updated "steps" array (preserve all existing steps with their ids unless removing one)
- Step ids must be preserved. New steps get an id of "step_" + 8 random alphanumeric chars
- For name, description, trigger, output_config — return only the changed keys
- Do not hallucinate tool names; use only: web_search, fetch_url, browser_fetch, rss_feed, get_emails, get_calendar, search_knowledge, browser_navigate, linkedin_post
- Keep reply concise (1-2 sentences)`;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await params; // id unused — workflow is sent in body
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

  const body = await request.json();
  const messages: ChatMessage[] = (body.messages ?? []).slice(-20); // last 20 turns
  const workflow: Partial<Workflow> = body.workflow ?? {};

  const contextMsg = `Current workflow:\n${JSON.stringify({
    name: workflow.name,
    description: workflow.description,
    trigger: workflow.trigger,
    steps: workflow.steps,
    output_config: workflow.output_config,
  }, null, 2)}`;

  try {
    const { client, model } = await getAIClient(user.id, 'generation', supabase);
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: contextMsg },
        ...messages,
      ],
      temperature: 0.3,
      max_tokens: 2000,
    });

    const raw = (response.choices[0]?.message?.content ?? '{}').trim();
    // Strip markdown code fences if model wraps response anyway
    const clean = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    let result: { reply?: string; patch?: Partial<Workflow> } = {};
    try { result = JSON.parse(clean); } catch { /* fall through to default reply */ }

    return NextResponse.json({
      reply: result.reply ?? "I couldn't process that. Try rephrasing.",
      patch: result.patch ?? null,
    });
  } catch {
    return NextResponse.json({ reply: 'Something went wrong. Please try again.', patch: null });
  }
}
