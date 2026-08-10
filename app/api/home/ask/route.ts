import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { converse, type ConverseHistoryTurn } from '@/lib/converse';

// 180: a production hand-off (delegation runs synchronously, the artifact comes home) must
// never be killed by the route budget — the 30s cap predates chat-borne production.
export const maxDuration = 180;

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
    // THE PASTE CEILING DIED (Aug 10, found live): a pilot pasted a full questionnaire and the
    // old slice(0, 500) silently discarded everything past character 500 — the brain answered a
    // request it never saw. Long input is the NORM for production asks; 20k chars ≈ a long doc.
    const q = String(body.question ?? '').trim().slice(0, 20000);
    if (!q) return NextResponse.json({ error: 'question required' }, { status: 400 });
    const history = Array.isArray(body.history) ? body.history : [];
    // THE SCOPE CHIP (Aug 6): a scoped Home conversation converses IN the project's room scope —
    // full room grounding, the room's verbs — through the same one core. RLS scopes the read.
    const scope = body.entityId
      ? ({ kind: 'entity', entityId: String(body.entityId) } as const)
      : ({ kind: 'global' } as const);
    // THE RECOGNITION NUDGE (Aug 7 — "will it suggest opening the project room?"): when an
    // UNSCOPED question NAMES a registered project (the same deterministic focus match the
    // grounding uses), the response carries the match so the panel can OFFER filing the
    // conversation there — a suggestion, never an auto-file (chat is cheap, objects are
    // deliberate). Zero AI: one entity read + token matching.
    const focusOf = async (): Promise<{ id: string; name: string } | undefined> => {
      if (scope.kind !== 'global') return undefined;
      try {
        const { findEntityFocus } = await import('@/lib/home/ask');
        const { data: ents } = await supabase.from('work_entities').select('id, name, aliases')
          .eq('user_id', user.id).eq('kind', 'initiative').eq('status', 'active')
          .order('last_event_at', { ascending: false }).limit(200);
        return findEntityFocus(q, (ents ?? []) as Array<{ id: string; name: string; aliases?: string[] | null }>) ?? undefined;
      } catch { return undefined; }
    };
    const payloadOf = (turn: Awaited<ReturnType<typeof converse>>, focus?: { id: string; name: string }) => ({
      answer: turn.say, refs: turn.refs,
      ...(turn.applied?.length ? { applied: turn.applied } : {}),
      ...(turn.files?.length ? { files: turn.files } : {}),
      ...(turn.delegated ? { delegated: turn.delegated } : {}),
      ...(turn.options?.length ? { options: turn.options } : {}),
      // ARTIFACTS-INTO-ORIGIN (Aug 9): the dispatched deliverable's card rides the answer.
      ...(turn.artifact ? { artifact: turn.artifact } : {}),
      // THE ONE CREATION CARD (Aug 10): the drafted standing task reviews inline.
      ...(turn.workflowDraft ? { workflowDraft: turn.workflowDraft } : {}),
      // The filing nudge never decorates a failed/empty answer (found live: a wrong "File it"
      // chip beside a dead reply compounds the miss).
      ...(focus && turn.say?.trim() ? { focus } : {}),
    });
    if (body.stream === true) {
      const enc = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (d: Record<string, unknown>) => {
            try { controller.enqueue(enc.encode(`data: ${JSON.stringify(d)}\n\n`)); } catch { /* client gone */ }
          };
          Promise.all([
            converse(supabase, user.id, scope, q, {
              history, onProgress: (label) => send({ type: 'progress', label }),
            }),
            focusOf(),
          ]).then(([turn, focus]) => { send({ type: 'done', ...payloadOf(turn, focus) }); })
            .catch((e) => { console.error('[home/ask] stream error:', e); send({ type: 'error' }); })
            .finally(() => { try { controller.close(); } catch { /* already closed */ } });
        },
      });
      return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
      });
    }
    const [turn, focus] = await Promise.all([converse(supabase, user.id, scope, q, { history }), focusOf()]);
    return NextResponse.json(payloadOf(turn, focus));
  } catch (e) {
    console.error('[home/ask] error:', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
