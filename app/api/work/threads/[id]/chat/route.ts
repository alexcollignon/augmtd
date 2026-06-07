import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type OpenAI from 'openai';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { buildChatSystemPrompt, detectModelFamily } from '@/lib/work/chat-system-prompt'
// Intent classifier removed — replaced by lightweight heuristic router below.
// import { classifyIntent } from '@/lib/work/intent-classifier';
import { buildUserContextBlock } from '@/lib/context/build-user-context';
import { buildKBContext } from '@/lib/knowledge/build-kb-context';
import { getCalendarContext } from '@/lib/calendar/calendar-context';
import { formatCalendarContextForChat } from '@/lib/calendar/format-calendar-context';
import { runFullPipeline } from '@/lib/work/generate-pipeline';
import { buildToolRegistry } from '@/lib/mcp/registry';
import { DocumentArtifact } from '@/lib/types/inbox';
import { indexArtifact } from '@/lib/knowledge/indexer';
import { getMimeType, getFileExt } from '@/lib/artifacts/builders';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getMyWorkspace } from '@/lib/workspace/features';
import { DEFAULT_FEATURES, type WorkspaceFeatures } from '@/lib/workspace/types';
import {
  webSearchDefinition, fetchUrlDefinition, executeWebSearch, executeFetchUrl,
  getEmailsDefinition, executeGetEmails,
  getMeetingContextDefinition, executeGetMeetingContext,
  deepResearchDefinition, executeDeepResearch,
} from '@/lib/tools';
import { checkRateLimit } from '@/lib/utils/rate-limit';

export const maxDuration = 60;

// Module-level singleton — reused across requests within the same server process.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function getAdminClient() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}

const SSE = (data: object) => `data: ${JSON.stringify(data)}\n\n`;

// ── Heuristic router — replaces AI intent classifier ────────────────────────
// Zero AI calls, <1ms. Returns how the model should be configured for this turn.

type RouteMode = 'no_tools' | 'force_generate' | 'all_tools';

const GREETING_RE = /^(hi|hey|hello|thanks|thank you|ok|okay|sure|got it|sounds good|great|nice|cool|yep|yes|no|nope)\b[.!?\s]*$/i;

function heuristicRoute(
  content: string,
  mentions: Array<{ id: string; type: string }>,
  existingArtifacts?: unknown[],
): RouteMode {
  const trimmed = content.trim();

  // Clarification confirmed → force generate
  if (trimmed.startsWith('[CLARIFICATION CONFIRMED]')) return 'force_generate';

  // Simple greetings/acknowledgements with no mentions → no tools
  if (GREETING_RE.test(trimmed) && mentions.length === 0) return 'no_tools';

  // Everything else → model gets all tools and decides
  return 'all_tools';
}

// ── Smart pre-fetcher — heuristic context injection ─────────────────────────
// Detects temporal, person, and task references via regex. Pre-fetches matching
// context in parallel BEFORE the AI call, so the model appears omniscient.

const TEMPORAL_RE = /\b(today|tomorrow|this week|next week|meeting|meetings|schedule|calendar|upcoming)\b/i;
const TASK_RE = /\b(task|tasks|todo|to.do|working on|urgent|deadline|follow.?up|backlog|in progress)\b/i;

async function prefetchContext(
  message: string,
  userId: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  const parts: string[] = [];
  const fetches: Promise<void>[] = [];

  // Temporal references → calendar
  if (TEMPORAL_RE.test(message)) {
    fetches.push(
      getCalendarContext(userId, supabase).then(calCtx => {
        const formatted = formatCalendarContextForChat(calCtx);
        if (formatted) parts.push(formatted);
      }).catch(() => {})
    );
  }

  if (fetches.length === 0) return null;
  await Promise.all(fetches);
  return parts.length > 0 ? `<available_context>\n${parts.join('\n\n')}\n</available_context>` : null;
}

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

  const messages = (messagesResult.data || []).map((m: Record<string, unknown>) => {
    const meta = m.metadata as Record<string, unknown> | null;
    return {
      ...m,
      mentions: (meta?.mentions as unknown[] | undefined) || undefined,
    };
  });

  return NextResponse.json({
    thread: threadResult.data,
    messages,
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

    const rl = checkRateLimit(`chat:${user.id}`, 20, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
      );
    }

    const { data: thread, error: threadError } = await supabase
      .from('work_threads')
      .select('id, title, user_attachments, artifacts, is_temporary')
      .eq('id', threadId)
      .eq('user_id', user.id)
      .single();

    if (threadError || !thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    const body = await request.json();
    const { content, sources = ['kb', 'inbox', 'calendar'], mentions = [], attachments = [], agentId } = body as {
      content: string;
      sources?: string[];
      mentions?: Array<{ id: string; type: string; label: string; subtitle?: string }>;
      attachments?: Array<{ id: string; name: string }>;
      agentId?: string;
    };

    if (!content?.trim()) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 });
    }

    // ── Resolve AI client via factory ────────────────────────────────────────
    const adminClient = getAdminClient();

    const { client: aiClient, model: chatModel, endpoint: chatEndpoint } = await getAIClient(user.id, 'conversation', supabase);
    const modelFamily = detectModelFamily(chatModel);

    // Save user message — capture ID so we can update metadata with mention_context later
    const { data: savedMsg } = await adminClient.from('work_messages').insert({
      thread_id: threadId,
      role: 'user',
      content: content.trim(),
      metadata: (mentions.length > 0 || attachments.length > 0) ? { mentions: mentions.length > 0 ? mentions : undefined, attachments: attachments.length > 0 ? attachments : undefined } : null,
    }).select('id').single();

    // Check if this is the first message (for auto-rename)
    const { count: msgCount } = await adminClient
      .from('work_messages')
      .select('id', { count: 'exact', head: true })
      .eq('thread_id', threadId);
    const isFirstMessage = (msgCount ?? 0) <= 1;

    // Load conversation history — include metadata so mention_context is re-injected
    const { data: history } = await adminClient
      .from('work_messages')
      .select('role, content, metadata')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
      .limit(40);

    // Build static context + smart pre-fetch in parallel (no AI calls)
    const [userContextBlock, contactsResult, prefetchedContext, agentResult] = await Promise.all([
      buildUserContextBlock(user.id, supabase),
      adminClient
        .from('relationship_graph')
        .select('contact_name, contact_email, relationship_type, importance, last_interaction, typical_topics')
        .eq('user_id', user.id)
        .gte('importance', 0.3)
        .order('importance', { ascending: false })
        .limit(10),
      prefetchContext(content, user.id, supabase),
      agentId
        ? adminClient
            .from('custom_agents')
            .select('id, user_id, name, instructions, memory_text, web_enabled, agent_knowledge_sources(knowledge_file_id)')
            .eq('id', agentId)
            .single()
        : Promise.resolve({ data: null }),
    ]);

    const agentRaw = (agentResult as { data: { id: string; user_id: string; name: string; instructions: string | null; memory_text: string | null; web_enabled: boolean | null; agent_knowledge_sources: Array<{ knowledge_file_id: string | null }> } | null }).data ?? null;

    // For shared agents used by non-owners, load personal memory from agent_memories
    let agentMemoryText = agentRaw?.memory_text ?? null;
    if (agentRaw && agentRaw.user_id !== user.id) {
      const { data: memRow } = await adminClient
        .from('agent_memories')
        .select('memory_text')
        .eq('agent_id', agentRaw.id)
        .eq('user_id', user.id)
        .single();
      agentMemoryText = (memRow as { memory_text: string | null } | null)?.memory_text ?? null;
    }

    const agent = agentRaw ? { ...agentRaw, memory_text: agentMemoryText } : null;
    const agentFileIds: string[] = agent
      ? agent.agent_knowledge_sources
          .map((s: { knowledge_file_id: string | null }) => s.knowledge_file_id)
          .filter((id: string | null): id is string => Boolean(id))
      : [];

    // ── Heuristic router — replaces the AI intent classifier ─────────────────
    // Zero AI calls, <1ms. Decides tool availability based on simple patterns.
    const routeMode = heuristicRoute(content, mentions, (thread as any).artifacts);

    // Format context blocks
    // When an agent is active, its identity takes top priority — injected BEFORE the base prompt.
    // This ensures the model adopts the agent's role rather than treating instructions as an addendum.
    const contextParts: string[] = [];

    if (agent) {
      // Agent-first system prompt: role + instructions + memory, then base capabilities below
      const agentHeader = [
        `You are "${agent.name}", a custom AI assistant with a specific role.`,
        agent.instructions?.trim()
          ? `Your instructions:\n${agent.instructions.trim()}`
          : '',
        `Stay in this role for the entire conversation. Do not describe yourself as a general-purpose assistant.`,
        `Approach: when context is incomplete, make a reasonable assumption, state it briefly, and attempt the task. The user wants output. If you must ask, ask ONE focused question — never a list of questions.`,
        agent.web_enabled
          ? `You have access to web_search and fetch_url tools. Use them proactively — do not answer from memory when fresh information is available online.`
          : '',
      ].filter(Boolean).join('\n\n');
      contextParts.push(agentHeader);

      if (agent.memory_text?.trim()) {
        contextParts.push(
          `[MEMORY — things you've learned about this user from past conversations]\n${agent.memory_text.trim()}`
        );
      }

      // Append base capabilities so the agent still has tools/format knowledge
      contextParts.push(buildChatSystemPrompt(modelFamily));
    } else {
      contextParts.push(buildChatSystemPrompt(modelFamily));
    }

    if (userContextBlock) {
      contextParts.push(
        userContextBlock +
        '\n\n(Answer questions about the user directly from the context above — no tool call needed for anything listed here.)'
      );
    }

    const contacts = (contactsResult.data ?? []) as Array<{
      contact_name: string; contact_email: string; relationship_type: string; importance: number;
      last_interaction: string | null; typical_topics: string[] | null;
    }>;
    if (contacts.length > 0) {
      contextParts.push(
        'KEY CONTACTS (from your network):\n' +
        contacts.map(c => {
          const parts = [`- ${c.contact_name} (${c.contact_email}) — ${c.relationship_type}`];
          if (c.last_interaction) {
            parts.push(`last contact: ${new Date(c.last_interaction).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`);
          }
          if (c.typical_topics?.length) parts.push(`topics: ${c.typical_topics.slice(0, 3).join(', ')}`);
          return parts.join(', ');
        }).join('\n')
      );
    }

    // Pre-fetched context — injected so the model appears to "just know" relevant info
    if (prefetchedContext) {
      contextParts.push(prefetchedContext);
    }

    // Existing artifacts — inject title + full content so AI can reference and edit them
    const existingArtifacts = ((thread as any).artifacts || []) as DocumentArtifact[];
    if (existingArtifacts.length > 0) {
      const artifactBlocks = existingArtifacts.map(a => {
        const raw = a.type === 'document' && a.content
          ? serializeDocContent(a.content as import('@/lib/types/inbox').DocContent)
          : null;
        const docContent = raw && raw.length > 12000 ? raw.slice(0, 12000) + '\n\n[...document truncated for context...]' : raw;
        return docContent
          ? `DOCUMENT: "${a.title}"\n---\n${docContent}\n---`
          : `DOCUMENT: "${a.title}" (${a.type}) — no preview available`;
      }).join('\n\n');
      contextParts.push(
        'DOCUMENTS ALREADY CREATED IN THIS CONVERSATION:\n\n' + artifactBlocks +
        '\n\nWhen the user asks to edit or update any of these documents, call generate_document immediately — do NOT ask clarifying questions about content you can already see above.'
      );
    }

    // Attachment context from thread files
    const userAttachments = ((thread as any).user_attachments || []) as Array<{
      chatAttachId?: string;
      filename: string;
      mimeType?: string;
      storagePath?: string;
      extractedText: string | null;
    }>;

    // Re-extract text for PDFs that failed at upload time (pdf-parse returned empty string → stored as null).
    // Run against ALL thread attachments — not gated on the current message's attachment IDs — so
    // the text context path works even when the client didn't send attachment IDs in the request body.
    const needsExtraction = userAttachments.filter(ua =>
      !ua.extractedText && ua.mimeType === 'application/pdf' && ua.storagePath
    );
    if (needsExtraction.length > 0) {
      const { extractTextFromAttachment } = await import('@/lib/attachments/text-extractor');
      await Promise.all(needsExtraction.map(async (ua) => {
        try {
          const { data } = await adminClient.storage.from('email-attachments').download(ua.storagePath!);
          if (!data) return;
          const buf = Buffer.from(await data.arrayBuffer());
          const text = await extractTextFromAttachment(buf, 'application/pdf', ua.filename);
          if (!text?.trim()) return;
          ua.extractedText = text.trim().replace(/\u0000/g, '').slice(0, 4000);
        } catch { /* leave null — native-PDF path still handles Bedrock/Anthropic */ }
      }));
      // Persist any newly extracted text so future messages don't re-download
      if (needsExtraction.some(ua => ua.extractedText)) {
        adminClient.from('work_threads')
          .update({ user_attachments: userAttachments })
          .eq('id', threadId)
          .catch(() => {});
      }
    }

    if (userAttachments.some(a => a.extractedText)) {
      const attachCtx = userAttachments
        .filter(a => a.extractedText)
        .map(a => `--- ${a.filename} ---\n${a.extractedText}`)
        .join('\n\n');
      contextParts.push(`ATTACHED FILES:\n${attachCtx}`);
    }

    const system = contextParts.join('\n\n');

    // Mention context — fetched AFTER system is built; injected into the last user message
    // so the model reads it as user-attached context, not system instructions.
    // Also persisted to work_messages.metadata so subsequent turns can re-inject it from history.
    let mentionContext: string | null = null;
    let mentionKbContext = '';
    if (mentions.length > 0) {
      const mentionResult = await buildMentionContext(mentions, user.id, adminClient);
      mentionContext = mentionResult.mentionContext;
      mentionKbContext = mentionResult.kbContext;
      if (mentionContext && savedMsg?.id) {
        adminClient.from('work_messages')
          .update({ metadata: { mentions, mention_context: mentionContext } })
          .eq('id', savedMsg.id)
          .then(() => {}).catch(() => {});
      }
    }

    // Build tools based on heuristic route — model gets full tool set unless trivially conversational
    const tools = routeMode === 'no_tools'
      ? []
      : buildChatTools(sources, chatEndpoint.provider, modelFamily);

    // Build message history — system goes first, then conversation.
    // The last user message is augmented with mention context so "what is this about?"
    // unambiguously refers to the mentioned item rather than the system prompt.
    const rawHistory = (history || []).map((m: { role: string; content: string; metadata?: unknown }) => {
      const meta = m.metadata as Record<string, unknown> | null;
      const savedMentionCtx = meta?.mention_context as string | undefined;
      return {
        role: m.role as 'user' | 'assistant',
        content: savedMentionCtx ? `${m.content}\n\n${savedMentionCtx}` : m.content,
      };
    });
    if (mentionContext && rawHistory.length > 0) {
      const last = rawHistory[rawHistory.length - 1];
      if (last.role === 'user') {
        rawHistory[rawHistory.length - 1] = {
          ...last,
          content: `${last.content}\n\n${mentionContext}`,
        };
      }
    }
    const systemFinal = tools.length === 0
      ? system + '\n\nNo tools are available. Do not output any XML, function calls, or <function_calls> blocks. Answer directly from the context above.'
      : system;

    // Token budget management — prevent silent context overflow on smaller models.
    // ~4 chars per token is a rough heuristic. Trim oldest history messages if over budget.
    const MAX_CONTEXT_CHARS = 48000; // ~12K tokens — safe headroom for 128K context models
    const systemChars = systemFinal.length;
    let historyChars = rawHistory.reduce((sum: number, m: { content?: string }) => sum + (m.content?.length ?? 0), 0);
    let trimmedHistory = rawHistory;
    if (systemChars + historyChars > MAX_CONTEXT_CHARS && rawHistory.length > 10) {
      // Keep last 10 messages to preserve recent context
      trimmedHistory = rawHistory.slice(-10);
      historyChars = trimmedHistory.reduce((sum: number, m: { content?: string }) => sum + (m.content?.length ?? 0), 0);
    }

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemFinal },
      ...trimmedHistory,
    ];

    // Vision: inject image attachments from the current message as base64 content blocks.
    // Download from storage → data URI so all providers (including Bedrock) get base64 format.
    if (attachments.length > 0) {
      const imageAttachRecords = userAttachments.filter((ua: any) =>
        ua.mimeType?.startsWith('image/') &&
        ua.storagePath &&
        attachments.some((a: { id: string }) => a.id === ua.chatAttachId)
      );
      if (imageAttachRecords.length > 0) {
        const downloadResults = await Promise.all(
          imageAttachRecords.map(async (ua: any) => {
            try {
              const { data, error } = await adminClient.storage.from('email-attachments').download(ua.storagePath);
              if (error || !data) return null;
              let buf = Buffer.from(await data.arrayBuffer());
              let mime = ua.mimeType as string;
              // Resize if needed — Bedrock and others cap image payloads at 5 MB
              const { resizeImageIfNeeded } = await import('@/lib/attachments/resize-image');
              ({ buffer: buf, mimeType: mime } = await resizeImageIfNeeded(buf, mime));
              const b64 = buf.toString('base64');
              return { dataUri: `data:${mime};base64,${b64}` };
            } catch {
              return null;
            }
          })
        );
        const imageBlocks = downloadResults
          .filter((r): r is { dataUri: string } => r !== null)
          .map((r) => ({
            type: 'image_url' as const,
            image_url: { url: r.dataUri },
          }));
        if (imageBlocks.length > 0) {
          const lastIdx = messages.findLastIndex((m: OpenAI.Chat.ChatCompletionMessageParam) => m.role === 'user');
          if (lastIdx !== -1) {
            const lastMsg = messages[lastIdx];
            const textContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';
            messages[lastIdx] = {
              role: 'user',
              content: [
                { type: 'text', text: textContent || '(see attached images)' },
                ...imageBlocks,
              ],
            };
          }
        }
      }
    }

    // PDF attachments: for Anthropic/Bedrock providers, inject as native document blocks.
    // Handles PDFs where text extraction returned nothing (truly scanned, no text layer).
    // The Bedrock adapter passes { type: 'document' } blocks through to Anthropic Messages API unchanged.
    // Not gated on attachments[] IDs — reads user_attachments directly so files are visible
    // even when the client didn't send attachment IDs in the request body.
    if (chatEndpoint.provider === 'bedrock' || chatEndpoint.provider === 'anthropic') {
      const pdfAttachRecords = userAttachments.filter((ua: any) =>
        ua.mimeType === 'application/pdf' &&
        !ua.extractedText &&
        ua.storagePath
      );
      if (pdfAttachRecords.length > 0) {
        const pdfResults = await Promise.all(
          pdfAttachRecords.map(async (ua: any) => {
            try {
              const { data, error } = await adminClient.storage.from('email-attachments').download(ua.storagePath);
              if (error || !data) return null;
              const buf = Buffer.from(await data.arrayBuffer());
              return { b64: buf.toString('base64'), filename: ua.filename as string };
            } catch {
              return null;
            }
          })
        );
        const pdfBlocks = pdfResults
          .filter((r): r is { b64: string; filename: string } => r !== null)
          .map((r) => ({
            type: 'document' as const,
            source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: r.b64 },
          }));
        if (pdfBlocks.length > 0) {
          const lastIdx = messages.findLastIndex((m) => m.role === 'user');
          if (lastIdx !== -1) {
            const lastMsg = messages[lastIdx];
            const existingBlocks: any[] = Array.isArray(lastMsg.content)
              ? lastMsg.content
              : [{ type: 'text', text: typeof lastMsg.content === 'string' ? lastMsg.content : '' }];
            messages[lastIdx] = { role: 'user', content: [...existingBlocks, ...pdfBlocks] as any };
          }
        }
      }
    }

    // Resolve workspace features for graceful context degradation
    const workspace = await getMyWorkspace(user.id, supabase);
    const features: WorkspaceFeatures = workspace?.features ?? DEFAULT_FEATURES;

    // Build run context for document generation
    const runContext = {
      userId: user.id,
      threadId,
      supabase,
      adminClient,
      thread,
      existingArtifacts: ((thread as any).artifacts || []) as DocumentArtifact[],
      userContextBlock: userContextBlock || undefined,
      kbSources: [] as Array<{ id: string; title: string; type: 'kb' }>,
      // Pre-populate with @mention KB content so generate_document is grounded
      // even when the AI didn't call search_knowledge_base
      kbContext: mentionKbContext,
      agentFileIds: agentFileIds.length > 0 ? agentFileIds : undefined,
      agentId: agentId || undefined,
      isTemporary: !!(thread as any).is_temporary,
      features,
    };

    // ── Stream ────────────────────────────────────────────────────────────────
    let fullAssistantText = '';
    const allToolCalls: Array<{ name: string; summary: string; citations?: string[]; clarification?: object }> = [];
    const allArtifactIds: string[] = [];

    const readable = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (data: object) => {
          try { controller.enqueue(encoder.encode(SSE(data))); } catch { /* stream closed */ }
        };

        // SSE heartbeat — keeps connection alive during long tool executions
        const heartbeat = setInterval(() => {
          try { controller.enqueue(encoder.encode(': keep-alive\n\n')); } catch { /* stream closed */ }
        }, 15000);

        // When the user confirms a clarification, we know generate_document will be called.
        // Send an early chip so the user sees feedback immediately during the <think> phase.
        if (routeMode === 'force_generate') {
          send({ type: 'tool_start', name: 'generate_document', id: 'pre-generate', label: 'Generating document' });
        }

        try {
          let continueLoop = true;
          let turnIndex = 0;
          let toolRetries = 0;
          const MAX_TOOL_RETRIES = 2;
          // Dedup: prevent same tool+query being called twice in one turn
          const calledTools = new Set<string>();
          const toolResultCache = new Map<string, string>();

          while (continueLoop) {
            // Accumulate tool call fragments — OpenAI streams arguments in pieces
            const toolCallAccum = new Map<number, { id: string; name: string; args: string }>();
            let turnText = '';
            // Once XML tool call markers appear mid-stream, stop sending live deltas
            // and wait for text_set at stream end to show the clean version.
            let xmlStreamSuppressed = false;

            // Retry wrapper for transient errors (429, 503, 529)
            let stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
            let attempts = 0;
            while (true) {
              try {
                const hasTools = tools.length > 0;
                // Temperature: low when tools available (reliable selection), higher for pure conversation
                const temperature = hasTools ? 0.15 : 0.5;
                stream = await aiClient.chat.completions.create({
                  model: chatModel,
                  max_tokens: 4096,
                  temperature,
                  ...(hasTools ? {
                    tools,
                    tool_choice: deriveToolChoice(routeMode, turnIndex),
                    parallel_tool_calls: false,
                  } : {}),
                  messages,
                  stream: true,
                }) as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
                turnIndex++;
                break;
              } catch (err: any) {
                const retryable = err?.status === 429 || err?.status === 503 || err?.status === 529;
                if (retryable && attempts < 2) {
                  attempts++;
                  await new Promise(r => setTimeout(r, 1000 * attempts));
                } else {
                  throw err;
                }
              }
            }

            let sawFinish = false;

            for await (const chunk of stream) {
              const choice = chunk.choices[0];
              if (!choice) continue;

              const delta = choice.delta;
              const finishReason = choice.finish_reason as string | null;

              // Stream text delta — suppress once XML tool call markers appear
              if (delta?.content) {
                turnText += delta.content;
                if (!xmlStreamSuppressed) {
                  const hasXmlMarker = turnText.includes('<think>') ||
                    turnText.includes('<function_calls>') ||
                    turnText.includes('<tool_call>') ||
                    XML_TOOL_NAMES.some(n => turnText.includes(`<${n}>`));
                  if (hasXmlMarker) {
                    xmlStreamSuppressed = true;
                    // Immediately show clean version (strips XML and anything after it)
                    const cleanSoFar = stripXmlToolCalls(turnText);
                    send({ type: 'text_set', content: cleanSoFar });
                  } else {
                    send({ type: 'text', delta: delta.content });
                  }
                }
                // If xmlStreamSuppressed, accumulate silently — text_set at stream end handles display
              }

              // Accumulate tool call fragments by index
              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  if (!toolCallAccum.has(tc.index)) {
                    toolCallAccum.set(tc.index, { id: tc.id ?? '', name: tc.function?.name ?? '', args: '' });
                  }
                  const acc = toolCallAccum.get(tc.index)!;
                  if (tc.id) acc.id = tc.id;
                  if (tc.function?.name) acc.name = tc.function.name;
                  if (tc.function?.arguments) acc.args += tc.function.arguments;
                }
              }

              if (finishReason === 'stop' || finishReason === 'end_turn' || finishReason === 'eos' || finishReason === 'length') {
                sawFinish = true;

                // Some models (DeepSeek on Fireworks, Claude via Anthropic compat) emit tool calls
                // as XML text instead of structured tool_calls deltas. Always strip XML from the
                // displayed text; only execute as tool calls when no structured calls were received.
                const cleanText = stripXmlToolCalls(turnText);
                if (cleanText !== turnText) {
                  send({ type: 'text_set', content: cleanText });
                }

                const xmlCalls = toolCallAccum.size === 0 ? parseXmlToolCalls(turnText) : null;
                if (xmlCalls && xmlCalls.length > 0) {
                  fullAssistantText += cleanText;

                  const syntheticToolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = xmlCalls.map((c, i) => ({
                    id: `xml-${Date.now()}-${i}`,
                    type: 'function' as const,
                    function: { name: c.name, arguments: JSON.stringify(c.args) },
                  }));

                  messages.push({ role: 'assistant', content: cleanText || null, tool_calls: syntheticToolCalls });

                  const toolResultMessages: OpenAI.Chat.ChatCompletionToolMessageParam[] = [];
                  for (const _tc of syntheticToolCalls) {
                    const tc = _tc as { id: string; function: { name: string; arguments: string } };
                    let toolInput: Record<string, unknown> = {};
                    try { toolInput = JSON.parse(tc.function.arguments); } catch {}

                    const dedupeKey = `${tc.function.name}:${String(toolInput.query ?? toolInput.filter ?? '')}`;
                    if (calledTools.has(dedupeKey)) {
                      toolResultMessages.push({ role: 'tool', tool_call_id: tc.id, content: toolResultCache.get(dedupeKey) ?? 'Already retrieved.' });
                      continue;
                    }
                    calledTools.add(dedupeKey);

                    send({ type: 'tool_start', name: tc.function.name, id: tc.id, label: toolLabel(tc.function.name) });
                    const { result, summary, artifact, citations, clarification, stopStream } = await executeChatTool(tc.function.name, toolInput, sources, runContext);
                    send({ type: 'tool_result', name: tc.function.name, id: tc.id, summary, ...(citations?.length ? { citations } : {}) });
                    allToolCalls.push({ name: tc.function.name, summary, ...(citations?.length ? { citations } : {}) });
                    if (clarification) send({ type: 'clarification_request', ...(clarification as object) });
                    if (artifact?.id) { allArtifactIds.push(artifact.id); send({ type: 'artifact_ready', artifact: { id: artifact.id, type: artifact.type, title: artifact.title } }); }
                    toolResultMessages.push({ role: 'tool', tool_call_id: tc.id, content: result });
                    toolResultCache.set(dedupeKey, result);
                    if (stopStream) { continueLoop = false; break; }
                  }
                  for (const tr of toolResultMessages) messages.push(tr);
                  if (continueLoop) continueLoop = true; // continue to get AI's response after tools
                } else {
                  fullAssistantText += cleanText;
                  messages.push({ role: 'assistant', content: cleanText || '' });
                  continueLoop = false;
                }

              } else if (finishReason === 'tool_calls') {
                sawFinish = true;
                const cleanTurnText = stripXmlToolCalls(turnText);
                // Strip <think> blocks so fullAssistantText stays clean for empty-response detection
                fullAssistantText += cleanTurnText;

                // Flush any accumulated text BEFORE firing tool events so the UI renders
                // text above tool chips/clarification widgets, not after them.
                // This matters when <think> suppressed all text deltas (xmlStreamSuppressed = true).
                if (cleanTurnText && xmlStreamSuppressed) {
                  send({ type: 'text_set', content: cleanTurnText });
                }

                const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] =
                  Array.from(toolCallAccum.values()).map(tc => ({
                    id: tc.id,
                    type: 'function' as const,
                    function: { name: tc.name, arguments: tc.args },
                  }));

                // Add assistant turn with tool calls to history
                messages.push({
                  role: 'assistant',
                  content: turnText || null,
                  tool_calls: toolCalls,
                });

                const toolResultMessages: OpenAI.Chat.ChatCompletionToolMessageParam[] = [];

                for (const _tc of toolCalls) {
                  const tc = _tc as { id: string; function: { name: string; arguments: string } };
                  let toolInput: Record<string, unknown>;
                  try {
                    toolInput = JSON.parse(tc.function.arguments);
                  } catch {
                    toolInput = {};
                  }

                  // Dedup: if same tool+query already ran this turn, return cached result silently
                  const dedupeKey = `${tc.function.name}:${String(toolInput.query ?? toolInput.filter ?? '')}`;
                  if (calledTools.has(dedupeKey)) {
                    const cached = toolResultCache.get(dedupeKey) ?? 'Already retrieved.';
                    toolResultMessages.push({ role: 'tool', tool_call_id: tc.id, content: cached });
                    continue;
                  }
                  calledTools.add(dedupeKey);

                  send({ type: 'tool_start', name: tc.function.name, id: tc.id, label: toolLabel(tc.function.name) });

                  const { result, summary, artifact, citations, clarification, stopStream, retryCorrection } = await executeChatTool(
                    tc.function.name,
                    toolInput,
                    sources,
                    runContext
                  );

                  // Validation failed — inject correction and retry via next loop iteration
                  if (retryCorrection) {
                    if (toolRetries < MAX_TOOL_RETRIES) {
                      toolRetries++;
                      toolResultMessages.push({ role: 'tool', tool_call_id: tc.id, content: result });
                    } else {
                      // Retries exhausted — surface a fallback so the user sees something
                      const fallback = "I found some relevant content but ran into an issue preparing the confirmation. Could you rephrase your request or let me know what you'd like to do next?";
                      send({ type: 'text', delta: fallback });
                      fullAssistantText += fallback;
                      continueLoop = false;
                    }
                    break;
                  }

                  send({ type: 'tool_result', name: tc.function.name, id: tc.id, summary, ...(citations?.length ? { citations } : {}) });
                  allToolCalls.push({ name: tc.function.name, summary, ...(citations?.length ? { citations } : {}) });

                  if (clarification) {
                    send({ type: 'clarification_request', ...(clarification as object) });
                  }

                  if (artifact?.id) {
                    allArtifactIds.push(artifact.id);
                    send({ type: 'artifact_ready', artifact: { id: artifact.id, type: artifact.type, title: artifact.title } });
                  }

                  toolResultMessages.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    content: result,
                  });
                  toolResultCache.set(dedupeKey, result);

                  if (stopStream) {
                    continueLoop = false;
                    allToolCalls[allToolCalls.length - 1] = {
                      ...allToolCalls[allToolCalls.length - 1],
                      clarification: clarification as object,
                    };
                    break;
                  }
                }

                // Add tool results to history (even when stopping, preserves clarification context)
                for (const tr of toolResultMessages) {
                  messages.push(tr);
                }

                if (!continueLoop) break;
              }
            }

            // Fallback: if the stream closed without a recognized finish_reason
            // (e.g. Together AI / Llama send null or an unknown value), treat it as stop.
            if (!sawFinish && continueLoop) {
              fullAssistantText += turnText;
              messages.push({ role: 'assistant', content: turnText || '' });
              continueLoop = false;
            }
          }

          // If tools ran but the model returned empty text, retry once with a nudge
          if (!fullAssistantText.trim() && allToolCalls.length > 0) {
            messages.push({
              role: 'user',
              content: 'Please respond based on the tool results above. List specific items by name.',
            });
            try {
              let retryRaw = '';
              const retryStream = await aiClient.chat.completions.create({
                model: chatModel,
                max_tokens: 4096,
                temperature: 0.5,
                messages,
                stream: true,
              }) as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
              let retrySuppressed = false;
              for await (const chunk of retryStream) {
                const delta = chunk.choices[0]?.delta;
                if (delta?.content) {
                  retryRaw += delta.content;
                  if (!retrySuppressed) {
                    if (retryRaw.includes('<think>')) {
                      retrySuppressed = true;
                    } else {
                      send({ type: 'text', delta: delta.content });
                    }
                  }
                  // Once think block closes, start streaming the clean text after it
                  if (retrySuppressed && retryRaw.includes('</think>')) {
                    retrySuppressed = false;
                    const afterThink = retryRaw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
                    if (afterThink) {
                      send({ type: 'text_set', content: afterThink });
                    }
                  }
                }
              }
              // Final cleanup — strip any remaining think blocks
              fullAssistantText = retryRaw
                .replace(/<think>[\s\S]*?<\/think>/gi, '')
                .replace(/<think>[\s\S]*$/gi, '')
                .trim();
              send({ type: 'text_set', content: fullAssistantText });
            } catch (retryErr) {
              console.error('[Chat] Empty-response retry failed:', retryErr);
            }
          }

          // Auto-rename — fire and forget so it doesn't block the done event
          if (isFirstMessage) {
            generateAutoTitle(content, user.id, supabase, adminClient, threadId)
              .then(title => { if (title) send({ type: 'title_update', title }); })
              .catch(() => {});
          }

          // Memory extraction — fire and forget after agent conversations
          if (runContext.agentId) {
            fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/agents/${runContext.agentId}/extract-memory`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Cookie: request.headers.get('cookie') ?? '' },
              body: JSON.stringify({ threadId }),
            }).catch(() => {});
          }

          send({ type: 'done' });
        } catch (err) {
          console.error('[Chat] Stream error:', err);
          send({ type: 'error', message: 'An error occurred. Please try again.' });
        } finally {
          clearInterval(heartbeat);
          // Save complete assistant message
          try {
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

// ── Tool definitions (neutral schema — input_schema maps directly to OpenAI parameters) ──

interface NeutralTool {
  name: string;
  description: string;
  input_schema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

function deriveToolChoice(
  routeMode: RouteMode,
  turnIndex: number
): OpenAI.Chat.ChatCompletionToolChoiceOption {
  // Only force on the very first API call of this request — subsequent tool-loop
  // turns must be 'auto' to avoid infinite generation loops.
  if (turnIndex === 0 && routeMode === 'force_generate') {
    return { type: 'function', function: { name: 'generate_document' } };
  }
  return 'auto';
}

function buildChatTools(sources: string[], _provider: string, _modelFamily: string): OpenAI.Chat.ChatCompletionTool[] {
  const neutral: NeutralTool[] = [];

  // ── Search tools ──────────────────────────────────────────────────────────
  if (sources.includes('kb')) {
    neutral.push({
      name: 'search_knowledge_base',
      description: "Search indexed files and Drive documents for relevant content.",
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Specific search query' },
        },
        required: ['query'],
      },
    });
  }

  if (sources.includes('kb')) {
    neutral.push({
      name: 'read_document',
      description: "Read the full content of a specific document. Call after search_knowledge_base finds a relevant file and you need more detail than the search excerpt.",
      input_schema: {
        type: 'object',
        properties: {
          file_id: { type: 'string', description: 'File ID from search results' },
          filename: { type: 'string', description: 'Filename (for display)' },
        },
        required: ['file_id', 'filename'],
      },
    });
  }

  if (sources.includes('inbox')) {
    neutral.push(getEmailsDefinition);
    neutral.push({
      name: 'get_email_body',
      description: "Read the full body of a specific email by ID. Call after get_emails identifies the email you need.",
      input_schema: {
        type: 'object',
        properties: {
          email_id: { type: 'string', description: 'The email ID from get_emails results' },
        },
        required: ['email_id'],
      },
    });
  }

  if (sources.includes('calendar')) {
    neutral.push(getMeetingContextDefinition);
  }

  if (sources.includes('research')) {
    neutral.push(deepResearchDefinition);
  }

  // ── Web tools — available when user enables web search ─────────────────────
  if (sources.includes('web')) {
    neutral.push(
      webSearchDefinition,
      fetchUrlDefinition,
    );
  }

  // ── Action tools ────────────────────────────────────────────────────────────
  neutral.push(
    {
      name: 'request_clarification',
      description: "Present a confirmation card before generating a file. Call ONLY when: (1) the user's message explicitly requested a file artifact using words like 'document', 'Word doc', 'spreadsheet', 'presentation', 'deck', 'PDF', 'file', 'to download', 'to send as' AND (2) you have searched and found relevant content. Content type alone is never enough — 'write a press release / report / proposal / summary' does NOT qualify. Do NOT call when searches returned nothing — respond conversationally instead.",
      input_schema: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            minLength: 10,
            description: 'A STATEMENT of what you will create — must be declarative, not a question. Example: "I\'ll create a pricing summary using the three documents I found."',
          },
          sources: {
            type: 'array',
            description: 'Documents/items found. Use EXACT full filenames from search results.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string', minLength: 3, description: 'EXACT full filename from search results — never abbreviated' },
                type: { type: 'string', enum: ['kb', 'email', 'calendar'] },
              },
              required: ['id', 'title', 'type'],
            },
          },
          options: {
            type: 'array',
            description: 'Optional choice groups (max 3) for genuinely ambiguous decisions.',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                label: { type: 'string' },
                choices: { type: 'array', items: { type: 'string' } },
                default: { type: 'string' },
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
      description: "Generate a downloadable file artifact. Call ONLY when the user explicitly asked for a file using words like 'document', 'Word doc', 'spreadsheet', 'presentation', 'deck', 'PDF', 'file', 'to download', 'to send as'. Content type alone is never a trigger — 'write a press release / report / proposal / summary / draft an email' always produces inline text, not a file. Only 'create a press release document' / 'I need a Word report' / 'make me a presentation' triggers this tool.",
      input_schema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['word', 'excel', 'pptx', 'email'], description: 'File format. "word" = user asked for a Word doc / document / report to download. "excel" = user asked for a spreadsheet / tracker / budget. "pptx" = user asked for a presentation / deck / slides. "email" = user explicitly asked to send an email or open a draft in their mail client — NOT for "write an email about X" (that goes inline).' },
          instructions: { type: 'string', description: 'Detailed instructions: purpose, audience, key sections, tone, specific data to include.' },
        },
        required: ['type', 'instructions'],
      },
    },
  );

  // Convert neutral schema to OpenAI function-calling format
  return neutral.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    search_knowledge_base: 'Searching knowledge base',
    read_document: 'Reading document',
    get_emails: 'Checking emails',
    get_email_body: 'Reading email',
    get_meeting_context: 'Checking meetings & calendar',
    deep_research: 'Researching…',
    web_search: 'Searching the web',
    fetch_url: 'Reading page',
    request_clarification: 'Preparing options',
    generate_document: 'Generating document',
  };
  return labels[name] ?? name;
}

interface RunContext {
  userId: string;
  threadId: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any;
  thread: { user_attachments?: unknown };
  existingArtifacts: DocumentArtifact[];
  userContextBlock?: string;
  /** Accumulates real KB file data from search_knowledge_base calls — used to enrich request_clarification sources */
  kbSources: Array<{ id: string; title: string; type: 'kb' }>;
  /** Accumulates actual KB text chunks from search_knowledge_base calls — passed to generate_document to ground output */
  kbContext: string;
  /** Agent-scoped KB file IDs — search is scoped to these files first, then falls through to global KB */
  agentFileIds?: string[];
  /** Agent ID — used to trigger memory extraction after conversation */
  agentId?: string;
  isTemporary?: boolean;
  /** Workspace feature flags — drives graceful degradation of context tools */
  features: WorkspaceFeatures;
}

// ── Clarification validator ───────────────────────────────────────────────────

function validateClarificationInput(input: Record<string, unknown>): string | null {
  const q = ((input.question as string) ?? '').trim();
  if (!q || q.length < 10) {
    return 'The "question" field is empty or too short. Write a 1–2 sentence statement describing exactly what you will create (minimum 10 characters).';
  }
  if (q.endsWith('?')) {
    return 'The "question" field must be a declarative statement, not a question. Remove the question mark and rewrite as a confident declaration of what you will create. Example: "I\'ll create a pricing summary using the three documents I found."';
  }
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function serializeDocContent(doc: import('@/lib/types/inbox').DocContent): string {
  const lines: string[] = [doc.title];
  if (doc.subtitle) lines.push(doc.subtitle);
  for (const section of doc.sections) {
    lines.push(`\n## ${section.heading}`);
    for (const p of section.paragraphs) lines.push(p);
  }
  return lines.join('\n\n');
}

// ── Tool execution ────────────────────────────────────────────────────────────

async function executeChatTool(
  name: string,
  input: Record<string, unknown>,
  sources: string[],
  ctx: RunContext
): Promise<{ result: string; summary: string; artifact?: DocumentArtifact; citations?: string[]; clarification?: object; stopStream?: boolean; retryCorrection?: string }> {
  switch (name) {
    case 'request_clarification': {
      // Validate question field before doing anything else
      const validationError = validateClarificationInput(input);
      if (validationError) {
        return {
          result: `Tool call rejected — fix these issues and call request_clarification again: ${validationError}`,
          summary: 'Retrying clarification',
          retryCorrection: validationError,
        };
      }

      // Enrich sources: replace KB-type sources (which models often fill with empty/bad titles)
      // with the real file data accumulated from search_knowledge_base calls.
      const modelSources = Array.isArray(input.sources)
        ? input.sources as Array<{ id: string; title: string; type: string }>
        : [];
      // Keep non-KB sources the model provided (emails, calendar items)
      const nonKbSources = modelSources.filter(s => s.type !== 'kb');
      // Use real KB file data if we have it; otherwise fall back to whatever the model provided
      const kbSources = ctx.kbSources.length > 0
        ? ctx.kbSources
        : modelSources.filter(s => s.type === 'kb');
      // Deduplicate by id and remove any sources with blank titles
      const seen = new Set<string>();
      const enrichedSources = [...kbSources, ...nonKbSources].filter(s => {
        if (!s.title || s.title.trim().length < 2) return false;
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      });

      const clarification = {
        question: input.question as string,
        sources: enrichedSources,
        options: Array.isArray(input.options) ? input.options as Array<{ key: string; label: string; choices: string[]; default?: string }> : [],
      };
      return {
        result: 'Clarification presented to user. Stream will pause until user confirms.',
        summary: 'Awaiting your confirmation',
        clarification,
        stopStream: true,
      };
    }

    case 'search_knowledge_base': {
      if (!ctx.features.drive) {
        return {
          result: 'Knowledge base access is not enabled for this workspace.',
          summary: 'Drive module disabled',
        };
      }
      const query = input.query as string;
      const kbCtx = await buildKBContext(ctx.userId, query, ctx.adminClient, {
        fileLimit: 5,
        maxChunksPerFile: 3,
        threshold: 0.2,
        maxTotalChars: 8000,
        scopeFileIds: ctx.agentFileIds,
      });
      const result = kbCtx.context || 'No relevant documents found in your knowledge base.';
      const filenames = kbCtx.filenames ?? [];
      const summary = filenames.length > 0 ? `Found ${filenames.length} relevant document${filenames.length > 1 ? 's' : ''}` : 'No relevant documents found';
      // Accumulate real file data for enriching request_clarification sources
      for (const g of kbCtx.fileGroups) {
        if (!ctx.kbSources.some(s => s.id === g.fileId)) {
          ctx.kbSources.push({ id: g.fileId, title: g.filename, type: 'kb' });
        }
      }
      // Accumulate actual KB text so generate_document can ground its output in it
      if (kbCtx.context) {
        ctx.kbContext = ctx.kbContext
          ? `${ctx.kbContext}\n\n${kbCtx.context}`
          : kbCtx.context;
      }
      return { result, summary, citations: filenames };
    }

    case 'read_document': {
      if (!ctx.features.drive) {
        return {
          result: 'Knowledge base access is not enabled for this workspace.',
          summary: 'Drive module disabled',
        };
      }
      const fileId = input.file_id as string;
      const filename = (input.filename as string) || 'document';
      const MAX_CHARS = 12000;
      const { data: chunks } = await ctx.adminClient
        .from('knowledge_chunks')
        .select('heading, content, chunk_index')
        .eq('file_id', fileId)
        .order('chunk_index', { ascending: true })
        .limit(50);
      if (!chunks || chunks.length === 0) {
        return { result: `No content found for "${filename}".`, summary: 'Document not found' };
      }
      let totalChars = 0;
      const sections: string[] = [];
      for (const chunk of chunks) {
        const text = chunk.heading ? `## ${chunk.heading}\n${chunk.content}` : chunk.content;
        if (totalChars + text.length > MAX_CHARS) {
          sections.push(text.slice(0, MAX_CHARS - totalChars) + '\n…[truncated]');
          break;
        }
        sections.push(text);
        totalChars += text.length;
      }
      const fullText = `[${filename}]\n\n${sections.join('\n\n')}`;
      // Also accumulate as KB context for grounding generation
      ctx.kbContext = ctx.kbContext ? `${ctx.kbContext}\n\n${fullText}` : fullText;
      if (!ctx.kbSources.some(s => s.id === fileId)) {
        ctx.kbSources.push({ id: fileId, title: filename, type: 'kb' });
      }
      return { result: fullText, summary: `Read "${filename}" (${chunks.length} sections)`, citations: [filename] };
    }

    case 'get_emails': {
      if (!ctx.features.email) {
        return {
          result: 'Email access is not enabled for this workspace.',
          summary: 'Email module disabled',
        };
      }
      // Map 'filter' (AI schema name) → 'topic' (executor param)
      const emailConfig: Record<string, unknown> = { ...input };
      if (typeof input.filter === 'string') emailConfig.topic = input.filter;
      const result = await executeGetEmails(emailConfig, ctx.userId, ctx.supabase);
      const lineCount = result.split('\n\n').length - 1;
      const summary = result.startsWith('No emails') ? 'No matching emails found' : `Found ${lineCount} email${lineCount !== 1 ? 's' : ''}`;
      return { result, summary };
    }

    case 'get_email_body': {
      if (!ctx.features.email) {
        return { result: 'Email access is not enabled for this workspace.', summary: 'Email module disabled' };
      }
      const emailId = input.email_id as string;
      const { data: item } = await ctx.supabase
        .from('inbox_items')
        .select('source_data, created_at')
        .eq('id', emailId)
        .eq('user_id', ctx.userId)
        .single();
      if (!item) {
        return { result: `Email not found: ${emailId}`, summary: 'Email not found' };
      }
      const sd = item.source_data as Record<string, unknown>;
      const from = sd?.from_name ? `${sd.from_name} <${sd.from_address || ''}>` : (sd?.from as string || 'Unknown');
      const subject = (sd?.subject as string) || '(no subject)';
      const date = new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const rawBody = (sd?.body as string) ||
        (sd?.html_body ? (sd.html_body as string).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '') ||
        (sd?.snippet as string) || '';
      const body = rawBody.slice(0, 8000);
      const result = `From: ${from}\nSubject: ${subject}\nDate: ${date}\n\n${body}${rawBody.length > 8000 ? '\n…[truncated]' : ''}`;
      return { result, summary: `Read email: "${subject}"` };
    }

    case 'get_meeting_context': {
      if (!ctx.features.meetings) {
        return {
          result: 'Calendar and meetings access is not enabled for this workspace.',
          summary: 'Meetings module disabled',
        };
      }
      // Default include_upcoming=true for work chat (calendar awareness is the primary use case)
      const meetingConfig: Record<string, unknown> = { include_upcoming: true, ...input };
      const result = await executeGetMeetingContext(meetingConfig, ctx.userId, ctx.supabase);
      const summary = result.startsWith('No processed') ? 'No meetings found' : 'Meeting context retrieved';
      return { result, summary };
    }

    case 'deep_research': {
      const researchConfig = {
        focus: (input.focus as string) || '',
        language: (input.language as string | undefined),
        model: 'fast' as const,
      };
      if (!researchConfig.focus) {
        return { result: 'No research topic provided.', summary: 'Research skipped' };
      }
      const result = await executeDeepResearch(researchConfig, '');
      return { result, summary: `Research complete: ${researchConfig.focus.slice(0, 60)}` };
    }

    case 'generate_document': {
      const type = input.type as string;
      const instructions = input.instructions as string;

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

      const maxTokensMap: Record<string, number> = {
        word: 5000,
        excel: 3000,
        pptx: 3000,
        email: 800,
      };

      const userAttachments = ((ctx.thread.user_attachments || []) as Array<{
        filename: string;
        mimeType: string;
        storagePath: string;
        extractedText: string | null;
      }>);

      const toolRegistry = await buildToolRegistry(ctx.userId, ctx.supabase);

      // If there's an existing document artifact, serialise its content so the
      // generator modifies it rather than replacing it from scratch.
      const existingDoc = ctx.existingArtifacts
        .filter(a => a.type === 'document' && a.content)
        .at(-1); // most recent document
      const existingDocText = existingDoc?.content
        ? serializeDocContent(existingDoc.content as import('@/lib/types/inbox').DocContent)
        : null;

      // Build grounded context: existing doc first (if any), then KB sources, then instructions
      let groundedContext: string;
      if (existingDocText) {
        groundedContext =
          `EXISTING DOCUMENT TO MODIFY — preserve all sections unless explicitly told to change or remove them:\n\n${existingDocText}\n\n---\n\nREQUESTED CHANGES: ${instructions}` +
          (ctx.kbContext ? `\n\nADDITIONAL SOURCE MATERIAL:\n${ctx.kbContext}` : '');
      } else {
        groundedContext = ctx.kbContext
          ? `SOURCE DOCUMENTS (from knowledge base — use this content as the primary source):\n\n${ctx.kbContext}\n\n---\n\nINSTRUCTIONS: ${instructions}`
          : instructions;
      }

      const pipelineResult = await runFullPipeline({
        userId: ctx.userId,
        threadId: ctx.threadId,
        plan: plan as any,
        emailAttachments: [],
        userAttachments,
        conversationContext: groundedContext,
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
      // Inherit parent title so version grouping works; tag parent_id for chain traversal
      if (existingDoc) {
        artifact.title = existingDoc.title;
        artifact.parent_id = existingDoc.id;
      } else {
        artifact.title = instructions.slice(0, 60);
      }

      const { data: freshThread } = await ctx.adminClient
        .from('work_threads')
        .select('artifacts')
        .eq('id', ctx.threadId)
        .single();
      const existing = ((freshThread?.artifacts as DocumentArtifact[]) || []);
      // When editing an existing doc, keep all previous versions — just append.
      // When generating fresh, remove prior artifacts of the same type (old behaviour).
      const kept = existingDoc
        ? existing
        : existing.filter((a: DocumentArtifact) => !new Set(newArtifacts.map((n: DocumentArtifact) => n.type)).has(a.type));
      const updated = [...kept, ...newArtifacts];

      await ctx.adminClient
        .from('work_threads')
        .update({ artifacts: updated, artifact: artifact, updated_at: new Date().toISOString() })
        .eq('id', ctx.threadId);

      // Fire-and-forget: index generated artifacts into KB (skip for temporary threads)
      if (!ctx.isTemporary) newArtifacts.forEach((a: DocumentArtifact) => {
        if (!a.id) return;
        indexArtifact({
          artifactId: a.id,
          storagePath: a.storage_path ?? null,
          filename: `${a.title}.${getFileExt(a.type)}`,
          mimeType: getMimeType(a.type),
          userId: ctx.userId,
          threadId: ctx.threadId,
          emailBody: a.type === 'email' ? (a.content as { body?: string })?.body : undefined,
        }, ctx.adminClient).catch(() => {});
      });

      const typeLabels: Record<string, string> = {
        word: 'Word document', excel: 'spreadsheet', pptx: 'presentation', email: 'email draft',
      };
      const summary = `${typeLabels[type] || 'Document'} created`;
      return { result: `Document created successfully: ${artifact.title}`, summary, artifact };
    }

    case 'web_search': {
      const result = await executeWebSearch(input);
      const query = typeof input.query === 'string' ? input.query : '';
      return { result, summary: `Web search: ${query.slice(0, 50)}` };
    }

    case 'fetch_url': {
      const result = await executeFetchUrl(input);
      const urls = Array.isArray(input.urls) ? input.urls : [];
      return { result, summary: `Read ${urls.length} page${urls.length !== 1 ? 's' : ''}` };
    }

    default:
      return { result: 'Unknown tool', summary: 'Unknown tool' };
  }
}

// ── Auto-rename ──────────────────────────────────────────────────────────────

async function generateAutoTitle(
  firstMessage: string,
  userId: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  threadId: string
): Promise<string | undefined> {
  try {
    // Use summarization task — lighter model per tier, not the conversation model
    const { client, model } = await getAIClient(userId, 'summarization', supabase);
    const res = await aiCreate(client, {
      model,
      max_tokens: 20,
      messages: [{
        role: 'user',
        content: `Generate a concise 3-5 word title for this chat. Return ONLY the title, no punctuation, no quotes.\n\nMessage: "${firstMessage.slice(0, 200)}"`,
      }],
    });
    const title = (res.choices[0]?.message?.content ?? '').trim().replace(/^["']|["']$/g, '');
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
): Promise<{ mentionContext: string | null; kbContext: string }> {
  const lines: string[] = [];
  const kbLines: string[] = [];

  await Promise.all(mentions.map(async (m) => {
    try {
      switch (m.type) {
        case 'email': {
          const { data } = await adminClient
            .from('emails')
            .select('subject, from_name, from_address, body, received_at')
            .eq('id', m.id)
            .eq('user_id', userId)
            .single();
          if (data) {
            lines.push(
              `[EMAIL] "${data.subject || '(no subject)'}"\n` +
              `From: ${data.from_name || data.from_address} · ${new Date(data.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}\n` +
              (data.body ? `Preview: ${data.body.slice(0, 300)}` : '')
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
                  .slice(0, 8).map(a => {
                    if (a.name && a.email) return `${a.name} <${a.email}>`;
                    return a.name || a.email || '';
                  }).filter(Boolean).join(', ')
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
            .select('filename, summary')
            .eq('id', m.id)
            .eq('user_id', userId)
            .single();
          if (data) {
            const { data: chunks } = await adminClient
              .from('knowledge_chunks')
              .select('content, heading')
              .eq('file_id', m.id)
              .order('chunk_index', { ascending: true })
              .limit(20);
            const allChunks = (chunks as Array<{ heading?: string; content: string }> | null) ?? [];
            const fullText = allChunks
              .map(c => (c.heading ? `${c.heading}\n${c.content}` : c.content))
              .join('\n\n');
            // Short preview for the user-facing [Referenced items] block
            lines.push(
              `[DOCUMENT] "${data.filename}"\n` +
              (fullText ? `Content:\n${fullText.slice(0, 800)}` : data.summary ? `Summary: ${data.summary}` : '(no content available)')
            );
            // Full content for generation grounding (used by generate_document)
            if (fullText) {
              kbLines.push(`[${data.filename}]\n${data.summary ? `Summary: ${data.summary}\n` : ''}${fullText.slice(0, 6000)}`);
            }
          }
          break;
        }
        case 'contact': {
          const { data: contact } = await adminClient
            .from('relationship_graph')
            .select('contact_name, contact_email, relationship_type, typical_topics, last_interaction, interaction_frequency')
            .eq('id', m.id)
            .eq('user_id', userId)
            .single();
          if (!contact) break;

          const { contact_email, contact_name } = contact;

          const [fromEmailsRes, toEmailsRes, meetingsRes] = await Promise.all([
            // Emails FROM this contact
            adminClient
              .from('emails')
              .select('subject, received_at, body')
              .eq('user_id', userId)
              .ilike('from_address', contact_email)
              .order('received_at', { ascending: false })
              .limit(8),
            // Emails TO/CC this contact
            adminClient
              .from('emails')
              .select('subject, from_address, from_name, received_at, body')
              .eq('user_id', userId)
              .or(`to_addresses.cs.{"${contact_email}"},cc_addresses.cs.{"${contact_email}"}`)
              .order('received_at', { ascending: false })
              .limit(8),
            // Calendar events they attended
            adminClient
              .from('calendar_events')
              .select('title, start_time')
              .eq('user_id', userId)
              .contains('attendees', JSON.stringify([{ email: contact_email }]))
              .order('start_time', { ascending: false })
              .limit(5),
          ]);

          // Merge + deduplicate emails by subject+date
          const seenKeys = new Set<string>();
          const allEmails = [
            ...(fromEmailsRes.data ?? []),
            ...(toEmailsRes.data ?? []),
          ]
            .filter(e => {
              const key = `${e.subject}|${e.received_at}`;
              if (seenKeys.has(key)) return false;
              seenKeys.add(key);
              return true;
            })
            .sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime())
            .slice(0, 10);

          const parts: string[] = [];

          // Header line
          const headerParts = [
            `[CONTACT] ${contact_name || contact_email}${contact_name ? ` <${contact_email}>` : ''}`,
            contact.relationship_type || null,
            contact.interaction_frequency ? `${contact.interaction_frequency} interactions` : null,
            contact.last_interaction
              ? `last contact: ${new Date(contact.last_interaction).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
              : null,
          ].filter(Boolean);
          parts.push(headerParts.join(' — '));

          if ((contact.typical_topics as string[] | null)?.length) {
            parts.push(`Topics: ${(contact.typical_topics as string[]).slice(0, 4).join(', ')}`);
          }

          if (allEmails.length > 0) {
            parts.push(`\nRecent emails (${allEmails.length}):`);
            for (const e of allEmails) {
              const date = new Date(e.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              const snippet = e.body ? e.body.slice(0, 100).replace(/\s+/g, ' ') + '…' : '';
              parts.push(`  · "${e.subject || '(no subject)'}" — ${date}${snippet ? ` — "${snippet}"` : ''}`);
            }
          }

          const meetings = meetingsRes.data ?? [];
          if (meetings.length > 0) {
            parts.push(`\nShared meetings (${meetings.length}):`);
            for (const ev of meetings) {
              const date = new Date(ev.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              parts.push(`  · "${ev.title}" — ${date}`);
            }
          }

          lines.push(parts.join('\n'));
          break;
        }
      }
    } catch {
      // Non-fatal — if a mention fails to load, skip it
    }
  }));

  const mentionContext = lines.length > 0 ? `[Referenced items]\n${lines.join('\n\n')}` : null;
  const kbContext = kbLines.length > 0
    ? `RELEVANT KNOWLEDGE BASE (from your indexed files — use this content when answering):\n\n${kbLines.join('\n\n')}`
    : '';
  return { mentionContext, kbContext };
}

// ── Specificity detection ─────────────────────────────────────────────────────
// Determines whether a message names a specific subject (product, person, project,
// company, code) — without relying on an AI call that can be wrong.
// Returns false for generic requests like "create a pricing document" or
// "find something about proposals" where no named subject is present.

const GENERIC_DOC_WORDS = new Set([
  'document', 'doc', 'report', 'email', 'presentation', 'deck', 'spreadsheet',
  'proposal', 'summary', 'analysis', 'memo', 'brief', 'letter', 'contract',
  'update', 'draft', 'follow', 'followup', 'follow-up', 'note', 'notes',
  'create', 'make', 'write', 'draft', 'generate', 'build', 'prepare', 'need',
  'pricing', 'budget', 'plan', 'schedule', 'tracker', 'template', 'outline',
  'i', 'a', 'an', 'the', 'to', 'for', 'and', 'or', 'of', 'in', 'on', 'with',
  'my', 'me', 'our', 'us', 'new', 'some', 'this', 'that', 'about', 'please',
])

function hasSpecificSubject(message: string): boolean {
  // Quoted strings always count as specific
  if (/"[^"]{2,}"/.test(message)) return true

  // Alphanumeric codes: letters+digits mixed (Z100, Q3, GPT-4, ISO27001)
  if (/\b(?:[A-Za-z]+\d[\w-]*|\d+[A-Za-z][\w-]*)\b/.test(message)) return true

  // Proper nouns: capitalised words that aren't at sentence start and aren't generic
  const words = message.split(/\s+/)
  for (let i = 1; i < words.length; i++) {
    const word = words[i].replace(/[^A-Za-z]/g, '')
    if (
      word.length >= 2 &&
      word[0] === word[0].toUpperCase() &&
      word[0] !== word[0].toLowerCase() &&
      !GENERIC_DOC_WORDS.has(word.toLowerCase())
    ) return true
  }

  // Possessive references to named things ("Acme's proposal", "John's report")
  if (/[A-Z][a-z]+'s\b/.test(message)) return true

  return false
}

// ── XML tool call detection (DeepSeek/Fireworks compat) ───────────────────────
// DeepSeek models sometimes emit tool calls as XML text instead of structured
// tool_calls deltas when using OpenAI-compatible wrappers. These helpers detect
// and parse them so we can execute the tools correctly.

const XML_TOOL_NAMES = ['search_knowledge_base', 'get_emails', 'get_email_body', 'get_meeting_context', 'deep_research', 'request_clarification', 'generate_document'];

function parseXmlToolCalls(text: string): Array<{ name: string; args: Record<string, unknown> }> | null {
  if (!text.includes('<')) return null;
  const results: Array<{ name: string; args: Record<string, unknown> }> = [];

  // Format 1: <tool_call>{"name":"...","arguments":{...}}</tool_call>
  const tcBlocks = text.match(/<tool_call>([\s\S]*?)<\/tool_call>/g) ?? [];
  for (const block of tcBlocks) {
    try {
      const inner = block.replace(/<\/?tool_call>/g, '').trim();
      const p = JSON.parse(inner);
      if (p.name && p.arguments) results.push({ name: p.name, args: p.arguments });
    } catch {}
  }

  // Format 2: <tool_name><param>value</param>...</tool_name>
  for (const toolName of XML_TOOL_NAMES) {
    const re = new RegExp(`<${toolName}>([\\s\\S]*?)<\\/${toolName}>`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const args: Record<string, unknown> = {};
      const paramRe = /<(\w+)>([\s\S]*?)<\/\1>/g;
      let pm: RegExpExecArray | null;
      while ((pm = paramRe.exec(m[1])) !== null) {
        args[pm[1]] = pm[2].trim();
      }
      results.push({ name: toolName, args });
    }
  }

  // Format 3: Anthropic <function_calls><invoke name="..."><parameter name="...">value</parameter></invoke></function_calls>
  const fcBlocks = text.match(/<function_calls>[\s\S]*?<\/function_calls>/g) ?? [];
  for (const block of fcBlocks) {
    const invokeRe = /<invoke name="([^"]+)">([\s\S]*?)<\/invoke>/g;
    let im: RegExpExecArray | null;
    while ((im = invokeRe.exec(block)) !== null) {
      const toolName = im[1];
      if (!XML_TOOL_NAMES.includes(toolName)) continue;
      const args: Record<string, unknown> = {};
      const paramRe = /<parameter name="([^"]+)">([\s\S]*?)<\/parameter>/g;
      let pm: RegExpExecArray | null;
      while ((pm = paramRe.exec(im[2])) !== null) {
        args[pm[1]] = pm[2].trim();
      }
      results.push({ name: toolName, args });
    }
  }

  return results.length > 0 ? results : null;
}

function stripXmlToolCalls(text: string): string {
  // DeepSeek reasoning: <think>...</think>
  let r = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // Anthropic format: <function_calls>...</function_calls> and <function_results>...</function_results>
  r = r.replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '');
  r = r.replace(/<function_results>[\s\S]*?<\/function_results>/g, '');
  // Qwen/JSON format: <tool_call>...</tool_call>
  r = r.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
  // DeepSeek format: <toolname>...</toolname>
  for (const toolName of XML_TOOL_NAMES) {
    r = r.replace(new RegExp(`<${toolName}>[\\s\\S]*?<\\/${toolName}>`, 'g'), '');
  }
  // Strip unclosed <think> block (model still reasoning when stream ended)
  r = r.replace(/<think>[\s\S]*$/gi, '');
  return r.trim();
}

// ── PATCH: edit a user message and truncate subsequent messages ──────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: threadId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { messageId, newContent } = body as { messageId: string; newContent: string };

  if (!messageId || !newContent?.trim()) {
    return NextResponse.json({ error: 'messageId and newContent required' }, { status: 400 });
  }

  const admin = getAdminClient();

  // Verify message belongs to this thread and is a user message
  const { data: msg } = await admin
    .from('work_messages')
    .select('id, role, created_at')
    .eq('id', messageId)
    .eq('thread_id', threadId)
    .single();

  if (!msg || msg.role !== 'user') {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  }

  // Delete all messages that came strictly after the edited message
  await admin
    .from('work_messages')
    .delete()
    .eq('thread_id', threadId)
    .gt('created_at', msg.created_at);

  // Update the user message content
  await admin
    .from('work_messages')
    .update({ content: newContent.trim() })
    .eq('id', messageId);

  return NextResponse.json({ ok: true });
}
