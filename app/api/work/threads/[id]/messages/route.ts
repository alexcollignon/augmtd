import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import OpenAI from 'openai';

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

const PLAN_SEPARATOR = '---PLAN_UPDATE---';

const SYSTEM_PROMPT = `You are a work planning assistant embedded in AUGMTD, an AI-powered work management tool. Your job is to help users decompose their work into clear, actionable plans.

BEHAVIOR:
- When given work, immediately propose a clear decomposition — don't ask many questions upfront
- Keep responses concise and direct — no filler or fluff
- After your initial proposal, ask one focused question about the most important unknown
- Update the plan based on user responses
- Guide toward a complete, actionable plan

RESPONSE FORMAT (always follow exactly — never deviate):
[Your conversational message — plain prose, no headers, markdown lists ok]
---PLAN_UPDATE---
[JSON plan object or the word null]

The text before ---PLAN_UPDATE--- is shown to the user.
The JSON after is parsed silently to update the workflow panel.
Always include both parts in every response.

PLAN JSON STRUCTURE:
{
  "deliverable_type": "report" | "presentation" | "document" | "email" | "analysis" | "spreadsheet",
  "deliverable_description": "Clear description of what will be created",
  "estimated_time": "Human-readable estimate e.g. 2 hours",
  "deadline": null,
  "inputs": [
    {
      "id": "input_1",
      "name": "Input name",
      "type": "data_source" | "document" | "context" | "approval" | "meeting_notes" | "user_input",
      "description": "What is needed and why",
      "required": true,
      "examples": ["Example 1", "Example 2"]
    }
  ],
  "steps": [
    {
      "number": 1,
      "action": "Clear action description",
      "estimatedTime": "15 minutes",
      "toolsNeeded": ["Excel"],
      "skill": "data_pull" | "excel_generator" | "powerpoint_generator" | "word_generator" | "email_drafter" | "data_analyzer" | "chart_generator",
      "status": "pending"
    }
  ],
  "outputs": [
    {
      "id": "output_1",
      "name": "Output name",
      "type": "draft" | "final_document" | "data_export" | "visualization" | "summary" | "decision" | "notification",
      "description": "What gets produced"
    }
  ]
}

Rules:
- Return null plan only if work is too vague to plan or user is asking a general question
- Keep steps concrete — max 6
- Always update the plan in every response, reflecting any changes from the conversation
- Match the deliverable type to what's actually being requested`;

// POST /api/work/threads/[id]/messages — send a message and stream the AI response
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: threadId } = await params;

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify thread belongs to user
    const { data: thread, error: threadError } = await supabase
      .from('work_threads')
      .select('id, plan')
      .eq('id', threadId)
      .eq('user_id', user.id)
      .single();

    if (threadError || !thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    const body = await request.json();
    const { content } = body;

    if (!content || typeof content !== 'string') {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 });
    }

    // Save user message
    await supabase.from('work_messages').insert({
      thread_id: threadId,
      role: 'user',
      content: content.trim(),
    });

    // Load conversation history
    const { data: messages } = await supabase
      .from('work_messages')
      .select('role, content')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });

    // Load user context for personalization
    const { data: identityProfile } = await supabase
      .from('context_profiles')
      .select('profile_data')
      .eq('user_id', user.id)
      .eq('profile_type', 'identity')
      .single();

    const identity = identityProfile?.profile_data;
    const userContextNote = identity
      ? `\n\nUser context: ${identity.role || ''} ${identity.department ? `in ${identity.department}` : ''}`.trim()
      : '';

    // Build messages for OpenAI
    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: SYSTEM_PROMPT + userContextNote,
      },
      ...(messages || []).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    const openai = getOpenAI();
    const stream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: openaiMessages,
      temperature: 0.4,
      max_tokens: 1200,
      stream: true,
    });

    // Buffer the full response so we can save it + extract plan after streaming
    let fullResponse = '';

    const readable = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content || '';
            if (text) {
              fullResponse += text;
              controller.enqueue(encoder.encode(text));
            }
          }
        } finally {
          // Parse plan and conversational text from full response
          const sepIdx = fullResponse.indexOf(PLAN_SEPARATOR);
          const conversationalText =
            sepIdx !== -1
              ? fullResponse.slice(0, sepIdx).trim()
              : fullResponse.trim();
          const planRaw =
            sepIdx !== -1
              ? fullResponse.slice(sepIdx + PLAN_SEPARATOR.length).trim()
              : null;

          // Save assistant message (conversational part only)
          const adminClient = (await import('@supabase/supabase-js')).createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
          );

          await adminClient.from('work_messages').insert({
            thread_id: threadId,
            role: 'assistant',
            content: conversationalText,
          });

          // Save updated plan and bump updated_at
          if (planRaw && planRaw !== 'null') {
            try {
              const plan = JSON.parse(planRaw);
              await adminClient.from('work_threads').update({
                plan,
                updated_at: new Date().toISOString(),
              }).eq('id', threadId);
            } catch {
              // Plan parse failed — just update timestamp
              await adminClient.from('work_threads').update({
                updated_at: new Date().toISOString(),
              }).eq('id', threadId);
            }
          } else {
            await adminClient.from('work_threads').update({
              updated_at: new Date().toISOString(),
            }).eq('id', threadId);
          }

          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('[WorkMessages] POST error:', error);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}

// GET /api/work/threads/[id]/messages — load thread + messages
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: threadId } = await params;

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [threadResult, messagesResult] = await Promise.all([
      supabase
        .from('work_threads')
        .select('*')
        .eq('id', threadId)
        .eq('user_id', user.id)
        .single(),
      supabase
        .from('work_messages')
        .select('id, role, content, created_at')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true }),
    ]);

    if (threadResult.error || !threadResult.data) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    return NextResponse.json({
      thread: threadResult.data,
      messages: messagesResult.data || [],
    });
  } catch (error) {
    console.error('[WorkMessages] GET error:', error);
    return NextResponse.json({ error: 'Failed to load thread' }, { status: 500 });
  }
}
