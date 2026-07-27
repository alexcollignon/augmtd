// THE WORK LOOP GATES (docs/work-loop-plan.md) — the proactive loop is visible, reliable, closed.
//   W1 — self-waiting heals at the SPINE (you cannot be blocked on yourself → your own to-do);
//        the room's waiting groups key on the guarded blockedOn; the ⋯ menu shows the live category.
//   (W2–W5 gates land with their slices.)
import { config } from 'dotenv'; config({ path: '.env.local' });
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { buildWorkItems } from '../lib/work-items/model';
import { suggestWorkerForMove } from '../lib/prepare/route-suggestion';
import { prepareOneItem } from '../lib/prepare/pass';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const A = '08fe4449-e5eb-431d-9156-02e9324e5903';
const B = 'c723c2f2-e069-4ab8-980e-ac3585028fec';
const RENE_PREFIX = 'ae306f38';
const PERSONAL = 'e009a499-41d4-4c44-ad53-53a0e851d143';
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  // ── W1 STRUCTURAL ──
  const model = src('lib/work-items/model.ts');
  check('W1: the spine flips a self-waiting item to todo (before priority reads state)',
    model.includes("w.state === 'waiting' && w.who && isSelf(w.who)) w.state = 'todo'") &&
    model.indexOf("w.state = 'todo'") < model.indexOf('w.priority = priorityOf'));
  const room = src('components/entities/entity-room.tsx');
  check('W1: the room groups waiting by the GUARDED blockedOn, never raw who',
    room.includes('w.blockedOn ? w.blockedOn.split') && !room.includes("w.who ? w.who.split('<')[0].trim().split(' ')[0] : 'them'"));
  check('W1: the board rows carry blockedOn from the spine',
    src('app/api/entities/[id]/detail/route.ts').includes('blockedOn: (w as { blockedOn?: string | null }).blockedOn ?? null'));
  check('W1: the ⋯ menu highlights the live category (the portfolio idiom) + a section header',
    room.includes("e.category === c ? 'text-indigo-600 font-medium'") && room.includes('>Category</p>'));
  check('W1: the detail route serves category', src('app/api/entities/[id]/detail/route.ts').includes('category: (st as'));

  // ── W2 STRUCTURAL — the regex twins are DEAD; both surfaces read the served verdict ──
  const rail = src('components/home/item-rail.tsx');
  const noRegex = (s: string) => !s.includes('research|analy') && !s.includes('write|draft|post');
  check('W2: no client-side routing regex survives (rail + room)', noRegex(rail) && noRegex(src('components/entities/entity-room.tsx')));
  check('W2: the rail chip reads the SERVED suggestedWorker', rail.includes('ent?.suggestedWorker ?? null'));
  check('W2: the room chip reads the SERVED suggestedWorker', src('components/entities/entity-room.tsx').includes('e?.suggestedWorker ?? null'));
  check('W2: ONE routing brain — room-view + detail route both call suggestWorkerForMove',
    src('lib/entities/room-view.ts').includes('suggestWorkerForMove') &&
    src('app/api/entities/[id]/detail/route.ts').includes('suggestWorkerForMove'));
  // O2 superseded W2's mechanism: the router is now the ROSTER JUDGE (no map at all).
  check('W2→O2: ONE reasoned router — the roster judge, no SHAPE_TO_ROLE map anywhere',
    src('lib/prepare/route-suggestion.ts').includes('export async function routeTasks') &&
    src('lib/prepare/route-suggestion.ts').includes('loadRoster') &&
    !src('lib/prepare/pass.ts').includes('SHAPE_TO_ROLE') &&
    src('lib/prepare/pass.ts').includes('routeTasks'));

  // ── W3 STRUCTURAL — the CTA narrates FACTS (keyed, deduped, actionable) ──
  const railSrc = src('components/home/item-rail.tsx');
  const roomSrc = src('components/entities/entity-room.tsx');
  check('W3: pushDealTurn dedupes by key (a re-clicked CTA cannot stutter)',
    railSrc.includes('t.key !== opts.key'));
  check('W3: the CTA narration is composed from the board row\'s prepared state, never a hedge',
    roomSrc.includes("row?.prepared === 'draft'") && !roomSrc.includes("if there's a draft it's below the messages"));
  // O5 restyled the offers as the numbered decision idiom (judged route first) — same real actions.
  check('W3: nothing-prepared narration carries REAL offers (prepare + routed hand-off)',
    roomSrc.includes("act: 'prepare'") && roomSrc.includes("prepare it`, act: 'say'"));
  check('W3: the rail fires the offers (prepare-now + the one conversation core)',
    railSrc.includes('/api/items/prepare-now') && railSrc.includes("a.act === 'say'"));

  // ── W4 STRUCTURAL — ONE engine, two callers ──
  const passSrc = src('lib/prepare/pass.ts');
  check('W4: prepareOneItem is THE engine — the cron walker calls it for every branch',
    passSrc.includes('export async function prepareOneItem') &&
    (passSrc.match(/await prepareOneItem\(/g) ?? []).length >= 3);
  check('W4: the prepare-now route shares the SAME engine',
    src('app/api/items/prepare-now/route.ts').includes('prepareOneItem'));
  check('W4: the room refreshes on aug:prepared + rows have the Prepare affordance',
    roomSrc.includes("addEventListener('aug:prepared'") && roomSrc.includes("'Preparing…'"));
  check('W4: the engine never sends (draft/nudge/delegate/docsend only — no send path)',
    !/sendCoworkerEmail|\/send-email|compose\/send/.test(passSrc));

  // ── W5 STRUCTURAL — ONE prepared-work derivation, one vocabulary, everywhere ──
  const detailSrc = src('app/api/entities/[id]/detail/route.ts');
  check('W5: the room board derives prepared via THE ONE reader (preparedBadge — nudges included)',
    detailSrc.includes("import('@/lib/prepare/read')") && detailSrc.includes('preparedBadge(sd'));
  check('W5: the Home brief derives via the SAME reader', src('app/api/home/brief/route.ts').includes("import('@/lib/prepare/read')"));
  check('W5: the reader covers all three storage places (draft / nudge_draft / deliverables)',
    src('lib/prepare/read.ts').includes('nudge_draft') && src('lib/prepare/read.ts').includes('item_deliverables'));
  check('W5: the prepared token is TAPPABLE in the room (deliverable preview / thread open)',
    roomSrc.includes('onPreviewDeliverable(w.title, w.preparedRef)'));

  // ── W1 LIVE — zero waiting-on-self rows on every user's spine ──
  const { data: uidRows } = await sb.from('work_entities').select('user_id').eq('kind', 'initiative');
  const rene = [...new Set((uidRows ?? []).map((r) => r.user_id as string))].find((u) => u.startsWith(RENE_PREFIX));
  const users: Array<[string, string]> = [[A, 'user A'], [B, 'user B'], [PERSONAL, 'personal']];
  if (rene) users.push([rene, 'user C']);
  const todayStr = new Date().toISOString().slice(0, 10);
  for (const [uid, label] of users) {
    const [{ data: prof }, { data: conns }] = await Promise.all([
      sb.from('profiles').select('email, full_name').eq('id', uid).maybeSingle(),
      sb.from('connections').select('metadata, provider_account_id').eq('user_id', uid),
    ]);
    const selfIds = new Set<string>();
    const add = (s: string | null | undefined) => { const t = String(s || '').toLowerCase().trim(); if (t) selfIds.add(t); };
    add(prof?.email); add(prof?.full_name);
    for (const c of (conns ?? []) as Array<Record<string, unknown>>) add(((c.metadata as { email?: string } | null)?.email) || (c.provider_account_id as string));
    const isSelf = (who: string): boolean => { const w = who.toLowerCase(); return [...selfIds].some((s) => w === s || w.includes(s) || (s.includes('@') && w.includes(s.split('@')[0] + '@'))); };

    const items = await buildWorkItems(sb, uid, { todayStr, skipReconcile: true });
    const selfWaiting = items.filter((w) => w.state === 'waiting' && w.who && isSelf(w.who));
    check(`${label} · zero waiting-on-self rows on the spine`, selfWaiting.length === 0,
      selfWaiting.length ? selfWaiting.slice(0, 3).map((w) => w.title.slice(0, 40)).join(' | ') : `${items.filter((w) => w.state === 'waiting').length} waiting, all real counterparties`);
    // And every surviving waiting row that will GROUP under a name has a guarded blockedOn or folds to "them".
    const badGroup = items.filter((w) => w.state === 'waiting' && w.blockedOn && isSelf(w.blockedOn));
    check(`${label} · no blockedOn ever resolves to the user`, badGroup.length === 0);

    // ── W2 LIVE — the router judges a real next move: a role or an honest null, never a throw;
    // and the verdict CACHES (second call returns identically with zero AI — sig on next_move). ──
    const { data: ents } = await sb.from('work_entities').select('id, name, next_move').eq('user_id', uid)
      .eq('kind', 'initiative').eq('status', 'active').not('next_move', 'is', null).limit(30);
    const withMove = ((ents ?? []) as Array<{ id: string; name: string; next_move: { title?: string } | null }>).find((x) => x.next_move?.title);
    if (!withMove) { check(`${label} · routing verdict (vacuous — no next moves)`, true); }
    else {
      const v1 = await suggestWorkerForMove(sb, uid, withMove.id, { next_move: withMove.next_move });
      const { data: after } = await sb.from('work_entities').select('next_move').eq('id', withMove.id).maybeSingle();
      const nmAfter = (after?.next_move ?? {}) as { routedWorker?: unknown; routeSig?: string };
      check(`${label} · routing verdict served + cached on next_move`,
        nmAfter.routedWorker !== undefined && nmAfter.routeSig !== undefined,
        `"${withMove.next_move!.title!.slice(0, 44)}" → ${v1 ? `${v1.name.split(' ')[0]} (${v1.role})` : 'no chip (none)'}`);
      const v2 = await suggestWorkerForMove(sb, uid, withMove.id, { next_move: nmAfter });
      check(`${label} · cached verdict is stable`, (v1?.role ?? null) === (v2?.role ?? null));
    }

    // ── W4 LIVE (users A + B only — one controlled draft regen each, no spam) — the ONE engine
    // prepares a real reply item: backdate its draft to force staleness → prepareOneItem regenerates;
    // an immediate second call skips (idempotent). ──
    if (uid === A || uid === B) {
      // T3 (work-surface) refuses automated senders — the fixture must be a REAL human reply item.
      const { isAutomatedSender } = await import('../lib/inbox/automated');
      const candidates = items.filter((x) => x.kind === 'reply' && x.id.startsWith('inbox:') && x.state === 'todo' && !x.automated);
      const { judgeWork } = await import('../lib/work/judge');
      let replyItem: typeof candidates[number] | undefined;
      for (const cand of candidates.slice(0, 6)) {
        const { data: probe } = await sb.from('inbox_items').select('source_data').eq('id', cand.entityId).maybeSingle();
        const psd = (probe?.source_data ?? {}) as Record<string, unknown>;
        const k = ((psd.understanding ?? {}) as { mailKind?: string }).mailKind;
        if (isAutomatedSender((psd.from_address as string) || null, (psd.from_name as string) || null, (psd.subject as string) || '')) continue;
        if (k && ['receipt', 'newsletter', 'notification', 'cold_outreach', 'calendar'].includes(k)) continue;
        // THE ONE GATE: the pass drafts only what the JUDGE says is a reply — a decide/none item
        // correctly yields no draft (that's the fix working, not a failure). Same call, cached.
        const v = await judgeWork(sb, uid, { kind: 'inbox', id: cand.entityId });
        if (v.work !== 'reply') continue;
        replyItem = cand; break;
      }
      if (!replyItem) { check(`${label} · prepare-now (vacuous — no open judged-reply items)`, true); }
      else {
        const { data: it } = await sb.from('inbox_items').select('id, source_data').eq('id', replyItem.entityId).maybeSingle();
        const sd = (it?.source_data ?? {}) as Record<string, unknown>;
        const draft = (sd.draft ?? null) as { generated_at?: string } | null;
        if (draft?.generated_at) {
          await sb.from('inbox_items').update({ source_data: { ...sd, draft: { ...draft, generated_at: new Date(Date.now() - 48 * 3_600_000).toISOString() } } }).eq('id', replyItem.entityId);
        }
        // The backdate MOVES the judge's cache sig (the pool includes the draft) — re-judge AFTER
        // it so the pass reads this cached verdict; a fresh judgment that flips off `reply` is the
        // model's honest call on this item, not a regression → vacuous-pass with the reason.
        const vPost = await judgeWork(sb, uid, { kind: 'inbox', id: replyItem.entityId });
        if (vPost.work !== 'reply') {
          check(`${label} · prepare-now (vacuous — the fixture item re-judged ${vPost.work}, not reply)`, true, vPost.reason.slice(0, 60));
        } else {
        const p1 = await prepareOneItem(sb, uid, replyItem);
        check(`${label} · prepare-now regenerates a stale draft`, p1.did === 'draft', `did=${p1.did}${p1.reason ? ` (${p1.reason})` : ''}`);
        const p2 = await prepareOneItem(sb, uid, replyItem);
        check(`${label} · immediate re-prepare skips (idempotent)`, p2.did === 'none', `did=${p2.did} (${p2.reason ?? ''})`);
        const { data: after2 } = await sb.from('inbox_items').select('source_data').eq('id', replyItem.entityId).maybeSingle();
        const d2 = ((after2?.source_data ?? {}) as { draft?: { body?: string; generated_at?: string } }).draft;
        check(`${label} · the fresh draft persisted on the item`, !!d2?.body && (Date.now() - Date.parse(d2.generated_at || '0')) < 600_000);
        }
      }
    }
  }

  console.log('\n════ THE WORK LOOP GATES ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  → ${d}` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();
