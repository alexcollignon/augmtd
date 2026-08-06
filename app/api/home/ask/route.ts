import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { converse, type ConverseHistoryTurn } from '@/lib/converse';

export const maxDuration = 30;

// POST /api/home/ask — the Home chat, a THIN wrapper over THE ONE conversation core (lib/converse).
// Questions answer from the brain snapshot (answerHomeQuestion, unchanged); commands ("find the deck"),
// delegation ("have Max research X"), and composite turns come free from the core — no surface-owned
// logic. { question, history? } → { answer, refs, applied?, files?, delegated? }.
// STREAMING (Aug 6): { stream: true } switches the response to SSE — `progress` events narrate what
// the core is DOING (tool labels from the ONE progress channel), then one `done` event carries the
// same payload the JSON path returns. The JSON path stays for every non-panel caller.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = (await request.json()) as { question?: string; history?: ConverseHistoryTurn[]; stream?: boolean; entityId?: string };
    const q = String(body.question ?? '').trim().slice(0, 500);
    if (!q) return NextResponse.json({ error: 'question required' }, { status: 400 });
    const history = Array.isArray(body.history) ? body.history : [];
    // THE SCOPE CHIP (Aug 6): a scoped Home conversation converses IN the project's room scope —
    // full room grounding, the room's verbs — through the same one core. RLS scopes the read.
    const scope = body.entityId
      ? ({ kind: 'entity', entityId: String(body.entityId) } as const)
      : ({ kind: 'global' } as const);
    const payloadOf = (turn: Awaited<ReturnType<typeof converse>>) => ({
      answer: turn.say, refs: turn.refs,
      ...(turn.applied?.length ? { applied: turn.applied } : {}),
      ...(turn.files?.length ? { files: turn.files } : {}),
      ...(turn.delegated ? { delegated: turn.delegated } : {}),
    });
    if (body.stream === true) {
      const enc = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (d: Record<string, unknown>) => {
            try { controller.enqueue(enc.encode(`data: ${JSON.stringify(d)}\n\n`)); } catch { /* client gone */ }
          };
          converse(supabase, user.id, scope, q, {
            history, onProgress: (label) => send({ type: 'progress', label }),
          }).then((turn) => { send({ type: 'done', ...payloadOf(turn) }); })
            .catch((e) => { console.error('[home/ask] stream error:', e); send({ type: 'error' }); })
            .finally(() => { try { controller.close(); } catch { /* already closed */ } });
        },
      });
      return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
      });
    }
    const turn = await converse(supabase, user.id, scope, q, { history });
    return NextResponse.json(payloadOf(turn));
  } catch (e) {
    console.error('[home/ask] error:', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
