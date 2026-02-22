import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import OpenAI from 'openai';
import { updateWorkPatternsFromThread } from '@/lib/context/work-patterns-service';

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

const PLAN_SEPARATOR = '---PLAN_UPDATE---';

const SYSTEM_PROMPT = `You are a work planning assistant embedded in AUGMTD. Your job is to help users decompose their work into clear, actionable plans shown in a live workflow panel.

RESPONSE FORMAT (follow exactly — never deviate):
[Short conversational message — 1-3 sentences max, plain prose only, NO step lists or structured data]
---PLAN_UPDATE---
[Full JSON plan object, or the word null]

The text before ---PLAN_UPDATE--- is shown to the user as a chat message.
The JSON after is parsed silently to update the workflow panel on screen.
NEVER put step details, time estimates, or tool names in the chat message — that all goes in the JSON.

CONVERSATIONAL TEXT RULES:
- 1-3 sentences only — acknowledge what changed, then ask one focused follow-up question
- No bullet lists, no step breakdowns, no structured data
- Examples of good messages: "Got it — updated the plan to use PowerPoint. What's the deadline?" or "Here's a draft plan. Want me to add a review step before sending?"

PLAN JSON STRUCTURE:
{
  "deliverable_type": "report" | "presentation" | "document" | "email" | "analysis" | "spreadsheet",
  "deliverable_description": "Clear description of what will be created",
  "deadline": null,
  "inputs": [
    {
      "id": "input_1",
      "name": "Input name",
      "type": "data_source" | "document" | "context" | "approval" | "meeting_notes" | "user_input",
      "description": "What is needed and why",
      "required": true,
      "status": "provided" | "pending",
      "providedFilename": "filename.pdf",
      "examples": ["Example 1"]
    }
  ],
  "steps": [
    {
      "number": 1,
      "action": "Clear action description",
      "toolsNeeded": ["PowerPoint"],
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

PLAN RULES:
- Always emit the full updated plan JSON — never partial or null unless the request is completely off-topic
- Update ALL relevant fields when something changes (e.g. changing to PowerPoint updates deliverable_type AND step skills AND toolsNeeded)
- Max 6 steps
- deliverable_type must match the actual format requested
- If the workflow prompt mentions available attachments, include each as an input with status "provided" and set providedFilename to the exact filename — never ask the user to re-upload something already attached`;

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
      .select('id, title, plan, user_attachments')
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
    const [{ data: identityProfile }, { data: workPatternsProfile }] = await Promise.all([
      supabase
        .from('context_profiles')
        .select('profile_data')
        .eq('user_id', user.id)
        .eq('profile_type', 'identity')
        .single(),
      supabase
        .from('context_profiles')
        .select('profile_data')
        .eq('user_id', user.id)
        .eq('profile_type', 'work_patterns')
        .single(),
    ]);

    const identity = identityProfile?.profile_data;
    const workPatterns = workPatternsProfile?.profile_data;

    let userContextNote = identity
      ? `\n\nUser context: ${identity.jobRole || ''} ${identity.department ? `in ${identity.department}` : ''}`.trim()
      : '';

    // Inject only anonymised patterns — never specific names/clients from other threads
    if (workPatterns?.deliverableTypes && Object.keys(workPatterns.deliverableTypes).length > 0) {
      const typesSummary = Object.entries(workPatterns.deliverableTypes as Record<string, number>)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `${type} (${count}x)`)
        .join(', ');
      userContextNote += `\n\nDeliverable types this user typically creates: ${typesSummary}`;
    }
    if (workPatterns?.commonSkills?.length) {
      userContextNote += `\n\nMost-used skills: ${workPatterns.commonSkills.join(', ')}`;
    }

    // Build messages for OpenAI
    const currentPlanNote = thread.plan
      ? `\n\nCURRENT PLAN STATE (update this precisely — change only what the user's message affects, preserve everything else):\n${JSON.stringify(thread.plan, null, 2)}`
      : '';

    const userAttachments = ((thread as any).user_attachments || []) as Array<{
      filename: string;
      extractedText: string | null;
    }>;
    const attachmentContext = userAttachments
      .filter((a) => a.extractedText)
      .map((a) => `--- Attached file: ${a.filename} ---\n${a.extractedText}`)
      .join('\n\n');
    const attachmentNote = attachmentContext
      ? `\n\nATTACHED FILES (reference material the user has uploaded — use these when answering questions about their content):\n${attachmentContext}`
      : '';

    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: SYSTEM_PROMPT + userContextNote + currentPlanNote + attachmentNote,
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
      max_tokens: 2500,
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

              // Update work_patterns context profile from this thread's plan
              await updateWorkPatternsFromThread(
                user.id,
                threadId,
                thread.title,
                plan,
                adminClient
              );
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
