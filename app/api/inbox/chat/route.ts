import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAIClient } from '@/lib/ai/factory';
import { buildInboxSnapshot, formatSnapshotForPrompt } from '@/lib/inbox/chat-context';
import { buildKBContext } from '@/lib/knowledge/build-kb-context';
import { getCalendarContext } from '@/lib/calendar/calendar-context';
import { formatCalendarContextForChat } from '@/lib/calendar/format-calendar-context';
import { buildUserContextBlock } from '@/lib/context/build-user-context';
import { checkRateLimit } from '@/lib/utils/rate-limit';

/** Strip HTML tags from a draft body so the AI sees clean text, not markup. */
function stripHtmlForAI(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const SYSTEM_PROMPT = `You are an intelligent assistant for a professional email tool called AUGMTD.
You help users search and understand their emails, answer questions using their indexed documents, and help with scheduling.

{{USER_CONTEXT}}

{{KB_CONTEXT}}

{{CALENDAR_CONTEXT}}

{{FOCUSED_EMAIL}}

Here is the user's current inbox (most recent first):
{{INBOX_SNAPSHOT}}

Rules:
- Answer questions using BOTH the knowledge base above AND the inbox — whichever is relevant
- When KB documents are relevant to the question, summarize their content directly — do not say you can't find something if it appears in the knowledge base
- When you reference a specific email, include its ID in square brackets like this: [uuid] — the UI will render it as an email card. ONLY use [uuid] when the user explicitly asked about a specific email. NEVER attach [uuid] to calendar events, meeting descriptions, or scheduling answers.
- If you find multiple matching emails, list them one per line with their [id]
- Do not make up emails that aren't in the inbox snapshot above
- Dates: today is {{TODAY}}
- Use the calendar above when answering scheduling questions. Propose conflict-free times based on the user's actual calendar.
- If the user has attached a document (shown as [Attached document content: ...]), answer using it as primary context.
- If you used content from the knowledge base in your answer, append exactly one line at the very end: KB_REFS:filename1.pdf|filename2.pdf (pipe-separated, exact filenames as shown in the KB headers above). Do not append KB_REFS if you did not use the knowledge base.

TOKEN RULES — emit only the appropriate token(s) at the very end of your response, after all text:

ACTION:{"type":"archive","itemId":"uuid","label":"..."}
→ User wants to archive an email. Only when intent is clear.

ACTION:{"type":"open","itemId":"uuid","label":"..."}
→ User wants to navigate to / read a specific email. NOT for sending or replying.

MEETING_SUGGESTION:{"title":"...","duration_minutes":30,"attendees":["email@example.com"],"proposed_times":["2026-03-14T14:00:00"],"notes":"..."}
→ User clearly wants to schedule a meeting. Times must not conflict with the calendar above.
  CRITICAL: attendees must be valid email addresses (e.g. "alex@company.com"), never names.
  If a FOCUSED EMAIL is shown, use the sender's email address as the attendee.
  If the email address is unknown, omit the attendee rather than using a name.

OPEN_COMPOSE:{"to":"...","subject":"...","body":"..."}
→ User wants to write or send a NEW email to someone.
  ALWAYS emit this token when the user wants to compose a new email — even if the recipient email address is unknown (use their name or leave to:"" and the user will fill it in the compose panel).
  Do not combine with ACTION or MEETING_SUGGESTION.
  Formatting rules (same as below): use markdown — **bold**, *italic*, - bullet lists, 1. numbered lists. \\n for newlines. Never HTML tags.

REPLY_DRAFT:{"body":"..."}
→ REQUIRED when user asks to draft, write, or suggest a reply to an email.
  Triggers: "draft a reply", "reply to X", "write a response", "suggest a reply", "how should I respond", etc.
  ALWAYS emit this token — do NOT write the reply as plain text prose.
  Write a short intro sentence first (e.g. "Here's a draft:"), then emit the token on the next line.
  If a FOCUSED EMAIL is shown above, reply to that one. Otherwise use the inbox snapshot.
  Body must be the complete reply text only — no subject line.
  Structure: greeting line, blank line (\\n\\n), body paragraphs separated by blank lines, blank line, sign-off, name. Use \\n for newlines inside the JSON string.
  Formatting: markdown only — **bold**, *italic*, - item (bullet list), 1. item (numbered list). Never HTML tags like <b> or <strong>.
  Do not combine with OPEN_COMPOSE.

UPDATE_DRAFT:{"subject":"...","body":"..."}
→ User is composing a new email (compose panel is open) and wants to refine it. Only in compose mode.
  Structure: same as REPLY_DRAFT — paragraphs separated by \\n\\n, sign-off at end. Use \\n for newlines.
  Formatting: markdown only — **bold**, *italic*, - item (bullet list), 1. item (numbered list). Never HTML tags.`;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rl = checkRateLimit(`inbox-chat:${user.id}`, 20, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
      );
    }

    const { client: openaiClient, model: chatModel } = await getAIClient(user.id, 'conversation', supabase);

    const body = await request.json();
    const { message, history = [], sources, fileContext, mode, composeDraft, emailContext, replyDraft } = body as {
      message: string;
      history: Array<{ role: 'user' | 'assistant'; content: string }>;
      sources?: string[];
      fileContext?: string;
      mode?: 'inbox' | 'compose' | 'reply';
      composeDraft?: { to: string; cc: string; subject: string; body: string };
      replyDraft?: string;
      emailContext?: {
        subject?: string;
        from?: string;
        fromName?: string;
        summary?: string;
        keyPoints?: string[];
        body?: string;
      };
    };

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message required' }, { status: 400 });
    }

    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const activeSources = sources?.length ? sources : ['inbox', 'kb', 'calendar'];

    const [snapshot, kbContext, calendarCtx, userContextBlock, indexedFilesResult] = await Promise.all([
      activeSources.includes('inbox') && mode !== 'reply'
        ? buildInboxSnapshot(user.id, message, supabase)
        : Promise.resolve([]),
      activeSources.includes('kb')
        ? buildKBContext(user.id, message, adminClient, { fileLimit: 6, maxChunksPerFile: 3, threshold: 0.2, maxTotalChars: 12000 })
        : Promise.resolve({ context: '', filenames: [] }),
      activeSources.includes('calendar')
        ? getCalendarContext(user.id, supabase)
        : Promise.resolve({ upcomingMeetings: [], availability: undefined }),
      buildUserContextBlock(user.id, supabase),
      activeSources.includes('kb')
        ? supabase.from('knowledge_files').select('filename').eq('user_id', user.id)
        : Promise.resolve({ data: [] }),
    ]);
    const snapshotText = formatSnapshotForPrompt(snapshot);
    const calendarText = formatCalendarContextForChat(calendarCtx);
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // Build KB section: file inventory (all indexed filenames) + semantic excerpts
    const allFiles = (indexedFilesResult as any).data as Array<{ filename: string }> | null;
    const inventoryLine = allFiles?.length
      ? `YOUR INDEXED FILES (${allFiles.length} total): ${allFiles.map(f => f.filename).join(', ')}\n\n`
      : '';
    const kbSection = inventoryLine + (kbContext.context || '');

    // Build focused email block when user has a specific email open in context
    const focusedEmailBlock = emailContext
      ? `FOCUSED EMAIL — the user is currently working on this email. When they say "this email", "it", "them", or "draft a reply", refer to this:
From: ${emailContext.fromName ? `${emailContext.fromName} <${emailContext.from}>` : emailContext.from}
Subject: ${emailContext.subject || '(no subject)'}${emailContext.summary ? `\nSummary: ${emailContext.summary}` : ''}${emailContext.keyPoints?.length ? `\nKey points:\n${emailContext.keyPoints.map(p => `- ${p}`).join('\n')}` : ''}${emailContext.body ? `\nBody:\n${emailContext.body.slice(0, 2000)}${emailContext.body.length > 2000 ? '\n[...truncated]' : ''}` : ''}`
      : '';

    let systemPrompt = SYSTEM_PROMPT
      .replace('{{USER_CONTEXT}}', userContextBlock || '')
      .replace('{{INBOX_SNAPSHOT}}', snapshotText || 'No active inbox items.')
      .replace('{{FOCUSED_EMAIL}}', focusedEmailBlock)
      .replace('{{TODAY}}', today)
      .replace('{{KB_CONTEXT}}', kbSection)
      .replace('{{CALENDAR_CONTEXT}}', calendarText || '');

    // Compose mode addendum
    if (mode === 'compose' && composeDraft) {
      const bodyForAI = stripHtmlForAI(composeDraft.body || '');
      systemPrompt += `\n\nThe user is composing a new outgoing email. Current draft:
  To: ${composeDraft.to || '(empty)'}
  Subject: ${composeDraft.subject || '(empty)'}
  Body: ${bodyForAI || '(empty)'}

Help improve tone, length, subject, clarity. When providing a full revision emit UPDATE_DRAFT at the very end. Only emit UPDATE_DRAFT for complete rewrites, not commentary.`;
    }

    // Reply mode addendum
    if (mode === 'reply') {
      const replyForAI = stripHtmlForAI(replyDraft || '');
      systemPrompt += `\n\nThe user has the reply box open. Current draft:
${replyForAI || '(empty — not yet drafted)'}

REPLY MODE — follow exactly:
1. Silently decide if the user wants to WRITE/EDIT the draft or ask a QUERY. Do NOT write "INTENT DETECTION" or any label — this classification is internal only.

2. If WRITE/EDIT intent → this includes: drafting from scratch when the draft is empty ("draft a reply", "write a response", "reply saying..."), AND editing an existing draft (change, improve, rewrite, shorten, formalize, adjust tone, etc.). Write a single short acknowledgment sentence (e.g. "Here's a draft:" or "Made it more casual:"), then on the next line emit REPLY_DRAFT:{"body":"..."}. The body must be the complete reply text.

3. If QUERY intent (asking a question, checking calendar, etc.) → respond normally as a helpful assistant. Do NOT emit REPLY_DRAFT.

4. EMAIL BODY FORMAT — all reply drafts must follow this structure:
   "Hi Alex,\\n\\nThank you for reaching out...\\n\\nBest regards,\\nAlexandre"
   Rules: greeting on first line, \\n\\n between paragraphs, sign-off line, name on the line after.
   Use \\n for newlines inside the JSON string. Use **word** for bold, - item for bullet lists.

5. CRITICAL: Never emit ACTION, OPEN_COMPOSE, or UPDATE_DRAFT in reply mode. MEETING_SUGGESTION is allowed only for QUERY intents about scheduling.`;
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
        stream = await openaiClient.chat.completions.create(chatParams);
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
    console.error('[InboxChat] POST error:', err);
    return NextResponse.json({ error: 'Failed to process message' }, { status: 500 });
  }
}
