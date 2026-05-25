import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAIClient } from '@/lib/ai/factory';
import { buildInboxSnapshot, formatSnapshotForPrompt } from '@/lib/inbox/chat-context';
import { buildKBContext } from '@/lib/knowledge/build-kb-context';
import { getCalendarContext } from '@/lib/calendar/calendar-context';
import { formatCalendarContextForChat } from '@/lib/calendar/format-calendar-context';
import { buildUserContextBlock } from '@/lib/context/build-user-context';
import { getMyWorkspace } from '@/lib/workspace/features';
import { DEFAULT_FEATURES } from '@/lib/workspace/types';
import { checkRateLimit } from '@/lib/utils/rate-limit';
export const maxDuration = 60;

// ── System prompt ────────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are an intelligent work assistant inside AUGMTD.
You help users manage their inbox, handle emails, prioritize tasks, reference processes, and take action.

{{USER_CONTEXT}}

{{KB_CONTEXT}}

{{CALENDAR_CONTEXT}}

{{WORKFLOW_HISTORY}}

{{PROCESS_LIST}}

{{CONTACTS_SECTION}}

{{FOCUSED_ITEM}}

{{INBOX_SNAPSHOT_SECTION}}

Today is {{TODAY}}.

GENERAL RULES:
- Answer questions using inbox, KB, calendar, and processes — whichever is relevant.
- When KB documents are relevant, summarize their content directly — do not say you can't find something if it appears in the KB.
- When referencing a specific email, include its ID in square brackets like [uuid] — the UI renders it as a card. ONLY use [uuid] when the user explicitly asked about a specific email. NEVER attach [uuid] to calendar events or meeting descriptions.
- If multiple matching emails: list them one per line with [id].
- Do not invent emails not in the inbox snapshot.
- Unread items are tagged [unread] in the snapshot. When summarising or prioritising the inbox, treat unread items as higher priority unless instructed otherwise.
- Use the calendar when answering scheduling questions. Propose conflict-free times.
- If a document is attached ([Attached document content: ...]), use it as primary context.
- If you used KB content, append exactly one line at the very end: KB_REFS:filename1.pdf|filename2.pdf (pipe-separated). Do not append if KB was not used.

TOKEN RULES — emit only the appropriate token(s) at the very end of your response, after all text.
You may emit multiple ACTION tokens in one response (e.g. move + mark read). Never emit other token types more than once. Never emit a token mid-response.

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

OPEN_COMPOSE:{"to":"...","cc":"...","bcc":"...","subject":"...","body":"..."}
→ User wants to write a NEW email. Always emit when composing intent is clear. to:"" if unknown.
  cc and bcc are optional — only include if the user explicitly mentions them.
  Do not combine with ACTION or MEETING_SUGGESTION.

REPLY_DRAFT:{"body":"...","cc":"...","bcc":"..."}
→ REQUIRED when user asks to draft, write, or suggest a reply to an email or board email item.
  Triggers: "draft a reply", "reply to X", "write a response", "suggest a reply", "how should I respond".
  ALWAYS emit this token — do NOT write the reply as plain text prose.
  Write a short intro sentence first (e.g. "Here's a draft:"), then emit the token on the next line.
  If a FOCUSED EMAIL or FOCUSED CARD (email type) is shown, reply to that. Otherwise use the inbox snapshot.
  Body: complete reply text only — no subject line.
  cc and bcc are optional — only include if the user explicitly asks to CC or BCC someone.
  Format: greeting, blank line, body paragraphs separated by blank lines, blank line, sign-off line, then name on the next line. Never add a comma before the name.
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
  Only emit when user clearly intends to navigate to a specific process — not for general questions.`;

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rl = checkRateLimit(`assistant:${user.id}`, 20, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
      );
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
      emailItemId,
      availableFolders,
      fileContext,
      meetingContext,
    } = body as {
      context?: 'inbox' | 'meeting' | 'drive';
      message: string;
      history: Array<{ role: 'user' | 'assistant'; content: string }>;
      sources?: string[];
      mode?: 'inbox' | 'compose' | 'reply';
      composeDraft?: { to: string; cc: string; subject: string; body: string };
      replyDraft?: string;
      emailContext?: {
        subject?: string; from?: string; fromName?: string;
        summary?: string; keyPoints?: string[]; body?: string;
        isRead?: boolean;
      };
      emailItemId?: string;
      availableFolders?: { id: string; name: string }[];
      fileContext?: string;
      meetingContext?: {
        title: string;
        date: string;
        durationMinutes?: number;
        attendees: string[];
        summary?: string;
        decisions?: string[];
        actionItems?: Array<{ text: string; assignee?: string; status?: string }>;
        risks?: Array<{ description: string; severity: string }>;
        suggestedNextStep?: string;
      };
    };

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message required' }, { status: 400 });
    }

    const { client: aiClient, model: chatModel } = await getAIClient(user.id, 'conversation', supabase);

    // Workspace features drive graceful degradation of context sources.
    const workspace = await getMyWorkspace(user.id, supabase);
    const features = workspace?.features ?? DEFAULT_FEATURES;

    const activeSources = sources?.length ? sources : ['inbox', 'kb', 'calendar'];
    const fetchInbox = features.email    && activeSources.includes('inbox')    && mode !== 'reply' && context !== 'meeting';
    const fetchKB    = features.drive    && activeSources.includes('kb');
    const fetchCal   = features.meetings && activeSources.includes('calendar');

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
      workThreadsResult,
      contactsResult,
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
      // Recent workflow threads — always, both surfaces
      supabase
        .from('work_threads')
        .select('id, title, updated_at')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(5),
      // Key contacts — only for meeting context; gated on email (contacts are
      // built from inbox data, so they degrade together).
      context === 'meeting' && features.email
        ? supabase
            .from('relationship_graph')
            .select('contact_name, contact_email, relationship_type, importance, last_interaction, typical_topics')
            .eq('user_id', user.id)
            .gte('importance', 0.3)
            .order('importance', { ascending: false })
            .limit(10)
        : Promise.resolve({ data: [] }),
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

    const processList = '';

    // Contacts block — meeting surface only
    const contacts = (contactsResult.data ?? []) as Array<{
      contact_name: string; contact_email: string; relationship_type: string;
      last_interaction: string | null; typical_topics: string[] | null;
    }>;
    const contactsBlock = contacts.length
      ? 'KEY CONTACTS (from your network — use these when drafting emails or identifying attendees):\n' +
        contacts.map(c => {
          const parts = [`- ${c.contact_name}${c.contact_email ? ` <${c.contact_email}>` : ''}`];
          if (c.relationship_type) parts.push(c.relationship_type);
          if (c.last_interaction) parts.push(`last contact: ${new Date(c.last_interaction).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`);
          if (c.typical_topics?.length) parts.push(`topics: ${c.typical_topics.slice(0, 3).join(', ')}`);
          return parts.join(' — ');
        }).join('\n')
      : '';

    // Meeting context block
    let focusedMeetingBlock = '';
    if (context === 'meeting' && meetingContext) {
      const lines: string[] = [
        `FOCUSED MEETING — you have full context of this meeting. When the user says "this meeting", "the meeting", "decisions", etc., refer to this:`,
        `Title: ${meetingContext.title}`,
        `Date: ${meetingContext.date}${meetingContext.durationMinutes ? ` · ${meetingContext.durationMinutes} min` : ''}`,
      ];
      if (meetingContext.attendees.length > 0) {
        lines.push(`Attendees: ${meetingContext.attendees.join(', ')}`);
      }
      if (meetingContext.summary) lines.push(`Summary: ${meetingContext.summary}`);
      if (meetingContext.decisions?.length) {
        lines.push(`Decisions:\n${meetingContext.decisions.map(d => `- ${d}`).join('\n')}`);
      }
      if (meetingContext.actionItems?.length) {
        lines.push(`Action items:\n${meetingContext.actionItems.map(a => `- ${a.text}${a.assignee ? ` (${a.assignee})` : ''}`).join('\n')}`);
      }
      if (meetingContext.risks?.length) {
        lines.push(`Risks:\n${meetingContext.risks.map(r => `- [${r.severity}] ${r.description}`).join('\n')}`);
      }
      if (meetingContext.suggestedNextStep) {
        lines.push(`Suggested next step: ${meetingContext.suggestedNextStep}`);
      }
      focusedMeetingBlock = lines.join('\n');
    }

    // Focused item block
    let focusedItemBlock = '';
    if (emailContext) {
      focusedItemBlock = `FOCUSED EMAIL — the user is currently working on this email. When they say "this email", "it", "them", or "draft a reply", refer to this:
From: ${emailContext.fromName ? `${emailContext.fromName} <${emailContext.from}>` : emailContext.from}
Subject: ${emailContext.subject || '(no subject)'}
Read status: ${emailContext.isRead === false ? 'unread (the user has not yet read this email)' : 'read'}${emailContext.summary ? `\nSummary: ${emailContext.summary}` : ''}${emailContext.keyPoints?.length ? `\nKey points:\n${emailContext.keyPoints.map(p => `- ${p}`).join('\n')}` : ''}${emailContext.body ? `\nBody:\n${emailContext.body.slice(0, 2000)}${emailContext.body.length > 2000 ? '\n[...truncated]' : ''}` : ''}`;
    }

    // Inbox snapshot section
    const inboxSnapshotSection = fetchInbox && snapshotText
      ? `Here is the user's current inbox (most recent first):\n${snapshotText}`
      : fetchInbox
        ? 'Here is the user\'s current inbox: No active inbox items.'
        : '';

    let systemPrompt = BASE_SYSTEM_PROMPT
      .replace('{{USER_CONTEXT}}', userContextBlock || '')
      .replace('{{KB_CONTEXT}}', kbSection || '')
      .replace('{{CALENDAR_CONTEXT}}', calendarText || '')
      .replace('{{WORKFLOW_HISTORY}}', workflowHistory || '')
      .replace('{{PROCESS_LIST}}', processList || '')
      .replace('{{CONTACTS_SECTION}}', contactsBlock || '')
      .replace('{{FOCUSED_ITEM}}', focusedMeetingBlock || focusedItemBlock || '')
      .replace('{{INBOX_SNAPSHOT_SECTION}}', inboxSnapshotSection || '')
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

    if (mode === 'inbox' && emailContext) {
      let inboxAddendum = `\n\nA specific email is in focus (shown above as FOCUSED EMAIL). When the user asks to draft, write, or suggest a reply — emit REPLY_DRAFT:{"body":"..."} exactly as described above. This automatically opens the reply box and injects the draft. Write a short intro sentence first (e.g. "Here's a draft reply:"), then emit the token on its own next line. EMAIL BODY FORMAT: "Hi [sender name],\\n\\nThank you for reaching out...\\n\\nBest regards,\\n[user name]" — greeting, blank line between paragraphs, sign-off, name. Use \\n for newlines inside JSON. Never emit OPEN_COMPOSE or UPDATE_DRAFT in this case.`;

      if (emailItemId) {
        const folderList = availableFolders?.length
          ? availableFolders.map(f => `- "${f.name}" (id: ${f.id})`).join('\n')
          : '(no custom folders)';
        inboxAddendum += `

FOLDER ACTIONS — you can act on this email (itemId: ${emailItemId})
Emit ACTION tokens when the user asks to move, delete, archive, or change the read status of this email.

Available folders to move to:
${folderList}

ACTION token formats — emit at end of response after any text:
  ACTION:{"type":"move_to_folder","itemId":"${emailItemId}","folderId":"<id>","folderName":"<name>","label":"Move to <name>"}
  ACTION:{"type":"delete","itemId":"${emailItemId}","label":"Delete"}
  ACTION:{"type":"archive","itemId":"${emailItemId}","label":"Archive"}
  ACTION:{"type":"mark_read","itemId":"${emailItemId}","label":"Mark as read"}
  ACTION:{"type":"mark_unread","itemId":"${emailItemId}","label":"Mark as unread"}

Rules for folder actions:
- Only emit when the user explicitly asks to perform the operation (not just discussing it)
- For move: match folder name case-insensitively; if the name is ambiguous or not in the list, ask which folder
- You may emit multiple ACTION tokens in one response (e.g. move + mark read)
- Do not emit a move action if no custom folders exist and the user hasn't specified a system folder`;
      }

      systemPrompt += inboxAddendum;
    }

    if (context === 'meeting') {
      systemPrompt += `\n\nYou are a meeting assistant. You have the full context of this meeting above. Help the user understand outcomes, draft follow-up emails, create workflows, or identify next steps.\nRelevant action tokens:\n- REPLY_DRAFT when the user asks to draft a follow-up email or any email related to the meeting.\n- OPEN_WORKFLOW when the user wants to start a workflow or generate a document based on meeting outcomes.\n- OPEN_PROCESS when the user wants to navigate to a specific active process referenced in the meeting.`;
    }

    if (context === 'drive') {
      systemPrompt += `\n\nYou are a document and knowledge assistant on the Drive page. Help the user find files, understand what's in their knowledge base, and decide what to generate or connect. You can suggest workflows for creating new documents based on existing files.`;
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
      max_tokens: context === 'meeting' ? 1200 : mode === 'reply' ? 1500 : 1500,
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
