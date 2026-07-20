// ONE BRAIN — CONSOLIDATED END-TO-END SCENARIO MATRIX. Every subsystem, cross-user, PASS/FAIL. Read-mostly
// (one temp probe link, cleaned). The single script to re-run after any One Brain change.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { recognizeItem } from '../lib/entities/recognize';
import { shadowRecognizeTouched } from '../lib/entities/hooks';
import { getPersonEntities, findPersonEntity } from '../lib/entities/people';
import { renderBrainContext, renderWorldContext } from '../lib/context/brain-context';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const EVAL = '08fe4449-e5eb-431d-9156-02e9324e5903';
const EVAL2 = 'c723c2f2-e069-4ab8-980e-ac3585028fec';
const NONEVAL = 'e009a499-41d4-4c44-ad53-53a0e851d143'; // has person entities but NO initiative memory

const out: Array<[string, boolean, string]> = [];
const check = (name: string, ok: boolean, detail = '') => { out.push([name, ok, detail]); };

(async () => {
  // ── 1. RECOGNITION idempotency: an already-linked item returns instantly, no AI. ──
  {
    const { data: link } = await sb.from('entity_links').select('item_id, entity_id, via').eq('user_id', EVAL).eq('item_kind', 'inbox_item').not('entity_id', 'is', null).limit(1);
    const l = link?.[0];
    const t0 = Date.now();
    const r = l ? await recognizeItem(sb, EVAL, { kind: 'inbox_item', id: l.item_id, title: 'x' }) : null;
    check('recognition: linked item short-circuits', !!r && r.entityId === l!.entity_id && Date.now() - t0 < 800, `${Date.now() - t0}ms`);
  }
  // ── 2. Refusal memory: a via='none' item returns 'none' with no AI. ──
  {
    const { data: none } = await sb.from('entity_links').select('item_id').eq('user_id', EVAL).eq('via', 'none').limit(1);
    const r = none?.[0] ? await recognizeItem(sb, EVAL, { kind: 'inbox_item', id: none[0].item_id, title: 'x' }) : null;
    check('recognition: refusal remembered', !!r && r.via === 'none' && r.entityId === null);
  }
  // ── 3. Structural thread inheritance (probe, cleaned). ──
  {
    const { data: tl } = await sb.from('entity_links').select('item_id, entity_id').eq('user_id', EVAL2).eq('item_kind', 'email_thread').limit(1);
    if (tl?.[0]) {
      const r = await recognizeItem(sb, EVAL2, { kind: 'inbox_item', id: 'e2e-probe-structural', title: 'Re: probe', threadId: tl[0].item_id });
      check('recognition: structural inheritance', r.via === 'structural' && r.entityId === tl[0].entity_id);
      await sb.from('entity_links').delete().eq('user_id', EVAL2).eq('item_id', 'e2e-probe-structural');
    } else check('recognition: structural inheritance', false, 'no thread link found');
  }
  // ── 4. Live hook: post-universal-rollout, EVERY connected user has memory → the hook runs for all.
  // (The gate still exists for a truly-new user pre-bootstrap; bootstrapMemory converges them.) ──
  {
    const since = new Date(Date.now() - 3 * 86400000).toISOString();
    const rMem = await shadowRecognizeTouched(sb, EVAL, since);
    const rAll = await shadowRecognizeTouched(sb, NONEVAL, since);
    check('live hook: memory user runs', rMem !== null, `ran ${rMem?.ran ?? 0}`);
    check('live hook: post-rollout user runs too', rAll !== null, `ran ${rAll?.ran ?? 0}`);
  }
  // ── 5. Entity states: reasoned priority present, calibrated (no 80+ flood), honest no-moves. ──
  {
    const { data: ents } = await sb.from('work_entities').select('state, next_move, priority').eq('user_id', EVAL).eq('kind', 'initiative').not('state', 'is', null);
    const rows = (ents ?? []) as any[];
    const withP = rows.filter((r) => typeof r.priority?.weight === 'number');
    const high = withP.filter((r) => r.priority.weight >= 80).length;
    check('entity states: priorities present+reasoned', withP.length > 20 && withP.every((r) => (r.priority.reason || '').length > 0), `${withP.length} states`);
    check('entity states: calibration (80+ rare)', high <= Math.max(2, withP.length * 0.1), `${high} at 80+`);
    check('entity states: honest no-move exists', rows.some((r) => !r.next_move));
  }
  // ── 6. Deck weights: entity priority reaches the brief's atoms. ──
  {
    const { data: items } = await sb.from('inbox_items').select('id, rule_type, status, source_data').eq('user_id', EVAL).eq('source', 'email').order('created_at', { ascending: false }).limit(120);
    const mr = ((items ?? []) as any[]).filter((it) => it.status !== 'completed' && it.status !== 'dismissed' && (it.rule_type === 'needs_reply' || it.source_data?.understanding?.relevance === 'reply'));
    const { data: links } = await sb.from('entity_links').select('item_id, entity_id').eq('user_id', EVAL).eq('item_kind', 'inbox_item').in('item_id', mr.map((m: any) => m.id)).not('entity_id', 'is', null);
    check('deck: entity priorities cover live replies', (links ?? []).length >= Math.floor(mr.length * 0.6), `${(links ?? []).length}/${mr.length}`);
  }
  // ── 7. PROMINENCE (post-D: tracking is human-override; the portfolio LEADS with reasoned-alive work). ──
  {
    const { data: active } = await sb.from('work_entities').select('id, state, priority, last_event_at').eq('user_id', EVAL).eq('kind', 'initiative').eq('status', 'active').not('state', 'is', null);
    const nowMs = Date.now();
    const prominent = ((active ?? []) as any[]).filter((e) => {
      const w = e.priority?.weight ?? 0; const st = e.state ?? {}; const q = e.last_event_at ? (nowMs - new Date(e.last_event_at).getTime()) / 86400000 : 99;
      return w >= 40 || st.momentum === 'needs_you' || (st.momentum === 'active' && q <= 10) || ((st.whoOwes?.you?.length ?? 0) > 0 && q <= 21);
    }).length;
    check('portfolio: reasoned prominence leads', prominent >= 1 && prominent < (active ?? []).length, `${prominent}/${(active ?? []).length} prominent`);
  }
  // ── 8. Person entities: alias resolution (multi-address human → ONE entity), used by consumers. ──
  {
    const reg = await getPersonEntities(sb, EVAL2);
    const multi = reg.find((p) => p.aliases.filter((a) => a.includes('@')).length >= 3);
    const hit1 = multi ? findPersonEntity(reg, multi.aliases.find((a) => a.includes('@')), null) : null;
    const hit2 = multi ? findPersonEntity(reg, multi.aliases.filter((a) => a.includes('@'))[2] ?? null, null) : null;
    check('people: multi-address human = ONE entity', !!multi && hit1?.id === multi.id && hit2?.id === multi.id, multi ? `${multi.name}: ${multi.aliases.length} aliases` : 'none');
    const block = multi ? await renderBrainContext(sb, EVAL2, { personEmail: multi.aliases.find((a) => a.includes('@')) }) : '';
    check('people: drafter context renders from entity', block.includes(multi?.name ?? '∅'));
    const world = await renderWorldContext(sb, EVAL2);
    check('people: world context renders', world.length > 0);
  }
  // ── 9. UNIVERSAL MEMORY: every connected user has initiative entities + states (the demolition gate). ──
  {
    const { data: conns } = await sb.from('connections').select('user_id');
    const users = [...new Set((conns ?? []).map((c: { user_id: string }) => c.user_id))];
    let all = true;
    for (const uid of users) {
      const { count } = await sb.from('work_entities').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('kind', 'initiative').not('state', 'is', null);
      if ((count ?? 0) === 0) all = false;
    }
    check('universal: every connected user has memory+states', all, `${users.length} users`);
  }

  console.log('\n════ ONE BRAIN E2E MATRIX ════');
  let pass = 0;
  for (const [name, ok, detail] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`); }
  console.log(`\n${pass}/${out.length} scenarios pass`);
})();
