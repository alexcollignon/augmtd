/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — THE ROOM'S FIRST PAINT (stabilization W3.5 — docs/stabilization-plan.md PART III;
 * invariants 8 A CLAIM RENDERS · 11 NO MUTATION AFTER PAINT; registry precedence #1 (compose before
 * paint → last-good → append, never swap), #2 (floor → ladder → single claim), #10 (the MOVE yields
 * to any mounted card); threads-plan clause 5 (one type scale per bubble).
 *
 * ZERO-AI, deterministic: source floors for (a)–(e) + pure tests of the render-plan yield, the
 * sole-artifact CTA binding and the moot-ask predicate. Exit 1 on any failure.
 *
 *   npx tsx scripts/smoke-room-first-paint.ts              (+ the read-only census when env exists)
 *   npx tsx scripts/smoke-room-first-paint.ts --no-census  (the board's form — never depends on data)
 *
 * THE CENSUS (read-only, never a gate): every room_brief whose latest MOVE is an offer while a LIVE
 * artifact stands in that room — the false "say the word" class — with the before/after verdict of
 * the CTA floor computed IN CODE on the live rows (old rule: the ref's own entry; new rule: the
 * sole-artifact binding first). No writes, no AI.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv'; config({ path: '.env.local' });
import { panelPlan } from '../lib/room/render-plan';
import { bindToSoleStaged, enforceCtaLaw, offerLineFor } from '../lib/room/cta-law';
import { askIsMoot, mootRequireLabels, namesOwnInbound, namesTheDraft, outlivedVerdict } from '../lib/room/ask-mootness';
import { deriveState } from '../lib/work/machine';

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0; const failures: string[] = [];
const gate = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// ═══ A · (a) THE BRIEF BEFORE THE PAINT — source floors ═══
console.log('\nA · (a) the composed brief reaches the first paint (compose before paint · last-good · append)');
{
  const brief = src('lib/room/brief.ts');
  gate('A1 briefBeforePaint exists with a bounded budget, races the compose, and hands the compose promise to after()',
    // ⟲ RE-POINTED (W3.7 ROOM SPEED): the budget was pinned at 6_000; the warm now composes before
    // the click, so the door waits ≤1.5s (smoke-room-speed owns the exact bound). Bounded, not pinned.
    /export const BRIEF_PAINT_BUDGET_MS = [\d_]+;/.test(brief)
    && Number((brief.match(/export const BRIEF_PAINT_BUDGET_MS = ([\d_]+);/)?.[1] ?? 'NaN').replace(/_/g, '')) <= 6_000
    && /export async function briefBeforePaint\(/.test(brief)
    && /Promise\.race\(\[composed\.then\(\(r\) => \(\{ r \}\)\), budget\]\)/.test(brief)
    && /settled: Promise<void>/.test(brief));
  gate('A2 last-good is the fallback VOICE — an older version serves only when asked for, and FLAGGED (staleVersion)',
    /allowStaleVersion\?: boolean/.test(brief)
    && /if \(stale && !opts\.allowStaleVersion\) return null;/.test(brief)
    && /\.\.\.\(stale \? \{ staleVersion: true \} : \{\}\)/.test(brief)
    && /readRoomResponse\(client, userId, roomKey, \{ allowStaleVersion: true \}\)/.test(brief));
  gate('A3 the composer hands its composition back (no second read on the paint path) and ensure* return it',
    /return \{ text, move, offers, at \};/.test(brief)
    && /export async function ensureRoomBrief\([^)]*\): Promise<RoomResponse \| null>/.test(brief)
    && /export async function ensureLooseRoomBrief\([\s\S]*?\): Promise<RoomResponse \| null>/.test(brief));

  const view = src('app/api/items/view/route.ts');
  gate('A4 /api/items/view paints LAST-GOOD at once and composes the item\'s OWN room under after() — never awaited',
    // ⟲ RE-POINTED (W3.7): the compose is wrapped in joinCompose (a warm in flight is joined).
    // ⟲ RE-POINTED (W7.2 ONE OBJECT, ONE DOOR): the item door composes under its own `<kind>:<id>`
    // key whatever it is linked to — the linked→entity branch is DEAD (it served a machine
    // container's agenda under the item's title). smoke-one-door owns the full law.
    // ⟲ RE-POINTED (W8.4 THE ROOM SPEAKS TRUE AND FAST — owner's call, dev logs Sep 23): the door
    // no longer WAITS up to a budget for the compose (≈1s of every open was "brief-pending"). The
    // paint carries last-good (one select, older version flagged); the compose runs under after()
    // through the SAME joinCompose + ensureLooseRoomBrief; a landing where nothing was painted is
    // APPENDED on the client's one re-check (A7/A8 — the append rule is unchanged). smoke-room-voice
    // owns the "no await on compose" floor.
    /const lastGoodP = readRoomResponse\(supabase, user\.id, looseKey, \{ allowStaleVersion: true \}\)/.test(view)
    // ⟲ RE-POINTED (W13.5 THE RE-PREPARE TRIP ON WITHDRAWAL): the same joinCompose + ensureLooseRoomBrief
    // still runs only under onOpen/after(), now chained AFTER the budgeted on-open trip (when one is due)
    // so the appended opening reads the corrected board.
    && /onOpen\(async \(\) => \{\s*\n\s*if \(tripDue\) \{[^\n]*reprepareTrip[^\n]*\}\s*\n\s*await joinCompose\(uid, looseKey, \(\) => ensureLooseRoomBrief\(supabase, uid, looseKey, anchorForBrief\)\);/.test(view)
    && /const onOpen = \(work: \(\) => Promise<unknown>\) => \{ if \(!warm\) after\(/.test(view)
    // ⟲ (W13.5): the one awaited compose lives INSIDE the onOpen/after() block (chained after the trip);
    // outside that block nothing awaits a compose — the GET path still never does.
    && !/await[^;\n]*ensureLooseRoomBrief/.test(view.replace(/onOpen\(async \(\) => \{\s*\n\s*if \(tripDue\)[\s\S]*?anchorForBrief\)\);\s*\n\s*\}\);/, ''))
    && (view.match(/ensureLooseRoomBrief\(/g) ?? []).length === 1 && !/briefBeforePaint\(/.test(view)
    && !/ensureRoomBrief\(supabase, uid, eid\)/.test(view)
    // the old after()-only compose is gone
    && !/after\(async \(\) => \{\s*try \{ const \{ ensureRoomBrief \}/.test(view)
    && !/after\(async \(\) => \{\s*try \{ const \{ ensureLooseRoomBrief \}/.test(view));
  gate('A5 the view serves the composition on the door\'s OWN fields (never an entity overlay), plus briefPending + briefStaleVersion',
    // ⟲ RE-POINTED (W7.2): the entity is served VOICELESS on an item door; the composition rides
    // brief/move/offers/briefAt unconditionally.
    !/\{ \.\.\.room\.entity, brief: r\.text, move: r\.move, offers: r\.offers, briefAt: r\.at \}/.test(view)
    && /\{ \.\.\.room\.entity, brief: null, move: null, offers: \[\], briefAt: null \}/.test(view)
    && /const looseBrief = r\?\.text \?\? null;/.test(view)
    // ⟲ RE-POINTED (W8.4): pending = nothing current painted (no last-good, or an older version).
    // ⟲ RE-POINTED (W13.5 SERVE-TIME TRUTH): `r` is last-good AFTER the serve-time net; pending also
    // covers a withheld last-good and a re-prepare trip about to correct the board.
    && /const r = serve\.response \?/.test(view)
    && /const briefPending = !r \|\| !!r\.staleVersion \|\| serve\.withheld \|\| tripDue;/.test(view) && /\n      briefPending,\n/.test(view)
    && /briefStaleVersion: true/.test(view));

  const room = src('app/api/entities/[id]/room/route.ts');
  gate('A6 /api/entities/[id]/room serves its brief the same way as the item door (overlay + briefPending)',
    // ⟲ RE-POINTED (W3.7): joinCompose-wrapped, as on the item door.
    // ⟲ RE-POINTED (W8.5 — the W8.4 law on the project door): the door no longer waits on the
    // compose — last-good in the read wave, the joinCompose-wrapped compose under after() only, and
    // pending = nothing current painted (smoke-room-voice I1–I4 hold the never-await floors).
    /readRoomResponse\(supabase, uid, id, \{ allowStaleVersion: true \}\)/.test(room)
    && /after\(async \(\) => \{ try \{ await joinCompose\(uid, id, \(\) => ensureRoomBrief\(supabase, uid, id\)\); \} catch/.test(room)
    && /brief: r\.text, move: r\.move, offers: r\.offers, briefAt: r\.at/.test(room)
    // ⟲ RE-POINTED (W13.5 SERVE-TIME TRUTH): `r` is last-good after the net; a withheld one is pending.
    && /const r = serve\.response;/.test(room)
    && /const briefPending = !r \|\| !!r\.staleVersion \|\| serve\.withheld;/.test(room) && /\n      briefPending,\n/.test(room));

  const detail = src('components/home/item-detail.tsx');
  const eroom = src('components/entities/entity-room.tsx');
  gate('A7 a late brief ARRIVES AS AN APPEND on both doors (one re-check → lateBrief; the painted opening never swaps)',
    /if \(d\.briefPending && !paintedBrief && !lateCheckedRef\.current\)/.test(detail)
    // ⟲ RE-POINTED (W7.2 ONE OBJECT, ONE DOOR): the item door's late brief is ITS OWN field — the
    // entity's brief is never read on an item door.
    && /lateBrief: \{ text, at: d2\.briefAt \?\? null \}/.test(detail)
    && !/setView\(d2\)[^\n]*lateBrief/.test(detail)
    && /if \(data\.briefPending && !data\.entity\.brief\)/.test(eroom)
    && /setRail\(\(prev\) => \(prev \? \{ \.\.\.prev, lateBrief: \{ text, at: d2\.entity\.briefAt \?\? null \} \} : prev\)\)/.test(eroom));

  const rail = src('components/home/item-rail.tsx');
  gate('A8 the rail renders the late brief as an APPENDED actor bubble beneath the pinned opening, only while no composed brief was painted',
    /const lateBrief = !composed && view\.lateBrief\?\.text \? view\.lateBrief\.text : null;/.test(rail)
    && /type: 'actor_bubble', id: 'late-brief'/.test(rail));
  gate('A9 THE FALLBACK IS ONE VOICE — no grey entity-summary line, no You owe/They owe lines, no stored next_move card, no echoesAnchor',
    !/secondarySummary/.test(rail) && !/owesYou/.test(rail) && !/owesThem/.test(rail)
    && !/fallbackMove/.test(rail) && !/function echoesAnchor/.test(rail)
    && !/label: `Next: \$\{ent\.nextMove\}`/.test(rail)
    // ⟲ RE-POINTED (W8.4 THE ROOM SPEAKS TRUE): the item door's fallback is the ONE pure ladder
    // (lib/room/opening-fallback.ts) — the item's own ask or nothing; the "standalone" claim made
    // from absence is gone (smoke-room-voice holds the ladder's fixtures).
    && /: anchorLine\);/.test(rail) && /fallbackOpeningLine\(\{ who, ask: a\?\.ask \?\? null, preparedClause: prep \}\)/.test(rail)
    && !/keep it standalone/.test(rail));
}

// ═══ B · (b) THE MOVE YIELDS TO ANY MOUNTED CARD ═══
console.log('\nB · (b) the MOVE yields to any mounted card for its target (render-plan owns it)');
{
  const rp = src('lib/room/render-plan.ts');
  gate('B1 render-plan takes moveCardMounted and showMove yields to it (and still to a decision)',
    /moveCardMounted\?: boolean;/.test(rp) && /showMove: !input\.hasDecision && !input\.cardForMove,/.test(rp));
  const rail = src('components/home/item-rail.tsx');
  gate('B2 the rail states the fact to the table (moveCardMounted: !!cardForMove) — the move is nulled AT THE SOURCE',
    /panelPlan\(\{ hasDecision: decisionIsPrimary, moveCardMounted: !!cardForMove \}\)/.test(rail)
    && /const resp = composed \? \{ move: plan\.showMove \? respMove : null/.test(rail));
  // pure
  const p1 = panelPlan({ hasDecision: false, moveCardMounted: true });
  const p2 = panelPlan({ hasDecision: false, moveCardMounted: false });
  const p3 = panelPlan({ hasDecision: true, moveCardMounted: false });
  gate('B3 pure: a mounted card for the move → showMove false; nothing mounted → true; a decision still yields; offers unaffected by the card',
    p1.showMove === false && p2.showMove === true && p3.showMove === false && p1.showOffers === true);
}

// ═══ C · (c) THE CTA FLOOR NEVER DEMOTES A READY ARTIFACT ═══
console.log('\nC · (c) a ready artifact is never demoted to "say the word"');
{
  const brief = src('lib/room/brief.ts');
  gate('C1 composition binds an unbound move to the SOLE staged entry BEFORE the noise check and the CTA floor',
    (() => {
      const bind = brief.indexOf('bindToSoleStaged(move, g.board.map');
      const noise = brief.indexOf('if (move && noiseAnchor) move = null;');
      const cta = brief.indexOf('enforceCtaLaw(move, { targetPrepared:');
      return bind > 0 && noise > bind && cta > noise;
    })());
  const rail = src('components/home/item-rail.tsx');
  gate('C2 at the render the offer line passes the mounted-card fact through ONE predicate (offerLineFor); the old as-is read is gone',
    /offerLineFor\(resp\?\.move, \{ cardMounted: mountedCards\.length > 0 \|\| !!mergedArt \}\)/.test(rail)
    && !/resp\.move\.offerText \?\? shapingOffer\(resp\.move\.label\)/.test(rail));
  // pure
  const mv = { label: 'Review and send reply', ref: null as string | null };
  const bound = bindToSoleStaged(mv, [{ ref: 'inbox:a', prepared: true }, { ref: 'inbox:b', prepared: false }]);
  const two = bindToSoleStaged(mv, [{ ref: 'inbox:a', prepared: true }, { ref: 'inbox:b', prepared: true }]);
  const kept = bindToSoleStaged({ label: 'x', ref: 'commit:z' }, [{ ref: 'inbox:a', prepared: true }]);
  gate('C3 pure: one staged entry → the move binds to it; two → unbound (code never guesses); a bound move is untouched',
    bound.ref === 'inbox:a' && two.ref === null && kept.ref === 'commit:z');
  const v1 = enforceCtaLaw(bound, { targetPrepared: true });
  const v2 = enforceCtaLaw(mv, { targetPrepared: false });
  gate('C4 pure: the bound move survives the floor as a primary; the unbound-unstaged one is an offer',
    v1.demoted === false && v2.demoted === true && v2.move?.offer === true);
  gate('C5 pure: offerLineFor says nothing while a card is mounted, speaks the offer otherwise, and nothing for a primary',
    offerLineFor({ label: 'Send it', offer: true }, { cardMounted: true }) === null
    && /shape this up/.test(offerLineFor({ label: 'Send it', offer: true }, { cardMounted: false }) ?? '')
    && offerLineFor({ label: 'Send it' }, { cardMounted: false }) === null);
}

// ═══ D · (d) THE HEADER SPEAKS ONE CLAIM — the moot ask by code ═══
console.log('\nD · (d) a requires-ask for the draft itself / the item\'s own inbound is moot BY CODE at read time');
{
  const machine = src('lib/work/machine.ts');
  gate('D1 both machine readers decide ask liveness through the ONE predicate (askIsMoot) and serve mootAskKeys',
    // ⟲ RE-POINTED (W13.6): the machine also imports the ONE verdict-labels reader (`verdictRequireLabels`)
    // it now shares with the room grounding — the same predicate, the same facts.
    /import \{ askIsMoot, isEngineAskKey, verdictRequireLabels \} from '@\/lib\/room\/ask-mootness';/.test(machine)
    && (machine.match(/liveAsksOf\(/g) ?? []).length >= 3
    && /mootAskKeys\?: string\[\];/.test(machine)
    // the title half is the inbound's OWN subject (source_data.subject), never the judge's work_title
    && /select\('status, source_data, source'\)/.test(machine) && /itemTitle = sd\.subject \|\| null;/.test(machine)
    && /select\('id, status, source_data, last_activity_at, source'\)/.test(machine)
    && !/select\('[^']*work_title/.test(machine));
  const view = src('app/api/items/view/route.ts');
  const rail = src('components/home/item-rail.tsx');
  gate('D2 the view serves the machine\'s moot keys and the rail hides those turns (header and room: one claim)',
    // ⟲ RE-POINTED (W3.7): the machine now runs in wave 2 beside the rail; its moot keys ride out of that flight.
    /moot: st\.mootAskKeys \?\? \[\]/.test(view) && /const mootAskKeys: string\[\] = machine\?\.moot \?\? \[\];/.test(view) && /mootAskKeys,\n/.test(view)
    && /const mootAskKeys = new Set\(view\.mootAskKeys \?\? \[\]\);/.test(rail)
    && /const stream = turns\.filter\(\(t\) => t !== liftedAsk && !isMootAsk\(t\)\);/.test(rail));
  // pure — the live room's own shape (Sep 22): title "Review condominium payment notice",
  // ask labels ["the condominium payment notice", "review criteria"], verdict requires ["reply_draft"].
  const facts = { itemTitle: 'Review condominium payment notice', verdictRequires: ['reply_draft'], engineAsk: true };
  gate('D3 pure: the draft itself is moot (reply_draft · "a reply draft" · "the response email")',
    namesTheDraft('reply_draft') && namesTheDraft('a reply draft') && namesTheDraft('the response email') && !namesTheDraft('completed insurance application form'));
  gate('D4 pure: the item\'s own inbound is moot by title tokens (INBOX only) and by shape; a commitment\'s deliverable and a real file are not',
    namesOwnInbound('the condominium payment notice', facts.itemTitle, 'inbox')
    && namesOwnInbound('the original email', null)
    && !namesOwnInbound('ALP group allocation Excel sheet', facts.itemTitle, 'inbox')
    // the census find: "Share onboarding kit" (a commitment) asking for the onboarding kit — the user holds it
    && !namesOwnInbound('onboarding kit', 'Share onboarding kit', 'commitment')
    && !askIsMoot(['onboarding kit'], { itemTitle: 'Share onboarding kit', itemKind: 'commitment', verdictRequires: null, engineAsk: true })
    // …and the obligation-titled inbox rows: the label is the user's OWN deliverable, not an inbound object
    && !namesOwnInbound('refund processing details', 'Overdue: Process the refund and share the processing details', 'inbox')
    && !namesOwnInbound('sample of recent work', 'Send Sam a sample of recent work', 'inbox')
    && namesOwnInbound('the payment notice', 'Payment notice — building administration, September', 'inbox')
    // the judge's obligation-phrased work_title is NOT the subject: fed the subject, the user's deliverable stays live
    && !namesOwnInbound('the contract document', 'Re: next steps', 'inbox'));
  gate('D5 pure: an engine ask\'s label the CURRENT verdict no longer requires has outlived it; a re-phrasing (≥0.6 echo) still counts; a coworker\'s ask is exempt',
    outlivedVerdict('review criteria', facts)
    && !outlivedVerdict('review criteria', { ...facts, engineAsk: false })
    && !outlivedVerdict('review criteria', { ...facts, verdictRequires: ['review criteria for the notice'] })
    && !outlivedVerdict('payment method confirmation (card or bank transfer details)', { ...facts, verdictRequires: ['payment method choice (card or bank transfer details)'] }));
  const split = mootRequireLabels(['the condominium payment notice', 'review criteria'], facts);
  gate('D6 pure: the live room\'s ask is moot end to end; an ask with one surviving real label stays live',
    split.live.length === 0 && askIsMoot(['the condominium payment notice', 'review criteria'], facts)
    && !askIsMoot(['completed insurance application form'], { itemTitle: 'Insurance renewal', verdictRequires: null, engineAsk: true }));
  const art = { kind: 'reply_draft', title: null, content: 'x', by: null, at: null, attachment: null, provenance: null } as never;
  const withAsk = deriveState({ open: true, verdict: { work: 'send_file' }, judgedAt: new Date().toISOString(), prepared: [art], liveAsk: true, sentStamp: false });
  const noAsk = deriveState({ open: true, verdict: { work: 'send_file' }, judgedAt: new Date().toISOString(), prepared: [art], liveAsk: false, sentStamp: false });
  gate('D7 pure: the ladder itself is unchanged — a live ask outranks the staged send; a mooted ask lets the send stand',
    withAsk.state === 'awaiting_input' && noAsk.state === 'awaiting_approval');
}

// ═══ E · (e) ONE TONE ═══
console.log('\nE · (e) pinned lines wear the bubble\'s own tone; hierarchy by spacing only (threads clause 5)');
{
  const rail = src('components/home/item-rail.tsx');
  const i = rail.indexOf('const pinnedNode =');
  const seg = i >= 0 ? rail.slice(i, rail.indexOf('// ── THE ARTIFACT CARDS', i)) : '';
  const tl = src('components/thread/thread-timeline.tsx');
  gate('E1 the pinned node has NO muted second tone and no second body size; every line is the bubble\'s 13px text-neutral-800',
    seg.length > 0 && !/text-neutral-500/.test(seg) && !/text-\[12\.5px\]/.test(seg)
    && (seg.match(/text-\[13px\] leading-\[1\.5\] text-neutral-800/g) ?? []).length >= 4
    && /text-\[13px\] leading-\[1\.55\] text-neutral-800/.test(tl));
}

// ═══ F · THE CENSUS (read-only) ═══
async function census(): Promise<void> {
  if (process.argv.includes('--no-census')) return;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.log('\n(census skipped — no env)'); return; }
  console.log('\nF · THE CENSUS (read-only): room_brief moves that are offers while a LIVE artifact stands');
  const { createClient } = await import('@supabase/supabase-js');
  const { preparedState } = await import('../lib/prepare/read');
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data } = await sb.from('item_plans').select('user_id, entity_id, tasks, updated_at')
    .eq('kind', 'room_brief').gte('updated_at', new Date(Date.now() - 14 * 86_400_000).toISOString())
    .order('updated_at', { ascending: false }).limit(300);
  const rows = (data ?? []) as Array<{ user_id: string; entity_id: string; tasks: { v?: number; move?: { label: string; ref: string | null; offer?: boolean } | null } }>;
  let moves = 0, offers = 0, offerWithLive = 0, healedByBinding = 0, healedAtRender = 0;
  const lines: string[] = [];
  for (const r of rows) {
    const m = r.tasks?.move; if (!m?.label) continue; moves++;
    if (!m.offer) continue; offers++;
    const [k, id] = String(r.entity_id).split(':');
    const entries: Array<{ ref: string; prepared: boolean }> = [];
    if (k === 'inbox' || k === 'commitment') {
      const st = await preparedState(sb, r.user_id, { kind: k === 'inbox' ? 'inbox_item' : 'commitment', id }).catch(() => null);
      entries.push({ ref: `${k === 'inbox' ? 'inbox' : 'commit'}:${id}`, prepared: (st?.live.length ?? 0) > 0 });
    } else {
      const { data: links } = await sb.from('entity_links').select('item_kind, item_id').eq('user_id', r.user_id).eq('entity_id', r.entity_id).in('item_kind', ['inbox_item', 'commitment']).limit(80);
      for (const l of links ?? []) {
        const st = await preparedState(sb, r.user_id, { kind: l.item_kind as 'inbox_item' | 'commitment', id: l.item_id as string }).catch(() => null);
        entries.push({ ref: `${l.item_kind === 'inbox_item' ? 'inbox' : 'commit'}:${l.item_id}`, prepared: (st?.live.length ?? 0) > 0 });
      }
    }
    const live = entries.filter((e) => e.prepared).length;
    if (!live) continue;
    offerWithLive++;
    // BEFORE: the ref's own entry decides. AFTER: the sole-artifact binding first.
    const before = enforceCtaLaw({ label: m.label, ref: m.ref }, { targetPrepared: !!entries.find((e) => e.ref === m.ref)?.prepared });
    const after = enforceCtaLaw(bindToSoleStaged({ label: m.label, ref: m.ref }, entries), { targetPrepared: !!entries.find((e) => e.ref === bindToSoleStaged({ label: m.label, ref: m.ref }, entries).ref)?.prepared });
    if (before.demoted && !after.demoted) healedByBinding++;
    else healedAtRender++; // a mounted card silences the offer line at the render (offerLineFor)
    if (lines.length < 10) lines.push(`  ${String(r.entity_id).slice(0, 34)}  v${r.tasks?.v}  ref=${m.ref ?? 'null'}  live=${live}  "${m.label}"  → ${before.demoted && !after.demoted ? 'BOUND (primary)' : 'card silences the offer'}`);
  }
  lines.forEach((l) => console.log(l));
  console.log(`  TOTAL moves ${moves} · offers ${offers} · offers-with-live-artifact ${offerWithLive} → healed by the sole binding ${healedByBinding} · silenced at the render by the mounted card ${healedAtRender}`);
  console.log('  (the composition-side fix applies on the next recompose of each room; the render-side fix applies on the next open)');

  // (d) THE HEADER'S FALSE "NEEDS ONE THING FROM YOU": live requires-asks the machine now reads as
  // moot (draft itself · own inbound · outlived the verdict) — before, every one of them put
  // awaiting_input in the header while the room showed a ready draft.
  const { data: asks } = await sb.from('room_turns').select('user_id, dedupe_key, component')
    .like('dedupe_key', 'requires:%').is('archived_at', null).limit(400);
  let liveAsks = 0, mootNow = 0; const why: string[] = [];
  for (const a of (asks ?? []) as Array<{ user_id: string; dedupe_key: string; component: { state?: { items?: unknown[]; proceeded?: boolean } } | null }>) {
    const items = a.component?.state?.items ?? [];
    if (a.component?.state?.proceeded || !items.length) continue;
    liveAsks++;
    const itemId = a.dedupe_key.slice('requires:'.length);
    const [{ data: it }, { data: c }, { data: j }] = await Promise.all([
      sb.from('inbox_items').select('work_title, source_data, source').eq('id', itemId).eq('user_id', a.user_id).maybeSingle(),
      sb.from('commitments').select('description').eq('id', itemId).eq('user_id', a.user_id).maybeSingle(),
      sb.from('item_plans').select('tasks').eq('user_id', a.user_id).eq('kind', 'judgment').in('entity_id', [`inbox:${itemId}`, `commitment:${itemId}`]).limit(1).maybeSingle(),
    ]);
    const title = it ? (((it.source_data ?? {}) as { subject?: string }).subject || null) : ((c?.description as string | null) || null);
    const req = ((j?.tasks as { verdict?: { requires?: Array<{ label?: string } | string> } } | null)?.verdict?.requires ?? null);
    const verdictRequires = Array.isArray(req) ? req.map((x) => (typeof x === 'string' ? x : String(x?.label ?? ''))).filter(Boolean) : null;
    if (askIsMoot(items, { itemTitle: title, itemKind: it && String(it.source ?? '') !== 'commitment' ? 'inbox' : 'commitment', verdictRequires: verdictRequires?.length ? verdictRequires : null, engineAsk: true })) {
      mootNow++;
      if (why.length < 6) why.push(`  ${itemId.slice(0, 8)}  "${String(title ?? '').slice(0, 40)}"  ask=[${items.map(String).join(' | ').slice(0, 80)}]  requires=[${(verdictRequires ?? []).join(' | ').slice(0, 40)}]`);
    }
  }
  why.forEach((l) => console.log(l));
  console.log(`  LIVE requires-asks ${liveAsks} → moot by code now ${mootNow} (each used to put "needs one thing from you" in the header)`);
}

census().then(() => {
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) { console.log('FAIL'); process.exit(1); }
  console.log('PASS'); process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });
