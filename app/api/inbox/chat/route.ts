import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAIClient } from '@/lib/ai/factory';
import { buildInboxSnapshot, formatSnapshotForPrompt } from '@/lib/inbox/chat-context';
import { buildKBContext } from '@/lib/knowledge/build-kb-context';
import { getCalendarContext } from '@/lib/calendar/calendar-context';
import { formatCalendarContextForChat } from '@/lib/calendar/format-calendar-context';

const SYSTEM_PROMPT = `You are an intelligent assistant for a professional email tool called AUGMTD.
You help users search and understand their emails, answer questions using their indexed documents, and help with scheduling.

{{KB_CONTEXT}}

{{CALENDAR_CONTEXT}}

Here is the user's current inbox (most recent first):
{{INBOX_SNAPSHOT}}

Rules:
- Answer questions using BOTH the knowledge base above AND the inbox — whichever is relevant
- When KB documents are relevant to the question, summarize their content directly — do not say you can't find something if it appears in the knowledge base
- When you reference a specific email, include its ID in square brackets like this: [uuid] — the UI will render it as an email card
- If you find multiple matching emails, list them one per line with their [id]
- Do not make up emails that aren't in the inbox snapshot above
- Dates: today is {{TODAY}}
- Use the calendar above when answering scheduling questions. Propose conflict-free times based on the user's actual calendar.
- If you used content from the knowledge base in your answer, append exactly one line at the very end: KB_REFS:filename1.pdf|filename2.pdf (pipe-separated, exact filenames as shown in the KB headers above). Do not append KB_REFS if you did not use the knowledge base.

When you want to suggest an action on an email, append it at the very end of your response using this exact format (one per line, no extra text after):
ACTION:{"type":"archive","itemId":"uuid","label":"Archive the invoice from KPMG?"}
ACTION:{"type":"open","itemId":"uuid","label":"Open the email from Sarah about the proposal?"}

Only suggest actions when the user clearly wants to do something (e.g. "archive this", "clean up", "open that email", "show me"). Do not suggest actions for every response.

When scheduling a meeting makes sense given the conversation (e.g. user wants to set up a call, email discusses meeting), propose one using this format appended at the very end (one line, after any ACTION lines):
MEETING_SUGGESTION:{"title":"Intro call","duration_minutes":30,"attendees":["alice@example.com"],"proposed_times":["2026-03-14T14:00:00","2026-03-15T10:00:00"],"notes":"Quick intro to discuss the proposal"}

Only emit MEETING_SUGGESTION when the user is clearly trying to schedule something. Proposed times must not conflict with the calendar above.`;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { client: openaiClient, model: chatModel } = await getAIClient(user.id, 'conversation', supabase);

    const body = await request.json();
    const { message, history = [] } = body as {
      message: string;
      history: Array<{ role: 'user' | 'assistant'; content: string }>;
    };

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message required' }, { status: 400 });
    }

    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const [snapshot, kbContext, calendarCtx] = await Promise.all([
      buildInboxSnapshot(user.id, message, supabase),
      buildKBContext(user.id, message, adminClient, { fileLimit: 3, maxChunksPerFile: 2, threshold: 0.2 }),
      getCalendarContext(user.id, supabase),
    ]);
    const snapshotText = formatSnapshotForPrompt(snapshot);
    const calendarText = formatCalendarContextForChat(calendarCtx);
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const systemPrompt = SYSTEM_PROMPT
      .replace('{{INBOX_SNAPSHOT}}', snapshotText || 'No active inbox items.')
      .replace('{{TODAY}}', today)
      .replace('{{KB_CONTEXT}}', kbContext.context)
      .replace('{{CALENDAR_CONTEXT}}', calendarText || '');

    const stream = await openaiClient.chat.completions.create({
      model: chatModel,
      messages: [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: message },
      ],
      temperature: 0.3,
      max_tokens: 700,
      stream: true,
    });

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
