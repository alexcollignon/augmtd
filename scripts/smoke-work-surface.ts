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
  // NOTE (Sep 13, cheap prevention): the anchor still means what it says, and now means it twice —
  // the threads arc narrowed DetailHeader to the EMBEDDED door only (on the loose door the ROOM
  // header carries those facts once, so there is no header to wear a pill at all). If that header
  // ever returns to the loose door, this clause is the one that must be re-read, not just re-run.
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
  // RETIRED + NARROWED (Sep 13, THE THREADS ARC reconciliation). The LENS died by owner call — the
  // Sep 8 calm-Home walk ("this is awful, looks bad and not aligned with the new design at all")
  // took the whole legacy deck, and the Tasks | By-project toggle with it; home-view records the
  // death in code ("H2's grouping lens + the calm-group hover/pin state died with the legacy deck").
  // The Home has ONE row grammar and ONE order now, so a second grouping of the same rows would be
  // a second surface — exactly what the arc forbids. WHAT SURVIVES is the half that was ever a law
  // rather than a control: a row still NAMES its project, and only a TRACKED one (the P15 law) —
  // `trackedLookup` still feeds the flattened rows, and the chip itself is gated by H8b below. The
  // project DIMENSION kept its home: the portfolio lens and the sidebar's Projects section.
  check('H2: THE GROUPING LENS IS RETIRED (owner, Sep 8) — one row grammar, one order; a row still wears its TRACKED project name (P15), and the project dimension lives in the portfolio lens',
    hv.includes('trackedLookup') &&
    hv.includes("died with the legacy deck") &&
    !hv.includes("'aug-do-group'") &&
    !src('components/one/one-home.tsx').includes('By project') &&
    !hv.includes("useState<'time' | 'project'>(() ="));
  // The final Home simplification: ONE row species — bundles retired from the deck. RE-POINTED
  // Aug 6 (the one-surface shell, owner-triggered): the deck wears THE CARD GRAMMAR (a calm
  // space-y stack of WorkRow variant="card" — state dot · sentence · sub · one CTA row); the
  // bordered divide-y container retired with the one-line rows. Other surfaces keep the row.
  // RE-POINTED Sep 13 (cleanup): the `variant="card"` clause outlived its subject twice over — the
  // deck that mounted it died in the Sep 8 calm-Home walk, and the card SKIN itself was deleted
  // from WorkRow the same day (zero callers). The law this gate has always carried survives and
  // narrows: ONE ROW SPECIES on the Home, no bundle cards, no divided container — and now no
  // second skin anywhere for one to drift back into.
  // RE-POINTED Sep 13 (again): the flatten itself only got RENAMED (`flat` → `flatRows`) when the
  // calm Home took over — the law is untouched and is the whole point of the gate: every agenda
  // entry, bundle or not, lands as ONE row species before anything renders.
  check('H6: bundles are RETIRED from the deck (ONE species — no bundle cards, no divided container, no second row skin)',
    !hv.includes('<BundleGroup') && !wr.includes("variant === 'card'") && hv.includes('flatRows.push') &&
    hv.includes("if (e.kind === 'bundle') for (const it of e.items) flatRows.push") &&
    !hv.includes('border-neutral-200/70 bg-white divide-y'));
  check('H6: WorkRow flat mode + the row-density law (one signal per category; prepared = one word: ready)',
    wr.includes('flat = false') && wr.includes('ONE signal per category') && wr.includes('>ready</span>'));
  // RETIRED + RE-SEATED (Sep 13). The GROUPS died by owner call (Sep 8) — with them the time-group
  // headers, the hover-preview and the click-pin this gate pinned. The LAW underneath them never
  // was "groups collapse"; it was NOTHING IS HIDDEN — what does not lead is still reachable, and
  // the urgent never folds. Both halves are stronger at the new seat: A NAMED FIRE IS A SEATED FIRE
  // (pickWhispers seats every overdue row FIRST, above the fold, in every lane — so urgency can no
  // longer sit inside a collapsed group at all), and the door expands the remainder IN PLACE, in
  // the calm module's ONE stated order, in the SAME row grammar — never a second deck.
  check('H7: NOTHING IS HIDDEN (the groups retired Sep 8) — every fire is SEATED above the fold, and the door expands the rest in place, in one stated order and one grammar',
    src('lib/home/calm.ts').includes('A NAMED FIRE IS A SEATED FIRE') &&
    src('lib/home/calm.ts').includes('export function sortDoorRows') &&
    src('lib/home/calm.ts').includes('function doorRank') &&
    hv.includes('THE DOOR EXPANDS IN PLACE, IN ORDER') &&
    hv.includes('<CalmDoor remaining={restRows.length}') &&
    !hv.includes("'aug-do-pinned'") &&
    !src('components/one/one-home.tsx').includes('hoverGroup === g.key'));
  check('H8: membership is visible IMMEDIATELY (July 30) — attach busts the brief server-side, the Home listens for membership-changed, and the row wears an optimistic TRACKED-only tag until the server tag arrives',
    src('app/api/items/entity/route.ts').includes('softBustBrief') &&
    hv.includes("addEventListener('aug:membership-changed'") &&
    wr.includes('onAttached') && wr.includes('if (tracked) setLocalTag(name)') &&
    wr.includes('item.initiative ?? localTag'));
  // RE-POINTED (Sep 13, THE PROACTIVE REACH ARC — the serving-truth wave). The law got STRICTLY
  // STRONGER on both halves, so the gate follows it up rather than pinning the old numbers:
  //  · THE BOUND: 250 → DECK_POOL_LIMIT 800, plus a named ACTION_NOTICE_LIMIT 200 for the notice
  //    lane that previously had none. The numbers moved OUT of the route into lib/home/deck-floors
  //    — named once, imported everywhere, so a second surface cannot quietly pick its own cap.
  //  · THE WARNING: the August comment PROMISED a loud log and never wrote one ("a bound that
  //    saturates IS a gate" only if it speaks). Both logs are real now and fire off the same
  //    constants they guard — no literal can drift from its bound.
  check('H10: NO SILENT CAPS on the deck\'s candidate pool (Aug 2 — an overdue obligation ranked 61st of a 60 cap and vanished): the bound is NAMED once (deck-floors), raised, and it SPEAKS when it binds',
    src('lib/home/deck-floors.ts').includes('export const DECK_POOL_LIMIT = 800') &&
    src('lib/home/deck-floors.ts').includes('export const ACTION_NOTICE_LIMIT = 200') &&
    src('app/api/home/brief/route.ts').includes('.limit(DECK_POOL_LIMIT)') &&
    src('app/api/home/brief/route.ts').includes('items.length >= DECK_POOL_LIMIT') &&
    src('app/api/home/brief/route.ts').includes('deck pool SATURATED at ${DECK_POOL_LIMIT}') &&
    src('app/api/home/brief/route.ts').includes('actionNoticesEligible.length >= ACTION_NOTICE_LIMIT') &&
    // A SATURATION LOG MUST NAME ITS OWN BOUND: no log may quote a cap the route no longer sets
    // (see the regression note in the reconciliation report — a stale 250 log was removed here).
    !src('app/api/home/brief/route.ts').includes('SATURATED the 250 cap'));
  // RE-POINTED (Sep 13): the DECK's fold moved to the density cap + the door — the Home's fold is
  // now enforced in ONE place (CALM_MAX_WHISPERS in lib/home/calm.ts, so no surface can quietly
  // widen it) and the remainder opens in place rather than per-group. The ONE EXPANDER IDIOM did
  // NOT die with the deck: ExpandableRows is still the single expander every other lane uses
  // (the Home's follow-ups + waiting-on lanes, the workflows ledger, the team home) — asserted here
  // so the idiom can never fork into a second "show more" while this gate watches.
  check('H9: the fold has ONE enforcement point (CALM_MAX_WHISPERS + the door, in place) and ExpandableRows remains the ONE expander idiom everywhere else — nothing hidden, just folded',
    src('lib/home/calm.ts').includes('export const CALM_MAX_WHISPERS') &&
    src('lib/home/calm.ts').includes('is the cap and it is enforced HERE') &&
    hv.includes('pickWhispers(flatRows.map((r) => r.item), CALM_MAX_WHISPERS)') &&
    hv.includes('<ExpandableRows items={looseWaiting}') &&
    src('components/home/expandable-rows.tsx').includes('export function ExpandableRows') &&
    src('components/workflows/workflows-ledger.tsx').includes('<ExpandableRows'));
  check('H8b: EVERY deck lane derives its row tag from the ENTITY LINK against the tracked registry — on the SERVED payload the client actually builds the deck from (reply + notice + commitment; P15 tracked-only; independent of state synthesis) + the client notice mapping carries it',
    src('app/api/home/brief/route.ts').includes('tagByAtom = new Map') &&
    (src('app/api/home/brief/route.ts').match(/tagByAtom\.get\(/g) ?? []).length >= 3 &&
    src('app/api/home/brief/route.ts').includes('trackedNameById = new Map') &&
    src('components/home/home-view.tsx').includes('initiative: a.initiative ?? null'));
  const brief = src('app/api/home/brief/route.ts');
  // J1 moved the law into lib/inbox/notice-demotion.ts (ONE module, shared with judgeWork).
  // RE-POINTED (Sep 13, THE PROACTIVE REACH ARC): the deck's lane-entry floors were extracted into
  // lib/home/deck-floors.ts — `rePromotesToDeck` + `noticeIsDemoted`, with `deckEligible` as their
  // conjunction — so the route no longer inlines the question. THE NO-SECOND-DERIVATION PRINCIPLE
  // is what this gate has always been about, and the extraction makes it structural: the module
  // does not re-implement the law, it CALLS `isNoMoveNotice` (the one shared reader, still keyed on
  // ownership), keeps the human `type_override` guard inside the floor, and is the same predicate
  // the standing deck-truth suite asserts the world against.
  check('H4: the demotion is OWNERSHIP-KEYED (the ONE shared law), asked in ONE place (deck-floors), override-guarded',
    src('lib/inbox/notice-demotion.ts').includes("u.ownership === 'none' && structuralNotice") &&
    src('lib/home/deck-floors.ts').includes('export function noticeIsDemoted') &&
    src('lib/home/deck-floors.ts').includes('return isNoMoveNotice({') &&
    src('lib/home/deck-floors.ts').includes("if (it.type_override === 'needs_reply' || it.type_override === 'to_do') return false;") &&
    src('lib/home/deck-floors.ts').includes('export function deckEligible') &&
    brief.includes('noticeIsDemoted(it as never, deckFloors)') &&
    brief.includes('rePromotesToDeck(x.it as never, x.posture, deckFloors)') &&
    brief.includes('if (noticeDemoted) continue;') &&
    // THE OVERRIDE GUARD MOVED WITH THE LAW: the route's inline `type_override !== 'needs_reply'`
    // test is gone precisely BECAUSE the floor now owns it (asserted above, inside noticeIsDemoted,
    // where it can never be forgotten by a new caller). A route-side copy would be the second
    // derivation this gate exists to forbid — so its absence here is the law holding, not slipping.
    !brief.includes("type_override !== 'needs_reply'") &&
    !brief.includes('kindDemoted'));
  // RETIRED (Sep 13) — THE CALENDAR LEFT THE HOME (owner walk, Sep 8). The This-week rail, the
  // day-grouped meeting column this gate measured, is gone: the meetings surface is the calendar's
  // home, and a fact with another home never earns a second seat on the Home. Nothing about the
  // dense scale was weakened — the column it applied to no longer exists, so the gate now holds the
  // RETIREMENT itself (a rail quietly growing back would fail here) and the meetings door that
  // replaced it. The prep that used to ride that rail arrives as a message in its room instead
  // (smoke-compute AN1, lib/home/anticipation.ts).
  check('H5: THE CALENDAR LEFT THE HOME (owner, Sep 8) — no This-week rail on the Home; the meetings surface is the calendar\'s one home',
    hv.includes('THE CALENDAR LEFT THE HOME') &&
    !hv.includes('slim, calm agenda rail') &&
    !hv.includes("{ title: 'This week', days:") &&
    src('components/one/one-sidebar.tsx').includes('<Link href="/meetings"'));

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
