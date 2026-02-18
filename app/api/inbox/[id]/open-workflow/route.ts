import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { updateWorkPatternsFromThread } from '@/lib/context/work-patterns-service';
import OpenAI from 'openai';

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

const PLAN_SEPARATOR = '---PLAN_UPDATE---';

// Same format as the workflow chat so the opening message feels native
const WARMUP_SYSTEM = `You are a work planning assistant embedded in AUGMTD. Your job is to help users decompose their work into clear, actionable plans shown in a live workflow panel.

RESPONSE FORMAT (follow exactly — never deviate):
[Short conversational message — 1-3 sentences max, plain prose only, NO step lists or structured data]
---PLAN_UPDATE---
[Full JSON plan object, or the word null]

The text before ---PLAN_UPDATE--- is shown to the user as a chat message.
The JSON after is parsed silently to update the workflow panel on screen.
NEVER put step details, time estimates, or tool names in the chat message — that all goes in the JSON.

CONVERSATIONAL TEXT RULES:
- 1-3 sentences only — introduce the workflow using specific details from the email, then ask one focused follow-up question
- Reference the actual requester name, client name, project name, or specific detail from the email — be specific, never generic
- No bullet lists, no step breakdowns, no structured data
- Examples: "I've set up a workflow for Acme Corp's Q1 report based on Sarah's request. Want me to add a review step before sending?" or "Ready to build the board deck John asked for — the plan covers data pull through final slides. Any specific sections you'd like to prioritize?"

PLAN JSON STRUCTURE:
{
  "deliverable_type": "report" | "presentation" | "document" | "email" | "analysis" | "spreadsheet",
  "deliverable_description": "Clear description using actual names from the email",
  "deadline": null,
  "inputs": [{ "id": "input_1", "name": "Input name", "type": "data_source" | "document" | "context" | "approval" | "meeting_notes" | "user_input", "description": "What is needed", "required": true, "examples": [] }],
  "steps": [{ "number": 1, "action": "Specific action", "toolsNeeded": [], "skill": "data_pull" | "excel_generator" | "powerpoint_generator" | "word_generator" | "email_drafter" | "data_analyzer" | "chart_generator", "status": "pending" }],
  "outputs": [{ "id": "output_1", "name": "Output name", "type": "draft" | "final_document" | "data_export" | "visualization" | "summary" | "decision" | "notification", "description": "What gets produced" }]
}

PLAN RULES:
- Keep the existing plan structure intact — only update descriptions to be more specific using email details
- Always emit the full plan JSON`;

// POST /api/inbox/[id]/open-workflow
// Creates (or returns existing) work thread pre-seeded from an executable inbox item.
// Idempotent: returns the existing thread if work_thread_id is already set.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: itemId } = await params;

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Load the inbox item (must belong to user and be executable)
    const { data: item, error: itemError } = await supabase
      .from('inbox_items')
      .select('id, work_title, work_thread_id, execution_plan, source_data')
      .eq('id', itemId)
      .eq('user_id', user.id)
      .single();

    if (itemError || !item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // Idempotent: return existing thread if already linked
    if (item.work_thread_id) {
      return NextResponse.json({ threadId: item.work_thread_id });
    }

    if (!item.execution_plan) {
      return NextResponse.json({ error: 'Item has no execution plan' }, { status: 400 });
    }

    const plan = item.execution_plan;
    const fromName = item.source_data?.from_name || item.source_data?.from || null;
    const emailSubject = item.source_data?.subject || '';
    const emailBody = item.source_data?.body || '';

    // Use service role client for writes that bypass RLS (messages table)
    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. Create the work thread pre-seeded with the execution plan
    const title = item.work_title || plan.deliverable_description || 'Untitled workflow';
    const { data: thread, error: threadError } = await adminClient
      .from('work_threads')
      .insert({
        user_id: user.id,
        title: title.substring(0, 200),
        plan,
        status: 'active',
      })
      .select('id, title, plan, status, created_at, updated_at')
      .single();

    if (threadError || !thread) {
      console.error('[OpenWorkflow] Failed to create thread:', threadError);
      return NextResponse.json({ error: 'Failed to create workflow' }, { status: 500 });
    }

    // 2. Generate AI warmup message using email context + pre-seeded plan
    let initialMessage: string;
    let finalPlan = plan;

    try {
      const currentPlanNote = `\n\nCURRENT PLAN STATE (keep structure intact — only sharpen descriptions using the email details below):\n${JSON.stringify(plan, null, 2)}`;

      const emailContext = [
        fromName ? `From: ${fromName}` : '',
        emailSubject ? `Subject: ${emailSubject}` : '',
        emailBody ? `\nEmail:\n${emailBody.substring(0, 800)}` : '',
      ].filter(Boolean).join('\n');

      const warmupTrigger = `A workflow has been opened from this email:\n\n${emailContext}\n\nIntroduce this workflow with specific details from the email, then ask one focused follow-up question to help get started.`;

      const openai = getOpenAI();
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: WARMUP_SYSTEM + currentPlanNote },
          { role: 'user', content: warmupTrigger },
        ],
        temperature: 0.4,
        max_tokens: 800,
      });

      const warmupResponse = completion.choices[0]?.message?.content?.trim() || '';
      const sepIdx = warmupResponse.indexOf(PLAN_SEPARATOR);
      const conversationalText = sepIdx !== -1
        ? warmupResponse.slice(0, sepIdx).trim()
        : warmupResponse.trim();
      const planRaw = sepIdx !== -1
        ? warmupResponse.slice(sepIdx + PLAN_SEPARATOR.length).trim()
        : null;

      initialMessage = conversationalText || `I've set up this workflow based on ${fromName ? `${fromName}'s request` : 'the email'}. Feel free to refine any part of the plan or add more context.`;

      // If AI sharpened the plan descriptions, apply the update
      if (planRaw && planRaw !== 'null') {
        try {
          finalPlan = JSON.parse(planRaw);
          await adminClient
            .from('work_threads')
            .update({ plan: finalPlan })
            .eq('id', thread.id);
        } catch {
          // Keep original plan if AI response can't be parsed
        }
      }
    } catch (aiError) {
      console.error('[OpenWorkflow] AI warmup failed, using fallback message:', aiError);
      const requestedBy = fromName ? `${fromName}'s request` : 'the email';
      initialMessage = `I've set up this workflow based on ${requestedBy}. The plan outlines ${plan.deliverable_description || 'the deliverable'}. Feel free to refine any part of it or add more context.`;
    }

    // 3. Save the initial assistant message
    await adminClient.from('work_messages').insert({
      thread_id: thread.id,
      role: 'assistant',
      content: initialMessage,
    });

    // 4. Link inbox item to this thread
    await supabase
      .from('inbox_items')
      .update({ work_thread_id: thread.id })
      .eq('id', itemId);

    // 5. Update work_patterns context profile (non-fatal)
    await updateWorkPatternsFromThread(
      user.id,
      thread.id,
      thread.title,
      finalPlan,
      adminClient
    );

    return NextResponse.json({ threadId: thread.id });
  } catch (error) {
    console.error('[OpenWorkflow] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
