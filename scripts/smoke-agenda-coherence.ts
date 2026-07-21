// THE AGENDA SPINE (Living-Home S1) — coherence smoke. Two layers:
//   1. PURE SCENARIOS (no AI, no DB) — the invariants the spine must hold: rows == what renders, atoms ==
//      the underlying volume, bundling collapses ≥2 only, urgency ordering, sentenced de-dup keeps the
//      hero, atom order expands bundles, lens stability.
//   2. REAL DATA (cross-user, no AI) — build each user's atoms from their live rows + the REAL server
//      bundling (computeBundles) → buildAgenda → the same invariants over real shapes.
//   3. LEAD ANCHOR (real AI, 2 users) — compose with agenda-ordered actions → the lead references {A1}
//      (the deck's first actionable) somewhere in lead/action, so prose and hero point at the same thing.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { buildAgenda, agendaAtomOrder, type DoItem, type Priority, type SlippingDeal } from '../lib/home/agenda';
import { computeBundles, type BundleAtom } from '../lib/home/bundle-brief';
import { composeBriefing, type BriefingInputs } from '../lib/briefing/compose';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);

const T = '2026-07-20';
const reply = (id: string, over: Partial<DoItem> = {}): DoItem => ({ source: 'reply', key: `r-${id}`, entityId: id, href: `/item/${id}`, ask: `reply ${id}`, ...over });
const commit = (id: string, over: Partial<DoItem> = {}): DoItem => ({ source: 'commitment', key: `c-${id}`, entityId: id, href: `/item/${id}`, ask: `commit ${id}`, ...over });

// ── 1 · PURE SCENARIOS ───────────────────────────────────────────────────────────────────────────
{
  // S1a — bundling: 3 of 5 atoms share a bundle → 3 rows (1 bundle + 2 singles), 5 atoms, first defined.
  const atoms = [reply('a1'), reply('a2'), reply('a3'), commit('a4'), commit('a5')];
  const bundles = { a1: { key: 'e:x', label: 'Deal X' }, a2: { key: 'e:x', label: 'Deal X' }, a4: { key: 'e:x', label: 'Deal X' } };
  const ag = buildAgenda({ replyItems: atoms.slice(0, 3), noticeItems: [], commitItems: atoms.slice(3), priorityCards: [], deals: [], bundles, bundleNames: {}, sort: 'urgent', todayISO: T });
  check('S1a rows = visible entries (bundle counts once)', ag.rows === ag.entries.length && ag.rows === 3, `rows=${ag.rows}`);
  check('S1a atoms = underlying volume', ag.atoms === 5, `atoms=${ag.atoms}`);
  check('S1a first = entries[0]', !!ag.first && ag.first.key === ag.entries[0].key);
  check('S1a atom order expands bundle members', agendaAtomOrder(ag).length === 5, `${agendaAtomOrder(ag).length}`);

  // S1b — a bundle whose live membership drops to 1 renders as a plain row (no 1-item bundle).
  const ag2 = buildAgenda({ replyItems: [reply('a1')], noticeItems: [], commitItems: [commit('a5')], priorityCards: [], deals: [], bundles, bundleNames: {}, sort: 'urgent', todayISO: T });
  check('S1b 1-member bundle renders single', ag2.entries.every((e) => e.kind === 'single') && ag2.rows === 2);

  // S1c — dismissal coherence: removing an atom shrinks rows+atoms together.
  check('S1c dismissal shrinks both counts', ag.atoms - ag2.atoms === 3 && ag.rows - ag2.rows === 1);

  // S1d — urgency: an OVERDUE commitment outranks undated replies; it is `first` under the Urgent lens.
  const ag3 = buildAgenda({ replyItems: [reply('b1'), reply('b2')], noticeItems: [], commitItems: [commit('b3', { overdue: true, dueDate: '2026-07-10' })], priorityCards: [], deals: [], bundles: {}, bundleNames: {}, sort: 'urgent', todayISO: T });
  check('S1d overdue leads the Urgent lens', ag3.first?.kind === 'single' && ag3.first.item.entityId === 'b3');

  // S1e — Important lens: verdict weight leads; a bundle carries its max member weight.
  const ag4 = buildAgenda({ replyItems: [reply('c1'), reply('c2'), reply('c3')], noticeItems: [], commitItems: [], priorityCards: [], deals: [], bundles: { c2: { key: 'e:y', label: 'Y' }, c3: { key: 'e:y', label: 'Y' } }, bundleNames: {}, sort: 'important', weights: { c1: 10, c2: 5, c3: 80 }, todayISO: T });
  check('S1e Important: bundle takes max member weight', ag4.first?.kind === 'bundle', ag4.first?.kind ?? 'none');

  // S1f — sentenced de-dup: sentenced items leave the deck but the hero (first) is kept.
  const ag5 = buildAgenda({ replyItems: [reply('d1'), reply('d2'), reply('d3')], noticeItems: [], commitItems: [], priorityCards: [], deals: [], bundles: {}, bundleNames: {}, sentencedIds: new Set(['d1', 'd2']), sort: 'urgent', todayISO: T });
  check('S1f sentenced leave, hero kept', ag5.rows === 2 && ag5.entries.some((e) => e.kind === 'single' && e.item.entityId === 'd1'), `rows=${ag5.rows}`);

  // S1g — empty input → calm zero.
  const ag6 = buildAgenda({ replyItems: [], noticeItems: [], commitItems: [], priorityCards: [], deals: [], bundles: {}, bundleNames: {}, sort: 'urgent', todayISO: T });
  check('S1g empty → rows 0, first null', ag6.rows === 0 && ag6.atoms === 0 && ag6.first === null);

  // S1h — cards + deals count as one row AND one atom each (mirrors the server's needYou unit).
  const card: Priority = { id: 'p1', source: 'meeting', posture: 'to_do', title: 'Review meeting', context: null, href: '/x', items: [{ id: 'i1', text: 't' }, { id: 'i2', text: 't' }] };
  const deal: SlippingDeal = { key: 'e-1', label: 'Deal', momentum: 'stalled', summary: 's', weight: 30, nextMove: null };
  const ag7 = buildAgenda({ replyItems: [reply('e1')], noticeItems: [], commitItems: [], priorityCards: [card], deals: [deal], bundles: {}, bundleNames: {}, sort: 'urgent', todayISO: T });
  check('S1h cards/deals: 1 row + 1 atom each', ag7.rows === 3 && ag7.atoms === 3, `rows=${ag7.rows} atoms=${ag7.atoms}`);
}

// ── 2 · REAL DATA (cross-user, no AI) ────────────────────────────────────────────────────────────
async function usersWithMemory(): Promise<string[]> {
  const { data } = await sb.from('work_entities').select('user_id').eq('kind', 'initiative').limit(5000);
  return [...new Set((data ?? []).map((e: any) => e.user_id as string))];
}

type RealInputs = { replies: DoItem[]; commits: DoItem[]; bundles: Record<string, { key: string; label: string }>; weights: Record<string, number>; actions: BriefingInputs['actions'] };
async function buildReal(uid: string): Promise<RealInputs> {
  const { data: items } = await sb.from('inbox_items').select('id, work_title, rule_type, status, source_data, source_id').eq('user_id', uid).eq('source', 'email').order('created_at', { ascending: false }).limit(150);
  const live = ((items ?? []) as any[]).filter((it) => it.status !== 'completed' && it.status !== 'dismissed' && (it.rule_type === 'needs_reply' || ['reply', 'action'].includes(it.source_data?.understanding?.relevance))).slice(0, 15);
  const { data: commitRows } = await sb.from('commitments').select('id, description, counterparty, due_date, overdue, status, source, source_id').eq('user_id', uid).in('status', ['open', 'pending']).limit(12);
  const commitsArr = (commitRows ?? []) as any[];
  const ids = [...live.map((l) => l.id), ...commitsArr.map((c) => c.id)];
  const { data: links } = await sb.from('entity_links').select('item_id, entity_id').eq('user_id', uid).in('item_kind', ['inbox_item', 'commitment']).in('item_id', ids).not('entity_id', 'is', null);
  const { data: ents } = await sb.from('work_entities').select('id, name, priority').eq('user_id', uid).eq('kind', 'initiative').eq('status', 'active');
  const entById = new Map((ents ?? []).map((e: any) => [e.id, e]));
  const linkByAtom = new Map((links ?? []).map((l: any) => [l.item_id, l.entity_id]));
  // The REAL server bundling over the same atoms.
  const bundleAtoms: BundleAtom[] = [
    ...live.map((it): BundleAtom => { const eid = linkByAtom.get(it.id); const e = eid ? entById.get(eid) : null; return { id: it.id, entity: e ? { id: e.id, name: e.name } : null, threadId: it.source_data?.thread_id ?? null, subject: it.work_title ?? null }; }),
    ...commitsArr.map((c): BundleAtom => { const eid = linkByAtom.get(c.id); const e = eid ? entById.get(eid) : null; return { id: c.id, entity: e ? { id: e.id, name: e.name } : null, meetingId: c.source === 'meeting' ? c.source_id : null }; }),
  ];
  const bundles = computeBundles(bundleAtoms);
  const weights: Record<string, number> = {};
  for (const id of ids) { const e = entById.get(linkByAtom.get(id)); if (e?.priority?.weight) weights[id] = Number(e.priority.weight); }
  const replies = live.map((it: any): DoItem => ({ source: 'reply', key: `r-${it.id}`, entityId: it.id, href: `/item/${it.id}`, ask: String(it.work_title || ''), primary: it.source_data?.from_name ?? null, dueDate: it.source_data?.understanding?.deadline ?? null }));
  const commits = commitsArr.map((c: any): DoItem => ({ source: 'commitment', key: `c-${c.id}`, entityId: c.id, href: `/item/${c.id}`, ask: String(c.description || ''), overdue: !!c.overdue, dueDate: c.due_date ?? null }));
  const actions: BriefingInputs['actions'] = [
    ...live.map((it: any) => ({ itemId: it.id, itemKind: 'inbox_item' as const, who: it.source_data?.from_name ?? null, ask: String(it.work_title || ''), move: null, entityId: linkByAtom.get(it.id) ?? null, entityName: entById.get(linkByAtom.get(it.id))?.name ?? null, weight: weights[it.id] ?? 20, overdue: false, dueDate: null, href: `/item/${it.id}?kind=email` })),
    ...commitsArr.map((c: any) => ({ itemId: c.id, itemKind: 'commitment' as const, who: c.counterparty ?? null, ask: String(c.description || ''), move: null, entityId: linkByAtom.get(c.id) ?? null, entityName: entById.get(linkByAtom.get(c.id))?.name ?? null, weight: weights[c.id] ?? 18, overdue: !!c.overdue, dueDate: c.due_date ?? null, href: `/item/${c.id}?kind=commitment` })),
  ];
  return { replies, commits, bundles, weights, actions };
}

(async () => {
  const users = await usersWithMemory();
  const firstIds = new Map<string, string>(); // uid → agenda-first actionable itemId (for the AI gate)
  for (const uid of users) {
    const u = uid.slice(0, 8);
    const real = await buildReal(uid);
    if (!real.replies.length && !real.commits.length) { check(`${u}: real-data coherence`, true, 'skipped — nothing live'); continue; }
    for (const sort of ['urgent', 'important', 'quick'] as const) {
      const ag = buildAgenda({ replyItems: real.replies, noticeItems: [], commitItems: real.commits, priorityCards: [], deals: [], bundles: real.bundles, bundleNames: {}, sort, weights: real.weights });
      const keys = ag.entries.map((e) => e.key);
      const atomsListed = agendaAtomOrder(ag).length;
      const ok = ag.rows === ag.entries.length && new Set(keys).size === keys.length
        && ag.atoms === real.replies.length + real.commits.length && atomsListed === ag.atoms
        && (ag.rows === 0 ? ag.first === null : ag.first?.key === ag.entries[0].key) && ag.rows <= ag.atoms;
      check(`${u}: coherent under '${sort}' (rows=${ag.rows} atoms=${ag.atoms})`, ok);
      if (sort === 'urgent') { const first = agendaAtomOrder(ag)[0]; if (first) firstIds.set(uid, first); }
    }
    // Ordering the compose actions by the agenda puts the deck-first actionable at A1.
    const ag = buildAgenda({ replyItems: real.replies, noticeItems: [], commitItems: real.commits, priorityCards: [], deals: [], bundles: real.bundles, bundleNames: {}, sort: 'urgent', weights: real.weights });
    const orderIdx = new Map(agendaAtomOrder(ag).map((id, i) => [id, i]));
    const sorted = [...real.actions].sort((a, b) => (orderIdx.get(a.itemId) ?? 1e9) - (orderIdx.get(b.itemId) ?? 1e9));
    check(`${u}: A1 == deck-first actionable`, sorted[0]?.itemId === firstIds.get(uid), sorted[0]?.itemId?.slice(0, 8) ?? 'none');
  }

  // ── 3 · LEAD ANCHOR (real AI, first 2 users with data) ──
  let aiChecked = 0;
  for (const uid of users) {
    if (aiChecked >= 2) break;
    const u = uid.slice(0, 8);
    const real = await buildReal(uid);
    if (!real.actions.length) continue;
    const ag = buildAgenda({ replyItems: real.replies, noticeItems: [], commitItems: real.commits, priorityCards: [], deals: [], bundles: real.bundles, bundleNames: {}, sort: 'urgent', weights: real.weights });
    const orderIdx = new Map(agendaAtomOrder(ag).map((id, i) => [id, i]));
    const actions = [...real.actions].sort((a, b) => (orderIdx.get(a.itemId) ?? 1e9) - (orderIdx.get(b.itemId) ?? 1e9));
    const { data: prof } = await sb.from('profiles').select('full_name').eq('id', uid).maybeSingle();
    const b = await composeBriefing(sb, uid, {
      todayStr: new Date().toISOString().slice(0, 10), firstName: String(prof?.full_name || 'there').split(' ')[0],
      actions, watch: [], moving: { count: 0, closest: null }, schedule: [],
      counts: { needYou: actions.length, cleared: 0, fromTeam: 0, followUps: 0, fyi: 0 }, prior: null,
    });
    if (!b) { check(`${u}: composed for anchor gate`, false); aiChecked++; continue; }
    const leadPlusAction = `${b.lead.text}\n${b.action.text}`;
    check(`${u}: prose anchors on the deck's first ({A1} present)`, /\{A1\}/.test(leadPlusAction), b.lead.text.slice(0, 80));
    aiChecked++;
  }

  console.log('\n════ AGENDA COHERENCE GATES ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  (${d})` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();
