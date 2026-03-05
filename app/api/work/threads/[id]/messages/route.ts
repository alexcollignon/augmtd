import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import OpenAI from 'openai';
import { updateWorkPatternsFromThread } from '@/lib/context/work-patterns-service';
import { SYSTEM_PROMPT, parsePlanResponse } from '@/lib/work/planning-ai';

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

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
    const mode = (body.mode as string) ?? 'planning';

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

    const currentModeNote =
      `CURRENT MODE: PLANNING — Your role is to help the user structure and refine their work plan. ` +
      `This conversation may include messages from other modes (ask, edit) — treat those as context only. ` +
      `Focus on planning-related requests. Do not attempt to edit a document unless the user explicitly asks.\n\n`;

    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: currentModeNote + SYSTEM_PROMPT + userContextNote + currentPlanNote + attachmentNote,
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
          const { conversationalText, planRaw } = parsePlanResponse(fullResponse);

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
              // Strip hallucinated providedFilename(s) — only filenames the server knows about are valid.
              // Include both user-uploaded files and email attachment filenames (for email-linked threads).
              const actualFilenames = new Set(
                ((thread as any).user_attachments || []).map((a: any) => a.filename)
              );
              // Also load email attachment filenames from the linked inbox item (if any)
              const { data: linkedItem } = await supabase
                .from('inbox_items')
                .select('source_data')
                .eq('work_thread_id', threadId)
                .eq('user_id', user.id)
                .maybeSingle();
              for (const att of (linkedItem?.source_data?.attachments || [])) {
                if (att.filename) actualFilenames.add(att.filename);
              }
              if (plan.inputs) {
                plan.inputs = plan.inputs.map((input: any) => {
                  // AI must never set status: 'provided' — only the server can via actual file upload or KB accept
                  if (input.status === 'provided' && !(input as any).fromKB) {
                    input = { ...input, status: 'pending' };
                  }
                  // Strip invalid single filename
                  if (input.providedFilename && !actualFilenames.has(input.providedFilename)) {
                    const { providedFilename: _removed, ...rest } = input;
                    return { ...rest, status: 'pending' };
                  }
                  // Strip invalid entries from providedFilenames array
                  if (input.providedFilenames?.length) {
                    const valid = input.providedFilenames.filter((f: string) => actualFilenames.has(f));
                    if (valid.length === 0) {
                      const { providedFilenames: _removed, ...rest } = input;
                      return { ...rest, status: 'pending' };
                    }
                    return { ...input, providedFilenames: valid };
                  }
                  return input;
                });
              }
              // Preserve provided-input state across follow-up planning messages
              if (thread.plan?.inputs && plan.inputs) {
                plan.inputs = plan.inputs.map((input: any) => {
                  const existing = (thread.plan!.inputs || []).find((i: any) => i.id === input.id);
                  if (existing?.status === 'provided') {
                    return {
                      ...input,
                      status: 'provided',
                      ...(existing.providedFilename ? { providedFilename: existing.providedFilename } : {}),
                      ...(existing.providedFilenames ? { providedFilenames: existing.providedFilenames } : {}),
                    };
                  }
                  return input;
                });
              }
              await adminClient.from('work_threads').update({
                plan,
                updated_at: new Date().toISOString(),
              }).eq('id', threadId);

              // KB enrichment — dual-pass via shared utility
              const { enrichPlanWithKB } = await import('@/lib/knowledge/enrich-plan-with-kb');
              const prevAcceptedKb = (thread.plan?.inputs ?? []).filter((i: any) => i.fromKB && i.status === 'provided');
              const globalQuery = [content.trim(), plan.deliverable_description].filter(Boolean).join(' — ');
              await enrichPlanWithKB(user.id, plan, globalQuery, adminClient, prevAcceptedKb);
              await adminClient.from('work_threads').update({ plan }).eq('id', threadId);

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
