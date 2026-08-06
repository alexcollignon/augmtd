// THE WORK SURFACE GATES (docs/work-surface-plan.md).
//   T — trust: a forward is not fulfillment (resolution floor); self-artifact debris swept; no
//       drafts for automated senders (all entries + the evaluator's structural check); the
//       Accepted boundary holds in presentation (untracked = quiet context, no posture pills).
import { config } from 'dotenv'; config({ path: '.env.local' });
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { computeThreadReplyState, messagesForResolution, threadCounterpartyEmail, type ThreadMessage } from '../lib/inbox/thread-resolution';
import { getPersonEntities, resolveIdentity } from '../lib/entities/people';
import { evaluateDeliverable } from '../lib/prepare/evaluate';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const A = '08fe4449-e5eb-431d-9156-02e9324e5903';
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  // ── T1 STRUCTURAL + PURE-LOGIC ──
  check('T1: both resolvers apply the resolution floor (messagesForResolution)',
    src('lib/inbox/resolve-on-reply.ts').includes('messagesForResolution(messages, cp)') &&
    src('lib/inbox/resolve-on-reply.ts').includes('messagesForResolution(messages, threadCp)'));
  check('T1: both callers supply sender + recipients',
    src('lib/inbox/reconcile-replied.ts').includes('to_addresses, cc_addresses') &&
    src('lib/email-sync/sync-emails.ts').includes('from_address, to_addresses, cc_addresses'));
  // The Spartak shape, as pure logic: inbound from the counterparty, then a user FORWARD to a colleague.
  const msgs: ThreadMessage[] = [
    { is_from_user: false, received_at: '2026-07-20T15:43:00Z', from: 'counterparty@example.com', to: ['me@example.com'] },
    { is_from_user: true, received_at: '2026-07-20T16:41:00Z', from: 'me@example.com', to: ['colleague@example.com'] },
  ];
  const cp = threadCounterpartyEmail(msgs);
  check('T1 logic · a forward to a third party does NOT resolve',
    cp === 'counterparty@example.com' &&
    !computeThreadReplyState(messagesForResolution(msgs, cp), new Date('2026-07-20T15:50:00Z')).userReplied);
  const msgs2: ThreadMessage[] = [...msgs, { is_from_user: true, received_at: '2026-07-20T17:00:00Z', from: 'me@example.com', to: ['counterparty@example.com'] }];
  check('T1 logic · a real reply TO the counterparty still resolves',
    computeThreadReplyState(messagesForResolution(msgs2, cp), new Date('2026-07-20T15:50:00Z')).userReplied);
  check('T1 logic · unknown recipients degrade to counting (never silently stop resolving)',
    computeThreadReplyState(messagesForResolution([msgs[0], { is_from_user: true, received_at: '2026-07-20T16:41:00Z' }], cp), new Date('2026-07-20T15:50:00Z')).userReplied);

  // ── T2 LIVE — zero self-recipient nudge debris across users ──
  const { data: profs } = await sb.from('profiles').select('id');
  for (const p of (profs ?? []) as Array<{ id: string }>) {
    const persons = await getPersonEntities(sb, p.id);
    if (!persons.some((x) => x.state?.self)) continue;
    const { data: dels } = await sb.from('item_deliverables').select('title').eq('user_id', p.id).eq('type', 'draft').ilike('title', 'Nudge — %').limit(200);
    const debris = ((dels ?? []) as Array<{ title: string }>).filter((d) => resolveIdentity(persons, d.title.replace(/^Nudge — /, '')).isSelf);
    check(`${p.id.slice(0, 8)} · zero self-recipient nudge debris`, debris.length === 0, debris.length ? debris[0].title : '');
  }

  // ── T3 STRUCTURAL + LIVE ──
  check('T3: the pass refuses automated senders before generating',
    src('lib/prepare/pass.ts').includes('automated sender — a reply would reach no one'));
  check('T3: the on-demand draft route refuses automated senders (and never serves a stale draft for one)',
    src('app/api/inbox/[id]/draft/route.ts').includes("skipped: 'automated_sender'"));
  const noReply = await evaluateDeliverable(sb, A, {
    content: 'Hi, thanks for the reset link — done!', task: 'Reset the password',
    recipient: 'Acme Portal <info@acme-portal-example.com>', kind: 'reply',
  });
  // info@ is a real address — the evaluator's structural check targets no-reply forms:
  const noReply2 = await evaluateDeliverable(sb, A, {
    content: 'Hi, thanks!', task: 'Reset the password', recipient: 'no-reply@acme-portal-example.com', kind: 'reply',
  });
  check('T3 live · evaluator structurally rejects a no-reply recipient',
    noReply2.verdict === 'revise' && /no one|no-reply/i.test(noReply2.objection ?? ''), `verdict=${noReply2.verdict}`);
  check('T3 live · a plausibly real address is NOT structurally blocked (AI judges it instead)',
    noReply.verdict !== 'revise' || !/no one|no-reply/i.test(noReply.objection ?? ''), `verdict=${noReply.verdict}`);

  // ── T4 STRUCTURAL ──
  check('T4: the email deep-dive shows NO posture pill', src('components/home/item-detail.tsx').includes('chip={null}'));
  check('T4: an untracked entity renders as quiet context with Track (membership chip)',
    src('components/entities/add-to-work-control.tsx').includes('connects to') &&
    src('components/entities/add-to-work-control.tsx').includes("action: 'track'"));
  check('T4: untracked framed as quiet related context ("Connects to"), never project chrome (one-room R3: the strip)',
    src('components/room/context-strip.tsx').includes("tracked === false ? 'Connects to' : 'In'") &&
    src('lib/entities/room-view.ts').includes('tracked: !!ent.tracked'));
  check('T4: the items/entity GET serves tracked', src('app/api/items/entity/route.ts').includes('tracked: !!(ent as'));

  // ── G STRUCTURAL — one obligation = one task ──
  const extract = src('lib/commitments/extract.ts');
  check('G1: the extractor judges at the MOTION level (one commitment, clauses as steps)',
    extract.includes('ONE commitment per MOTION/DELIVERABLE') && extract.includes('steps?: string[]'));
  check('G1: the writer has the same-batch consolidation backstop (reasoned, conservative)',
    extract.includes('parts of a SINGLE motion') && extract.includes('let consolidated = accepted'));
  check('G1: steps persist as the commitment\'s item plan, version-stamped (no regeneration over them)',
    extract.includes("kind: 'commitment', entity_id: cid") && extract.includes('version: PLAN_VERSION'));

  // ── G LIVE — a multi-ask email yields ONE commitment with steps (through the REAL extractor) ──
  const { extractEmailCommitments } = await import('../lib/commitments/extract');
  const GMARK = 'zz-smoke-g1-probe';
  const n = await extractEmailCommitments({
    userId: A, subject: 'Pilot proposal for Acme',
    body: 'Hi, following our call: please send over the pilot proposal — it should include the pricing for 7-8 seats, the presentation deck explaining the platform, and your answers on which data sources you would integrate. Can you get that to me by Friday? Thanks, Sam',
    isFromUser: false, userName: 'Alexandre Collignon', counterparty: 'Sam Vendor <sam@acme-example.com>',
    sourceId: GMARK, threadId: null, client: sb,
  });
  const { data: gRows } = await sb.from('commitments').select('id, description').eq('user_id', A).eq('source_id', GMARK);
  const one = (gRows ?? []).length === 1;
  let stepsOk = false;
  if (one) {
    const { data: plan } = await sb.from('item_plans').select('tasks').eq('user_id', A).eq('kind', 'commitment').eq('entity_id', gRows![0].id).maybeSingle();
    stepsOk = Array.isArray(plan?.tasks) && (plan!.tasks as unknown[]).length >= 2;
  }
  check('G live · a three-part ask extracts as ONE commitment', one, `wrote ${n} → ${(gRows ?? []).length} rows: ${(gRows ?? []).map((r) => r.description.slice(0, 40)).join(' | ')}`);
  check('G live · its parts landed as plan STEPS (≥2)', stepsOk);
  for (const r of gRows ?? []) { await sb.from('item_plans').delete().eq('user_id', A).eq('kind', 'commitment').eq('entity_id', r.id); await sb.from('commitments').delete().eq('id', r.id); }

  // ── D STRUCTURAL — dismiss-with-context is a LEDGER fact ──
  check('D: the inbox dismiss stores the note on the item (dismiss_note)',
    src('lib/tools/item-actions.ts').includes('dismiss_note: String(args.reason)'));
  check('D: the commitments PATCH + chat resolve carry the note into resolved_reason',
    src('app/api/commitments/[id]/route.ts').includes('userNote ??') &&
    src('lib/tools/item-actions.ts').includes("args.reason?.trim() ? String(args.reason).trim().slice(0, 200) : 'chat'"));
  check('D: the ledger SURFACES the user\'s note (both kinds)',
    src('lib/entities/state.ts').includes('sd.dismiss_note') && src('lib/entities/state.ts').includes('MACHINE_REASONS'));
  check('D: the deep-dive offers "Dismiss with a note…"',
    src('components/home/item-detail.tsx').includes('Dismiss with a note…') &&
    src('components/home/item-detail.tsx').includes('onDismissWithNote'));

  // ── D LIVE — the note travels: dismiss a probe commitment with context → the deal's ledger reads it ──
  const { data: busyEnt } = await sb.from('work_entities').select('id, name').eq('user_id', A).eq('kind', 'initiative').eq('status', 'active').eq('tracked', true).limit(1).maybeSingle();
  if (!busyEnt) { check('D live (vacuous — no tracked entity)', true); }
  else {
    const DMARK = 'ZZ-smoke dismiss-context probe task';
    const { data: dc } = await sb.from('commitments').insert({
      user_id: A, description: DMARK, direction: 'you_owe', source: 'manual', source_id: 'zz-d-probe', status: 'open',
    }).select('id').maybeSingle();
    if (dc) {
      await sb.from('entity_links').insert({ user_id: A, item_kind: 'commitment', item_id: dc.id, entity_id: busyEnt.id, via: 'user', reason: 'smoke', locked: true });
      const { executeResolveCommitment } = await import('../lib/tools/item-actions');
      await executeResolveCommitment({ client: sb, userId: A } as never, { commitmentId: dc.id, resolution: 'dismissed', reason: 'we have a call Thursday — will discuss then' });
      const { assembleLedger } = await import('../lib/entities/state');
      const { ledger } = await assembleLedger(sb, A, busyEnt.id as string);
      const line = ledger.find((l) => l.ref === `commit:${dc.id}`);
      check('D live · the dismiss note is IN the deal\'s ledger (the brain will reason with it)',
        !!line && line.text.includes('will discuss then'), line ? `"${line.text.slice(0, 90)}"` : 'line missing');
      await sb.from('entity_links').delete().eq('item_id', dc.id).eq('item_kind', 'commitment');
      await sb.from('commitments').delete().eq('id', dc.id);
    } else check('D live · probe insert failed', false);
  }

  // ── M STRUCTURAL — mailKind under the rules ──
  check('M1: mailKind is a closed, registry-grounded field on the understanding',
    src('lib/inbox/item-understanding.ts').includes("'cold_outreach'") &&
    src('lib/inbox/item-understanding.ts').includes('MAIL_KINDS.has(mk)') &&
    src('lib/ai/email-processor.ts').includes('GROUND it in the roster + relationship context'));
  check('M2: the drafter gate refines UNDER the rules (needs_reply rule always wins)',
    src('lib/prepare/pass.ts').includes("it.rule_type !== 'needs_reply'") &&
    src('lib/prepare/pass.ts').includes('no reply expected'));
  check('M3: the v1 AI taxonomy default rules are retired (posture rules + floors stay)',
    !src('lib/inbox/rules/defaults.ts').includes('A promotional or commercial email') &&
    src('lib/inbox/rules/defaults.ts').includes("name: 'Needs reply'") &&
    src('lib/inbox/rules/defaults.ts').includes("name: 'No-reply / automated senders'"));

  // ── M LIVE — pending items carry kinds. ⚠️ PROD-SKEW CAVEAT: until the next deploy, prod's sync
  // re-writes source_data WITHOUT mailKind on actively-synced accounts (observed on user A minutes
  // after stamping) — so the gate requires kinds on AT LEAST ONE account and reports per-user.
  // Re-run scripts/backfill-mail-kind.ts --apply once after deploying.
  let anyKinds = 0;
  for (const [uid, label] of [[A, 'user A'], ['c723c2f2-e069-4ab8-980e-ac3585028fec', 'user B']] as const) {
    const { data: its } = await sb.from('inbox_items').select('source_data').eq('user_id', uid).eq('source', 'email').eq('status', 'pending').limit(200);
    const kinds = ((its ?? []) as Array<{ source_data: Record<string, unknown> }>)
      .map((i) => ((i.source_data?.understanding ?? {}) as { mailKind?: string }).mailKind).filter(Boolean);
    anyKinds += kinds.length;
    console.log(`   · ${label}: ${kinds.length} kinds${kinds.length ? ` (${[...new Set(kinds)].slice(0, 4).join('/')})` : ' — prod-skew rewrite; re-backfill post-deploy'}`);
  }
  check('M live · mailKind present on live pending items (≥1 account; prod-skew caveat above)', anyKinds > 0, `${anyKinds} total`);

  // ── H STRUCTURAL — the compact Home (corrected: STRUCTURE, not padding) ──
  const hv = src('components/home/home-view.tsx');
  const wr = src('components/work/work-row.tsx');
  check('H1: ONE line per row — the second line is DEAD (folded inline, boilerplate dropped)',
    wr.includes('SECOND LINE IS DEAD') && !wr.includes('line-clamp-1`}>{item.second}</p>') &&
    wr.includes("item.second !== 'Action needed'"));
  check('H2: Tasks | By project lens on the deck (same entries, regrouped; persisted; effect-hydrated)',
    hv.includes("'aug-do-group'") && hv.includes('trackedLookup') && src('components/one/one-home.tsx').includes('By project') &&
    !hv.includes("useState<'time' | 'project'>(() =>"));
  // The final Home simplification: ONE row species — bundles retired from the deck. RE-POINTED
  // Aug 6 (the one-surface shell, owner-triggered): the deck wears THE CARD GRAMMAR (a calm
  // space-y stack of WorkRow variant="card" — state dot · sentence · sub · one CTA row); the
  // bordered divide-y container retired with the one-line rows. Other surfaces keep the row.
  check('H6: bundles are RETIRED from the deck (ONE species: the card stack — no bundle cards, no divided container)',
    !hv.includes('<BundleGroup') && src('components/one/one-home.tsx').includes('variant="card"') && hv.includes('flat.push') &&
    !hv.includes('border-neutral-200/70 bg-white divide-y'));
  check('H6: WorkRow flat mode + the row-density law (one signal per category; prepared = one word: ready)',
    wr.includes('flat = false') && wr.includes('ONE signal per category') && wr.includes('>ready</span>'));
  check('H7: calm groups collapse (hover-preview + click-pin, persisted — owner-reinstated July 30); urgent groups always open',
    src('components/one/one-home.tsx').includes("g.key === 'overdue' || g.key === 'today'") && hv.includes("'aug-do-pinned'") && src('components/one/one-home.tsx').includes('hoverGroup === g.key'));
  check('H8: membership is visible IMMEDIATELY (July 30) — attach busts the brief server-side, the Home listens for membership-changed, and the row wears an optimistic TRACKED-only tag until the server tag arrives',
    src('app/api/items/entity/route.ts').includes('softBustBrief') &&
    hv.includes("addEventListener('aug:membership-changed'") &&
    wr.includes('onAttached') && wr.includes('if (tracked) setLocalTag(name)') &&
    wr.includes('item.initiative ?? localTag'));
  check('H10: NO SILENT CAPS on the deck\'s candidate pool (Aug 2 — an overdue obligation ranked 61st of a 60 cap and vanished): high bound + a loud saturation warning',
    src('app/api/home/brief/route.ts').includes('.limit(250)') &&
    src('app/api/home/brief/route.ts').includes('SATURATED the 250 cap'));
  check('H9: a LONG deck group folds past 8 rows behind the ONE expander idiom (ExpandableRows in the group container — nothing hidden, just folded; lives in one-home since the Aug 6 extraction)',
    src('components/one/one-home.tsx').includes('<ExpandableRows items={g.rows} limit={8}'));
  check('H8b: EVERY deck lane derives its row tag from the ENTITY LINK against the tracked registry — on the SERVED payload the client actually builds the deck from (reply + notice + commitment; P15 tracked-only; independent of state synthesis) + the client notice mapping carries it',
    src('app/api/home/brief/route.ts').includes('tagByAtom = new Map') &&
    (src('app/api/home/brief/route.ts').match(/tagByAtom\.get\(/g) ?? []).length >= 3 &&
    src('app/api/home/brief/route.ts').includes('trackedNameById = new Map') &&
    src('components/home/home-view.tsx').includes('initiative: a.initiative ?? null'));
  const brief = src('app/api/home/brief/route.ts');
  // J1 moved the law into lib/inbox/notice-demotion.ts (ONE module, shared with judgeWork).
  check('H4: the demotion is OWNERSHIP-KEYED (the ONE shared law), on BOTH paths, override-guarded',
    src('lib/inbox/notice-demotion.ts').includes("u.ownership === 'none' && structuralNotice") &&
    brief.includes('isNoMoveNotice({ u,') &&
    brief.includes('if (noticeDemoted) continue;') &&
    (brief.match(/type_override !== 'needs_reply'/g) ?? []).length >= 1 &&
    !brief.includes('kindDemoted'));
  check('H5: the This-week rail matches the dense scale (slim, sticky)',
    hv.includes('slim, calm agenda rail'));

  // ── H LIVE — the demotion on user A's REAL pool: the junk class goes, real obligations stay ──
  {
    const { data: pool } = await sb.from('inbox_items').select('id, work_title, rule_type, type_override, work_state, source_data')
      .eq('user_id', A).eq('source', 'email').eq('status', 'pending')
      .or('work_state.in.(work_prepared,decision_required,action_required),rule_type.in.(needs_reply,to_do,waiting_on)').limit(60);
    // ONE LAW, ONE READER: the gate calls the real isNoMoveNotice (never an inline replica that
    // can drift from the shipped formula — July 31, after exactly that drift).
    const { isNoMoveNotice, rawMailKindOf } = await import('../lib/inbox/notice-demotion');
    const { coerceUnderstanding } = await import('../lib/inbox/item-understanding');
    let junkShown = 0, obligationsKept = 0;
    for (const it of (pool ?? []) as Array<{ work_title: string | null; type_override?: string | null; work_state?: string | null; source_data: Record<string, unknown> }>) {
      const sd = it.source_data ?? {};
      const subj = (sd.subject as string) || it.work_title || null;
      const nd = it.type_override !== 'needs_reply' && it.type_override !== 'to_do'
        && isNoMoveNotice({ u: coerceUnderstanding(sd.understanding), rawKind: rawMailKindOf(sd), fromEmail: (sd.from_address as string) ?? null, fromName: (sd.from_name as string) ?? null, subject: subj, workState: (it.work_state as string) ?? null });
      const isJunk = /property inquiry|response on .* apartment|meeting acceptance|response notification/i.test(String(it.work_title ?? ''));
      const isObligation = /pay for your booking|security|alerta de segurança|prepaid billing/i.test(String(it.work_title ?? ''));
      if (isJunk && !nd) junkShown++;
      if (isObligation && !nd) obligationsKept++;
    }
    check('H live · the screenshot junk class is DEMOTED on the real pool', junkShown === 0, `${junkShown} junk rows would still show`);
    check('H live · real obligations (pay/security/billing) are KEPT', obligationsKept > 0, `${obligationsKept} kept`);
  }

  console.log('\n════ THE WORK SURFACE GATES ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  → ${d}` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();
