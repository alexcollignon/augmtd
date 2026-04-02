import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';
import { buildChatSystemPrompt } from '@/lib/work/chat-system-prompt';
import { buildUserContextBlock } from '@/lib/context/build-user-context';
import { buildKBContext } from '@/lib/knowledge/build-kb-context';
import { buildInboxSnapshot, formatSnapshotForPrompt } from '@/lib/inbox/chat-context';
import { getCalendarContext } from '@/lib/calendar/calendar-context';
import { formatCalendarContextForChat } from '@/lib/calendar/format-calendar-context';
import { runFullPipeline } from '@/lib/work/generate-pipeline';
import { buildToolRegistry } from '@/lib/mcp/registry';
import { DocumentArtifact } from '@/lib/types/inbox';
import { indexArtifact } from '@/lib/knowledge/indexer';
import { getMimeType, getFileExt } from '@/lib/artifacts/builders';

const SSE = (data: object) => `data: ${JSON.stringify(data)}\n\n`;

// ── GET: load messages with metadata ────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: threadId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [threadResult, messagesResult] = await Promise.all([
    supabase
      .from('work_threads')
      .select('id, title, artifacts, updated_at')
      .eq('id', threadId)
      .eq('user_id', user.id)
      .single(),
    supabase
      .from('work_messages')
      .select('id, role, content, created_at, metadata')
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
}

// ── POST: stream chat response ───────────────────────────────────────────────

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

    const { data: thread, error: threadError } = await supabase
      .from('work_threads')
      .select('id, title, user_attachments, process_id, process_step_index')
      .eq('id', threadId)
      .eq('user_id', user.id)
      .single();

    if (threadError || !thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    const body = await request.json();
    const { content, sources = ['kb', 'inbox', 'calendar', 'processes'], mentions = [] } = body as {
      content: string;
      sources?: string[];
      mentions?: Array<{ id: string; type: string; label: string; subtitle?: string }>;
    };

    if (!content?.trim()) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 });
    }

    // Save user message
    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    await adminClient.from('work_messages').insert({
      thread_id: threadId,
      role: 'user',
      content: content.trim(),
    });

    // Check if this is the first message (for auto-rename)
    const { count: msgCount } = await adminClient
      .from('work_messages')
      .select('id', { count: 'exact', head: true })
      .eq('thread_id', threadId);
    const isFirstMessage = (msgCount ?? 0) <= 1;

    // Load conversation history (excluding the message we just inserted)
    const { data: history } = await adminClient
      .from('work_messages')
      .select('role, content')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
      .limit(40);

    // Build static context (always injected)
    const [userContextBlock, processListResult, contactsResult] = await Promise.all([
      buildUserContextBlock(user.id, supabase),
      adminClient
        .from('processes')
        .select('id, title, status, current_step_index')
        .in('status', ['active', 'in_progress'])
        .order('updated_at', { ascending: false })
        .limit(8),
      adminClient
        .from('relationship_graph')
        .select('name, email, relationship, importance, last_interaction, topics')
        .eq('user_id', user.id)
        .gte('importance', 0.3)
        .order('importance', { ascending: false })
        .limit(10),
    ]);

    // Format context blocks
    const contextParts: string[] = [buildChatSystemPrompt()];

    if (userContextBlock) {
      contextParts.push(userContextBlock);
    }

    const processes = (processListResult.data ?? []) as Array<{
      id: string; title: string; status: string; current_step_index?: number;
    }>;
    if (processes.length > 0) {
      contextParts.push(
        'ACTIVE PROCESSES:\n' +
        processes.map(p =>
          `- "${p.title}" [${p.id}] — ${p.status}${p.current_step_index != null ? `, step ${p.current_step_index + 1}` : ''}`
        ).join('\n')
      );
    }

    const contacts = (contactsResult.data ?? []) as Array<{
      name: string; email: string; relationship: string; importance: number;
      last_interaction: string | null; topics: string[] | null;
    }>;
    if (contacts.length > 0) {
      contextParts.push(
        'KEY CONTACTS (from your network):\n' +
        contacts.map(c => {
          const parts = [`- ${c.name} (${c.email}) — ${c.relationship}`];
          if (c.last_interaction) {
            parts.push(`last contact: ${new Date(c.last_interaction).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`);
          }
          if (c.topics?.length) parts.push(`topics: ${c.topics.slice(0, 3).join(', ')}`);
          return parts.join(', ');
        }).join('\n')
      );
    }

    // Process step context — injected when thread is linked to a process step
    const processId = (thread as any).process_id as string | null;
    const processStepIndex = (thread as any).process_step_index as number | null;
    if (processId != null && processStepIndex != null) {
      try {
        const [{ data: proc }, { data: step }] = await Promise.all([
          adminClient.from('processes').select('title').eq('id', processId).single(),
          adminClient.from('process_steps').select('title, description, step_type').eq('process_id', processId).eq('step_index', processStepIndex).single(),
        ]);
        if (proc && step) {
          contextParts.push(
            `PROCESS STEP CONTEXT:\n` +
            `You are helping the user complete Step ${processStepIndex + 1} of the "${proc.title}" process.\n` +
            `Step: "${step.title}"` +
            (step.description ? `\nDeliverable: ${step.description}` : '') +
            `\nWhen you generate a document for this step, it will be used as the final deliverable. ` +
            `Make it complete and high quality.`
          );
        }
      } catch { /* non-fatal */ }
    }

    // Attachment context from thread files
    const userAttachments = ((thread as any).user_attachments || []) as Array<{
      filename: string;
      extractedText: string | null;
    }>;
    if (userAttachments.some(a => a.extractedText)) {
      const attachCtx = userAttachments
        .filter(a => a.extractedText)
        .map(a => `--- ${a.filename} ---\n${a.extractedText}`)
        .join('\n\n');
      contextParts.push(`ATTACHED FILES:\n${attachCtx}`);
    }

    // Mention context — fetch details for each mentioned item
    if (mentions.length > 0) {
      const mentionBlocks = await buildMentionContext(mentions, user.id, adminClient);
      if (mentionBlocks) contextParts.push(mentionBlocks);
    }

    const system = contextParts.join('\n\n');

    // Build tools based on selected sources
    const tools = buildChatTools(sources);

    // Build Anthropic message history
    const anthropicMessages: Anthropic.MessageParam[] = (history || []).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // Build run context for document generation
    const runContext = {
      userId: user.id,
      threadId,
      supabase,
      adminClient,
      thread,
      userContextBlock: userContextBlock || undefined,
    };

    // ── Stream ────────────────────────────────────────────────────────────
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    let fullAssistantText = '';
    const allToolCalls: Array<{ name: string; summary: string; citations?: string[]; clarification?: object }> = [];
    const allArtifactIds: string[] = [];

    const readable = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (data: object) => {
          try { controller.enqueue(encoder.encode(SSE(data))); } catch { /* stream closed */ }
        };

        try {
          let continueLoop = true;

          while (continueLoop) {
            const stream = anthropic.messages.stream({
              model: 'claude-sonnet-4-6',
              max_tokens: 4096,
              tools: tools as Anthropic.Tool[],
              messages: anthropicMessages,
              system,
            });

            let turnText = '';

            // Stream text deltas to client as they arrive
            stream.on('text', (delta) => {
              turnText += delta;
              send({ type: 'text', delta });
            });

            // Wait for full message (needed to get complete tool inputs)
            const finalMsg = await stream.finalMessage();
            fullAssistantText += turnText;

            // Add this assistant turn to history for any follow-up turns
            anthropicMessages.push({ role: 'assistant', content: finalMsg.content });

            if (finalMsg.stop_reason === 'end_turn') {
              continueLoop = false;
            } else if (finalMsg.stop_reason === 'tool_use') {
              const toolResults: Anthropic.ToolResultBlockParam[] = [];

              for (const block of finalMsg.content) {
                if (block.type !== 'tool_use') continue;

                const toolInput = block.input as Record<string, unknown>;
                send({ type: 'tool_start', name: block.name, id: block.id, label: toolLabel(block.name) });

                const { result, summary, artifact, citations, clarification, stopStream } = await executeChatTool(
                  block.name,
                  toolInput,
                  sources,
                  runContext
                );

                send({ type: 'tool_result', name: block.name, id: block.id, summary, ...(citations?.length ? { citations } : {}) });
                allToolCalls.push({ name: block.name, summary, ...(citations?.length ? { citations } : {}) });

                if (clarification) {
                  send({ type: 'clarification_request', ...(clarification as object) });
                }

                if (artifact && artifact.id) {
                  allArtifactIds.push(artifact.id);
                  send({ type: 'artifact_ready', artifact: { id: artifact.id, type: artifact.type, title: artifact.title } });
                }

                toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });

                if (stopStream) {
                  continueLoop = false;
                  // Save partial assistant turn so the clarification is in history
                  anthropicMessages.push({ role: 'user', content: toolResults });
                  // Store clarification in the assistant message metadata for re-render
                  allToolCalls[allToolCalls.length - 1] = {
                    ...allToolCalls[allToolCalls.length - 1],
                    clarification: clarification as object,
                  };
                  break;
                }
              }

              if (!continueLoop) break;

              anthropicMessages.push({ role: 'user', content: toolResults });
            } else {
              continueLoop = false;
            }
          }

          // Auto-rename on first message
          let newTitle: string | undefined;
          if (isFirstMessage) {
            newTitle = await generateAutoTitle(content, anthropic, adminClient, threadId);
          }

          send({ type: 'done', ...(newTitle ? { title: newTitle } : {}) });
        } catch (err) {
          console.error('[Chat] Stream error:', err);
          send({ type: 'error', message: 'An error occurred. Please try again.' });
        } finally {
          // Save complete assistant message
          try {
            // Extract clarification data from tool calls if present
            const clarificationCall = allToolCalls.find(t => t.name === 'request_clarification');
            await adminClient.from('work_messages').insert({
              thread_id: threadId,
              role: 'assistant',
              content: fullAssistantText,
              metadata: {
                tool_calls: allToolCalls,
                artifact_ids: allArtifactIds,
                ...(clarificationCall?.clarification ? { clarification: clarificationCall.clarification } : {}),
              },
            });
            await adminClient
              .from('work_threads')
              .update({ updated_at: new Date().toISOString() })
              .eq('id', threadId);
          } catch (saveErr) {
            console.error('[Chat] Failed to save message:', saveErr);
          }
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('[Chat] POST error:', error);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}

// ── Tool definitions ─────────────────────────────────────────────────────────

function buildChatTools(sources: string[]): object[] {
  const tools: object[] = [
    {
      name: 'request_clarification',
      description: "Present a structured confirmation widget to the user BEFORE generating a document. Call this after gathering context (search results, emails, calendar) to confirm what the user wants. Include the relevant sources you found so the user can confirm which to use, and any options that meaningfully affect the output (format, tone, audience). Do NOT call this if the user's message starts with [CLARIFICATION CONFIRMED].",
      input_schema: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'A 1-2 sentence description of what you plan to create and what you found. Be specific (e.g. "I found 2 relevant documents. I\'ll draft a client-facing Q2 summary — confirm which sources to include and preferred format.").',
          },
          sources: {
            type: 'array',
            description: 'Relevant documents/items you found that the user can choose to include or exclude.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string', description: 'Filename or subject line — keep short' },
                type: { type: 'string', enum: ['kb', 'email', 'calendar', 'process'], description: 'Source type for the icon' },
              },
              required: ['id', 'title', 'type'],
            },
          },
          options: {
            type: 'array',
            description: 'Option groups for decisions that meaningfully affect the output. Max 3 groups. Only include genuinely ambiguous choices.',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string', description: 'Machine key, e.g. "format" or "tone"' },
                label: { type: 'string', description: 'Display label, e.g. "Format" or "Tone"' },
                choices: { type: 'array', items: { type: 'string' }, description: 'The options to choose from' },
                default: { type: 'string', description: 'Pre-selected default choice' },
              },
              required: ['key', 'label', 'choices'],
            },
          },
        },
        required: ['question'],
      },
    },
    {
      name: 'generate_document',
      description: "Generate a Word document, Excel spreadsheet, PowerPoint presentation, or email draft. Call this whenever the user asks you to create, write, draft, or produce any document.",
      input_schema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['word', 'excel', 'pptx', 'email'],
            description: 'Document type: word (reports, memos, proposals, analysis), excel (tables, budgets, trackers), pptx (presentations, decks), email (emails, replies, outreach)',
          },
          instructions: {
            type: 'string',
            description: 'Detailed instructions for what to generate. Include: purpose, target audience, key sections/content, tone, any specific data or examples to include. Be specific and thorough.',
          },
        },
        required: ['type', 'instructions'],
      },
    },
  ];

  if (sources.includes('kb')) {
    tools.push({
      name: 'search_knowledge_base',
      description: "Search the user's knowledge base and indexed Drive documents. Use this when you need information from their files, or when the user asks about something that might be in their documents.",
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query — be specific about what you need' },
        },
        required: ['query'],
      },
    });
  }

  if (sources.includes('inbox')) {
    tools.push({
      name: 'get_recent_emails',
      description: "Get recent emails and inbox items. Use this when the user asks about recent communications, specific people, or ongoing email conversations.",
      input_schema: {
        type: 'object',
        properties: {
          filter: { type: 'string', description: 'Optional topic, person name, or keyword to filter by' },
        },
        required: [],
      },
    });
  }

  if (sources.includes('calendar')) {
    tools.push({
      name: 'get_calendar_context',
      description: "Get upcoming meetings and calendar availability. Use this when the user asks about their schedule, upcoming meetings, or when scheduling is relevant.",
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
      },
    });
  }

  return tools;
}

function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    search_knowledge_base: 'Searching knowledge base',
    get_recent_emails: 'Checking recent emails',
    get_calendar_context: 'Checking calendar',
    request_clarification: 'Preparing options',
    generate_document: 'Generating document',
  };
  return labels[name] ?? name;
}

// ── Tool execution ────────────────────────────────────────────────────────────

interface RunContext {
  userId: string;
  threadId: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any;
  thread: { user_attachments?: unknown };
  userContextBlock?: string;
}

async function executeChatTool(
  name: string,
  input: Record<string, unknown>,
  sources: string[],
  ctx: RunContext
): Promise<{ result: string; summary: string; artifact?: DocumentArtifact; citations?: string[]; clarification?: object; stopStream?: boolean }> {
  switch (name) {
    case 'request_clarification': {
      const clarification = {
        question: input.question as string,
        sources: (input.sources as Array<{ id: string; title: string; type: string }> | undefined) ?? [],
        options: (input.options as Array<{ key: string; label: string; choices: string[]; default?: string }> | undefined) ?? [],
      };
      return {
        result: 'Clarification presented to user. Stream will pause until user confirms.',
        summary: 'Awaiting your confirmation',
        clarification,
        stopStream: true,
      };
    }

    case 'search_knowledge_base': {
      const query = input.query as string;
      const kbCtx = await buildKBContext(ctx.userId, query, ctx.adminClient, {
        fileLimit: 5,
        maxChunksPerFile: 3,
        threshold: 0.2,
        maxTotalChars: 8000,
      });
      const result = kbCtx.context || 'No relevant documents found in your knowledge base.';
      const filenames = kbCtx.filenames ?? [];
      const summary = filenames.length > 0 ? `Found ${filenames.length} relevant document${filenames.length > 1 ? 's' : ''}` : 'No relevant documents found';
      return { result, summary, citations: filenames };
    }

    case 'get_recent_emails': {
      const filter = (input.filter as string) || 'recent work';
      const snapshot = await buildInboxSnapshot(ctx.userId, filter, ctx.supabase);
      const result = formatSnapshotForPrompt(snapshot) || 'No recent emails found.';
      const count = snapshot?.length ?? 0;
      const summary = count > 0 ? `Found ${count} recent item${count > 1 ? 's' : ''}` : 'No recent emails found';
      return { result, summary };
    }

    case 'get_calendar_context': {
      const calCtx = await getCalendarContext(ctx.userId, ctx.supabase);
      const result = formatCalendarContextForChat(calCtx) || 'No upcoming calendar events found.';
      const eventCount = calCtx?.upcomingEvents?.length ?? 0;
      const summary = eventCount > 0 ? `Found ${eventCount} upcoming event${eventCount > 1 ? 's' : ''}` : 'No upcoming events';
      return { result, summary };
    }

    case 'generate_document': {
      const type = input.type as string;
      const instructions = input.instructions as string;

      // Map AI tool type to canonical DeliverableType
      const toolMap: Record<string, string> = {
        word: 'generators__word',
        excel: 'generators__xlsx',
        pptx: 'generators__pptx',
        email: 'generators__email_draft',
      };
      const deliverableTypeMap: Record<string, string> = {
        word: 'document',
        excel: 'spreadsheet',
        pptx: 'presentation',
        email: 'email',
      };
      const deliverableType = deliverableTypeMap[type] || 'document';
      const generatorTool = toolMap[type] || 'generators__word';

      // Build a proper 2-step plan: reasoning → generation.
      // Email is single-shot (no reasoning step needed).
      const isEmail = type === 'email';
      const steps = isEmail
        ? [{ number: 1, action: instructions, tool: generatorTool, status: 'pending' }]
        : [
            {
              number: 1,
              action: `Analyse the requirements and prepare a detailed content outline. List specific sections, key data points, arguments, and exact content to include. Requirements: ${instructions.slice(0, 300)}`,
              status: 'pending',
            },
            {
              number: 2,
              action: `Produce the complete ${deliverableType} based on the outline above`,
              tool: generatorTool,
              status: 'pending',
            },
          ];

      const plan = {
        deliverable_type: deliverableType,
        deliverable_description: instructions,
        inputs: [],
        outputs: [{ name: instructions.slice(0, 60), deliverableType }],
        steps,
      };

      // Max tokens per type — higher ceiling for word docs
      const maxTokensMap: Record<string, number> = {
        word: 3500,
        excel: 2500,
        pptx: 2500,
        email: 800,
      };

      const userAttachments = ((ctx.thread.user_attachments || []) as Array<{
        filename: string;
        mimeType: string;
        storagePath: string;
        extractedText: string | null;
      }>);

      const toolRegistry = await buildToolRegistry(ctx.userId, ctx.supabase);

      const pipelineResult = await runFullPipeline({
        userId: ctx.userId,
        threadId: ctx.threadId,
        plan: plan as any,
        emailAttachments: [],
        userAttachments,
        conversationContext: instructions,
        userContext: ctx.userContextBlock || '',
        adminClient: ctx.adminClient,
        toolRegistry,
        maxGenerationTokens: maxTokensMap[type] ?? 3500,
      });

      const newArtifacts = pipelineResult.artifacts || [];
      if (newArtifacts.length === 0) {
        return { result: 'Document generation failed.', summary: 'Generation failed' };
      }

      const artifact = newArtifacts[0];
      artifact.title = instructions.slice(0, 60);

      // Merge into thread artifacts
      const { data: freshThread } = await ctx.adminClient
        .from('work_threads')
        .select('artifacts')
        .eq('id', ctx.threadId)
        .single();
      const existing = ((freshThread?.artifacts as DocumentArtifact[]) || []);
      const regeneratedTypes = new Set(newArtifacts.map((a: DocumentArtifact) => a.type));
      const kept = existing.filter((a: DocumentArtifact) => !regeneratedTypes.has(a.type));
      const updated = [...kept, ...newArtifacts];

      await ctx.adminClient
        .from('work_threads')
        .update({ artifacts: updated, artifact: artifact, updated_at: new Date().toISOString() })
        .eq('id', ctx.threadId);

      // Fire-and-forget: index generated artifacts into KB
      newArtifacts.forEach((a: DocumentArtifact) => {
        if (!a.id) return;
        indexArtifact({
          artifactId: a.id,
          storagePath: a.storage_path ?? null,
          filename: `${a.title}.${getFileExt(a.type)}`,
          mimeType: getMimeType(a.type),
          userId: ctx.userId,
          emailBody: a.type === 'email' ? (a.content as { body?: string })?.body : undefined,
        }, ctx.adminClient).catch(() => {});
      });

      const typeLabels: Record<string, string> = {
        word: 'Word document', excel: 'spreadsheet', pptx: 'presentation', email: 'email draft',
      };
      const summary = `${typeLabels[type] || 'Document'} created`;
      return { result: `Document created successfully: ${artifact.title}`, summary, artifact };
    }

    default:
      return { result: 'Unknown tool', summary: 'Unknown tool' };
  }
}

// ── Auto-rename ──────────────────────────────────────────────────────────────

async function generateAutoTitle(
  firstMessage: string,
  anthropic: Anthropic,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  threadId: string
): Promise<string | undefined> {
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 20,
      messages: [{
        role: 'user',
        content: `Generate a concise 3-5 word title for this chat. Return ONLY the title, no punctuation, no quotes.\n\nMessage: "${firstMessage.slice(0, 200)}"`,
      }],
    });
    const title = ((msg.content[0] as Anthropic.TextBlock).text || '').trim().replace(/^["']|["']$/g, '');
    if (title) {
      await adminClient.from('work_threads').update({ title }).eq('id', threadId);
      return title;
    }
  } catch {
    // Non-fatal — original title stays
  }
  return undefined;
}

// ── Mention context builder ──────────────────────────────────────────────────

async function buildMentionContext(
  mentions: Array<{ id: string; type: string; label: string; subtitle?: string }>,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any
): Promise<string | null> {
  const lines: string[] = [];

  await Promise.all(mentions.map(async (m) => {
    try {
      switch (m.type) {
        case 'email': {
          const { data } = await adminClient
            .from('emails')
            .select('subject, from_name, from_email, body_preview, received_at')
            .eq('id', m.id)
            .eq('user_id', userId)
            .single();
          if (data) {
            lines.push(
              `[EMAIL] "${data.subject || '(no subject)'}"\n` +
              `From: ${data.from_name || data.from_email} · ${new Date(data.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}\n` +
              (data.body_preview ? `Preview: ${data.body_preview.slice(0, 300)}` : '')
            );
          }
          break;
        }
        case 'meeting': {
          const { data } = await adminClient
            .from('calendar_events')
            .select('title, start_time, end_time, attendees, description')
            .eq('id', m.id)
            .single();
          if (data) {
            const attendeeList = Array.isArray(data.attendees)
              ? (data.attendees as Array<{ name?: string; email?: string }>)
                  .slice(0, 5).map(a => a.name || a.email).join(', ')
              : '';
            lines.push(
              `[MEETING] "${data.title}"\n` +
              `When: ${new Date(data.start_time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}\n` +
              (attendeeList ? `Attendees: ${attendeeList}` : '') +
              (data.description ? `\nNotes: ${String(data.description).slice(0, 200)}` : '')
            );
          }
          break;
        }
        case 'kb': {
          const { data } = await adminClient
            .from('knowledge_files')
            .select('filename, title, source')
            .eq('id', m.id)
            .eq('user_id', userId)
            .single();
          if (data) {
            lines.push(`[DOCUMENT] "${data.title || data.filename}" (${data.source || 'Knowledge base'})`);
          }
          break;
        }
        case 'process': {
          const { data } = await adminClient
            .from('processes')
            .select('title, status, current_step_index, description')
            .eq('id', m.id)
            .eq('user_id', userId)
            .single();
          if (data) {
            lines.push(
              `[PROCESS] "${data.title}" — ${data.status}` +
              (data.current_step_index != null ? `, step ${data.current_step_index + 1}` : '') +
              (data.description ? `\n${String(data.description).slice(0, 200)}` : '')
            );
          }
          break;
        }
        case 'contact': {
          const { data } = await adminClient
            .from('relationship_graph')
            .select('name, email, relationship, topics, last_interaction')
            .eq('id', m.id)
            .eq('user_id', userId)
            .single();
          if (data) {
            lines.push(
              `[CONTACT] ${data.name} (${data.email}) — ${data.relationship}` +
              (data.topics?.length ? `\nTopics: ${(data.topics as string[]).slice(0, 4).join(', ')}` : '')
            );
          }
          break;
        }
      }
    } catch {
      // Non-fatal — if a mention fails to load, skip it
    }
  }));

  if (lines.length === 0) return null;
  return `MENTIONED ITEMS (the user explicitly referenced these — prioritize them in your response):\n\n${lines.join('\n\n')}`;
}
