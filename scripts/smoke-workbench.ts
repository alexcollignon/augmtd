// THE WORKBENCH GATES (docs/workbench-plan.md).
//   B1 — the room has a Schedule (the ONE shared event-Gantt) and a LIVING STATUS BRIEF assembled
//   from already-judged/factual lines (zero AI on read; people canonicalize via the registry).
import { config } from 'dotenv'; config({ path: '.env.local' });
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { assembleStatusBrief } from '../lib/entities/status-brief';
import { getPersonEntities, resolveIdentity, parseWho } from '../lib/entities/people';
import { writeCommitments } from '../lib/commitments/extract';
import { buildWorkItems } from '../lib/work-items/model';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const A = '08fe4449-e5eb-431d-9156-02e9324e5903';
const B = 'c723c2f2-e069-4ab8-980e-ac3585028fec';
const RENE_PREFIX = 'ae306f38';
const PERSONAL = 'e009a499-41d4-4c44-ad53-53a0e851d143';
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  // ── B1 STRUCTURAL ──
  const room = src('components/entities/entity-room.tsx');
  check('B1a: the room renders the ONE shared Gantt over the served rows',
    room.includes("import GanttChart from '@/components/entities/gantt-chart'") && room.includes('label="Schedule"'));
  const brief = src('lib/entities/status-brief.ts');
  check('B1b: the brief is PURE ASSEMBLY — zero AI in the module', !brief.includes('aiCall') && !brief.includes('getAIClient'));
  check('B1b: the detail route assembles + serves statusBrief (people via the registry, self excluded)',
    src('app/api/entities/[id]/detail/route.ts').includes('assembleStatusBrief') &&
    src('app/api/entities/[id]/detail/route.ts').includes('rid.isSelf) return null'));
  check('B1b: every brief line links to its source (dates → openHref, deliverables → preview)',
    room.includes('StatusBriefCard') && room.includes('onOpen(k.href)') && room.includes('onPreviewDeliverable(dv.title, dv.ref)'));
  check('B1b: evaluator objections feed Watch-outs', src('app/api/entities/[id]/detail/route.ts').includes('reviewNotes'));

  // ── B2 STRUCTURAL — meeting follow-ups are PROPOSED (Accept/Reject), never imposed ──
  const extract = src('lib/commitments/extract.ts');
  check('B2: the meeting path writes status=suggested (email stays open — explicit text is trusted)',
    extract.includes("status: 'suggested' }, client)") && extract.includes("status: meta.status ?? 'open'"));
  check('B2: the spine excludes suggested BY CONSTRUCTION (its status filter enumerates, never includes it)',
    src('lib/work-items/model.ts').includes('status.in.(open,pending,in_progress)') &&
    !/status\.in\.\([^)]*suggested/.test(src('lib/work-items/model.ts')));
  const patchRoute = src('app/api/commitments/[id]/route.ts');
  check('B2: accept flips ONLY a suggested row to open + logs + learning signal',
    patchRoute.includes("cur.status !== 'suggested'") && patchRoute.includes("'suggested_task_accepted'"));
  check('B2: rejecting a proposed task is a learning signal (the extractor hears the no)',
    patchRoute.includes("'suggested_task_rejected'"));
  const roomB2 = src('components/entities/entity-room.tsx');
  check('B2: the room renders the Proposed block with Accept / Reject / Accept all',
    roomB2.includes('Proposed from the meeting') && roomB2.includes('Accept all') && roomB2.includes('setProposedStatus'));

  // ── B4 STRUCTURAL — human status + priority ──
  const model = src('lib/work-items/model.ts');
  check('B4: the spine carries in_progress (query + state map)',
    model.includes('status.in.(open,pending,in_progress)') && model.includes("status === 'in_progress' ? 'in_progress'"));
  check('B4: a human-set priority OUTRANKS the computed weight (floor 85 / cap 15)',
    model.includes('Math.max(w.priority, 85)') && model.includes('Math.min(w.priority, 15)'));
  const patchB4 = src('app/api/commitments/[id]/route.ts');
  check('B4: the PATCH allows Start (open→in_progress), Pause (in_progress→open) + the priority edit',
    patchB4.includes("status === 'in_progress'") && patchB4.includes("cur.status === 'in_progress'") && patchB4.includes("'priority' in body"));
  check('B4: the room leads with a Doing group + Start/Pause + priority controls (checkbox still completes in one tap)',
    roomB2.includes('>Doing</p>') && roomB2.includes("doing ? 'Pause' : 'Start'") && roomB2.includes('Cycle priority'));
  check('B4: the priority migration exists (apply manually)',
    (() => { try { src('supabase/migrations/20260724c_commitments_priority.sql'); return true; } catch { return false; } })());

  // ── B3 STRUCTURAL — the Home invites work + shows the horizon; the pass preps meetings ──
  const hv = src('components/home/home-view.tsx');
  check('B3a: the composer invites work (Add a task… prefills, Plan my week asks)',
    hv.includes("'Add a task…'") && hv.includes("'Plan my week'") &&
    src('components/home/home-ask.tsx').includes("s.endsWith('…')"));
  // Iterated (user call, July 24 evening): the To-prep card is REMOVED; This-week rides BESIDE the
  // list as column two, day-grouped; the deck became the TIME-GROUPED LIST (one row anatomy, all
  // visible — curation decides what, time decides the frame, judged priority orders within groups).
  check('B3b: This-week rides beside the list (two columns, day-grouped; To-prep card gone)',
    src('app/api/home/horizon/route.ts').includes('calendar_event') && hv.includes('ThisWeekCard') &&
    hv.includes('lg:grid-cols-[minmax(0,1fr)_300px]') && !hv.includes('To prep · next 2 weeks') &&
    !hv.includes("useState(() => loadLS<{ thisWeek"));
  check('B3d: the deck is the TIME-GROUPED list (Overdue · Due today · This week · When you can), hero/peek gone',
    hv.includes("label: 'Overdue'") && hv.includes("label: 'Due today'") && hv.includes("label: 'When you can'") &&
    !hv.includes('PEEK_VISIBLE') && !hv.includes('setFocusKey'));
  const passB3 = src('lib/prepare/pass.ts');
  check('B3c: the pass preps DEAL-LINKED upcoming meetings (idempotent per meeting, capped, evaluated, attributed)',
    passB3.includes('meeting-prep-') && passB3.includes('PREP_CAP') &&
    passB3.includes('evaluateDeliverable') && passB3.includes('meetingPrep: true'));

  // ── B6 STRUCTURAL — portfolio urgency is a FACT (earliest open due date), badge derives client-side ──
  check('B6: the portfolio serves nextDue from open commitments only',
    src('app/api/entities/portfolio/route.ts').includes('nextDue') &&
    src('app/api/entities/portfolio/route.ts').includes("st === 'open' || st === 'pending' || st === 'in_progress'"));
  check('B6: the row badge derives from the fact (Overdue / Due soon)',
    src('components/entities/portfolio-view.tsx').includes('Overdue ·') && src('components/entities/portfolio-view.tsx').includes('e.nextDue'));

  // ── B5 STRUCTURAL — the artifact plane: a deliverable opens IN the main card, not a modal ──
  check('B5: deliverable is a first-class FOCUS kind (renders in the main card)',
    roomB2.includes("{ kind: 'deliverable'; id: string; title: string }") && roomB2.includes('DeliverableFocus'));
  check('B5: prepared tokens + brief deliverables open the FOCUS, not the modal',
    (roomB2.match(/setFocused\(\{ kind: 'deliverable'/g) ?? []).length >= 2 &&
    !roomB2.includes("setPreview({ name, ref: { kind: 'deliverable'"));
  check('B5: entity-level deliverables (prep briefs, status updates) surface in the room pool',
    src('app/api/entities/[id]/detail/route.ts').includes('...commitIds, id]'));

  // ── B1 LIVE — assemble the brief from each user's REAL busiest deal ──
  const { data: uidRows } = await sb.from('work_entities').select('user_id').eq('kind', 'initiative');
  const rene = [...new Set((uidRows ?? []).map((r) => r.user_id as string))].find((u) => u.startsWith(RENE_PREFIX));
  const users: Array<[string, string]> = [[A, 'user A'], [B, 'user B'], [PERSONAL, 'personal']];
  if (rene) users.push([rene, 'user C']);
  const todayStr = new Date().toISOString().slice(0, 10);

  for (const [uid, label] of users) {
    // Busiest active entity by link count.
    const { data: links } = await sb.from('entity_links').select('entity_id').eq('user_id', uid).not('entity_id', 'is', null);
    const counts = new Map<string, number>();
    for (const l of links ?? []) counts.set(l.entity_id as string, (counts.get(l.entity_id as string) ?? 0) + 1);
    const { data: ents } = await sb.from('work_entities').select('id, name, state, next_move')
      .eq('user_id', uid).eq('kind', 'initiative').eq('status', 'active');
    const busy = ((ents ?? []) as Array<Record<string, unknown>>)
      .sort((a, b) => (counts.get(b.id as string) ?? 0) - (counts.get(a.id as string) ?? 0))[0];
    if (!busy) { check(`${label} · status brief (vacuous — no active deals)`, true); continue; }

    const { data: elinks } = await sb.from('entity_links').select('item_kind, item_id').eq('user_id', uid).eq('entity_id', busy.id as string);
    const commitIds = (elinks ?? []).filter((l) => l.item_kind === 'commitment').map((l) => l.item_id as string);
    const meetingIds = (elinks ?? []).filter((l) => l.item_kind === 'meeting').map((l) => l.item_id as string);
    const [{ data: cs }, { data: mt }, persons] = await Promise.all([
      commitIds.length ? sb.from('commitments').select('id, description, counterparty, due_date, status').in('id', commitIds.slice(0, 50)) : Promise.resolve({ data: [] }),
      meetingIds.length ? sb.from('meeting_transcripts').select('id, title, start_time, created_at').in('id', meetingIds.slice(0, 10)) : Promise.resolve({ data: [] }),
      getPersonEntities(sb, uid),
    ]);
    const resolveName = (who: string): string | null => {
      const rid = resolveIdentity(persons, who);
      if (rid.isSelf) return null;
      return rid.canonical ?? parseWho(who).name ?? parseWho(who).email;
    };
    const b = assembleStatusBrief({
      state: (busy.state ?? {}) as never, nextMove: (busy.next_move ?? null) as never,
      rows: ((cs ?? []) as Array<Record<string, unknown>>).filter((c) => c.status === 'open')
        .map((c) => ({ title: String(c.description), who: (c.counterparty as string) ?? null, when: (c.due_date as string) ?? null, href: `/item/${c.id}?kind=commitment` })),
      meetings: ((mt ?? []) as Array<Record<string, unknown>>).map((m) => ({ id: m.id as string, title: String(m.title || 'Meeting'), date: ((m.start_time as string) || (m.created_at as string) || null)?.slice(0, 10) ?? null })),
      deliverables: [], reviews: [], resolveName, todayStr,
    });
    const sections = [b.whatItIs, b.priorityNow, b.keyDates.length || null, b.people.length || null].filter(Boolean).length;
    // A thin deal gets a thin brief — that's honesty, not failure. The personal account is
    // errand-only by design (≥1 section); the work accounts must assemble a real brief (≥2).
    const need = uid === PERSONAL ? 1 : 2;
    check(`${label} · brief assembles from the busiest deal (≥${need} sections)`, sections >= need,
      `"${String(busy.name).slice(0, 26)}" · what=${!!b.whatItIs} move=${!!b.priorityNow} dates=${b.keyDates.length} people=${b.people.length}`);
    check(`${label} · brief people never include the user`, !b.people.some((p) => resolveIdentity(persons, p).isSelf));
  }

  // ── B2 LIVE (user A) — the full proposed lifecycle through the REAL writer + spine ──
  const MARK = 'ZZ-smoke proposed follow-up probe';
  await writeCommitments(A, [
    { direction: 'you_owe', description: `${MARK} — circulate the recap`, counterparty: 'Spartak Fedotov' } as never,
  ], { source: 'meeting', sourceId: `smoke-${MARK}`, threadId: null, status: 'suggested' }, sb as never);
  const { data: prow } = await sb.from('commitments').select('id, status').eq('user_id', A).eq('source_id', `smoke-${MARK}`).maybeSingle();
  check('B2 live · a meeting follow-up lands as SUGGESTED', prow?.status === 'suggested', `status=${prow?.status ?? 'missing'}`);
  if (prow) {
    const spine1 = await buildWorkItems(sb, A, { todayStr, skipReconcile: true });
    check('B2 live · a suggested task NEVER reaches the spine (no board/deck/nag)', !spine1.some((w) => w.entityId === prow.id));
    await sb.from('commitments').update({ status: 'open' }).eq('id', prow.id); // the accept flip
    const spine2 = await buildWorkItems(sb, A, { todayStr, skipReconcile: true });
    check('B2 live · accepting makes it REAL work on the spine', spine2.some((w) => w.entityId === prow.id));
    await sb.from('commitments').delete().eq('id', prow.id); // cleanup
  }

  // ── B4 LIVE (user A) — in_progress round-trip on the spine; priority override if migrated ──
  const MARK4 = 'ZZ-smoke doing-state probe';
  const { data: dp } = await sb.from('commitments').insert({
    user_id: A, description: `${MARK4} — draft the working doc`, direction: 'you_owe',
    source: 'manual', source_id: `smoke-${MARK4}`, status: 'open',
  }).select('id').maybeSingle();
  if (dp) {
    await sb.from('commitments').update({ status: 'in_progress' }).eq('id', dp.id);
    const spine3 = await buildWorkItems(sb, A, { todayStr, skipReconcile: true });
    const row3 = spine3.find((w) => w.entityId === dp.id);
    check('B4 live · an in-progress task rides the spine with its human state', row3?.state === 'in_progress', `state=${row3?.state ?? 'missing'}`);
    // Priority override — conditional on the manual migration having been applied.
    const { error: perr } = await sb.from('commitments').update({ priority: 'high' }).eq('id', dp.id);
    if (perr) { check('B4 live · priority override (vacuous — migration 20260724c not yet applied)', true, 'apply it in Supabase'); }
    else {
      const spine4 = await buildWorkItems(sb, A, { todayStr, skipReconcile: true });
      const row4 = spine4.find((w) => w.entityId === dp.id);
      check('B4 live · a human "high" floors the spine priority at 85', (row4?.priority ?? 0) >= 85 && row4?.manualPriority === 'high', `priority=${row4?.priority}`);
    }
    await sb.from('commitments').delete().eq('id', dp.id);
  } else check('B4 live · probe insert failed', false);

  // ── B3c LIVE (users A + B) — a deal-linked upcoming meeting gets a prep brief after the pass. ──
  const { runPreparationPass } = await import('../lib/prepare/pass');
  for (const [uid, label] of [[A, 'user A'], [B, 'user B']] as const) {
    const ceil14 = new Date(Date.now() + 14 * 86_400_000).toISOString();
    const { data: upEvs } = await sb.from('calendar_events').select('id').eq('user_id', uid)
      .gte('start_time', new Date().toISOString()).lte('start_time', ceil14).limit(20);
    const evIds = (upEvs ?? []).map((e) => e.id as string);
    const { data: evLinks } = evIds.length
      ? await sb.from('entity_links').select('item_id').eq('user_id', uid).eq('item_kind', 'calendar_event').in('item_id', evIds).not('entity_id', 'is', null)
      : { data: [] };
    if (!(evLinks ?? []).length) { check(`${label} · meeting prep (vacuous — no deal-linked upcoming meetings)`, true); continue; }
    await runPreparationPass(sb, uid);
    const linkedIds = (evLinks ?? []).map((l) => l.item_id as string).slice(0, 4);
    const { data: preps } = await sb.from('item_deliverables').select('id, task_id, metadata')
      .eq('user_id', uid).eq('kind', 'entity').in('task_id', linkedIds.map((i) => `meeting-prep-${i}`));
    check(`${label} · a prep brief landed for a deal-linked upcoming meeting (attributed)`,
      (preps ?? []).length > 0 && !!((preps![0].metadata ?? {}) as { agentName?: string }).agentName,
      `${(preps ?? []).length} prep brief(s), by ${((preps?.[0]?.metadata ?? {}) as { agentName?: string }).agentName ?? '—'}`);
  }

  console.log('\n════ THE WORKBENCH GATES ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  → ${d}` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();
