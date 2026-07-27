// FIX-3 RESIDUE SWEEP — stored delegation "deliverables" that are actually ASKS or monologues.
// The old evaluator's prompt allowed "an honest question to the principal" as a deliverable, so a
// coworker's missing-inputs ask got stored in the pool and rendered as a "Prepared by X" card.
// This sweep re-reviews every LIVE delegation deliverable with the CURRENT evaluator (reasoned —
// no keyword matching) and converts what the new engine would never have stored:
//   needs_input → delete the pool row, strip the item's prepared_by stamp, and write the coworker's
//                 ask as the durable input_checklist room turn (what the new engine produces).
//   revise      → delete the pool row + strip the stamp (the new engine's honest refusal stores
//                 nothing; the old report-back narration in the room already tells the story).
//   pass/flag   → keep (real prepared work).
// Dry-run by default; `--apply` commits. Busts home_brief for touched users.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { evaluateDeliverable } from '../lib/prepare/evaluate';
import { writeRoomTurn, roomKeyForItem } from '../lib/room/turns';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');

(async () => {
  const { data: dels } = await sb.from('item_deliverables')
    .select('id, user_id, kind, entity_id, task_id, title, content, metadata, created_at')
    .or('task_id.eq.prepare-pass,metadata->>source.eq.delegation').limit(300);
  const touched = new Set<string>();
  for (const d of (dels ?? []) as Array<Record<string, unknown>>) {
    const uid = d.user_id as string, entityId = d.entity_id as string, kind = d.kind as string;
    // Only live items — resolved/dismissed items keep their history untouched.
    if (kind === 'email') {
      const { data: it } = await sb.from('inbox_items').select('status').eq('id', entityId).maybeSingle();
      if (it?.status !== 'pending') continue;
    } else if (kind === 'commitment') {
      const { data: c } = await sb.from('commitments').select('status').eq('id', entityId).maybeSingle();
      if (!c || !['open', 'pending', 'in_progress'].includes(String(c.status))) continue;
    } else continue;

    const review = await evaluateDeliverable(sb, uid, {
      content: String(d.content), task: String(d.title ?? 'the delegated task'),
      recipient: null, entityId: null, kind: 'deliverable',
    });
    const meta = (d.metadata ?? {}) as { agentName?: string; agentId?: string };
    console.log(`${review.verdict.toUpperCase().padEnd(11)} · ${uid.slice(0, 8)} · ${kind} · "${String(d.title).slice(0, 55)}" · by ${meta.agentName ?? '?'}${review.missing ? ` · missing=${JSON.stringify(review.missing.slice(0, 3))}` : ''}`);
    if (review.verdict === 'pass' || review.verdict === 'flag') continue;
    if (!APPLY) continue;

    // Delete the pool row (the new engine stores nothing for an ask/monologue).
    await sb.from('item_deliverables').delete().eq('id', d.id as string);
    // Strip the stamp if it rode this delegation (inbox items only carry prepared_by).
    if (kind === 'email') {
      const { data: it } = await sb.from('inbox_items').select('source_data').eq('id', entityId).maybeSingle();
      const sd = (it?.source_data ?? {}) as Record<string, unknown>;
      if (sd.prepared_by) {
        const { prepared_by: _pb, ...rest } = sd;
        await sb.from('inbox_items').update({ source_data: rest }).eq('id', entityId);
      }
    }
    // needs_input → the ask lands as the durable checklist turn (the new engine's shape), replacing
    // the old plain narration via the same dedupe key.
    if (review.verdict === 'needs_input' && review.missing?.length) {
      let role: string | null = null;
      if (meta.agentId) {
        const { data: ag } = await sb.from('custom_agents').select('worker_role').eq('id', meta.agentId).maybeSingle();
        role = (ag?.worker_role as string) ?? null;
      }
      const itemKind = kind === 'commitment' ? 'commitment' as const : 'inbox' as const;
      const roomKey = await roomKeyForItem(sb, uid, itemKind, entityId);
      const first = (meta.agentName ?? 'Your coworker').split(' ')[0];
      await writeRoomTurn(sb, uid, roomKey, {
        role: 'system',
        text: `${first} needs a few things from you before this can be finished — attach or answer below.`,
        refs: [{ label: String(d.title ?? '').slice(0, 60), href: itemKind === 'commitment' ? `/item/${entityId}?kind=commitment` : `/item/${entityId}` }],
        author: meta.agentName ? { kind: 'coworker', id: meta.agentId ?? '', name: meta.agentName, role } : undefined,
        component: { key: 'input_checklist', state: { items: review.missing, taskId: (d.task_id as string) ?? null } },
        dedupeKey: `delegate:${entityId}:${(d.task_id as string) ?? 'item'}`,
      });
    }
    touched.add(uid);
  }
  if (APPLY) {
    for (const uid of touched) {
      await sb.from('profiles').update({ home_brief: null }).eq('id', uid);
      console.log('busted home_brief for', uid.slice(0, 8));
    }
  }
  console.log(APPLY ? 'done' : 'dry-run done (re-run with --apply)');
})();
