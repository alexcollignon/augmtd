// ════════════════════════════════════════════════════════════════════════════════════════════════
// POST /api/items/steer — a THIN wrapper over THE ONE CONVERSATION CORE (lib/converse — P6b).
// The rail's composer posts here with item scope; the core routes the turn (command / question /
// correction / delegate / open-agent-loop) against the chief-of-staff capability slice. No logic
// lives in this route — every chat surface wires to the same core.
//
// Body: { kind: 'email'|'followup'|'commitment'|'awareness'|'meeting'|'entity', id, text }
//   kind 'entity' = the PROJECT DOOR (P7c-c2): id is the entity id; the core runs in entity scope.
// Response (superset of the pre-P6b contract, so the rail upgrades without breakage):
//   { ok, say, refs, files?, applied?, question?, answer?, draft?, learned?, entityName?, delegated? }
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { converse, type ConverseScope } from '@/lib/converse';

export const maxDuration = 120;

type SteerKind = 'email' | 'followup' | 'commitment' | 'awareness' | 'meeting' | 'entity';
const VALID: SteerKind[] = ['email', 'followup', 'commitment', 'awareness', 'meeting', 'entity'];

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await request.json()) as { kind?: SteerKind; id?: string; text?: string };
    const kind = body.kind && VALID.includes(body.kind) ? body.kind : null;
    const id = body.id?.trim();
    const text = (body.text ?? '').trim().slice(0, 1000);
    if (!kind || !id || !text) return NextResponse.json({ error: 'kind, id and text required' }, { status: 400 });

    const scope: ConverseScope = kind === 'entity'
      ? { kind: 'entity', entityId: id }
      : { kind: 'item', itemKind: kind, itemId: id };
    const turn = await converse(supabase, user.id, scope, text);

    return NextResponse.json({
      ok: true,
      say: turn.say,
      refs: turn.refs,
      ...(turn.files ? { files: turn.files } : {}),
      ...(turn.applied ? { applied: turn.applied } : {}),
      // Back-compat fields the rail's pre-P6b renderer reads:
      ...(turn.refs.length || (!turn.draft && !turn.applied && !turn.delegated && !turn.learned?.length)
        ? { question: true, answer: turn.say } : {}),
      ...(turn.draft !== undefined ? { draft: turn.draft } : {}),
      ...(turn.learned ? { learned: turn.learned } : {}),
      ...(turn.entityName !== undefined ? { entityName: turn.entityName } : {}),
      ...(turn.delegated !== undefined ? { delegated: turn.delegated } : {}),
      // THE PARITY LAW (Aug 4): the chat-approved send / summoned-stage signals — the client
      // fires the one send door / raises the stage.
      ...(turn.commit ? { commit: turn.commit } : {}),
      ...(turn.openStage ? { openStage: turn.openStage } : {}),
      // ARTIFACTS-INTO-ORIGIN (Aug 9): the dispatched deliverable's card rides into the room.
      ...(turn.artifact ? { artifact: turn.artifact } : {}),
      ...(turn.options?.length ? { options: turn.options } : {}),
    });
  } catch (e) {
    console.error('[items/steer]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
