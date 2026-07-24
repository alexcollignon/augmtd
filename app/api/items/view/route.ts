// ════════════════════════════════════════════════════════════════════════════════════════════════
// GET /api/items/view?kind=email|commitment|followup|meeting|awareness&id=<itemId>
//
// The deep-dive's ONE outcome read (just-works P1): everything the outcome-first detail needs beyond
// the thread itself, in a single response —
//   • prepared — every prepared artifact via THE ONE READER (reply draft w/ byline, nudge, coworker
//     deliverables w/ provenance)
//   • gap      — ONE plain suggestion derived from the CACHED plan's unmet producing steps
//     (grounded-or-absent; the step list itself never ships to the client)
//   • inviteTaskId — an open prepared-calendar-invite step, so the detail can offer ONE contextual
//     "Schedule" action (approve-gated card) without a step panel
//   • entity   — the linked entity (provenance chip + the steer endpoint's memory target)
//
// HARD RULE (P0): no AI call in this GET — the plan is read AS CACHED (generation stays on the
// existing POST /api/items/plan, pre-generated in the background from the Home).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getPrepared } from '@/lib/prepare/read';
import { deriveGap, isOpenStep, isSendBlocked } from '@/lib/home/item-gaps';
import type { ItemPlanKind, ItemPlanTask } from '@/lib/home/item-plan';

const VALID_KINDS: ItemPlanKind[] = ['email', 'meeting', 'commitment', 'awareness', 'followup'];
const INVITE_PHRASE = /\b(calendar invite|calendar event|send (?:an? )?invite|book (?:a|the) (?:meeting|call|slot)|schedule (?:a|the|this) (?:meeting|call|invite))\b/i;

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const kind = request.nextUrl.searchParams.get('kind') as ItemPlanKind | null;
    const id = request.nextUrl.searchParams.get('id');
    if (!kind || !id || !VALID_KINDS.includes(kind)) {
      return NextResponse.json({ error: 'kind and id required' }, { status: 400 });
    }

    // The entity-link item_kind + prepared-pool kind for this plan kind.
    const linkKind = kind === 'commitment' || kind === 'followup' ? 'commitment' : kind === 'meeting' ? 'meeting' : 'inbox_item';

    const [planRes, preparedArts, linkRes, anyVerdict, itemRowRes] = await Promise.all([
      supabase.from('item_plans').select('tasks, updated_at').eq('user_id', user.id).eq('kind', kind).eq('entity_id', id).maybeSingle(),
      linkKind === 'meeting'
        ? Promise.resolve([] as Awaited<ReturnType<typeof getPrepared>>)
        : getPrepared(supabase, user.id, { kind: linkKind as 'inbox_item' | 'commitment', id }),
      supabase.from('entity_links').select('entity_id').eq('user_id', user.id).eq('item_kind', linkKind).eq('item_id', id).not('entity_id', 'is', null).maybeSingle(),
      // ANY membership verdict (incl. a remembered refusal) — decides whether to recognize-on-open below.
      supabase.from('entity_links').select('item_id').eq('user_id', user.id).eq('item_kind', linkKind).eq('item_id', id).maybeSingle(),
      // The open item itself — the ANCHOR the rail leads with (P5b: the rail narrates THIS item first).
      linkKind === 'inbox_item'
        ? supabase.from('inbox_items').select('work_title, source_data, last_activity_at, created_at').eq('id', id).eq('user_id', user.id).maybeSingle()
        : linkKind === 'commitment'
          ? supabase.from('commitments').select('description, counterparty, created_at').eq('id', id).eq('user_id', user.id).maybeSingle()
          : supabase.from('meeting_transcripts').select('title, start_time').eq('id', id).eq('user_id', user.id).maybeSingle(),
    ]);

    // ── THE ANCHOR — what the rail's opening message is assembled from: who this is with, the item's
    // verb-first ask (understanding.ask), and whether prepared work already arrived. Grounded-or-absent
    // per part; never invented.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const itemRow = (itemRowRes.data ?? null) as any;
    let anchor: { who: string | null; ask: string | null; prepared: string | null } = { who: null, ask: null, prepared: null };
    let itemActivityAt: string | null = null;
    if (itemRow) {
      if (linkKind === 'inbox_item') {
        const sd = (itemRow.source_data ?? {}) as Record<string, unknown>;
        const u = (sd.understanding ?? null) as { ask?: string } | null;
        anchor = {
          who: (sd.from_name as string) || (sd.from as string) || null,
          ask: (typeof u?.ask === 'string' && u.ask) || null,
          prepared: null,
        };
        itemActivityAt = (itemRow.last_activity_at as string) || (sd.received_at as string) || (itemRow.created_at as string) || null;
      } else if (linkKind === 'commitment') {
        anchor = { who: (itemRow.counterparty as string) || null, ask: String(itemRow.description || '') || null, prepared: null };
      } else {
        anchor = { who: null, ask: null, prepared: null };
      }
    }
    const replyArt = preparedArts.find((a) => a.kind === 'reply_draft' || a.kind === 'nudge_draft');
    if (replyArt) anchor.prepared = replyArt.by ?? 'draft';

    // RECOGNIZE-ON-OPEN (the coverage tail): the live hooks gate on understanding labels, so an item
    // can reach the deep-dive with NO membership verdict at all — and then the rail has no deal to
    // narrate. Opening an item is the strongest "this matters" signal there is, so an unverdicted item
    // gets recognized in the BACKGROUND (idempotent; a refusal is remembered too, so this fires at
    // most once per item). No AI in the GET path — the client re-checks shortly after.
    if (!anyVerdict.data) {
      const uid = user.id;
      after(async () => {
        try {
          const { recognizeItem } = await import('@/lib/entities/recognize');
          const src = await import('@/lib/entities/sources');
          if (linkKind === 'inbox_item') {
            const { data: it } = await supabase.from('inbox_items').select('id, work_title, source_data, created_at').eq('id', id).eq('user_id', uid).maybeSingle();
            if (it) await recognizeItem(supabase, uid, src.itemFromInbox(it));
          } else if (linkKind === 'commitment') {
            const { data: c } = await supabase.from('commitments').select('id, description, counterparty, thread_id, source, source_id, created_at').eq('id', id).eq('user_id', uid).maybeSingle();
            if (c) await recognizeItem(supabase, uid, src.itemFromCommitment(c));
          } else {
            const { data: m } = await supabase.from('meeting_transcripts').select('id, title, summary, attendees, start_time, created_at').eq('id', id).eq('user_id', uid).maybeSingle();
            if (m) await recognizeItem(supabase, uid, src.itemFromMeeting(m));
          }
        } catch { /* non-fatal — the cron hooks are the backstop */ }
      });
    }

    const tasks = (Array.isArray(planRes.data?.tasks) ? planRes.data!.tasks : []) as ItemPlanTask[];
    // GAP only from a FRESH plan (P5b): a plan older than the item's latest thread activity describes a
    // conversation that has moved on — its unmet inputs (the stale "upload the X" class) must not
    // surface as a live ask. Same freshness rule the plan route uses to regenerate.
    const planFresh = !itemActivityAt || !planRes.data?.updated_at ||
      String(planRes.data.updated_at) >= String(itemActivityAt);
    const gap = planFresh ? deriveGap(tasks) : null;

    // ONE contextual prepared action: an open calendar-invite send step (approve-gated card in the UI).
    // DEPENDENCY HONESTY: never offered while a producing step before it is still open.
    const inviteStep = tasks.find((t) =>
      isOpenStep(t) && t.actor === 'system' && t.capability === 'send' &&
      INVITE_PHRASE.test(`${t.text || ''} ${t.detail || ''}`) && !isSendBlocked(tasks, t));
    const inviteTaskId = inviteStep?.id ?? null;

    // ── THE RAIL (P1.5b) — the deal's judged state + everything else living on this entity, via
    // THE ONE room-view builder (P7c-c2: shared with GET /api/entities/[id]/room — the deep-dive and
    // the project room can never drift). Zero AI here.
    const { buildRoomView, emptySiblings } = await import('@/lib/entities/room-view');
    const room = linkRes.data?.entity_id
      ? await buildRoomView(supabase, user.id, linkRes.data.entity_id as string, id)
      : { entity: null, siblings: emptySiblings() };
    const entity = room.entity;
    const siblings = room.siblings;
    return NextResponse.json({
      prepared: preparedArts.map((a, i) => ({
        id: `${a.kind}-${i}`, kind: a.kind, title: a.title, content: a.content,
        by: a.by, at: a.at, attachment: a.attachment, provenance: a.provenance,
      })),
      anchor,
      gap,
      inviteTaskId,
      entity,
      siblings,
    });
  } catch (e) {
    console.error('[items/view]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
