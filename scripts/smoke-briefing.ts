// THE REASONED BRIEFING — S1 smoke (REAL AI, cross-user). Composes a live brief per user from real data
// and runs the qualitative gates the design demands:
//   • groundedness — every {ref} the model wrote exists in the candidate set (law 5)
//   • restatement  — no sentence is a subject-line parrot (law 1; token-overlap heuristic AS A TEST ONLY)
//   • repeat       — recompose with the first brief as `prior` → must not repeat verbatim (law 3)
//   • quiet-day    — empty-inputs compose must SAY it's quiet, not manufacture urgency (law 6)
//   • voice        — zero exclamation marks
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { composeBriefing, type BriefingInputs } from '../lib/briefing/compose';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const USERS = ['08fe4449-e5eb-431d-9156-02e9324e5903', 'c723c2f2-e069-4ab8-980e-ac3585028fec'];
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);

async function buildInputs(uid: string): Promise<{ inp: BriefingInputs; subjects: string[] }> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const { data: items } = await sb.from('inbox_items').select('id, work_title, rule_type, status, source_data').eq('user_id', uid).eq('source', 'email').order('created_at', { ascending: false }).limit(120);
  const live = ((items ?? []) as any[]).filter((it) => it.status !== 'completed' && it.status !== 'dismissed' && (it.rule_type === 'needs_reply' || ['reply', 'action'].includes(it.source_data?.understanding?.relevance)));
  const { data: links } = await sb.from('entity_links').select('item_id, entity_id').eq('user_id', uid).in('item_kind', ['inbox_item', 'commitment']).in('item_id', live.map((l: any) => l.id)).not('entity_id', 'is', null);
  const { data: ents } = await sb.from('work_entities').select('id, name, status, state, next_move, priority, last_event_at').eq('user_id', uid).eq('kind', 'initiative').eq('status', 'active').not('state', 'is', null);
  const entById = new Map((ents ?? []).map((e: any) => [e.id, e]));
  const linkByAtom = new Map((links ?? []).map((l: any) => [l.item_id, l.entity_id]));
  const deckEnts = new Set((links ?? []).map((l: any) => l.entity_id));
  const actions = live.slice(0, 12).map((it: any) => {
    const e = entById.get(linkByAtom.get(it.id));
    return {
      itemId: it.id, itemKind: 'inbox_item' as const, who: it.source_data?.from_name ?? null,
      ask: String(it.work_title || ''), move: e?.next_move?.title ?? null, entityName: e?.name ?? null,
      weight: e?.priority?.weight ?? 20, overdue: false, dueDate: it.source_data?.understanding?.deadline ?? null,
      href: `/item/${it.id}?kind=email`,
    };
  });
  const slipping = ((ents ?? []) as any[]).filter((e) => { const st = e.state ?? {}; return (st.momentum === 'gone_quiet' || st.momentum === 'stalled') && (st.whoOwes?.you?.length ?? 0) > 0 && !deckEnts.has(e.id); })
    .sort((a, b) => (b.priority?.weight ?? 0) - (a.priority?.weight ?? 0)).slice(0, 3)
    .map((e) => ({ entityId: e.id, name: e.name, summary: e.state.summary, move: e.next_move?.title ?? null, quietDays: e.last_event_at ? Math.floor((Date.now() - new Date(e.last_event_at).getTime()) / 86400000) : null, weight: e.priority?.weight ?? 20 }));
  const moving = ((ents ?? []) as any[]).filter((e) => !deckEnts.has(e.id) && ['active', 'waiting'].includes(e.state?.momentum) && e.state?.summary);
  const best = [...moving].sort((a, b) => (b.priority?.weight ?? 0) - (a.priority?.weight ?? 0))[0];
  const { data: prof } = await sb.from('profiles').select('full_name').eq('id', uid).maybeSingle();
  return {
    inp: {
      todayStr, firstName: String(prof?.full_name || 'there').split(' ')[0],
      actions, watch: slipping,
      moving: { count: moving.length, closest: best ? { entityId: best.id, name: best.name, summary: best.state.summary } : null },
      schedule: [], counts: { needYou: actions.length, cleared: 0, fromTeam: 0, followUps: 0, fyi: 0 }, prior: null,
    },
    subjects: live.map((it: any) => String(it.work_title || '')),
  };
}

const tokens = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
const overlap = (a: string, b: string) => { const A = tokens(a), B = tokens(b); if (!A.size || !B.size) return 0; let n = 0; for (const t of A) if (B.has(t)) n++; return n / Math.min(A.size, B.size); };

(async () => {
  for (const uid of USERS) {
    const { inp, subjects } = await buildInputs(uid);
    const b1 = await composeBriefing(sb, uid, inp);
    if (!b1) { check(`${uid.slice(0, 8)}: composed`, false); continue; }
    const all = [b1.lead.text, b1.action.text, b1.watchlist?.text ?? '', b1.pulse?.text ?? ''].join('\n');
    // Render for the eye: swap {refs} → [Name]
    const named = all.replace(/\{([AWP]\d+)\}/g, (_, id) => `[${b1.refs.find((r) => r.id === id)?.who ?? id}]`);
    console.log(`\n════ ${inp.firstName} (${uid.slice(0, 8)}) ════\n${named}\n  (tail: ${b1.tail.length} folded · refs: ${b1.refs.length})`);
    check(`${uid.slice(0, 8)}: composed`, true);
    check(`${uid.slice(0, 8)}: grounded (no invented refs)`, !/\{[AWP]\d+\}/.test(all.replace(/\{([AWP]\d+)\}/g, (m, id) => (b1.refs.some((r) => r.id === id) ? '' : m))));
    const worstOverlap = Math.max(...subjects.map((sub) => overlap(sub, all)), 0);
    check(`${uid.slice(0, 8)}: judges, not restates`, worstOverlap < 0.8, `max subject overlap ${(worstOverlap * 100).toFixed(0)}%`);
    check(`${uid.slice(0, 8)}: voice (no exclamation)`, !all.includes('!'));
    // Law 3: recompose with b1 as prior → not verbatim.
    const b2 = await composeBriefing(sb, uid, { ...inp, prior: { lead: b1.lead.text, action: b1.action.text, watchlist: b1.watchlist?.text, pulse: b1.pulse?.text } });
    check(`${uid.slice(0, 8)}: never repeats itself`, !!b2 && b2.lead.text !== b1.lead.text, b2 ? '' : 'recompose failed');
  }
  // Quiet-day honesty (synthetic empty inputs).
  const quiet = await composeBriefing(sb, USERS[0], {
    todayStr: new Date().toISOString().slice(0, 10), firstName: 'Sam',
    actions: [], watch: [], moving: { count: 0, closest: null }, schedule: [],
    counts: { needYou: 0, cleared: 3, fromTeam: 0, followUps: 0, fyi: 2 }, prior: null,
  });
  const ql = (quiet?.lead.text ?? '').toLowerCase();
  console.log(`\n════ quiet day ════\n${quiet?.lead.text ?? '(failed)'}`);
  check('quiet day: says quiet, no manufactured urgency', /quiet|clear|nothing|no .*need|caught up|light/.test(ql));

  console.log('\n════ BRIEFING GATES ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  (${d})` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
})();
