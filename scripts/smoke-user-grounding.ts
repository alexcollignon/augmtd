// smoke-user-grounding.ts — W2.2 ONE USER GROUNDING gate (invariant 5, ONE READER PER OBJECT).
//
// ZERO AI. Default run is ZERO DB (source floors + pure checks) so it can sit on the board.
// `--live` adds a READ-ONLY census (no reconcile, no cache derive): for the owner account + two
// others, the OLD ask-lane "replies you owe" count (raw rule_type/relevance over the last 60 mails)
// vs the NEW judged set the one grounding serves. Numbers only.
//
// Run: npx tsx scripts/smoke-user-grounding.ts [--live]
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);

function walk(dir: string, files: string[] = []): string[] {
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return files; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, files);
    else if (/\.(ts|tsx)$/.test(e)) files.push(p);
  }
  return files;
}
const rel = (f: string) => f.replace(ROOT + '/', '');
const treeFiles = ['lib', 'app', 'components'].flatMap((d) => walk(join(ROOT, d)));

(async () => {
  // ── SOURCE FLOORS ─────────────────────────────────────────────────────────────────────────────
  const ask = src('lib/home/ask.ts');
  check('UG1: the Home-ask lane builds NO private world — no raw rule_type/relevance reply filter, no own commitment read',
    !ask.includes("rule_type === 'needs_reply'") && !ask.includes("relevance === 'reply'")
    && !ask.includes("from('commitments')") && !ask.includes("from('inbox_items')") && !ask.includes('REPLIES YOU OWE'),
  );
  check('UG2: the Home-ask snapshot reads the ONE user grounding (and still threads the focus through the room grounding)',
    ask.includes("import('@/lib/room/user-grounding')") && ask.includes('assembleUserGrounding(supabase, userId)')
    && ask.includes('assembleRoomGrounding') && ask.includes('buildBrainSnapshot(supabase, userId, question)'));

  // Every user-scope world consumer imports the one door; the old private renderer is gone.
  const consumers = ['app/api/work/threads/[id]/chat/route.ts', 'lib/work/agentos-bridge.ts', 'lib/home/ask.ts'];
  for (const f of consumers) {
    const t = src(f);
    check(`UG3: ${f} reads assembleUserGrounding`, t.includes('assembleUserGrounding') && !t.includes('renderWorldContext'));
  }
  {
    const offenders = treeFiles.filter((f) => /renderWorldContext\s*\(|function renderWorldContext/.test(src(rel(f)))).map(rel);
    check('UG4: renderWorldContext is neither defined nor called anywhere in lib/app/components', offenders.length === 0, offenders.join(', '));
  }

  // The drafter's wider work comes from the entity link, never the classifier's label.
  {
    const bc = src('lib/context/brain-context.ts');
    check('UG5: renderBrainContext resolves THE WIDER WORK through entity_links (no initiative-label string match)',
      bc.includes("from('entity_links')") && !bc.includes('opts.initiative') && !bc.includes('nk(e.name) === want'));
    const dr = src('lib/inbox/draft-reply.ts');
    check('UG6: the drafter passes the item/thread, not understanding.initiative',
      !dr.includes('initiative: understanding?.initiative') && /renderBrainContext\(client, userId, \{[^}]*threadId/.test(dr));
  }

  // ONE open-commitment status constant: no NEW local list outside lib/core/statuses.ts.
  {
    const allowed = new Set([
      'lib/core/statuses.ts',
      // W2.1's fence (grounding.ts reads `.eq('status','open')` — narrower, documented in statuses.ts).
      'lib/room/grounding.ts',
      // The brief route (owned by another wave) reads `.eq('status','open')` for its own pool.
      'app/api/home/brief/route.ts',
      // DO-NOT-TOUCH this wave (already the union semantically) — fold on their next open.
      'lib/work/judge.ts',
      'components/home/item-detail.tsx',
    ]);
    const localList = /\[\s*'open'\s*,\s*'pending'(\s*,\s*'in_progress')?\s*\]/;
    const offenders = treeFiles.filter((f) => !allowed.has(rel(f)) && localList.test(src(rel(f)))).map(rel);
    check("UG7: no local ['open','pending'(,'in_progress')] commitment-status list outside lib/core/statuses.ts", offenders.length === 0, offenders.join(', '));
    const model = src('lib/work-items/model.ts');
    check('UG8: the spine fetches AND tests openness on the ONE constant',
      model.includes('[...OPEN_COMMITMENT_STATUSES]') && model.includes('isOpenCommitmentStatus(c.status'));
    check('UG9: the brief per-person map reads the ONE constant', src('lib/home/brief-context.ts').includes('[...OPEN_COMMITMENT_STATUSES]'));
  }

  // The grounding's own contract: spine + deck floors, excerpt-honest, budgeted, no raw slice.
  {
    const ug = src('lib/room/user-grounding.ts');
    check('UG10: WORK YOU OWE = the spine (buildWorkItems) gated by the deck floors (deckEligible + readJudgedNone), never raw rule_type',
      ug.includes("import('@/lib/work-items/model')") && ug.includes('deckEligible(') && ug.includes('readJudgedNone(')
      && ug.includes('classifyItem(') && !/rule_type\s*===/.test(ug));
    check('UG11: excerpt-honest and budgeted (clipForPrompt/clipLabel, a declared drop, no raw .slice on prose)',
      ug.includes('clipForPrompt(') && ug.includes('more not shown') && !/summary\.slice\(|title\.slice\(/.test(ug));
    check('UG12: other projects\' CONTENT can be kept out of a room (projectDepth: names)', ug.includes("projectDepth?: 'state' | 'names'") && ug.includes('names only'));
  }

  // ── PURE CHECKS (the renderer's laws, on fixtures) ────────────────────────────────────────────
  {
    const { renderUserGrounding, sortOwed, isLiveWorkItem } = await import('../lib/room/user-grounding');
    const { placedTags } = await import('../lib/home/ask-refs');
    const facts = {
      todayStr: '2026-09-22',
      owed: [
        { id: 'a', ref: 'inbox' as const, kind: 'reply' as const, title: 'Reply to Sam', who: 'Sam', due: null, bucket: 'this_week', project: null, href: '/item/a', priority: 30 },
        { id: 'b', ref: 'commitment' as const, kind: 'commitment' as const, title: 'Send deck', who: 'Sam', due: '2026-09-20', bucket: 'overdue', project: 'Acme', href: '/', priority: 50 },
      ].sort(sortOwed),
      waiting: [], projects: [], people: [], scheduleBlock: null, calendarWindowBlock: null, deeds: [], notes: [],
    };
    const r = renderUserGrounding(facts);
    check('UG13 pure: overdue promise leads; tags [C1]/[R1] resolve by id', r.text.indexOf('[C1]') < r.text.indexOf('[R1]') && r.refs.get('C1')?.id === 'b' && r.refs.get('R1')?.id === 'a');
    check('UG14 pure: every placed tag is a served ref', placedTags(r.text).every((t) => r.refs.has(t)));
    check('UG15 pure: an automated/done/team row is never live', !isLiveWorkItem({ state: 'todo', automated: true, actor: 'you' }) && !isLiveWorkItem({ state: 'done', automated: false, actor: 'you' }) && !isLiveWorkItem({ state: 'todo', automated: false, actor: 'team' }));
    const big = renderUserGrounding({ ...facts, owed: Array.from({ length: 300 }, (_, i) => ({ ...facts.owed[0], id: `o${i}`, title: `Obligation ${i} with a long enough title to push the page over its budget` })) });
    check('UG16 pure: the budget holds and the drop is declared', big.text.length <= 6500 && /more not shown/.test(big.text));
  }

  // ── LIVE CENSUS (read-only, opt-in) ───────────────────────────────────────────────────────────
  if (process.argv.includes('--live')) {
    const { config } = await import('dotenv'); config({ path: join(ROOT, '.env.local') });
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { assembleUserGrounding } = await import('../lib/room/user-grounding');
    const OWNER = '08fe4449-e5eb-431d-9156-02e9324e5903';
    // Two other accounts with the most recent mail — deterministic, no names.
    const { data: recent } = await sb.from('inbox_items').select('user_id').eq('source', 'email')
      .neq('user_id', OWNER).order('created_at', { ascending: false }).limit(400);
    const others = [...new Set(((recent ?? []) as Array<{ user_id: string }>).map((r) => r.user_id))].slice(0, 2);
    console.log('\nLIVE CENSUS (read-only) — OLD ask-lane "replies you owe" vs NEW judged set');
    for (const uid of [OWNER, ...others]) {
      const { data: items } = await sb.from('inbox_items').select('id, status, rule_type, source_data')
        .eq('user_id', uid).eq('source', 'email').order('created_at', { ascending: false }).limit(60);
      const old = ((items ?? []) as Array<{ status: string; rule_type: string | null; source_data: { understanding?: { relevance?: string } } | null }>)
        .filter((it) => it.status !== 'completed' && it.status !== 'dismissed' && (it.rule_type === 'needs_reply' || it.source_data?.understanding?.relevance === 'reply')).length;
      const t0 = Date.now();
      const g = await assembleUserGrounding(sb, uid, { readOnly: true });
      const ms = Date.now() - t0;
      const replies = g.facts.owed.filter((o) => o.kind === 'reply').length;
      const actions = g.facts.owed.filter((o) => o.kind === 'action').length;
      const promises = g.facts.owed.filter((o) => o.kind === 'commitment').length;
      const meetings = g.facts.owed.filter((o) => o.kind === 'meeting').length;
      console.log(`  ${uid.slice(0, 8)}${uid === OWNER ? ' (owner)' : ''}: OLD replies-you-owe (last 60 mails, raw) = ${Math.min(old, 12)} of ${old} eligible`
        + ` → NEW judged: replies ${replies} · actions ${actions} · promises ${promises} · meeting follow-ups ${meetings} · waiting ${g.facts.waiting.length}`
        + ` · projects ${g.facts.projects.length} · people ${g.facts.people.length} · page ${g.text.length} chars${Object.keys(g.omitted).length ? ` (dropped ${JSON.stringify(g.omitted)})` : ''} · ${ms}ms`
        + `${g.facts.notes.length ? ` · notes: ${g.facts.notes.join('; ')}` : ''}`);
    }
  }

  // ── REPORT ────────────────────────────────────────────────────────────────────────────────────
  let fails = 0;
  for (const [n, ok, d] of out) { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} · ${n}${d ? ` — ${d}` : ''}`); }
  console.log(`\nsmoke-user-grounding: ${out.length - fails}/${out.length}`);
  process.exit(fails ? 1 : 0);
})();
