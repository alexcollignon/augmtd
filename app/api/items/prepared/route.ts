// ════════════════════════════════════════════════════════════════════════════════════════════════
// PATCH /api/items/prepared — THE EDIT DOOR (W9.1, the law `the-users-hand-wins`).
//
// The cards that let the user change prepared words save here: the email card (item lane → the
// inbox reply draft; compose lane → the commitment's pooled message), the invite card (item lane),
// the forward card. The save lands IN PLACE on the artifact's one home with the hand stamp
// (`edited_by_user_at` + `hand_hash` + the ground it was edited on) — from then on the engine never
// overwrites it; a later inbound only MARKS it (THE ONE READER's `staleUnderEdit`).
//
// Body: { itemKind: 'inbox'|'commitment', itemId, kind, body? | invite? | forward?, rowId? }
// RLS client: the user writes only their own rows. Nothing sends, nothing calls a model.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { saveUserEdit, type HandEdit } from '@/lib/prepare/hand-store';
import type { HandKind } from '@/lib/prepare/hand';

const KINDS: HandKind[] = ['reply_draft', 'nudge_draft', 'invite', 'forward', 'paste_pack', 'deliverable'];

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const b = (await request.json().catch(() => ({}))) as Partial<HandEdit>;
    const itemKind = b.itemKind === 'commitment' ? 'commitment' : b.itemKind === 'inbox' ? 'inbox' : null;
    const kind = b.kind && KINDS.includes(b.kind) ? b.kind : null;
    const itemId = typeof b.itemId === 'string' ? b.itemId.trim() : '';
    if (!itemKind || !kind || !itemId) return NextResponse.json({ error: 'itemKind, itemId and kind required' }, { status: 400 });
    const r = await saveUserEdit(supabase, user.id, {
      itemKind, itemId, kind,
      ...(typeof b.body === 'string' ? { body: b.body } : {}),
      ...(b.invite && typeof b.invite === 'object' ? { invite: b.invite } : {}),
      ...(b.forward && typeof b.forward === 'object' ? { forward: b.forward } : {}),
      ...(typeof b.rowId === 'string' ? { rowId: b.rowId } : {}),
    });
    if (r.saved) return NextResponse.json(r);
    const status = r.reason === 'unchanged' ? 200 : r.reason === 'sent' ? 409 : r.reason === 'not_found' ? 404 : r.reason === 'invalid' ? 400 : 500;
    return NextResponse.json(r, { status });
  } catch (e) {
    console.error('[items/prepared]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
