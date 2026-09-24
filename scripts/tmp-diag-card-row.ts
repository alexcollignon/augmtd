// READ-ONLY diagnosis of a walked row's BOARD SHAPE (never a write). Scratch tool, untracked.
//   npx tsx --env-file=.env.local scripts/tmp-diag-card-row.ts <title needle>
import { createClient } from '@supabase/supabase-js';
import { preparedBadge } from '../lib/prepare/read';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const needle = process.argv[2] ?? 'RIB';
  const byId = /^[0-9a-f]{8}/.test(needle);
  let q = sb.from('inbox_items')
    .select('id, user_id, work_title, work_state, status, source_data, created_at');
  q = byId ? q.gte('id', `${needle}-0000-0000-0000-000000000000`).lte('id', `${needle}-ffff-ffff-ffff-ffffffffffff`) : q.ilike('work_title', `%${needle}%`);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(6);
  if (byId) {
    const { data: c } = await sb.from('commitments').select('id, user_id, description, status, due_date, source, source_id')
      .gte('id', `${needle}-0000-0000-0000-000000000000`).lte('id', `${needle}-ffff-ffff-ffff-ffffffffffff`).limit(3);
    if (c?.length) console.log('COMMITMENT ROWS', JSON.stringify(c, null, 1));
  }
  if (error) { console.log('ERR', error.message); return; }
  if (!data?.length) console.log('no rows for needle', needle);
  for (const it of data ?? []) {
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    const draft = sd.draft as Record<string, unknown> | undefined;
    console.log('─────────────────────────────────────────────');
    console.log('id           ', it.id);
    console.log('title        ', it.work_title);
    console.log('work_state   ', it.work_state, '| status', it.status);
    console.log('itemSource   ', sd.source ?? '(none)');
    console.log('prepared_by  ', JSON.stringify(sd.prepared_by ?? null));
    console.log('draft?       ', !!draft, '| body chars', String(draft?.body ?? '').length);
    console.log('draft keys   ', draft ? Object.keys(draft).join(',') : '-');
    console.log('nudge_draft? ', !!sd.nudge_draft, '| invite?', !!sd.prepared_invite, '| forward?', !!sd.prepared_forward);
    console.log('preparedBadge→', preparedBadge(sd as never));
    const { data: jd } = await sb.from('item_plans').select('tasks')
      .eq('user_id', it.user_id).eq('kind', 'judgment').eq('entity_id', `inbox:${it.id}`).maybeSingle();
    const v = (jd?.tasks ?? {}) as Record<string, unknown>;
    console.log('verdict.work ', (v.verdict as any)?.work ?? v.work ?? JSON.stringify(v).slice(0, 200));
    console.log('verdict.req  ', JSON.stringify((v.verdict as any)?.requires ?? null), '| reason:', String((v.verdict as any)?.reason ?? '').slice(0,120));
    const { data: dels } = await sb.from('item_deliverables').select('id, type, title')
      .eq('user_id', it.user_id).eq('kind', 'email').eq('entity_id', it.id).limit(5);
    console.log('deliverables ', JSON.stringify(dels ?? []));
    // END-TO-END: the served deed shape + the room's card predicate, on the REAL row.
    const { mountsEmailCard } = await import('../lib/room/presentation');
    const { buildWorkItems } = await import('../lib/work-items/model');
    const items = await buildWorkItems(sb, it.user_id as string, { todayStr: new Date().toISOString().slice(0, 10), skipReconcile: true });
    const w = items.find((x) => (x as { entityId?: string }).entityId === it.id);
    const href = (w as { href?: string } | undefined)?.href ?? '(row not on the board)';
    const preparedKind = typeof draft?.body === 'string' && String(draft.body).trim() ? 'email_draft' as const : null;
    console.log('board row id ', (w as { id?: string } | undefined)?.id, '| entityId', (w as { entityId?: string } | undefined)?.entityId);
    console.log('board href   ', href);
    console.log('preparedKind ', preparedKind);
    // THE CARD'S OWN DOOR: would /api/inbox/<raw>/draft serve this row's stored draft?
    const { loadUserRules } = await import('../lib/inbox/rules/load');
    const { setInboxRules, shouldDraftReply } = await import('../lib/inbox/classify-item');
    const { isAutomatedSender } = await import('../lib/inbox/automated');
    const { data: full } = await sb.from('inbox_items')
      .select('source_data, work_title, work_state, rule_type, type_override, status, source')
      .eq('id', it.id).maybeSingle();
    try { setInboxRules(await loadUserRules(it.user_id as string, sb)); } catch {}
    console.log('from_address ', sd.from_address, '| subject', String(sd.subject ?? '').slice(0,60));
    console.log('automatedSender', isAutomatedSender((sd.from_address as string) || null, (sd.from_name as string) || null, (sd.subject as string) || ''));
    console.log('shouldDraftReply', shouldDraftReply(full as never));
    const { groundOf, groundMoved } = await import('../lib/prepare/ground');
    const { draftLawStale } = await import('../lib/inbox/attachment-context');
    const g = await groundOf(sb, it.user_id as string, { kind: 'inbox', id: it.id as string });
    console.log('groundMoved    ', groundMoved((draft as any)?.prepared_from ?? null, g), '| lawStale', draftLawStale((sd.draft as never) ?? null));
    console.log('mountsEmailCard →', mountsEmailCard({ href: String(href), preparedKind, source: (sd.source as string) ?? null }));
  }
}
main();
