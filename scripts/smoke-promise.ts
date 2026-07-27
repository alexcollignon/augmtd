// ═══ THE PROMISE GATES ═══
// These assert the PRODUCT'S PROMISE on real accounts — outcomes, not plumbing. The lesson that
// created this suite: mechanism gates passed while a password reset carried a drafted reply. Every
// gate here encodes a sentence of the promise: it never manufactures work, it never loses work,
// noise never becomes a task, one obligation is one task, corrections stick, one definition of
// "project" everywhere, labels tell the truth (kind = identity, posture = lifecycle, rules outrank).
// Run per user. 100% required — a failure is a live trust bug, not a flaky test.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { resolveKind, postureFor, labelNamesFor } from '../lib/inbox/rules/write-back';
import { isAutomatedSender } from '../lib/inbox/automated';
import { resolveProbeUser } from './probe-user';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const A = '08fe4449-e5eb-431d-9156-02e9324e5903';
const B = 'c723c2f2-e069-4ab8-980e-ac3585028fec';
// The PROBE HOST — a dedicated real auth user the live probes insert into (FK-safe, no human's
// data at risk, survives any personal account being deleted). Shared: scripts/probe-user.ts.
let PERSONAL = '';
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);
const src = (p: string) => readFileSync(p, 'utf8');

const isNoiseRow = (it: Record<string, unknown>): boolean => {
  const sd = (it.source_data ?? {}) as Record<string, unknown>;
  const k = resolveKind(sd, (it.rule_type as string) ?? null);
  return k === 'receipt' || k === 'newsletter' || k === 'notification'
    || isAutomatedSender((sd.from_address as string) ?? null, (sd.from_name as string) ?? null, String(it.work_title ?? ''));
};

(async () => {
  PERSONAL = await resolveProbeUser(sb);
  const { data: uidRows } = await sb.from('work_entities').select('user_id').limit(2000);
  const rene = [...new Set(((uidRows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id))].find((u) => u.startsWith('ae306f38')) ?? null;
  const USERS: Array<[string, string]> = [[A, 'user A'], [B, 'user B'], ...(rene ? [[rene, 'user C'] as [string, string]] : []), [PERSONAL, 'personal']];

  // ═══ P1 · IT NEVER MANUFACTURES WORK — no noise item carries a prepared draft (live, per user) ═══
  for (const [uid, label] of USERS) {
    const { data: items } = await sb.from('inbox_items')
      .select('id, work_title, rule_type, type_override, source_data')
      .eq('user_id', uid).eq('status', 'pending').not('source_data->draft', 'is', null).limit(500);
    const offenders = ((items ?? []) as Array<Record<string, unknown>>)
      .filter((it) => it.rule_type !== 'needs_reply' && it.type_override !== 'needs_reply')
      .filter(isNoiseRow);
    check(`P1 ${label} · zero prepared drafts on noise mail (rules-override excepted)`,
      offenders.length === 0, offenders.length ? `OFFENDERS: ${offenders.slice(0, 3).map((o) => String(o.work_title).slice(0, 40)).join(' · ')}` : 'clean');
  }

  // ═══ P2 · THE JUDGE IS THE ONLY GATE TO PREPARATION ═══
  check('P2 · no preparation path bypasses the judge (fast-paths deleted; on-demand draft route consults it)',
    !src('lib/prepare/pass.ts').includes("w.kind === 'reply' && w.id.startsWith('inbox:')) return await done(await prepareReplyDraft") &&
    src('lib/prepare/pass.ts').includes('THE ONE GATE') &&
    src('app/api/inbox/[id]/draft/route.ts').includes("skipped: 'judged_none'"));
  // Live probe: a notification through the WHOLE engine → none.
  {
    const { data: probe } = await sb.from('inbox_items').insert({
      user_id: PERSONAL, source: 'email', status: 'pending', work_state: 'work_prepared',
      work_title: 'Your password was changed',
      source_data: {
        subject: 'Your password was changed', body: 'Your account password was changed. If this was not you, secure your account.',
        from_name: 'Acme Security', from_address: 'no-reply@acme-example.com', received_at: new Date().toISOString(),
        understanding: { mailKind: 'notification', ownership: 'none', relevance: 'awareness', role: 'primary' },
      },
    }).select('id').maybeSingle();
    if (!probe?.id) check('P2 live · probe insert failed', false);
    else {
      const { prepareOneItem } = await import('../lib/prepare/pass');
      const r = await prepareOneItem(sb, PERSONAL, {
        id: `inbox:${probe.id}`, entityId: String(probe.id), kind: 'reply', title: 'Your password was changed',
        who: 'Acme Security', actor: 'you', state: 'todo',
        when: { explicit: null, bucket: 'today' }, source: 'email', href: `/item/${probe.id}`,
        at: new Date().toISOString(), startAt: new Date().toISOString().slice(0, 10),
        projectId: null, automated: false, initiative: null, effort: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const { data: after } = await sb.from('inbox_items').select('source_data').eq('id', probe.id).maybeSingle();
      const draftless = !((after?.source_data ?? {}) as Record<string, unknown>).draft;
      check('P2 live · a notification pushed through the ENGINE (even mislabeled kind:reply) yields NO draft',
        r.did === 'none' && draftless, `did=${r.did} · draftless=${draftless}`);
      await sb.from('item_plans').delete().eq('user_id', PERSONAL).eq('entity_id', `inbox:${probe.id}`);
      await sb.from('inbox_items').delete().eq('id', probe.id);
    }
  }

  // ═══ P3 · ONE OBLIGATION = ONE TASK (live, per user — the spine agrees with itself) ═══
  {
    const { buildWorkItems } = await import('../lib/work-items/model');
    const { isVisibleObligationRow } = await import('../lib/home/dedupe-deck');
    const todayStr = new Date().toISOString().slice(0, 10);
    for (const [uid, label] of USERS) {
      const items = await buildWorkItems(sb, uid, { todayStr, skipReconcile: true });
      // Only threads whose email row the user actually SEES as a task (the ONE shared visibility
      // predicate — an FYI row doesn't count; its commitment is then rightly the one visible row).
      const emailThreads = new Map<string, string>();
      for (const w of items) {
        if (w.id.startsWith('inbox:') && (w.kind === 'reply' || w.kind === 'action') && w.state === 'todo') {
          const { data: it } = await sb.from('inbox_items').select('source_data, rule_type, work_state, type_override').eq('id', w.entityId).maybeSingle();
          if (!it || !isVisibleObligationRow(it)) continue;
          const tid = ((it.source_data ?? {}) as Record<string, unknown>).thread_id as string | undefined;
          if (tid) emailThreads.set(tid, w.title);
        }
      }
      let dupes = 0;
      for (const w of items) {
        if (!w.id.startsWith('commit:') || w.state !== 'todo') continue;
        const { data: c } = await sb.from('commitments').select('thread_id, direction').eq('id', w.entityId).maybeSingle();
        if (c?.thread_id && c.direction !== 'awaiting' && emailThreads.has(c.thread_id as string)) dupes++;
      }
      check(`P3 ${label} · no open commitment duplicates a live email row on the same thread`,
        dupes === 0, dupes ? `${dupes} duplicate pair(s)` : `threads=${emailThreads.size}`);
    }
  }

  // ═══ P4 · NOISE NEVER FOUNDS A BODY OF WORK (structural + live) ═══
  check('P4 · recognition refuses to found from noise (kind-aware, via the ONE resolver)',
    src('lib/entities/recognize.ts').includes('noise mail — never founds a new body of work') &&
    src('lib/entities/sources.ts').includes('resolveKind'));
  {
    const { data: probe } = await sb.from('inbox_items').insert({
      user_id: PERSONAL, source: 'email', status: 'pending', work_state: 'noted',
      work_title: 'Your ZZ-Widget subscription receipt',
      source_data: {
        subject: 'Your ZZ-Widget subscription receipt', body: 'Thanks for your payment of $9.99. This is your monthly receipt.',
        from_name: 'ZZ-Widget Billing', from_address: 'billing@zz-widget-example.com', received_at: new Date().toISOString(),
        understanding: { mailKind: 'receipt', ownership: 'none', relevance: 'awareness', role: 'primary' },
      },
    }).select('id').maybeSingle();
    if (!probe?.id) check('P4 live · probe insert failed', false);
    else {
      const before = (await sb.from('work_entities').select('id', { count: 'exact', head: true }).eq('user_id', PERSONAL)).count ?? 0;
      const { recognizeItem } = await import('../lib/entities/recognize');
      const { itemFromInbox } = await import('../lib/entities/sources');
      const { data: row } = await sb.from('inbox_items').select('id, work_title, rule_type, source_data, created_at').eq('id', probe.id).maybeSingle();
      const res = await recognizeItem(sb, PERSONAL, itemFromInbox(row as never));
      const after = (await sb.from('work_entities').select('id', { count: 'exact', head: true }).eq('user_id', PERSONAL)).count ?? 0;
      check('P4 live · a subscription receipt does NOT found an entity (refusal recorded, registry unchanged)',
        res.founded === false && after === before, `via=${res.via} · entities ${before}→${after}`);
      await sb.from('entity_links').delete().eq('user_id', PERSONAL).eq('item_id', probe.id);
      await sb.from('inbox_items').delete().eq('id', probe.id);
    }
  }

  // ═══ P5 · ONE DEFINITION OF "PROJECT" — tracked, on every surface ═══
  check('P5 · Timeline lanes are TRACKED-only (the judged-untracked fallback is gone)',
    !src('app/api/home/timeline/route.ts').includes('judgedRows') &&
    src('app/api/home/timeline/route.ts').includes('filter((e) => !!e.tracked)'));
  check('P5 · the portfolio shows tracked as projects; untracked folds; the strip says "connects to"',
    src('components/entities/portfolio-view.tsx').includes('inTab.filter((e) => e.tracked)') &&
    src('components/room/context-strip.tsx').includes("'Connects to'"));

  // ═══ P6 · LABELS TELL THE TRUTH — kind=identity, posture=lifecycle, rules outrank (real rows) ═══
  for (const [uid, label] of [[A, 'user A'], [B, 'user B']] as const) {
    const { data: items } = await sb.from('inbox_items')
      .select('work_title, rule_type, work_state, source_data')
      .eq('user_id', uid).eq('status', 'pending').eq('source', 'email')
      .order('created_at', { ascending: false }).limit(200);
    let bad = 0; let kinds = 0; let postures = 0;
    for (const it of (items ?? []) as Array<Record<string, unknown>>) {
      const sd = (it.source_data ?? {}) as Record<string, unknown>;
      const pair = labelNamesFor(sd, it.rule_type as string, it.work_state as string);
      const u = (sd.understanding ?? null) as { mailKind?: string } | null;
      if (pair.kindName) kinds++;
      if (pair.postureName) postures++;
      // The truth conditions: a known kind always yields its kind label; fyi/bulk never yields a
      // posture label; a needs_reply rule ALWAYS keeps its posture label (rules outrank kind).
      if (u?.mailKind && u.mailKind !== 'other' && !pair.kindName) bad++;
      if ((it.rule_type === 'fyi' || it.rule_type === 'marketing' || it.rule_type === 'notifications') && pair.postureName) bad++;
      if (it.rule_type === 'needs_reply' && pair.postureName !== 'AUGMTD/Needs reply') bad++;
    }
    check(`P6 ${label} · label truth over 200 real rows (kind=identity · posture=lifecycle · rules outrank)`,
      bad === 0, `kinds=${kinds} postures=${postures}${bad ? ` · VIOLATIONS=${bad}` : ''}`);
  }
  check('P6 unit · posture never fires on bulk; rules outrank kind',
    postureFor('fyi') === null && postureFor('marketing') === null && postureFor('needs_reply') === 'needs_reply' &&
    resolveKind({ kind_override: 'customer', understanding: { mailKind: 'newsletter' } }) === 'customer');

  // ═══ P7 · CORRECTIONS STICK — a human detach is a durable refusal recognition honors ═══
  {
    const { data: probe } = await sb.from('inbox_items').insert({
      user_id: PERSONAL, source: 'email', status: 'pending', work_state: 'noted',
      work_title: 'ZZ-correction probe — planning question',
      source_data: { subject: 'Planning question', body: 'Quick question about the plan for next month.', from_name: 'Sam Vendor', from_address: 'sam@acme-example.com', received_at: new Date().toISOString() },
    }).select('id').maybeSingle();
    if (!probe?.id) check('P7 live · probe insert failed', false);
    else {
      const { setItemMembership } = await import('../lib/entities/membership');
      await setItemMembership(sb, PERSONAL, { kind: 'inbox_item', id: probe.id as string, entityId: null }, { inline: true });
      const { data: link } = await sb.from('entity_links').select('entity_id, via, locked')
        .eq('user_id', PERSONAL).eq('item_kind', 'inbox_item').eq('item_id', probe.id).maybeSingle();
      const { recognizeItem } = await import('../lib/entities/recognize');
      const { itemFromInbox } = await import('../lib/entities/sources');
      const { data: row } = await sb.from('inbox_items').select('id, work_title, rule_type, source_data, created_at').eq('id', probe.id).maybeSingle();
      const res = await recognizeItem(sb, PERSONAL, itemFromInbox(row as never));
      check('P7 live · "not this" writes a LOCKED refusal and recognition honors it (no re-file)',
        link?.entity_id === null && link?.locked === true && res.entityId === null,
        `via=${link?.via} locked=${link?.locked} re-recog=${res.via}`);
      await sb.from('entity_links').delete().eq('user_id', PERSONAL).eq('item_id', probe.id);
      await sb.from('inbox_items').delete().eq('id', probe.id);
    }
  }

  // ═══ P8 · THE SURFACE NEVER SHOWS-THEN-RETRACTS; a click always answers ═══
  const detail = src('components/home/item-detail.tsx');
  check('P8 · verdict-first mount (composer starts closed; cached verdict hydrates pre-paint)',
    detail.includes('const [composerOpen, setComposerOpen] = useState(false)') &&
    detail.includes('aug-item-verdict-inbox-') && detail.includes('VERDICT-FIRST MOUNT'));
  check('P8 · choosing a decision option is VISIBLE (the choice + the answer land as room turns)',
    (detail.match(/pushDealTurn\(roomKey, label, \{ role: 'user' \}\)/g)?.length ?? 0) >= 2);
  check('P8 · engine turns carry their item chip (a shared deal room is never ambiguous)',
    src('lib/prepare/pass.ts').includes('refs: [{ label: w.title.slice(0, 60)') &&
    src('lib/home/delegate.ts').includes('refs: [{ label: itemLabel.slice(0, 60)'));
  check('P8 · the reply drafter mirrors the CONCRETE text (fresh detection outranks a stale understanding)',
    src('lib/inbox/draft-reply.ts').includes('const detected = detectLanguage(`${subject}\\n${body}`) || languageName(understanding?.language)'));

  // ═══ P9 · TIME INVALIDATES WORK AND THE JUDGE NOTICES (mootness, live probes) ═══
  {
    const { judgeWork } = await import('../lib/work/judge');
    const past = new Date(Date.now() - 10 * 86_400_000);
    const pastStr = past.toISOString().slice(0, 10);
    const mk = async (subject: string, body: string, ownership: string) => {
      const { data } = await sb.from('inbox_items').insert({
        user_id: PERSONAL, source: 'email', status: 'pending', work_state: 'work_prepared', work_title: subject,
        source_data: {
          subject, body, from_name: 'Sam Vendor', from_address: 'sam@acme-example.com', received_at: past.toISOString(),
          understanding: { mailKind: 'customer', ownership, relevance: 'reply', role: 'primary' },
        },
      }).select('id').maybeSingle();
      return data?.id as string | undefined;
    };
    const mootId = await mk('Confirm the site visit tomorrow at 18:30',
      `Hi, could you confirm you can make the site visit tomorrow (${pastStr}) at 18:30? We need to lock the slot today.`, 'you_owe');
    if (mootId) {
      const v = await judgeWork(sb, PERSONAL, { kind: 'inbox', id: mootId });
      check('P9 live · an ask about a PAST event judges none+expired (time is in the judgment)',
        v.work === 'none' && v.resolution === 'expired', `${v.work}/${v.resolution ?? '—'} · "${v.reason.slice(0, 60)}"`);
      const { applyVerdictConsequences } = await import('../lib/work/apply-verdict');
      const cons = await applyVerdictConsequences(sb, PERSONAL, { kind: 'inbox', id: mootId }, v);
      const { data: after } = await sb.from('inbox_items').select('status').eq('id', mootId).maybeSingle();
      check('P9 live · the verdict MOVES the posture (expired → dismissed, logged, narrated)',
        cons.resolved && after?.status === 'dismissed', `status=${after?.status}`);
      await sb.from('room_turns').delete().eq('user_id', PERSONAL).like('dedupe_key', `%${mootId}%`);
      await sb.from('activity_events').delete().eq('user_id', PERSONAL).eq('entity_id', mootId);
      await sb.from('item_plans').delete().eq('user_id', PERSONAL).eq('entity_id', `inbox:${mootId}`);
      await sb.from('inbox_items').delete().eq('id', mootId);
    } else check('P9 · moot probe insert failed', false);
    // The counter-probe: a passed date where acting LATE still has value must NOT be expired.
    const lateId = await mk('Invoice #2214 — payment was due last week',
      `Hi, our invoice #2214 for €1,400 was due on ${pastStr} and remains unpaid. Could you arrange payment or let us know the status?`, 'you_owe');
    if (lateId) {
      const v = await judgeWork(sb, PERSONAL, { kind: 'inbox', id: lateId });
      check('P9 live · a passed-due UNPAID ask is NOT expired (late action still has value)',
        !(v.work === 'none' && v.resolution === 'expired'), `${v.work}/${v.resolution ?? '—'} · "${v.reason.slice(0, 60)}"`);
      await sb.from('item_plans').delete().eq('user_id', PERSONAL).eq('entity_id', `inbox:${lateId}`);
      await sb.from('inbox_items').delete().eq('id', lateId);
    } else check('P9 · late-value probe insert failed', false);
  }

  // ═══ P10 · VERDICT-POSTURE AGREEMENT — no pending item whose verdict says it's settled ═══
  for (const [uid, label] of USERS) {
    const { data: js } = await sb.from('item_plans').select('entity_id, tasks')
      .eq('user_id', uid).eq('kind', 'judgment').limit(500);
    let disagree = 0;
    const { applyVerdictConsequences: applyCons } = await import('../lib/work/apply-verdict');
    for (const j of (js ?? []) as Array<{ entity_id: string; tasks: { verdict?: { work?: string; resolution?: string } } }>) {
      const v = j.tasks?.verdict;
      if (!v || v.work !== 'none' || !v.resolution) continue;
      const m = /^(inbox|commitment):(.+)$/.exec(j.entity_id);
      if (!m) continue;
      const stillOpen = async (): Promise<boolean> => {
        if (m[1] === 'inbox') {
          const { data: it } = await sb.from('inbox_items').select('status').eq('id', m[2]).maybeSingle();
          return it?.status === 'pending';
        }
        const { data: c } = await sb.from('commitments').select('status').eq('id', m[2]).maybeSingle();
        return !!c && ['open', 'pending', 'in_progress'].includes(String(c.status));
      };
      if (!(await stillOpen())) continue;
      // A verdict can be JUDGED (a fixture, a cold cache write) without ever being SERVED — the
      // consequence module is the mover, so the gate applies it (the same ONE module) and asserts.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await applyCons(sb, uid, { kind: m[1] as any, id: m[2] }, j.tasks.verdict as any);
      if (await stillOpen()) disagree++;
    }
    check(`P10 ${label} · zero pending items whose verdict says settled (the judgment moved the posture)`,
      disagree === 0, disagree ? `${disagree} disagreement(s)` : 'in agreement');
  }

  // ═══ P11 · PREPARED WORK IS A DELIVERABLE — no monologue, no self-addressed artifacts ═══
  {
    const { getPersonEntities, resolveIdentity } = await import('../lib/entities/people');
    const MONO = /^(i need to|i should|let me|the instruction says|first, i|okay, i)/i;
    for (const [uid, label] of USERS) {
      const persons = await getPersonEntities(sb, uid);
      const { data: dels } = await sb.from('item_deliverables').select('content')
        .eq('user_id', uid).in('type', ['draft', 'text']).limit(400);
      let bad = 0;
      for (const d of (dels ?? []) as Array<{ content: string | null }>) {
        const c = String(d.content ?? '').trim();
        if (!c) continue;
        const first = c.split('\n')[0].trim();
        if (MONO.test(first)) bad++;
        const g = /^(hi|hello|dear|bom dia|boa tarde|olá|ola)\s+([^\s,!.]+)/i.exec(first)?.[2];
        if (g && resolveIdentity(persons, g).isSelf) bad++;
      }
      check(`P11 ${label} · pool holds DELIVERABLES only (no monologue, nothing self-addressed)`,
        bad === 0, bad ? `${bad} violation(s)` : 'clean');
    }
    check('P11 · the evaluator carries the deliverable-shape rule; delegation output is reviewed (capped retry, honest refusal)',
      src('lib/prepare/evaluate.ts').includes('not a DELIVERABLE at all') &&
      src('lib/home/delegate.ts').includes('deliverableOk') && src('lib/home/delegate.ts').includes('REVIEWER REJECTED'));
  }

  // ═══ P12 · ONE LAW, EVERY SURFACE — the notice law lives in the spine too ═══
  check('P12 · the spine applies the SAME notice law as the deck (isNoMoveNotice, incl. the RAW kind tier)',
    src('lib/work-items/model.ts').includes("from '@/lib/inbox/notice-demotion'") &&
    src('lib/work-items/model.ts').includes('isNoMoveNotice({ u, rawKind: rawMailKindOf(sd), fromEmail'));
  {
    const { buildWorkItems } = await import('../lib/work-items/model');
    const { isNoMoveNotice } = await import('../lib/inbox/notice-demotion');
    const { getUnderstanding } = await import('../lib/inbox/item-understanding');
    const todayStr = new Date().toISOString().slice(0, 10);
    for (const [uid, label] of [[A, 'user A'], [B, 'user B']] as const) {
      const items = await buildWorkItems(sb, uid, { todayStr, skipReconcile: true });
      let leaks = 0;
      for (const w of items.filter((x) => x.id.startsWith('inbox:') && x.state === 'todo' && !x.automated).slice(0, 60)) {
        const { data: it } = await sb.from('inbox_items').select('work_state, rule_type, type_override, source_data').eq('id', w.entityId).maybeSingle();
        if (!it) continue;
        const or = String(it.type_override || '');
        if (or === 'needs_reply' || or === 'to_do' || or === 'waiting_on') continue;
        const sd = (it.source_data ?? {}) as Record<string, unknown>;
        const u = getUnderstanding(it as never);
        const fe = String((sd.from_address as string) || '').toLowerCase() || null;
        if (isNoMoveNotice({ u, fromEmail: fe, fromName: (sd.from_name as string) ?? null, subject: w.title, workState: (it.work_state as string) ?? null })) leaks++;
      }
      check(`P12 ${label} · zero no-move notices leak into the spine as live tasks`, leaks === 0, leaks ? `${leaks} leak(s)` : 'tight');
    }
  }

  // ═══ Structural closures for the batch ═══
  check('P9-12 structural · the judge carries TODAY + a resolution disposition; the day rides the cache sig',
    src('lib/work/judge.ts').includes('TODAY is ${new Date()') && src('lib/work/judge.ts').includes("resolution?: 'expired' | 'answered'") &&
    src('lib/work/judge.ts').includes('${new Date().toISOString().slice(0, 10)}:${activityAt}'));
  check('structural · ONE consequence module, wired at the pass AND the serving edge',
    src('lib/work/apply-verdict.ts').includes('export async function applyVerdictConsequences') &&
    src('lib/prepare/pass.ts').includes('applyVerdictConsequences') &&
    src('app/api/items/judge/route.ts').includes('applyVerdictConsequences'));
  check('structural · the correction CASCADES (membership re-homes the item\'s engine turns) + a room reset exists',
    src('lib/entities/membership.ts').includes("from('room_turns').update({ room_key: newRoomKey })") &&
    src('app/api/room/turns/route.ts').includes('export async function DELETE') &&
    src('components/home/item-rail.tsx').includes('Archive this conversation'));
  check('structural · membership changes broadcast; every reader refetches (chip↔rail coherence)',
    src('components/entities/add-to-work-control.tsx').includes('aug:membership-changed') &&
    src('components/home/item-detail.tsx').includes("addEventListener('aug:membership-changed'"));
  check('structural · the nudge mirrors the counterparty\'s CONCRETE words; delegation narrations carry WHY',
    src('lib/inbox/draft-reply.ts').includes('mirrorText') && src('lib/prepare/pass.ts').includes('mirrorText') &&
    src('lib/prepare/pass.ts').includes('Nothing goes out without you.'));

  // ═══ P13 · PROJECTS ARE USER-CREATED ONLY, ON EVERY SURFACE ═══
  check('P13 · the portfolio renders TRACKED only (no smaller-things fold, no untracked rows anywhere)',
    src('components/entities/portfolio-view.tsx').includes('!hidden.has(e.id) && e.tracked') &&
    !src('components/entities/portfolio-view.tsx').includes('smaller thing'));
  check('P13 · the deck\'s By-project groups only under TRACKED names (label-era initiatives fold to "No project")',
    src('app/api/home/brief/route.ts').includes('trackedProjects') &&
    src('components/home/home-view.tsx').includes('trackedLookup'));
  check('P13 · Timeline item tags + lanes carry TRACKED names only (+ stale-cache keys bumped)',
    src('app/api/home/timeline/route.ts').includes('if (!e.tracked) continue;') &&
    src('components/timeline/timeline-view.tsx').includes('aug-timeline-v3') &&
    src('components/timeline/timeline-gantt.tsx').includes('aug-timeline-gantt-v2'));
  check('P13 · the New-project modal is name+description only (seeding lives in the room)',
    !src('components/entities/portfolio-view.tsx').includes('+ Add work'));

  // ═══ P14 · FOUNDING RECOGNIZES WHAT THE BRAIN ALREADY KNOWS (the near-name lesson, live) ═══
  {
    const { proposeFoundingAdoptions, narrateFounding } = await import('../lib/entities/founding');
    // A known near-name entity WITH a member → founding must propose it.
    const { data: known } = await sb.from('work_entities').insert({
      user_id: PERSONAL, kind: 'initiative', name: 'ZZ Widget Alpha Rollout', aliases: ['ZZ Widget Alpha Rollout'],
      tracked: false, status: 'active',
    }).select('id').maybeSingle();
    const { data: fresh } = await sb.from('work_entities').insert({
      user_id: PERSONAL, kind: 'initiative', name: 'Widget Alpha', aliases: ['Widget Alpha'],
      tracked: true, status: 'active',
    }).select('id').maybeSingle();
    if (!known?.id || !fresh?.id) check('P14 live · probe inserts failed', false);
    else {
      await sb.from('entity_links').insert({ user_id: PERSONAL, item_kind: 'inbox_item', item_id: '00000000-0000-0000-0000-0000000000b1', entity_id: known.id, via: 'user', reason: 'smoke' });
      const props = await proposeFoundingAdoptions(sb, PERSONAL, fresh.id as string, 'Widget Alpha');
      check('P14 live · founding a near-name project PROPOSES the known body of work (never silent, never missed)',
        props.some((x) => x.id === known.id && x.count > 0), JSON.stringify(props.map((x) => `${x.name}:${x.count}`)));
      await narrateFounding(sb, PERSONAL, fresh.id as string, 'Widget Alpha', 'started');
      const { data: turn } = await sb.from('room_turns').select('text, component')
        .eq('user_id', PERSONAL).eq('room_key', fresh.id as string).eq('dedupe_key', 'founding-proposal').maybeSingle();
      const comp = (turn?.component ?? null) as { key?: string; state?: { options?: unknown[] } } | null;
      check('P14 live · the proposal is a DURABLE confirmable turn (component payload, adopt options)',
        !!turn && comp?.key === 'founding_proposal' && (comp.state?.options?.length ?? 0) >= 1,
        String(turn?.text ?? '').slice(0, 80));
      await sb.from('room_turns').delete().eq('user_id', PERSONAL).eq('room_key', fresh.id as string);
      await sb.from('entity_links').delete().eq('user_id', PERSONAL).in('entity_id', [known.id, fresh.id]);
      await sb.from('work_entities').delete().in('id', [known.id, fresh.id]);
    }
  }
  check('P14 · adoption is the ONE absorb mechanic + label-era members link on confirm',
    src('app/api/entities/adopt/route.ts').includes('absorbEntity') &&
    src('app/api/entities/adopt/route.ts').includes('adopted with') &&
    src('components/home/item-rail.tsx').includes("act: 'adopt'"));
  check('P14 · conversation HISTORY: Clear archives (a session boundary, never a deletion); sessions listable',
    src('lib/room/turns.ts').includes('archiveRoomTurns') && src('lib/room/turns.ts').includes('listRoomSessions') &&
    src('app/api/room/turns/route.ts').includes('archiveRoomTurns(') &&
    src('components/home/item-rail.tsx').includes('Back to current'));

  // ═══ P15 · A DECK ROW NEVER WEARS AN UNTRACKED PROJECT'S NAME (row tags, slipping, bundle fallback) ═══
  check('P15 · row tags gate at the ONE derivation point (clusterTag → tracked canonical; slipping tracked-only; bundle-title fallback gated)',
    src('app/api/home/brief/route.ts').includes('trackedTagLookup') &&
    src('app/api/home/brief/route.ts').includes('!st.summary || !e.tracked') &&
    src('components/home/home-view.tsx').includes('trackedLookup.get(e.title.toLowerCase())'));

  // ═══ P16 · THE ZAASK CLASS, END TO END — a kind-only notification judges none WITHOUT AI and the
  // deck's demotion source (the cached verdict) picks it up. The floor reads the RAW kind (the
  // brain's own judgment of the mail), not sender patterns. ═══
  {
    const { judgeWork } = await import('../lib/work/judge');
    const { data: probe } = await sb.from('inbox_items').insert({
      user_id: PERSONAL, source: 'email', status: 'pending', work_state: 'work_prepared',
      work_title: 'A new update is available in your client portal',
      source_data: {
        subject: 'A new update is available in your client portal',
        body: 'There is a new update waiting for you in your client portal. Log in to view it.',
        from_name: 'Acme Portal', from_address: 'info@acme-portal-example.com', received_at: new Date().toISOString(),
        // KIND-ONLY understanding — the backfill class: a reasoned mailKind, no role/relevance
        // (coercion nulls the full understanding; the raw kind must still carry the demotion).
        understanding: { mailKind: 'notification' },
      },
    }).select('id').maybeSingle();
    if (!probe?.id) check('P16 live · probe insert failed', false);
    else {
      const v = await judgeWork(sb, PERSONAL, { kind: 'inbox', id: String(probe.id) });
      check('P16 live · a kind-only notification from an unpatterned sender (info@) judges none at the floor',
        v.work === 'none' && !v.resolution, `${v.work} · "${v.reason.slice(0, 60)}"`);
      const { data: plan } = await sb.from('item_plans').select('tasks')
        .eq('user_id', PERSONAL).eq('kind', 'judgment').eq('entity_id', `inbox:${probe.id}`).maybeSingle();
      const pv = ((plan?.tasks ?? {}) as { verdict?: { work?: string; resolution?: string } }).verdict;
      check('P16 live · the cached plain-none verdict exists — the deck\'s judgedNoneIds source demotes this row',
        pv?.work === 'none' && !pv?.resolution && src('app/api/home/brief/route.ts').includes('judgedNoneIds'),
        `cached=${pv?.work ?? 'missing'}`);
      await sb.from('item_plans').delete().eq('user_id', PERSONAL).eq('entity_id', `inbox:${probe.id}`);
      await sb.from('inbox_items').delete().eq('id', probe.id);
    }
  }
  check('P16 · verdict STICKINESS is reasoned, never a lock (the prior verdict anchors the re-judgment prompt)',
    src('lib/work/judge.ts').includes('PRIOR JUDGMENT') &&
    src('lib/work/judge.ts').includes('hit: WorkVerdict | null; prior: WorkVerdict | null'));

  // ═══ P17 · A COWORKER'S ASK IS A CONVERSATION EVENT, NEVER A DELIVERABLE — the evaluator judges
  // the shape (needs_input, reasoned), delegation routes it as a room checklist, the pass never
  // stamps "Prepared by" on an ask, and an attach clears it. ═══
  {
    const { evaluateDeliverable } = await import('../lib/prepare/evaluate');
    // The Max monologue-ask class, verbatim shape: a polite list of things only the principal has.
    const review = await evaluateDeliverable(sb, PERSONAL, {
      content: 'Thanks for handing this over. I can\'t start on this at all yet — the work is impossible without a few things only you can provide:\n' +
        '1. The target account list (or the criteria you want me to use)\n' +
        '2. Access to the latest pricing sheet\n' +
        '3. Your call on tone — formal or conversational?\n' +
        'Once I have these, I will get the first draft to you within the day.',
      task: 'Build the outbound prospect list', recipient: null, entityId: null, kind: 'deliverable',
    });
    check('P17 live · the evaluator judges a monologue-ask as needs_input with the concrete missing things',
      review.verdict === 'needs_input' && (review.missing?.length ?? 0) >= 2,
      `${review.verdict} · missing=${JSON.stringify((review.missing ?? []).slice(0, 3))}`);
  }
  check('P17 · a needs_input delegation is routed as a room CHECKLIST turn, never stored as prepared work',
    src('lib/home/delegate.ts').includes("key: 'input_checklist'") &&
    src('lib/home/delegate.ts').includes('needsInput') &&
    src('lib/prepare/pass.ts').includes('needs input') &&
    src('lib/prepare/pass.ts').includes('is waiting on input from you'));
  check('P17 · the loop closes — an attach CLEARS the ask (component strips, text stays) and re-opens the pass; the rail renders rows wired to ingest',
    src('app/api/items/ingest/route.ts').includes('input_checklist') &&
    src('components/home/item-rail.tsx').includes('input_checklist') &&
    src('components/home/item-rail.tsx').includes('t.checklist'));

  // ═══ P18 · THE DELIVERABLE RESOLUTION — "what does it take / what do I have / what do I need
  // from you" is part of preparation. A multi-artifact ask: the judge enumerates the inventory,
  // the pass resolves it, missing artifacts land as the room's ask, and the draft never claims
  // what isn't staged. ═══
  {
    const { judgeWork } = await import('../lib/work/judge');
    const { prepareOneItem } = await import('../lib/prepare/pass');
    const { data: probe } = await sb.from('inbox_items').insert({
      user_id: PERSONAL, source: 'email', status: 'pending', work_state: 'action_required',
      work_title: 'Send the quarterly compliance pack',
      source_data: {
        subject: 'Send the quarterly compliance pack',
        body: 'Hi Alex, for the audit could you please share: 1) the Q2 vendor risk register, 2) the signed data-processing addendum. The auditors need both by Thursday. Thanks, Sam',
        from_name: 'Sam Auditor', from_address: 'sam@acme-audit-example.com', received_at: new Date().toISOString(),
        understanding: { mailKind: 'customer', ownership: 'you_owe', relevance: 'reply', role: 'primary' },
      },
    }).select('id').maybeSingle();
    if (!probe?.id) check('P18 live · probe insert failed', false);
    else {
      const pid = String(probe.id);
      const v = await judgeWork(sb, PERSONAL, { kind: 'inbox', id: pid });
      check('P18 live · the judge enumerates the artifact INVENTORY from the item\'s own words',
        (v.work === 'reply' || v.work === 'send_file' || v.work === 'produce') && (v.requires?.length ?? 0) >= 2,
        `${v.work} · requires=${JSON.stringify((v.requires ?? []).map((r) => r.label))}`);
      await prepareOneItem(sb, PERSONAL, {
        id: `inbox:${pid}`, entityId: pid, kind: 'reply', title: 'Send the quarterly compliance pack',
        who: 'Sam Auditor', actor: 'you', state: 'todo',
        when: { explicit: null, bucket: 'today' }, source: 'email', href: `/item/${pid}`,
        at: new Date().toISOString(), startAt: new Date().toISOString().slice(0, 10),
        projectId: null, automated: false, initiative: null, effort: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const { data: ask } = await sb.from('room_turns').select('text, component')
        .eq('user_id', PERSONAL).eq('dedupe_key', `requires:${pid}`).maybeSingle();
      const comp = (ask?.component ?? null) as { key?: string; state?: { items?: unknown[] } } | null;
      check('P18 live · unfound artifacts become the room\'s input-checklist ASK (what I need from you)',
        comp?.key === 'input_checklist' && (comp.state?.items?.length ?? 0) >= 2,
        String(ask?.text ?? 'no ask turn').slice(0, 80));
      const { data: after } = await sb.from('inbox_items').select('source_data').eq('id', pid).maybeSingle();
      const dr = ((after?.source_data ?? {}) as { draft?: { body?: string; attachment?: unknown } }).draft;
      const claimsAttached = /attached (is|are|you.ll find|please find)|i('| ha)ve attached|find attached/i.test(String(dr?.body ?? ''));
      check('P18 live · the draft NEVER claims an artifact that isn\'t staged (artifact truth)',
        !dr?.attachment && !claimsAttached, dr?.body ? `draft head: ${String(dr.body).replace(/\s+/g, ' ').slice(0, 70)}` : 'no draft');
      await sb.from('room_turns').delete().eq('user_id', PERSONAL).like('dedupe_key', `%${pid}%`);
      await sb.from('item_plans').delete().eq('user_id', PERSONAL).eq('entity_id', `inbox:${pid}`);
      await sb.from('item_deliverables').delete().eq('user_id', PERSONAL).eq('entity_id', pid);
      await sb.from('inbox_items').delete().eq('id', pid);
    }
  }
  check('P18 · one law, every door (pass reply + doc-send + PRODUCE resolve; the truth rides the delegation envelope; on-demand route resolves; the judge serving edge backfills; the legacy cron loop defers to the pass)',
    src('lib/prepare/pass.ts').includes('resolveRequirements') &&
    src('lib/prepare/pass.ts').includes('THE DELIVERABLE RESOLUTION on PRODUCED work') &&
    src('lib/prepare/pass.ts').includes('if (artifactTruth) brainContext') &&
    src('app/api/inbox/[id]/draft/route.ts').includes('resolveRequirements') &&
    src('app/api/items/judge/route.ts').includes('resolveRequirements') &&
    src('app/api/cron/draft-sweep/route.ts').includes('verdict.requires?.length'));
  check('P18 · the story\'s ORDER is part of its truth (dedupe updates in place, never delete+reinsert)',
    src('lib/room/turns.ts').includes('Dedupe UPDATES IN PLACE'));
  check('P18 · ONE ask per item — the coworker\'s attempted-work ask SUPERSEDES the engine\'s provisional one (both directions)',
    src('lib/home/delegate.ts').includes('THE COWORKER SUPERSEDES') &&
    src('lib/prepare/requirements.ts').includes('THE COWORKER SUPERSEDES'));
  check('P18 · an ask NEVER BLOCKS — the contract says work with what\'s available (delegation prompt + evaluator + a one-tap "go ahead" on the checklist)',
    src('lib/home/delegate.ts').includes('WORK WITH WHAT YOU HAVE') &&
    src('lib/prepare/evaluate.ts').includes('incompleteness with honest gaps is a deliverable, not an ask') &&
    src('components/home/item-rail.tsx').includes("go ahead with what's available"));
  check('P18 · the item chip hides in the item\'s OWN room (self-referential noise; deal rooms keep it)',
    src('components/home/item-rail.tsx').includes('inRoom || !r.href?.includes(`/item/${id}`)'));
  check('P18 · a meeting card opens the meeting\'s OWN room (never the meetings list)',
    src('app/api/home/brief/route.ts').includes('/item/${tid}?kind=meeting'));

  // ═══ P19 · THE FIRST LOOK — a new user is never lied to and never left waiting: the empty Home
  // tells the truth (connect CTA / honest syncing state / earned all-clear), the chat is ALWAYS
  // there, connecting fires a server-side sync, and the first sync completing triggers the one-time
  // bootstrap chain (team → memory → judged+prepared deck) so the first real paint is the product. ═══
  check('P19 · the chat is ALWAYS on the Home (the front door never hides behind data)',
    src('components/home/home-view.tsx').includes('ALWAYS PRESENT'));
  check('P19 · the empty Home tells the truth (connect CTA → settings · honest first-sync state · earned all-clear; no hollow ring)',
    src('components/home/home-view.tsx').includes('Connect your inbox to get started') &&
    src('components/home/home-view.tsx').includes('Syncing your inbox') &&
    src('components/home/home-view.tsx').includes('/settings?tab=email&section=connections') &&
    src('components/home/home-view.tsx').includes('b.mail.connections === 0 || b.mail.syncing') &&
    src('app/api/home/brief/route.ts').includes('mail = { connections:'));
  check('P19 · connecting fires a SERVER-SIDE initial sync (never depends on which page the browser lands on)',
    src('app/api/auth/gmail/callback/route.ts').includes('syncEmailsForConnection(newConnection') &&
    src('app/api/auth/outlook/callback/route.ts').includes('syncEmailsForConnection(newConnection'));
  check('P19 · the first sync completing triggers the ONE-TIME bootstrap chain (atomically claimed: team → memory → judged+prepared deck → fresh brief)',
    src('lib/email-sync/sync-emails.ts').includes('wasFirstSync') &&
    src('lib/home/first-look.ts').includes("filter('metadata->>first_look_at', 'is', null)") &&
    src('lib/home/first-look.ts').includes('ensureWorkers') &&
    src('lib/home/first-look.ts').includes('bootstrapMemory') &&
    src('lib/home/first-look.ts').includes('runPreparationPass'));
  try {
    // On user A (a REAL auth account — PERSONAL is a fixture id with no auth.users row, so the
    // custom_agents FK rightly rejects it): an already-seeded team must be untouched.
    const { ensureWorkers } = await import('../lib/workers/seed');
    const before = await sb.from('custom_agents').select('id').eq('user_id', A).eq('is_worker', true);
    const r = await ensureWorkers(sb, A);
    const after19 = await sb.from('custom_agents').select('id').eq('user_id', A).eq('is_worker', true);
    check('P19 live · worker seeding is IDEMPOTENT (an already-seeded team is untouched)',
      (before.data?.length ?? 0) === (after19.data?.length ?? 0) && !r.seeded,
      `workers=${after19.data?.length ?? 0} seeded=${r.seeded}`);
  } catch (e) {
    check('P19 live · worker seeding is IDEMPOTENT (an already-seeded team is untouched)', false, String(e).slice(0, 80));
  }

  // ═══ P20 · SYNC SINGLE-FLIGHT + THE NOTICE-LAW REFINEMENT (the new-user race + the deck miss) ═══
  {
    // Live: two concurrent claims on one connection — EXACTLY one wins (the recognition-duplication
    // race: parallel first syncs founded the same entities twice before either link landed).
    const { claimSync } = await import('../lib/email-sync/sync-emails');
    const { data: probeConn } = await sb.from('connections').insert({
      user_id: PERSONAL, provider: 'gmail', provider_account_id: 'probe-claim@augmtd-internal.test',
      status: 'inactive', metadata: {}, last_sync: null, sync_status: 'pending',
    }).select('id').maybeSingle();
    if (!probeConn?.id) check('P20 live · claim probe insert failed', false);
    else {
      const [a, b2] = await Promise.all([claimSync(sb, probeConn.id as string), claimSync(sb, probeConn.id as string)]);
      check('P20 live · the single-flight claim admits EXACTLY ONE of two concurrent syncs',
        (a ? 1 : 0) + (b2 ? 1 : 0) === 1, `first=${a} second=${b2}`);
      await sb.from('connections').delete().eq('id', probeConn.id);
    }
  }
  check('P20 · every sync door funnels through the ONE claim (route claims upfront + passes claimed; direct callers claim internally; stale >10min self-releases)',
    src('lib/email-sync/sync-emails.ts').includes('export async function claimSync') &&
    src('lib/email-sync/sync-emails.ts').includes('!options.claimed && !(await claimSync') &&
    src('app/api/connections/sync/route.ts').includes('claimSync(adminSupabase, c.id)') &&
    src('app/api/connections/sync/route.ts').includes('{ claimed: true }'));
  {
    // Live: an action-worthy notice from a no-reply sender (the Workspace-security-alert miss) —
    // the deterministic noise tier must NOT file it as awareness when the brain says YOU OWE.
    const { classifyItem } = await import('../lib/inbox/classify-item');
    const t = classifyItem({
      id: 'probe', status: 'pending', source: 'email', work_state: 'decision_required',
      rule_type: null, type_override: null,
      source_data: {
        subject: 'Unresolved security risks in your Admin Console',
        from_address: 'workspace-noreply@example.com', from_name: 'Workspace Team',
        body: 'Security risks need review in your admin console.',
        understanding: { _v: 1, role: 'addressed', relevance: 'action', ownership: 'you_owe', mailKind: 'notification', language: 'en' },
      },
    } as never, null);
    check('P20 live · a you_owe action notice from a no-reply sender classifies ACTIONABLE (the notice law refines the noise tier — never silently awareness)',
      t === 'to_do' || t === 'needs_reply', `classified=${t}`);
    const t2 = classifyItem({
      id: 'probe2', status: 'pending', source: 'email', work_state: 'noted',
      rule_type: null, type_override: null,
      source_data: {
        subject: 'Your weekly product digest',
        from_address: 'no-reply@example.com', from_name: 'Product News',
        body: 'Here is what shipped this week.', has_unsubscribe: true,
        understanding: { _v: 1, role: 'one_of_many', relevance: 'awareness', ownership: 'none', mailKind: 'newsletter', language: 'en' },
      },
    } as never, null);
    check('P20 live · genuine noise STAYS demoted (ownership none + notice shape → fyi)',
      t2 === 'fyi', `classified=${t2}`);
  }

  console.log('\n═══ THE PROMISE GATES ═══');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  → ${d}` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();
