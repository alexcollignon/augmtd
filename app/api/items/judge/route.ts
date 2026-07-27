import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { judgeWork, type JudgeInput } from '@/lib/work/judge';

export const maxDuration = 30;

// GET /api/items/judge?kind=inbox|commitment&id=… — THE ONE WORK JUDGMENT, served (judged-room J1/J2).
// Cached on the item (sig on activity + pool), so repeat loads cost zero AI. Every surface mounts
// from THIS verdict — no local inference.
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const kind = request.nextUrl.searchParams.get('kind');
    const id = request.nextUrl.searchParams.get('id');
    if ((kind !== 'inbox' && kind !== 'commitment') || !id) {
      return NextResponse.json({ error: 'kind (inbox|commitment) and id required' }, { status: 400 });
    }
    const verdict = await judgeWork(supabase, user.id, { kind, id } as JudgeInput);
    // The verdict MOVES the posture (read-time reconcile precedent): an expired/answered none
    // resolves the item right here — the user opens a moot item and finds it honestly filed,
    // with the narration + undo in place, instead of a dead task pretending to be work.
    const { applyVerdictConsequences } = await import('@/lib/work/apply-verdict');
    const applied = await applyVerdictConsequences(supabase, user.id, { kind, id } as JudgeInput, verdict);
    // THE DELIVERABLE RESOLUTION at the serving edge (fire-and-forget): an inventory-carrying
    // verdict resolves on OPEN too — the ambient pass covers the top of the deck, this covers
    // everything else, so no item with a judged inventory ever sits silent. SETTLED-GUARDED:
    // skipped once every required artifact has its staged pool row or an active ask already
    // stands in the room (repeat opens cost zero AI).
    if (verdict.requires?.length && (verdict.work === 'reply' || verdict.work === 'send_file' || verdict.work === 'produce')) {
      const requires = verdict.requires;
      const uid = user.id;
      after(async () => {
        try {
          const { roomKeyForItem } = await import('@/lib/room/turns');
          const roomKey = await roomKeyForItem(supabase, uid, kind, id);
          const { data: ask } = await supabase.from('room_turns').select('id')
            .eq('user_id', uid).eq('room_key', roomKey).eq('dedupe_key', `requires:${id}`)
            .filter('component->>key', 'eq', 'input_checklist').limit(1).maybeSingle();
          if (ask) return; // the ask stands — nothing new until the user answers/attaches
          const taskIds = requires.map((r) => `require:${r.label.toLowerCase().slice(0, 60)}`);
          const poolKind = kind === 'commitment' ? 'commitment' : 'email';
          const { data: staged } = await supabase.from('item_deliverables').select('task_id')
            .eq('user_id', uid).eq('kind', poolKind).eq('entity_id', id).in('task_id', taskIds);
          if ((staged?.length ?? 0) >= requires.length) return; // settled — everything staged
          const { data: linkRow } = await supabase.from('entity_links').select('entity_id')
            .eq('user_id', uid).eq('item_kind', kind === 'commitment' ? 'commitment' : 'inbox_item')
            .eq('item_id', id).not('entity_id', 'is', null).maybeSingle();
          let title = '';
          if (kind === 'inbox') {
            const { data: it } = await supabase.from('inbox_items').select('work_title').eq('id', id).eq('user_id', uid).maybeSingle();
            title = String(it?.work_title ?? '');
          } else {
            const { data: c } = await supabase.from('commitments').select('description').eq('id', id).eq('user_id', uid).maybeSingle();
            title = String(c?.description ?? '');
          }
          const { resolveRequirements } = await import('@/lib/prepare/requirements');
          await resolveRequirements(supabase, uid, {
            itemKind: kind, itemId: id, itemTitle: title, entityId: (linkRow?.entity_id as string) ?? null, requires,
          });
        } catch { /* resolution is an enhancement */ }
      });
    }
    return NextResponse.json({ verdict, applied });
  } catch (e) {
    console.error('[items/judge]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
