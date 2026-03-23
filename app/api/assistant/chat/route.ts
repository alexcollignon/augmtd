import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAIClient } from '@/lib/ai/factory';
import { buildInboxSnapshot, formatSnapshotForPrompt } from '@/lib/inbox/chat-context';
import { buildKBContext } from '@/lib/knowledge/build-kb-context';
import { getCalendarContext } from '@/lib/calendar/calendar-context';
import { formatCalendarContextForChat } from '@/lib/calendar/format-calendar-context';
import { buildUserContextBlock } from '@/lib/context/build-user-context';
import type { DeskItem, DeskColumn } from '@/lib/types/desk';

export const maxDuration = 60;

// ── Board context builder ────────────────────────────────────────────────────

const COLUMN_LABELS: Record<DeskColumn, string> = {
  pool: 'Pool (unconfirmed)',
  todo: 'To Do',
  in_progress: 'In Progress',
  waiting: 'Waiting',
  done: 'Done',
};

function buildBoardContext(boardItems: DeskItem[]): string {
  const grouped: Partial<Record<DeskColumn, DeskItem[]>> = {};
  for (const item of boardItems) {
    if (!grouped[item.column]) grouped[item.column] = [];
    grouped[item.column]!.push(item);
  }
  const colOrder: DeskColumn[] = ['pool', 'todo', 'in_progress', 'waiting', 'done'];
  const lines: string[] = [];
  for (const col of colOrder) {
    const items = grouped[col];
    if (!items?.length) continue;
    lines.push(`[${COLUMN_LABELS[col]}]`);
    for (const item of items) {
      const src = item.sourceType === 'email' ? 'EMAIL'
        : item.sourceType === 'meeting_action' ? 'MEETING'
        : 'PROCESS';
      lines.push(`  - ${item.title} (${src}) [id:${item.id}]`);
    }
  }
  return lines.join('\n') || 'No items on the board.';
}

// ── System prompt ────────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are an intelligent work assistant inside AUGMTD.
You help users manage their inbox, handle emails, prioritize tasks, reference processes, and take action.

{{USER_CONTEXT}}

{{KB_CONTEXT}}

{{CALENDAR_CONTEXT}}

{{WORKFLOW_HISTORY}}

{{PROCESS_LIST}}

{{FOCUSED_ITEM}}

{{INBOX_SNAPSHOT_SECTION}}

{{BOARD_CONTEXT_SECTION}}

Today is {{TODAY}}.

GENERAL RULES:
- Answer questions using inbox, KB, calendar, board, and processes — whichever is relevant.
- When KB documents are relevant, summarize their content directly — do not say you can't find something if it appears in the KB.
- When referencing a specific email, include its ID in square brackets like [uuid] — the UI renders it as a card. ONLY use [uuid] when the user explicitly asked about a specific email. NEVER attach [uuid] to calendar events or meeting descriptions.
- If multiple matching emails: list them one per line with [id].
- Do not invent emails not in the inbox snapshot.
- Use the calendar when answering scheduling questions. Propose conflict-free times.
- If a document is attached ([Attached document content: ...]), use it as primary context.
- If you used KB content, append exactly one line at the very end: KB_REFS:filename1.pdf|filename2.pdf (pipe-separated). Do not append if KB was not used.

TOKEN RULES — emit only the appropriate token(s) at the very end of your response, after all text.
Never emit more than one action token per response. Never emit a token mid-response.

─── EMAIL TOKENS ──────────────────────────────────────────────────────────────

ACTION:{"type":"archive","itemId":"uuid","label":"..."}
→ User wants to archive or dismiss a specific inbox item. Only when intent is clear.

ACTION:{"type":"open","itemId":"uuid","label":"..."}
→ User wants to read or navigate to a specific inbox item. NOT for sending or replying.

MEETING_SUGGESTION:{"title":"...","duration_minutes":30,"attendees":["email@example.com"],"proposed_times":["2026-03-14T14:00:00"],"notes":"..."}
→ User wants to schedule a meeting. Times must not conflict with the calendar above.
  CRITICAL: attendees must be valid email addresses, never names.
  If a FOCUSED EMAIL or FOCUSED CARD is shown, use the sender's email as attendee.
  Omit attendee if email address is unknown.

OPEN_COMPOSE:{"to":"...","subject":"...","body":"..."}
→ User wants to write a NEW email. Always emit when composing intent is clear. to:"" if unknown.
  Do not combine with ACTION or MEETING_SUGGESTION.

REPLY_DRAFT:{"body":"..."}
→ REQUIRED when user asks to draft, write, or suggest a reply to an email or board email item.
  Triggers: "draft a reply", "reply to X", "write a response", "suggest a reply", "how should I respond".
  ALWAYS emit this token — do NOT write the reply as plain text prose.
  Write a short intro sentence first (e.g. "Here's a draft:"), then emit the token on the next line.
  If a FOCUSED EMAIL or FOCUSED CARD (email type) is shown, reply to that. Otherwise use the inbox snapshot.
  Body: complete reply text only — no subject line.
  Format: greeting, blank line, body paragraphs separated by blank lines, blank line, sign-off, name.
  Use \\n for newlines inside the JSON string. No extra commas.
  Do not combine with OPEN_COMPOSE.

UPDATE_DRAFT:{"subject":"...","body":"..."}
→ User is in compose mode and wants a full revision of the draft. Only emit for complete rewrites.

─── NAVIGATION TOKENS ─────────────────────────────────────────────────────────

OPEN_WORKFLOW:{"itemId":"...","skill":"...","prefillTitle":"..."}
→ User wants to start a workflow or generate a deliverable (document, report, proposal, deck, etc.).
  itemId = inbox_item or desk_item id if referencing a specific item, "" otherwise.
  skill is optional: "grant_proposal", "word", "pptx", "xlsx", "email_draft".
  prefillTitle is optional — use the task or email subject if relevant.
  Emit when user says "start a workflow", "generate a document", "create a proposal", "write a report", "draft a deck", etc.

OPEN_PROCESS:{"processId":"...","label":"..."}
→ User wants to view or continue a specific active process.
  processId MUST be from the ACTIVE PROCESSES list above — never invent one.
  Only emit when user clearly intends to navigate to a specific process — not for general questions.

─── DESK TOKENS ───────────────────────────────────────────────────────────────

DESK_ACTION:{"type":"move","itemId":"uuid","column":"todo|in_progress|waiting|done","label":"..."}
→ User wants to move a board item to a specific column.
  itemId must be from the CURRENT WORK BOARD list above (use the [id:...] shown).
  Only when both the item and target column are unambiguous.

DESK_ACTION:{"type":"dismiss","itemId":"uuid","label":"..."}
→ User wants to remove an item from the board entirely.

DESK_ACTION:{"type":"confirm","itemId":"uuid","label":"..."}
→ User wants to move a Pool item to To Do. Only valid for items in the Pool column.`;

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      context = 'inbox',
      message,
      history = [],
      sources,
      mode,
      composeDraft,
      replyDraft,
      emailContext,
      fileContext,
      boardItems = [],
      focusedCard,
    } = body as {
      context?: 'inbox' | 'desk';
      message: string;
      history: Array<{ role: 'user' | 'assistant'; content: string }>;
      sources?: string[];
      mode?: 'inbox' | 'compose' | 'reply';
      composeDraft?: { to: string; cc: string; subject: string; body: string };
      replyDraft?: string;
      emailContext?: {
        subject?: string; from?: string; fromName?: string;
        summary?: string; keyPoints?: string[]; body?: string;
      };
      fileContext?: string;
      boardItems?: DeskItem[];
      focusedCard?: {
        id: string; title: string; description: string | null;
        sourceType: string; column: string; urgency: string | null; synthesis: string | null;
      };
    };

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message required' }, { status: 400 });
    }

    const { client: aiClient, model: chatModel } = await getAIClient(user.id, 'conversation', supabase);

    const activeSources = sources?.length ? sources : ['inbox', 'kb', 'calendar'];
    const fetchInbox = activeSources.includes('inbox') && mode !== 'reply';
    const fetchKB = activeSources.includes('kb');
    const fetchCal = activeSources.includes('calendar');

    // Admin client only needed for KB search
    const adminClient = fetchKB
      ? (await import('@supabase/supabase-js')).createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        )
      : null;

    const [
      snapshot,
      kbContext,
      calendarCtx,
      userContextBlock,
      indexedFilesResult,
      processListResult,
      workThreadsResult,
    ] = await Promise.all([
      fetchInbox
        ? buildInboxSnapshot(user.id, message, supabase)
        : Promise.resolve([]),
      fetchKB && adminClient
        ? buildKBContext(user.id, message, adminClient, { fileLimit: 6, maxChunksPerFile: 3, threshold: 0.2, maxTotalChars: 12000 })
        : Promise.resolve({ context: '', filenames: [] }),
      fetchCal
        ? getCalendarContext(user.id, supabase)
        : Promise.resolve({ upcomingMeetings: [], availability: undefined }),
      buildUserContextBlock(user.id, supabase),
      fetchKB
        ? supabase.from('knowledge_files').select('filename').eq('user_id', user.id)
        : Promise.resolve({ data: [] }),
      // Light process list — always, both surfaces
      supabase
        .from('processes')
        .select('id, title, status, current_step_index')
        .in('status', ['active', 'in_progress'])
        .order('updated_at', { ascending: false })
        .limit(10),
      // Recent workflow threads — always, both surfaces
      supabase
        .from('work_threads')
        .select('id, title, updated_at')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(5),
    ]);

    const snapshotText = formatSnapshotForPrompt(snapshot);
    const calendarText = formatCalendarContextForChat(calendarCtx);
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // KB section
    const allFiles = (indexedFilesResult as any).data as Array<{ filename: string }> | null;
    const inventoryLine = allFiles?.length
      ? `YOUR INDEXED FILES (${allFiles.length} total): ${allFiles.map((f: { filename: string }) => f.filename).join(', ')}\n\n`
      : '';
    const kbSection = inventoryLine + (kbContext.context || '');

    // Workflow history
    const threads = (workThreadsResult.data ?? []) as Array<{ title: string; updated_at: string }>;
    const workflowHistory = threads.length
      ? `Recent workflows: ${threads.map(t => {
          const d = new Date(t.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          return `${t.title} (${d})`;
        }).join(', ')}`
      : '';

    // Process list
    const processes = (processListResult.data ?? []) as Array<{ id: string; title: string; status: string; current_step_index?: number }>;
    const processList = processes.length
      ? 'ACTIVE PROCESSES (reference these when the user asks about ongoing work):\n' +
        processes.map(p => `- "${p.title}" [id: ${p.id}] — ${p.status}${p.current_step_index != null ? `, step ${p.current_step_index + 1}` : ''}`).join('\n')
      : '';

    // Focused item block
    let focusedItemBlock = '';
    if (emailContext) {
      focusedItemBlock = `FOCUSED EMAIL — the user is currently working on this email. When they say "this email", "it", "them", or "draft a reply", refer to this:
From: ${emailContext.fromName ? `${emailContext.fromName} <${emailContext.from}>` : emailContext.from}
Subject: ${emailContext.subject || '(no subject)'}${emailContext.summary ? `\nSummary: ${emailContext.summary}` : ''}${emailContext.keyPoints?.length ? `\nKey points:\n${emailContext.keyPoints.map(p => `- ${p}`).join('\n')}` : ''}${emailContext.body ? `\nBody:\n${emailContext.body.slice(0, 2000)}${emailContext.body.length > 2000 ? '\n[...truncated]' : ''}` : ''}`;
    } else if (focusedCard) {
      focusedItemBlock = `FOCUSED CARD — the user has this board item in focus. When they say "this", "it", or "this task", refer to this:
Title: ${focusedCard.title}
Source: ${focusedCard.sourceType}
Column: ${focusedCard.column}${focusedCard.urgency ? `\nUrgency: ${focusedCard.urgency}` : ''}${focusedCard.synthesis || focusedCard.description ? `\nBrief: ${focusedCard.synthesis || focusedCard.description}` : ''}`;
    }

    // Inbox snapshot section
    const inboxSnapshotSection = fetchInbox && snapshotText
      ? `Here is the user's current inbox (most recent first):\n${snapshotText}`
      : fetchInbox
        ? 'Here is the user\'s current inbox: No active inbox items.'
        : '';

    // Board context section
    const boardContextSection = context === 'desk'
      ? `CURRENT WORK BOARD:\n${buildBoardContext(boardItems)}`
      : '';

    let systemPrompt = BASE_SYSTEM_PROMPT
      .replace('{{USER_CONTEXT}}', userContextBlock || '')
      .replace('{{KB_CONTEXT}}', kbSection || '')
      .replace('{{CALENDAR_CONTEXT}}', calendarText || '')
      .replace('{{WORKFLOW_HISTORY}}', workflowHistory || '')
      .replace('{{PROCESS_LIST}}', processList || '')
      .replace('{{FOCUSED_ITEM}}', focusedItemBlock || '')
      .replace('{{INBOX_SNAPSHOT_SECTION}}', inboxSnapshotSection || '')
      .replace('{{BOARD_CONTEXT_SECTION}}', boardContextSection || '')
      .replace(/{{TODAY}}/g, today);

    // Mode addenda
    if (mode === 'compose' && composeDraft) {
      systemPrompt += `\n\nThe user is composing a new outgoing email. Current draft:
  To: ${composeDraft.to || '(empty)'}
  Subject: ${composeDraft.subject || '(empty)'}
  Body: ${composeDraft.body || '(empty)'}

Help improve tone, length, subject, clarity. When providing a full revision emit UPDATE_DRAFT at the very end. Only emit UPDATE_DRAFT for complete rewrites, not commentary.`;
    }

    if (mode === 'reply') {
      systemPrompt += `\n\nThe user has the reply box open. Current draft:
${replyDraft?.trim() || '(empty — not yet drafted)'}

REPLY MODE — follow exactly:
1. Silently decide if the user wants to WRITE/EDIT the draft or ask a QUERY. Do NOT write "INTENT DETECTION" or any label.

2. If WRITE/EDIT intent → write a single short acknowledgment sentence, then emit REPLY_DRAFT:{"body":"..."} on the next line. The body must be the complete reply text.

3. If QUERY intent → respond normally. Do NOT emit REPLY_DRAFT.

4. EMAIL BODY FORMAT:
   "Hi Alex,\\n\\nThank you for reaching out...\\n\\nBest regards,\\nAlexandre"
   Greeting on first line, blank line between paragraphs, sign-off on its own line, name on the next.
   Use \\n for newlines inside JSON. Never add extra commas.

5. CRITICAL: Never emit ACTION, OPEN_COMPOSE, or UPDATE_DRAFT in reply mode. MEETING_SUGGESTION allowed only for scheduling queries.`;
    }

    if (context === 'desk') {
      systemPrompt += `\n\nYou are on the DESK surface — the user's home screen. Help them prioritize, move tasks, start workflows, and take action on their work. When suggesting task movement use DESK_ACTION tokens. When the user wants to start work on something use OPEN_WORKFLOW.`;
    }

    const userContent = fileContext
      ? `[Attached document content:\n${fileContext}\n]\n\n${message}`
      : message;

    const chatParams = {
      model: chatModel,
      messages: [
        { role: 'system' as const, content: systemPrompt },
        ...history,
        { role: 'user' as const, content: userContent },
      ],
      temperature: 0.3,
      max_tokens: mode === 'reply' ? 1200 : 700,
      stream: true as const,
    };

    let stream;
    let attempts = 0;
    while (true) {
      try {
        stream = await aiClient.chat.completions.create(chatParams);
        break;
      } catch (err: any) {
        const retryable = err?.status === 503 || err?.status === 429 || err?.status === 529;
        if (retryable && attempts < 2) {
          attempts++;
          await new Promise(r => setTimeout(r, 1000 * attempts));
        } else {
          throw err;
        }
      }
    }

    const readable = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content || '';
          if (text) controller.enqueue(encoder.encode(text));
        }
        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    console.error('[AssistantChat] POST error:', err);
    return NextResponse.json({ error: 'Failed to process message' }, { status: 500 });
  }
}
