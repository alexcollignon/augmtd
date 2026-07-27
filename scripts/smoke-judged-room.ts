// THE JUDGED ROOM GATES (docs/judged-room-plan.md).
//   J1 — ONE work judgment: brain in view, structural floors first, registry-read components,
//   conservative none, cached verdict; the H4 law imported (never re-implemented).
import { config } from 'dotenv'; config({ path: '.env.local' });
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { judgeWork } from '../lib/work/judge';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const A = '08fe4449-e5eb-431d-9156-02e9324e5903';
const B = 'c723c2f2-e069-4ab8-980e-ac3585028fec';
const PERSONAL = 'e009a499-41d4-4c44-ad53-53a0e851d143';
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  // ── J1 STRUCTURAL ──
  check('J1: the ownership notice law lives in ONE module, imported by the brief route AND the judge',
    src('app/api/home/brief/route.ts').includes("from '@/lib/inbox/notice-demotion'") &&
    src('lib/work/judge.ts').includes("from '@/lib/inbox/notice-demotion'") &&
    !src('app/api/home/brief/route.ts').includes('function isActionWorthyAutomated'));
  check('J1: the judge reads the REGISTRY for its component options (never a hardcoded enum in the prompt)',
    src('lib/work/judge.ts').includes('renderComponentOptions()') &&
    src('lib/work/judge.ts').includes('COMPONENT_KEYS.has(component)'));
  check('J1: conservative floors — none is always legal; an unrecognized coworker never invents one',
    src('lib/work/judge.ts').includes("fallbackVerdict('could not judge") &&
    src('lib/work/judge.ts').includes("executor.kind = 'user'; // an unrecognized name never invents a coworker"));
  check('J1: the gate derives from the registry (gateOf), never from the model',
    src('lib/work/judge.ts').includes('gate: gateOf(component'));
  check('J1: work↔component coherence is STRUCTURAL — a drifted component half is coerced from the registry (componentForWork)',
    src('lib/work/judge.ts').includes('componentForWork(work)') &&
    src('lib/work/surface-registry.ts').includes('export const componentForWork'));

  // ── J1 LIVE across users ──
  const todayStr = new Date().toISOString().slice(0, 10);
  for (const [uid, label] of [[A, 'user A'], [B, 'user B']] as const) {
    // A real unanswered human reply item (via the spine's honest definition).
    const { buildWorkItems } = await import('../lib/work-items/model');
    const { isAutomatedSenderStrong } = await import('../lib/inbox/notice-demotion');
    const items = await buildWorkItems(sb, uid, { todayStr, skipReconcile: true });
    let replyProbe: { entityId: string } | null = null;
    const { computeThreadReplyState } = await import('../lib/inbox/thread-resolution');
    for (const w of items.filter((x) => x.kind === 'reply' && x.id.startsWith('inbox:') && x.state === 'todo' && !x.automated).slice(0, 8)) {
      const { data: it } = await sb.from('inbox_items').select('source_data').eq('id', w.entityId).maybeSingle();
      const sd = (it?.source_data ?? {}) as Record<string, unknown>;
      if (isAutomatedSenderStrong((sd.from_address as string) ?? null, (sd.from_name as string) ?? null, (sd.subject as string) ?? null)) continue;
      // Skip threads the user has ALREADY answered — the judge's structural floor rightly says
      // none there (the same shared reply-state computation, imported not re-implemented).
      if (sd.thread_id) {
        const { data: msgs } = await sb.from('emails').select('is_from_user, received_at')
          .eq('user_id', uid).eq('thread_id', String(sd.thread_id)).limit(50);
        if (msgs?.length && computeThreadReplyState(msgs as never).lastMessageFromUser) continue;
      }
      replyProbe = { entityId: w.entityId }; break;
    }
    if (!replyProbe) { check(`${label} · reply verdict (vacuous — no human reply items)`, true); }
    else {
      const v1 = await judgeWork(sb, uid, { kind: 'inbox', id: replyProbe.entityId });
      check(`${label} · an unanswered human ask judges a real component (not none)`,
        v1.component !== 'message_only', `${v1.work}/${v1.component} · ${v1.executor.kind} · "${v1.reason.slice(0, 60)}"`);
      const v2 = await judgeWork(sb, uid, { kind: 'inbox', id: replyProbe.entityId });
      check(`${label} · the verdict is CACHED (identical on re-judge)`,
        v2.work === v1.work && v2.component === v1.component, `${v2.work}/${v2.component}`);
    }
    // An ownership-none notice → structural none (no AI).
    const { data: notices } = await sb.from('inbox_items').select('id, source_data').eq('user_id', uid).eq('status', 'pending').limit(60);
    const noticeRow = ((notices ?? []) as Array<{ id: string; source_data: Record<string, unknown> }>)
      .find((r) => {
        const u = (r.source_data?.understanding ?? null) as { ownership?: string; mailKind?: string } | null;
        return u?.ownership === 'none' && (u?.mailKind === 'notification' || u?.mailKind === 'calendar');
      });
    if (!noticeRow) { check(`${label} · notice → none (vacuous — no ownership-none notices)`, true); }
    else {
      const vn = await judgeWork(sb, uid, { kind: 'inbox', id: noticeRow.id });
      check(`${label} · an ownership-none notice judges NONE (structural floor)`,
        vn.component === 'message_only' && /notice|nobody owes/i.test(vn.reason), `${vn.work}/${vn.component} · "${vn.reason.slice(0, 50)}"`);
    }
  }

  // ── J1 LIVE — the decide + chase shapes on synthetic probes (personal account, cleaned up). ──
  const mkProbe = async (subject: string, body: string) => {
    const { data } = await sb.from('inbox_items').insert({
      user_id: PERSONAL, source: 'email', status: 'pending', work_state: 'work_prepared',
      work_title: subject,
      source_data: { subject, body, from_name: 'Sam Vendor', from_address: 'sam@acme-example.com', received_at: new Date().toISOString() },
    }).select('id').maybeSingle();
    return data?.id as string | undefined;
  };
  const dId = await mkProbe('Speaker slot — need your yes/no',
    'Hi, we would love you to speak at the Acme summit on Sep 12. If you are in, we lock the slot; if not, we offer it to the runner-up this week. Could you let us know either way?');
  if (dId) {
    const vd = await judgeWork(sb, PERSONAL, { kind: 'inbox', id: dId });
    check('probe · a stated either-way choice judges DECIDE with options',
      vd.work === 'decide' && (vd.options?.length ?? 0) >= 2, `${vd.work}/${vd.component} · options=${vd.options?.length ?? 0}`);
    await sb.from('item_plans').delete().eq('user_id', PERSONAL).eq('kind', 'judgment').eq('entity_id', `inbox:${dId}`);
    await sb.from('inbox_items').delete().eq('id', dId);
  } else check('probe · decide insert failed', false);

  // Distinct persona — the shared probe sender accumulates person-state across suites, which can
  // bias the judgment (a real cross-contamination we hit: "Sam awaits your availability").
  const { data: chaseC } = await sb.from('commitments').insert({
    user_id: PERSONAL, description: 'ZZ-judge probe — Vera owes the signed venue contract', direction: 'awaiting',
    counterparty: 'Vera Contractor', source: 'manual', source_id: 'zz-judge-chase', status: 'open',
  }).select('id').maybeSingle();
  if (chaseC) {
    const vc = await judgeWork(sb, PERSONAL, { kind: 'commitment', id: chaseC.id });
    check('probe · an awaiting commitment judges CHASE', vc.work === 'chase' && vc.component === 'chase',
      `${vc.work}/${vc.component} · "${vc.reason.slice(0, 50)}"`);
    await sb.from('item_plans').delete().eq('user_id', PERSONAL).eq('kind', 'judgment').eq('entity_id', `commitment:${chaseC.id}`);
    await sb.from('commitments').delete().eq('id', chaseC.id);
  } else check('probe · chase insert failed', false);

  // ── J3 LIVE — a steer rework writes NEW pool versions (never mutates), evaluator-reviewed ──
  const rwId = await mkProbe('Pricing follow-up — quick question',
    'Hi, quick one: could you send over the updated pricing for the pilot? We want to compare with the other vendor by Friday. Thanks, Sam');
  if (rwId) {
    await sb.from('inbox_items').update({
      source_data: {
        subject: 'Pricing follow-up — quick question', body: 'Hi, quick one: could you send over the updated pricing for the pilot?',
        from_name: 'Sam Vendor', from_address: 'sam@acme-example.com', received_at: new Date().toISOString(),
        draft: { body: 'ORIGINAL DRAFT — Hi Sam, here is the pricing overview you asked for. Best.', generated_at: new Date().toISOString() },
      },
    }).eq('id', rwId);
    const { converse } = await import('../lib/converse');
    const turn = await converse(sb, PERSONAL, { kind: 'item', itemKind: 'email', itemId: rwId }, 'Shorten the reply and say the pricing follows by Friday');
    const { data: vers } = await sb.from('item_deliverables').select('title, content, metadata')
      .eq('user_id', PERSONAL).eq('kind', 'email').eq('entity_id', rwId).eq('type', 'draft');
    const rows = (vers ?? []) as Array<{ title: string; content: string; metadata: Record<string, unknown> }>;
    const prior = rows.find((r) => (r.metadata as { superseded?: boolean }).superseded);
    const next = rows.find((r) => (r.metadata as { steered?: boolean }).steered && !(r.metadata as { superseded?: boolean }).superseded);
    check('J3 · a steer rework RETAINS the prior draft as a pool version (never mutates history)',
      !!prior && prior.content.startsWith('ORIGINAL DRAFT'), `versions=${rows.length}`);
    check('J3 · the reworked draft lands as the NEXT pool version and re-seeds the surface',
      !!next && !!turn.draft && next.content === turn.draft, `draft=${(turn.draft ?? '').slice(0, 40)}`);
    const { getPrepared } = await import('../lib/prepare/read');
    const prep = await getPrepared(sb, PERSONAL, { kind: 'inbox_item', id: rwId });
    check('J3 · version rows are LEDGER, not surface — getPrepared serves only the current pointer',
      prep.filter((p) => p.kind === 'deliverable').length === 0 && prep.some((p) => p.kind === 'reply_draft'),
      `served=${prep.map((p) => p.kind).join(',')}`);
    await sb.from('item_deliverables').delete().eq('user_id', PERSONAL).eq('entity_id', rwId);
    await sb.from('item_plans').delete().eq('user_id', PERSONAL).eq('entity_id', `inbox:${rwId}`);
    await sb.from('inbox_items').delete().eq('id', rwId);
  } else check('J3 · rework probe insert failed', false);

  // ── J2/J4 STRUCTURAL — the verdict drives the surface AND the pass (one judgment, no drift) ──
  const detail = src('components/home/item-detail.tsx');
  check('J2: the deep-dive fetches THE verdict and mounts from it (composer open only on reply; decide mounts the DecisionCard)',
    detail.includes('/api/items/judge?kind=inbox') && detail.includes("d.verdict.work === 'reply'") && detail.includes('<DecisionCard'));
  check('J2: the DecisionCard is the ONE shared component (decline always last; choosing speaks via steer)',
    src('components/work/decision-card.tsx').includes('Leave it with me') && detail.includes("kind: 'email', id, text: label"));
  check('J4: the pass prepares FROM the judged verdict (same cached judgment as the surface)',
    src('lib/prepare/pass.ts').includes('judgeWork(admin, userId') && src('lib/prepare/pass.ts').includes("verdict.work === 'send_file'"));
  check('J4: a send reports back INTO the deal conversation (keyed turn, deduped)',
    detail.includes('`sent:${id}`'));

  // ── J2 VISUAL — the Scape order: message card → mounted work → one commit line ──
  const threadSrc = src('components/inbox/thread-messages.tsx');
  check('J2v: the shared thread renderer has a COMPACT mode (all history folded, latest height-capped)',
    threadSrc.includes('compact ? 0 : 2') && threadSrc.includes('CappedBody'));
  check('J2v: the capped card only grows "Show full message" when the body ACTUALLY overflows',
    threadSrc.includes('scrollHeight > el.clientHeight') && threadSrc.includes('Show full message'));
  check('J2v: the email + follow-up deep-dives render the message compact (the mail client stays the Inbox\'s job)',
    (detail.match(/compact \/>/g)?.length ?? 0) >= 2);
  check('J2v: no bottom dock — the composer mounts INLINE beneath the message (both composers)',
    !detail.includes('Docked reply composer') && !detail.includes('Docked nudge composer') &&
    !detail.includes('max-h-[45vh]'));
  check('J2v: the commitment deep-dive mounts from THE verdict (chase/reply → composer open, no button gate)',
    detail.includes('/api/items/judge?kind=commitment') && detail.includes("d.verdict.work === 'chase' || d.verdict.work === 'reply'"));
  check('J2v: the rail skips a next-move that ECHOES the anchor ask (mechanical dedup, hand-off kept)',
    src('components/home/item-rail.tsx').includes('echoesAnchor(ent.nextMove'));
  check('J2v: a judged doc-send mounts PREFILLED — the resolved file auto-attaches as the standard ✕-removable chip (one-shot)',
    detail.includes('preparedAttachRef') && detail.includes("kind === 'reply_draft')?.attachment") &&
    detail.includes('atts.onKbSelect([{ id: preparedAttachment.fileId'));

  // ── J5 — THE PARITY MATRIX (docs/judged-room-plan.md): one shell everywhere ──
  // Live: a scheduling ask judges schedule/invite.
  const schId = await mkProbe('Intro call — which slot works?',
    'Hi, great meeting you at the fair. Could we set up a 30-minute intro call next week — Tuesday or Wednesday morning both work on our side. Happy to send times. Best, Sam');
  if (schId) {
    const vs = await judgeWork(sb, PERSONAL, { kind: 'inbox', id: schId });
    check('J5 · a scheduling ask judges a scheduling-shaped move (schedule, reply-with-times, or the slot DECISION)',
      vs.work === 'schedule' || vs.work === 'reply' || vs.work === 'decide', `${vs.work}/${vs.component}`);
    await sb.from('item_plans').delete().eq('user_id', PERSONAL).eq('kind', 'judgment').eq('entity_id', `inbox:${schId}`);
    await sb.from('inbox_items').delete().eq('id', schId);
  } else check('J5 · schedule probe insert failed', false);

  // Structural: ONE plane serves both doors — the room embeds the SAME ItemDetail the /item door renders.
  const room = src('components/entities/entity-room.tsx');
  check('J5 · one plane, both doors — the project room embeds the SAME ItemDetail (never a second thread renderer)',
    room.includes("from '@/components/home/item-detail'") && room.includes('embedded') && !room.includes('<ThreadMessages'));
  // Structural: tracked = project chrome; untracked = quiet "Connects to"; loose = founding chip.
  // (One-room R3 moved this per-anchor context OUT of the conversation into the STAGE's strip.)
  const strip = src('components/room/context-strip.tsx');
  check('J5 · tracked/untracked/loose parity — same shell, only the CONTEXT STRIP changes (Connects-to vs project vs founding chip)',
    strip.includes("tracked === false ? 'Connects to' : 'In'") && strip.includes('Start a project from this'));
  // Structural: a meeting's proposed tasks gate through Accept/Reject (never on the board until accepted).
  check('J5 · meeting → proposals gate through Accept/Reject in the room',
    room.includes('Accept all') && room.includes("setProposedStatus(p.id, 'open')"));
  // Structural: a multi-ask motion = ONE composer + the steps checklist (never N surfaces).
  check('J5 · multi-ask motion — ONE composer with the steps checklist (view serves steps; the detail mounts it)',
    src('app/api/items/view/route.ts').includes("kind === 'commitment' && tasks.length >= 2") &&
    detail.includes('<MotionChecklist'));
  // Live sweep — which matrix rows each user's real data instantiates (vacuous rows named honestly).
  for (const [uid, label] of [[A, 'user A'], [B, 'user B']] as const) {
    const [tracked, loose, proposed, multi] = await Promise.all([
      sb.from('work_entities').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('kind', 'initiative').eq('tracked', true).eq('status', 'active'),
      sb.from('entity_links').select('id', { count: 'exact', head: true }).eq('user_id', uid).is('entity_id', null),
      sb.from('commitments').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'suggested'),
      sb.from('item_plans').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('kind', 'commitment'),
    ]);
    check(`J5 · ${label} matrix coverage (tracked/loose/proposed/multi-ask present or honestly vacuous)`, true,
      `tracked=${tracked.count ?? 0} loose-links=${loose.count ?? 0} proposed=${proposed.count ?? 0} motion-plans=${multi.count ?? 0}`);
  }

  console.log('\n════ THE JUDGED ROOM GATES ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  → ${d}` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();
