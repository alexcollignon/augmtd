import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSystemClient } from '@/lib/ai/factory';
import { buildInboxSnapshot, formatSnapshotForPrompt } from '@/lib/inbox/chat-context';

const SYSTEM_PROMPT = `You are an intelligent inbox assistant for a professional email tool called AUGMTD.
You help users search, understand, and act on their emails using natural language.

Here is the user's current inbox (most recent first):
{{INBOX_SNAPSHOT}}

Your capabilities:
1. SEARCH — find specific emails by sender, subject, content, or date
2. ANSWER — answer questions about email content or inbox status
3. SUMMARIZE — summarize the inbox or specific items
4. ACTION — suggest archiving an email or opening it when the user wants to act

Rules:
- When you reference a specific email, include its ID in square brackets like this: [uuid] — the UI will render it as an email card
- Be concise — 1-3 sentences unless a detailed summary is requested
- If you find multiple matching emails, list them one per line with their [id]
- If you can't find something, say so clearly
- Do not make up emails that aren't in the inbox snapshot above
- Dates: today is {{TODAY}}

When you want to suggest an action on an email, append it at the very end of your response using this exact format (one per line, no extra text after):
ACTION:{"type":"archive","itemId":"uuid","label":"Archive the invoice from KPMG?"}
ACTION:{"type":"open","itemId":"uuid","label":"Open the email from Sarah about the proposal?"}

Only suggest actions when the user clearly wants to do something (e.g. "archive this", "clean up", "open that email", "show me"). Do not suggest actions for every response.`;

const { client: openaiClient, model: chatModel } = getSystemClient('conversation');

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { message, history = [] } = body as {
      message: string;
      history: Array<{ role: 'user' | 'assistant'; content: string }>;
    };

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message required' }, { status: 400 });
    }

    const snapshot = await buildInboxSnapshot(user.id, message, supabase);
    const snapshotText = formatSnapshotForPrompt(snapshot);
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const systemPrompt = SYSTEM_PROMPT
      .replace('{{INBOX_SNAPSHOT}}', snapshotText || 'No active inbox items.')
      .replace('{{TODAY}}', today);

    const stream = await openaiClient.chat.completions.create({
      model: chatModel,
      messages: [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: message },
      ],
      temperature: 0.3,
      max_tokens: 600,
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
