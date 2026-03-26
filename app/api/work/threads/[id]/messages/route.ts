import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAIClient } from '@/lib/ai/factory';
import { updateWorkPatternsFromThread } from '@/lib/context/work-patterns-service';
import { buildSystemPrompt, parsePlanResponse } from '@/lib/work/planning-ai';
import { buildToolRegistry } from '@/lib/mcp/registry';
import { buildKBContext } from '@/lib/knowledge/build-kb-context';
import { buildUserContextBlock } from '@/lib/context/build-user-context';
import { buildInboxSnapshot, formatSnapshotForPrompt } from '@/lib/inbox/chat-context';
import { getCalendarContext } from '@/lib/calendar/calendar-context';
import { formatCalendarContextForChat } from '@/lib/calendar/format-calendar-context';

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

    // Build dynamic tool registry based on user's active connections
    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const [toolRegistry, kbContext, userContextBlock, calendarCtx, inboxSnapshot, processListResult] = await Promise.all([
      buildToolRegistry(user.id, supabase),
      buildKBContext(user.id, content, adminClient, { fileLimit: 6, maxChunksPerFile: 3, threshold: 0.2, maxTotalChars: 12000 }),
      buildUserContextBlock(user.id, supabase),
      getCalendarContext(user.id, supabase),
      buildInboxSnapshot(user.id, content, supabase),
      supabase
        .from('processes')
        .select('id, title, status, current_step_index')
        .in('status', ['active', 'in_progress'])
        .order('updated_at', { ascending: false })
        .limit(8),
    ]);
    const systemPrompt = buildSystemPrompt(toolRegistry);

    const userContextNote = userContextBlock ? `\n\n${userContextBlock}` : '';
    const kbContextNote = kbContext.context
      ? `\n\nKNOWLEDGE BASE CONTEXT (from user's indexed files — reference when planning):\n${kbContext.context}`
      : '';

    const calendarText = formatCalendarContextForChat(calendarCtx);
    const calendarNote = calendarText
      ? `\n\nCALENDAR (upcoming meetings — use when the user asks about scheduling or meeting context):\n${calendarText}`
      : '';

    const snapshotText = formatSnapshotForPrompt(inboxSnapshot);
    const inboxNote = snapshotText
      ? `\n\nINBOX SNAPSHOT (recent relevant emails — use when the user asks about emails, people, or ongoing conversations):\n${snapshotText}`
      : '';

    const processes = (processListResult.data ?? []) as Array<{ id: string; title: string; status: string; current_step_index?: number }>;
    const processNote = processes.length
      ? `\n\nACTIVE PROCESSES (team workflows currently running — reference when the user asks about ongoing work):\n` +
        processes.map(p => `- "${p.title}" [id: ${p.id}] — ${p.status}${p.current_step_index != null ? `, step ${p.current_step_index + 1}` : ''}`).join('\n')
      : '';

    // On the very first message (no existing plan), inject a strong reminder that a plan is required now.
    const isFirstMessage = !thread.plan;
    const firstMessageNote = isFirstMessage
      ? '\n\nFIRST MESSAGE — you MUST emit a complete plan JSON after ---PLAN_UPDATE--- right now. Do not ask clarifying questions first. Make sensible assumptions and generate the plan immediately.'
      : '';

    const openaiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      {
        role: 'system',
        content: currentModeNote + systemPrompt + userContextNote + kbContextNote + calendarNote + inboxNote + processNote + currentPlanNote + attachmentNote + firstMessageNote,
      },
      ...(messages || []).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    const { client, model } = await getAIClient(user.id, 'planning', supabase);
    const stream = await client.chat.completions.create({
      model,
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
              // Preserve provided-input state and user decisions across follow-up planning messages
              if (thread.plan?.inputs && plan.inputs) {
                plan.inputs = plan.inputs.map((input: any) => {
                  const existing = (thread.plan!.inputs || []).find((i: any) => i.id === input.id);
                  if (!existing) return input;
                  if (existing.status === 'provided') {
                    return {
                      ...input,
                      status: 'provided',
                      ...(existing.source_type ? { source_type: existing.source_type } : {}),
                      ...(existing.fromKB ? { fromKB: true } : {}),
                      ...(existing.kbFileId ? { kbFileId: existing.kbFileId } : {}),
                      ...(existing.kbAccepted ? { kbAccepted: existing.kbAccepted } : {}),
                      ...(existing.providedFilename ? { providedFilename: existing.providedFilename } : {}),
                      ...(existing.providedFilenames ? { providedFilenames: existing.providedFilenames } : {}),
                    };
                  }
                  // Preserve in-progress KB collection (accepted but not yet confirmed)
                  if (existing.kbAccepted?.length) {
                    return { ...input, kbAccepted: existing.kbAccepted, dismissedKbFileIds: existing.dismissedKbFileIds };
                  }
                  // Preserve dismissed KB file IDs — prevents re-suggesting dismissed files after next message
                  if (existing.dismissedKbFileIds?.length) {
                    return { ...input, source_type: 'user_upload', dismissedKbFileIds: existing.dismissedKbFileIds };
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
