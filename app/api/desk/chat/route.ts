import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAIClient } from '@/lib/ai/factory';
import { buildUserContextBlock } from '@/lib/context/build-user-context';
import { getCalendarContext } from '@/lib/calendar/calendar-context';
import { formatCalendarContextForChat } from '@/lib/calendar/format-calendar-context';
import type { DeskItem, DeskColumn } from '@/lib/types/desk';

export const maxDuration = 60;

const COLUMN_LABELS: Record<DeskColumn, string> = {
  pool: 'Pool (unconfirmed)',
  todo: 'To Do',
  in_progress: 'In Progress',
  waiting: 'Waiting',
  done: 'Done',
};

function buildBoardContext(boardItems: DeskItem[]): string {
  const grouped: Record<string, DeskItem[]> = {};
  for (const item of boardItems) {
    const col = item.column;
    if (!grouped[col]) grouped[col] = [];
    grouped[col].push(item);
  }

  const lines: string[] = [];
  const colOrder: DeskColumn[] = ['pool', 'todo', 'in_progress', 'waiting', 'done'];
  for (const col of colOrder) {
    const colItems = grouped[col];
    if (!colItems?.length) continue;
    lines.push(`[${COLUMN_LABELS[col]}]`);
    for (const item of colItems) {
      const source = item.sourceType === 'email' ? 'EMAIL' : item.sourceType === 'meeting_action' ? 'MEETING' : 'PROCESS';
      lines.push(`  - ${item.title} (${source})`);
    }
  }
  return lines.join('\n') || 'No items on the board.';
}

const SYSTEM_PROMPT = `You are a work assistant inside AUGMTD. You help the user manage their work, prioritize tasks, and take action.

{{USER_CONTEXT}}

{{CALENDAR_CONTEXT}}

CURRENT WORK BOARD:
{{BOARD_CONTEXT}}

Today is {{TODAY}}.
Answer concisely. When relevant, reference specific items by name from the board above.`;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { message, history = [], boardItems = [] } = body as {
      message: string;
      history: Array<{ role: 'user' | 'assistant'; content: string }>;
      boardItems?: DeskItem[];
    };

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message required' }, { status: 400 });
    }

    const { client: aiClient, model } = await getAIClient(user.id, 'conversation', supabase);

    const [userContextBlock, calendarCtx] = await Promise.all([
      buildUserContextBlock(user.id, supabase),
      getCalendarContext(user.id, supabase),
    ]);

    const calendarText = formatCalendarContextForChat(calendarCtx);
    const boardContext = buildBoardContext(boardItems);
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const systemPrompt = SYSTEM_PROMPT
      .replace('{{USER_CONTEXT}}', userContextBlock || '')
      .replace('{{CALENDAR_CONTEXT}}', calendarText || '')
      .replace('{{BOARD_CONTEXT}}', boardContext)
      .replace('{{TODAY}}', today);

    const chatParams = {
      model,
      messages: [
        { role: 'system' as const, content: systemPrompt },
        ...history,
        { role: 'user' as const, content: message },
      ],
      temperature: 0.3,
      max_tokens: 700,
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
    console.error('[DeskChat] POST error:', err);
    return NextResponse.json({ error: 'Failed to process message' }, { status: 500 });
  }
}
