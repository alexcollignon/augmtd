// POST /api/workflows/[id]/chat
// AI assistant that can answer questions about the workflow and return patches to apply.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { requireFeature, handleWorkspaceError } from '@/lib/workspace/require-feature';
import type { Workflow } from '@/lib/workflows/types';
import { LINKEDIN_FRAMEWORKS } from '@/lib/tools/linkedin-post';
import { mergePatchSteps } from '@/lib/workflows/merge-chat-patch';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const LINKEDIN_FRAMEWORK_IDS = LINKEDIN_FRAMEWORKS.map(f => `${f.id} ("${f.name}")`).join(', ');

const SYSTEM = `You are an AI assistant embedded in a workflow builder called Studio. You help users build, understand, and improve their automation workflows.

You can:
1. Answer questions about how the workflow works
2. Make targeted changes to any step or workflow field by returning a patch object

Always respond with valid JSON (no markdown wrapper) in this exact shape:
{
  "reply": "Your message to the user — plain text, no markdown",
  "patch": { /* optional Partial<Workflow> */ }
}

Patch rules:
- Only include "patch" if you're making a change the user asked for
- WHAT CANNOT BE DONE IS SAID, NEVER FAKED: the tools below, the step types below and the delivery homes are everything that exists. If the user asks for something none of them does (another social network, an outside system such as an accounting tool or CRM, payments, signing, SMS, automatic publishing), reply plainly that the platform cannot do that, offer the nearest real option in one sentence (e.g. "I can also draft an Instagram caption for you to post"), and return NO patch. Never add a step that pretends to do it, and never reuse a tool for a job it doesn't do.
- Reply in the language the user wrote in.
- For step changes, return the COMPLETE updated "steps" array (preserve all existing steps with their ids unless removing one)
- Step ids must be preserved. New steps get an id of "step_" + 8 random alphanumeric chars
- Return each existing step with its real fields only (id, type, label, tool, config, prompt, model_tier, output_format …). The "index" and "prompt_preview" you see below are a summary for you, NOT step fields: never return them. To leave an ai step's prompt unchanged, omit "prompt"; only write a "prompt" when the user asked to change it.

Step types (use exactly these shapes):
- {"id","type":"tool","label","tool":"<a tool name below>","config":{}}
- {"id","type":"ai","label","prompt","model_tier"} — writes from the previous steps' outputs
- {"id","type":"verify","label","rules":["the user's rule"]} — fact-checks the previous draft against the sources and the user's rules
- {"id","type":"approval","label","instruction":"what the user is deciding"} — the run pauses until the user approves; place it right before the delivery it guards
- {"id","type":"input","label","ask":"what to ask the user for"} — the run stops and asks the user for material
- For name, description, trigger, output_config — return only the changed keys
- When patching a tool step's config, merge with existing config — only change the specific fields the user asked about
- Keep reply concise (1-2 sentences)

Available tool names (exactly these, nothing else): web_search, fetch_url, browser_fetch, rss_feed, get_emails, get_urgent_emails, get_meeting_context, get_calendar, read_kb_file, read_kb_folder, slack_read_channel, slack_send, linkedin_post (drafts only — never publishes), get_pt_tenders, match_to_profiles, deep_research, get_workflow_output. Never change an existing step's tool unless the user asked for that step to change.

LINKEDIN POST step config fields (all optional — only include keys you're changing):
- instructions: string — freeform voice, audience, and writing rules directive
- vocabulary: string — comma-separated terms to seed naturally in the post
- framework: one of ${LINKEDIN_FRAMEWORK_IDS} — structural template for the post; omit or null for no framework
- tone: "thought_leadership" | "conversational" | "data_driven" — omit for default
- length: "short" | "standard" | "long"
- language: "en" | "de" | "pt"
- variants: 1 | 2 | 3 — number of drafts to produce
- include_image_prompt: boolean — whether to append a Canva/Midjourney visual prompt

AI step fields:
- prompt: string — the full system/user prompt for the reasoning step
- model_tier: "planning" | "classification" | "conversation" | "generation" | "summarization"

When the user asks to change a specific field (e.g. "set the framework to contrarian take", "add vocabulary terms", "update the instructions"), patch only that field in the relevant step's config, leaving all other config fields unchanged.`;

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

  // Include full config for tool steps so the AI can make targeted field-level edits.
  // AI step prompts are truncated to avoid blowing the context window.
  const stepSummaries = (workflow.steps ?? []).map((s, i: number) => {
    const r = s as unknown as Record<string, unknown>;
    if (r.type === 'tool') return { index: i + 1, id: r.id, type: 'tool', label: r.label, tool: r.tool, config: r.config ?? {} };
    if (r.type === 'ai')   return { index: i + 1, id: r.id, type: 'ai',   label: r.label, model_tier: r.model_tier, prompt_preview: String(r.prompt ?? '').slice(0, 200) };
    return { index: i + 1, id: r.id, type: r.type, label: r.label };
  });

  const contextMsg = `Current workflow:\n${JSON.stringify({
    name: workflow.name,
    description: workflow.description,
    trigger: workflow.trigger,
    steps: stepSummaries,
    output_config: workflow.output_config,
  }, null, 2)}`;

  try {
    const { client, model } = await getAIClient(user.id, 'generation', supabase);
    const response = await aiCreate(client, {
      model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: contextMsg },
        ...messages,
      ],
      temperature: 0.3,
      max_tokens: 2000,
    });

    const raw = (response.choices[0]?.message?.content ?? '').trim();

    let result: { reply?: string; patch?: Partial<Workflow> } = {};
    const clean = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    try {
      result = JSON.parse(clean);
    } catch {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) {
        try { result = JSON.parse(match[0]); } catch { /* still failed */ }
      }
    }
    const reply = result.reply ?? (raw.length > 0 ? raw.replace(/^```[\s\S]*?```\n?/g, '').trim() : "I couldn't process that. Try rephrasing.");

    return NextResponse.json({ reply, patch: result.patch ? mergePatchSteps(workflow, result.patch) : null });
  } catch {
    return NextResponse.json({ reply: 'Something went wrong. Please try again.', patch: null });
  }
}

