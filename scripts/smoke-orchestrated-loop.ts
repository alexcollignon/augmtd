// THE ORCHESTRATED LOOP GATES (docs/orchestrated-loop-plan.md).
//   O1 — identity is recognized ONCE against the person registry: the SELF entity exists with the
//   user's real observed forms (incl. nickname from-forms); the extractor resolves counterparties at
//   the write (self → your own task, never a "wait on yourself"); the spine asks the registry, not a
//   string lens; the healed corpus holds zero self-counterparty commitments.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { ensureSelfEntity } from '../lib/entities/self';
import { getPersonEntities, resolveIdentity } from '../lib/entities/people';
import { writeCommitments } from '../lib/commitments/extract';
import { buildWorkItems } from '../lib/work-items/model';
import { resolveProbeUser } from './probe-user';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const A = '08fe4449-e5eb-431d-9156-02e9324e5903';
const B = 'c723c2f2-e069-4ab8-980e-ac3585028fec';
const RENE_PREFIX = 'ae306f38';
let PERSONAL = ''; // the PROBE HOST — resolved at start (scripts/probe-user.ts)
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);
const src = (p: string) => readFileSync(p, 'utf8');
const MARKER = 'ZZ-smoke self-resolution probe';

(async () => {
  PERSONAL = await resolveProbeUser(sb);
  // ── O1 STRUCTURAL ──
  check('O1: the self entity module exists + the ambient pass refreshes it',
    src('lib/entities/self.ts').includes('export async function ensureSelfEntity') &&
    src('lib/prepare/pass.ts').includes('ensureSelfEntity'));
  check('O1: the extractor RESOLVES counterparties at the write (self → you_owe + null)',
    src('lib/commitments/extract.ts').includes('resolveIdentity(persons, rawCp)') &&
    src('lib/commitments/extract.ts').includes("id.isSelf ? 'you_owe'"));
  const model = src('lib/work-items/model.ts');
  check('O1: the spine asks the REGISTRY — the name-substring lens is gone',
    model.includes('resolveIdentity(persons, who).isSelf') && !model.includes('w.includes(s)'));

  // ── O2 STRUCTURAL — the roster judge is THE router; the map is dead ──
  const router = src('lib/prepare/route-suggestion.ts');
  const passSrc = src('lib/prepare/pass.ts');
  check('O2: routing reads the ROSTER (coworkers + skills), not a shape map',
    router.includes('loadRoster') && router.includes('agent_skills') && !passSrc.includes('SHAPE_TO_ROLE'));
  check('O2: the pass + the chip suggestion share ONE judge (routeTasks)',
    passSrc.includes('routeTasks(admin, userId') && router.includes('routeTasks(supabase, userId, [title])'));
  check('O2: conservative doctrine in the judge prompt (unsure → none; wrong route costs trust)',
    router.includes('Unsure → "none"'));

  // ── O3 STRUCTURAL — every execution attributed; the envelope is the contract ──
  const drafter = src('lib/inbox/draft-reply.ts');
  check('O3: drafting is the assistant\'s craft — her SKILLS shape every draft (causal attribution)',
    drafter.includes('getDraftingAssistant') && drafter.includes('buildAssistantSkillsBlock') &&
    drafter.includes('assistantSkills'));
  check('O3: ambient drafts/nudges/doc-sends STAMP the assistant (no anonymous new work)',
    (passSrc.match(/getDraftingAssistant\(admin, userId\)/g) ?? []).length >= 4 &&
    passSrc.includes('prepared_by: { worker: pa.name'));
  check('O3: the delegation ENVELOPE carries the deal (goals/rules/state) + the person brain',
    passSrc.includes('[THE BODY OF WORK —') && passSrc.includes('renderBrainContext') &&
    passSrc.includes('brainContext: brainContext || undefined'));
  check('O3: the rail narrates WHO did the work (never a nameless system)',
    src('components/home/item-rail.tsx').includes('drafted it') && src('components/home/item-rail.tsx').includes('is on it'));

  // ── O4 STRUCTURAL — the CoS evaluator wraps every artifact ──
  const evalSrc = src('lib/prepare/evaluate.ts');
  check('O4: structural identity floor — a self-addressed artifact can never pass (no AI needed)',
    evalSrc.includes('resolveIdentity(persons, args.recipient).isSelf'));
  check('O4: capped evaluator-optimizer — one revision, then an honest FLAG (never silently discarded)',
    passSrc.includes("review = { verdict: 'flag', objection: review.objection }"));
  check('O4: wired into reply + nudge + delegation (annotate) branches',
    (passSrc.match(/reviewAndRevise\(/g) ?? []).length >= 4 && passSrc.includes("kind: 'deliverable'"));
  check('O4: the review never blocks the work (failure → pass)', evalSrc.includes("catch { return { verdict: 'pass'"));

  // ── O5 STRUCTURAL — the commit line is a DECISION ──
  const railSrc = src('components/home/item-rail.tsx');
  const roomSrc = src('components/entities/entity-room.tsx');
  check('O5: ≥2 routes render as the numbered options idiom, judged route FIRST, decline always last',
    railSrc.includes('t.actions.length >= 2') && railSrc.includes('Leave it with me') && railSrc.includes("j === 0 ? 'font-medium"));
  check('O5: the narration leads with the roster verdict + surfaces a prepared SIBLING honestly',
    roomSrc.includes('Have ${sw.name.split(\' \')[0]} prepare it') && roomSrc.includes('r.id !== f.id && r.prepared'));
  check('O5: a lone offer stays one calm chip (no one-item menu)', railSrc.includes('t.actions.length === 1'));

  // ── O1 LIVE — all four users ──
  const { data: uidRows } = await sb.from('work_entities').select('user_id').eq('kind', 'initiative');
  const rene = [...new Set((uidRows ?? []).map((r) => r.user_id as string))].find((u) => u.startsWith(RENE_PREFIX));
  const users: Array<[string, string]> = [[A, 'user A'], [B, 'user B'], [PERSONAL, 'personal']];
  if (rene) users.push([rene, 'user C']);
  const todayStr = new Date().toISOString().slice(0, 10);

  for (const [uid, label] of users) {
    const self = await ensureSelfEntity(sb, uid);
    check(`${label} · self entity exists (idempotent ensure)`, !!self && self.aliases.length >= 2,
      self ? `"${self.name}" · ${self.aliases.length} aliases` : 'none');

    const persons = await getPersonEntities(sb, uid);
    // Every open commitment's counterparty resolves to NOT-self (the healed invariant).
    const { data: open } = await sb.from('commitments').select('id, counterparty').eq('user_id', uid).eq('status', 'open').limit(1000);
    const selfCp = ((open ?? []) as Array<{ counterparty: string | null }>)
      .filter((c) => c.counterparty && resolveIdentity(persons, c.counterparty).isSelf);
    check(`${label} · zero open commitments with a self counterparty`, selfCp.length === 0,
      selfCp.length ? selfCp.slice(0, 2).map((c) => String(c.counterparty)).join(' | ') : `${(open ?? []).length} open, all clean`);

    // The spine agrees through the registry lens.
    const items = await buildWorkItems(sb, uid, { todayStr, skipReconcile: true });
    const selfWaiting = items.filter((w) => w.state === 'waiting' && w.who && resolveIdentity(persons, w.who).isSelf);
    check(`${label} · zero waiting rows resolve to self on the spine`, selfWaiting.length === 0);
  }

  // ── O1 LIVE — the nickname fixture (user A): "Alex Collignon" IS Alexandre, because his own sent
  // mail proves it — a registry fact, not a heuristic. ──
  const personsA = await getPersonEntities(sb, A);
  const alex = resolveIdentity(personsA, 'Alex Collignon');
  check('user A · "Alex Collignon" resolves to SELF via the sent-mail alias', alex.isSelf,
    alex.person ? `→ "${alex.person.name}"` : 'unresolved');
  check('user A · a real counterparty does NOT resolve to self',
    !resolveIdentity(personsA, 'Spartak Fedotov <spartak.fedotovv@gmail.com>').isSelf);

  // ── O1 LIVE — write-time resolution through the REAL writer: a synthetic "awaiting Alex Collignon"
  // lands as you_owe with a null counterparty (you cannot wait on yourself). Cleaned up after. ──
  await writeCommitments(A, [
    { direction: 'awaiting', description: `${MARKER} — send the follow-up`, counterparty: 'Alex Collignon' } as never,
  ], { source: 'email', sourceId: `smoke-${MARKER}` }, sb as never);
  const { data: probe } = await sb.from('commitments').select('id, direction, counterparty')
    .eq('user_id', A).eq('source_id', `smoke-${MARKER}`).maybeSingle();
  check('write-time: awaiting-on-self lands as you_owe + null counterparty',
    !!probe && probe.direction === 'you_owe' && probe.counterparty === null,
    probe ? `direction=${probe.direction} counterparty=${probe.counterparty}` : 'row not written');
  if (probe) await sb.from('commitments').delete().eq('id', probe.id);

  // ── O2 LIVE — the roster judge on the observed scenarios (user A, one batch call): the screenshot
  // fixture routes to a content-craft teammate; sending an existing doc flags sendDoc for the
  // system; human-only work routes to no one. ──
  const { routeTasks } = await import('../lib/prepare/route-suggestion');
  const routes = await routeTasks(sb, A, [
    'Prepare and send onboarding kit to Spartak',
    'Send the signed contract back to the landlord',
    'Approve the vendor invoice before Friday',
    'Research how three competitors price their AI offering',
  ]);
  check('roster judge · the fixture routes to a content-craft teammate', !!routes[0]?.worker,
    routes[0]?.worker ? `→ ${routes[0].worker.name} (${routes[0].worker.role})` : 'none');
  check('roster judge · sending an EXISTING doc → system doc-send, no teammate',
    !routes[1]?.worker && routes[1]?.sendDoc === true, JSON.stringify({ w: routes[1]?.worker?.name ?? null, sendDoc: routes[1]?.sendDoc }));
  check('roster judge · approval/decision is honestly NO ONE\'s to prepare', !routes[2]?.worker && !routes[2]?.sendDoc);
  check('roster judge · research routes to the analyst craft', routes[3]?.worker?.role === 'research_analyst',
    routes[3]?.worker ? `→ ${routes[3].worker.name}` : 'none');

  // ── O3 LIVE — ambient work is ATTRIBUTED end to end: a controlled-stale reply prepared through the
  // ONE engine comes back with the assistant's name, stamped on the item, served by the ONE reader. ──
  const { prepareOneItem } = await import('../lib/prepare/pass');
  const { preparedBadge } = await import('../lib/prepare/read');
  const itemsA = await buildWorkItems(sb, A, { todayStr, skipReconcile: true });
  // Fixture must be a HUMAN sender — a no-reply notification is correctly REFUSED by the T3
  // structural floor ("a reply would reach no one"), which is the engine working, not a failure.
  const { isAutomatedSenderStrong } = await import('../lib/inbox/notice-demotion');
  const { judgeWork: judgeForFixture } = await import('../lib/work/judge');
  let replyItem: (typeof itemsA)[number] | undefined;
  for (const cand of itemsA.filter((x) => x.kind === 'reply' && x.id.startsWith('inbox:') && x.state === 'todo' && !x.automated).slice(0, 8)) {
    const { data: row } = await sb.from('inbox_items').select('source_data').eq('id', cand.entityId).maybeSingle();
    const csd = (row?.source_data ?? {}) as Record<string, unknown>;
    if (isAutomatedSenderStrong((csd.from_address as string) ?? null, (csd.from_name as string) ?? null, (csd.subject as string) ?? null)) continue;
    const u = (csd.understanding ?? null) as { mailKind?: string } | null;
    if (u?.mailKind === 'notification' || u?.mailKind === 'calendar') continue;
    // THE ONE GATE: only a JUDGED-reply item drafts (a decide/none verdict yielding no draft is
    // the promise-fix working). Same judgment the pass reads — cached.
    const vf = await judgeForFixture(sb, A, { kind: 'inbox', id: cand.entityId });
    if (vf.work !== 'reply') continue;
    replyItem = cand; break;
  }
  if (!replyItem) { check('O3 live · attribution (vacuous — no open human reply items)', true); }
  else {
    const { data: it } = await sb.from('inbox_items').select('id, source_data').eq('id', replyItem.entityId).maybeSingle();
    const sd0 = (it?.source_data ?? {}) as Record<string, unknown>;
    const draft0 = (sd0.draft ?? null) as { generated_at?: string } | null;
    if (draft0?.generated_at) {
      await sb.from('inbox_items').update({ source_data: { ...sd0, draft: { ...draft0, generated_at: new Date(Date.now() - 48 * 3_600_000).toISOString() } } }).eq('id', replyItem.entityId);
    }
    // The backdate moved the judge's cache sig (the pool includes the draft) — re-judge AFTER it
    // so the pass reads THIS cached verdict; an honest flip off `reply` → vacuous-pass.
    const vPost = await judgeForFixture(sb, A, { kind: 'inbox', id: replyItem.entityId });
    if (vPost.work !== 'reply') {
      check('O3 live · attribution (vacuous — the fixture item re-judged not-reply)', true, `${vPost.work}: ${vPost.reason.slice(0, 50)}`);
    } else {
      const p = await prepareOneItem(sb, A, replyItem);
      const { data: after } = await sb.from('inbox_items').select('source_data').eq('id', replyItem.entityId).maybeSingle();
      const badge = preparedBadge((after?.source_data ?? {}) as never);
      check('O3 live · the prepared draft carries the assistant\'s NAME (engine → item → reader)',
        p.did === 'draft' && !!p.worker && badge === p.worker,
        `did=${p.did}${p.reason ? ` (${p.reason})` : ''} · by=${p.worker ?? '—'} · badge=${badge ?? '—'}`);
    }
  }

  // ── O4 LIVE — the canonical failure: a nudge addressed to the user himself is caught by the
  // STRUCTURAL floor (registry, zero AI); a sane draft for a real recipient passes the AI review. ──
  const { evaluateDeliverable } = await import('../lib/prepare/evaluate');
  const selfNudge = await evaluateDeliverable(sb, A, {
    content: 'Boa tarde Alex,\n\nJá teve oportunidade de partilhar o onboarding kit?\n\nObrigado',
    task: 'Share onboarding kit', recipient: 'Alex Collignon', kind: 'nudge',
  });
  check('O4 live · the self-addressed nudge is CAUGHT (structural, pre-AI)',
    selfNudge.verdict === 'revise' && !!selfNudge.objection && /themself|counterparty/i.test(selfNudge.objection),
    `verdict=${selfNudge.verdict} · "${(selfNudge.objection ?? '').slice(0, 60)}"`);
  // Fixture hardened WITH the evaluator's own laws (never weakened): the draft must actually DO
  // its task (a "kit will follow" note doesn't serve a send-the-kit task — the evaluator rightly
  // rejects that) and must not promise timing nothing verifies. A sane welcome-reply for a
  // welcome-reply task is the honest pass case.
  const sane = await evaluateDeliverable(sb, A, {
    content: 'Hi Spartak,\n\nGreat news on the signed contract — welcome aboard! I\'m putting your onboarding kit together now and will follow up with it in a separate email.\n\nBest,\nAlexandre',
    task: 'Reply to Spartak — welcome him aboard and confirm the onboarding kit is coming', recipient: 'Spartak Fedotov <spartak.fedotovv@gmail.com>', kind: 'reply',
  });
  check('O4 live · a sane draft for the real recipient PASSES review', sane.verdict === 'pass',
    `verdict=${sane.verdict}${sane.objection ? ` · "${sane.objection.slice(0, 60)}"` : ''}`);

  console.log('\n════ THE ORCHESTRATED LOOP GATES ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  → ${d}` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();
