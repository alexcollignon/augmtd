// PHASE C CUTOVER #1 smoke — the deck's "Important" lens on ENTITY priorities. Cross-user:
//   1. Pair-verdict memory (20260721c applied): reflection run A re-judges+persists, run B must be 0 AI.
//   2. Coverage: how many of the deck's weighted atoms (needs-reply items + open commitments) resolve an
//      entity priority vs fall back to the person-verdict formula.
//   3. BEFORE vs AFTER: the Important top-5 under the formula vs under entity priorities — with reasons.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { reflectEntities } from '../lib/entities/reflect';
import { personVerdict, type PersonRow } from '../lib/brains/verdict';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const emailOf = (s?: string | null) => String(s || '').toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || null;
const USERS = ['08fe4449-e5eb-431d-9156-02e9324e5903', 'c723c2f2-e069-4ab8-980e-ac3585028fec'];

(async () => {
  for (const uid of USERS) {
    // ── 1. Pair-verdict memory ──
    const beforeA = new Date().toISOString();
    await reflectEntities(sb, uid, { commit: true });
    const { data: uA } = await sb.from('ai_usage_events').select('id').eq('user_id', uid).gte('created_at', beforeA).eq('source', 'brain_synthesis');
    const beforeB = new Date().toISOString();
    await reflectEntities(sb, uid, { commit: true });
    const { data: uB } = await sb.from('ai_usage_events').select('id').eq('user_id', uid).gte('created_at', beforeB).eq('source', 'brain_synthesis');
    console.log(`\n════ user ${uid.slice(0, 8)} ════`);
    console.log(`  1. reflection pair-memory: runA judged ${(uA ?? []).length} pairs → runB ${(uB ?? []).length} ${(uB ?? []).length === 0 ? '✓ zero (remembered)' : '⚠️'}`);

    // ── 2+3. Deck atoms: needs-reply items + open commitments (what the Important lens weighs). ──
    const { data: items } = await sb.from('inbox_items').select('id, work_title, source_data, rule_type, status').eq('user_id', uid).eq('source', 'email').order('created_at', { ascending: false }).limit(200);
    const mr = ((items ?? []) as any[]).filter((it) => it.status !== 'completed' && it.status !== 'dismissed' && (it.rule_type === 'needs_reply' || it.source_data?.understanding?.relevance === 'reply')).slice(0, 25);
    const { data: commits } = await sb.from('commitments').select('id, description').eq('user_id', uid).in('status', ['open', 'pending']).limit(25);
    type Atom = { id: string; label: string; who: string | null };
    const atoms: Atom[] = [
      ...mr.map((it: any) => ({ id: it.id, label: String(it.work_title || '').slice(0, 40), who: it.source_data?.from_name ?? null })),
      ...((commits ?? []) as any[]).map((c) => ({ id: c.id, label: String(c.description || '').slice(0, 40), who: null })),
    ];

    // OLD weights: person-verdict formula (must-respond senders only — as before the cutover).
    const oldW = new Map<string, number>();
    const keys = [...new Set(mr.map((it: any) => emailOf(it.source_data?.from_address || it.source_data?.from)).filter(Boolean) as string[])];
    if (keys.length) {
      const { data: ps } = await sb.from('person_state').select('person_key, state, next_touch, quiet_days').eq('user_id', uid).in('person_key', keys);
      const byKey = new Map(((ps ?? []) as any[]).map((r) => [r.person_key, personVerdict(r as PersonRow).weight]));
      for (const it of mr) { const k = emailOf(it.source_data?.from_address || it.source_data?.from); if (k && byKey.has(k)) oldW.set(it.id, byKey.get(k)!); }
    }
    // NEW weights: entity priority via links (the cutover path).
    const { data: elinks } = await sb.from('entity_links').select('item_id, entity_id').eq('user_id', uid)
      .in('item_kind', ['inbox_item', 'commitment']).in('item_id', atoms.map((a) => a.id)).not('entity_id', 'is', null);
    const entIds = [...new Set((elinks ?? []).map((l: any) => l.entity_id))];
    const { data: ents } = await sb.from('work_entities').select('id, name, priority').in('id', entIds);
    const prio = new Map((ents ?? []).map((e: any) => [e.id, e]));
    const newW = new Map<string, { w: number; ent: string; reason: string }>();
    for (const l of (elinks ?? []) as any[]) {
      const e = prio.get(l.entity_id);
      if (typeof e?.priority?.weight === 'number') newW.set(l.item_id, { w: e.priority.weight, ent: e.name, reason: e.priority.reason ?? '' });
    }

    console.log(`  2. coverage: ${newW.size}/${atoms.length} deck atoms carry an ENTITY priority (rest → formula fallback ${oldW.size})`);
    const top = (m: (a: Atom) => number) => [...atoms].sort((a, b) => m(b) - m(a)).slice(0, 5);
    console.log(`  3. IMPORTANT top-5 BEFORE (formula):`);
    for (const a of top((x) => oldW.get(x.id) ?? 0)) console.log(`     ${String(oldW.get(a.id) ?? 0).padStart(3)}  ${(a.who ? a.who + ' · ' : '')}${a.label}`);
    console.log(`     IMPORTANT top-5 AFTER (entity priority, reasoned):`);
    for (const a of top((x) => newW.get(x.id)?.w ?? oldW.get(x.id) ?? 0)) {
      const n = newW.get(a.id);
      console.log(`     ${String(n?.w ?? oldW.get(a.id) ?? 0).padStart(3)}  ${(a.who ? a.who + ' · ' : '')}${a.label}${n ? `  [${n.ent.slice(0, 24)}: ${n.reason.slice(0, 38)}]` : '  [formula]'}`);
    }
  }
})();
