/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — EVERY ITEM CAN BE CLOSED, AND SAYS WHERE IT STANDS (stabilization W15.2, owner walk Sep 24 —
 * docs/laws-registry.md `every-item-can-be-closed` · `scheduled-is-not-overdue` · `no-empty-ready`).
 *
 * Three finds on the owner's walk, each fixed as a class for EVERY item kind:
 *   (1) with nothing prepared, the item page offered no action but the ⋯ menu → a persistent Done ·
 *       Dismiss group in every item room's header, each through the kind's OWN resolution door;
 *   (2) a call booked for next week read "Due Thu · You owe…" and sat as due work → the machine state
 *       `scheduled`, derived at read from the booked calendar event (or a judged revisit date), never
 *       seated before its day, never overdue, and LOOKS DONE once the event has passed;
 *   (3) a settled item still showed a reply card with an EMPTY body labelled "reply ready" and a live
 *       Send → settled items mount no action card, and an empty draft never claims ready nor sends.
 *
 * ZERO AI, zero DB (an in-memory PostgREST fake for the two machine readers), deterministic.
 *   npx tsx scripts/smoke-item-actions.ts        exit 1 on any failure
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  ITEM_DEED_WORDS, RESOLUTION_FAMILY, resolveRequestOf, resolveEmphasisOf, HEADER_OWNED_VERB_KEYS,
} from '../lib/work/item-actions';
import {
  SCHEDULED_WORD, scheduledWordOf, isScheduledWord, scheduledWhenOf, meetingShaped, bookedEventFor,
  scheduledSeatOf, type CalendarRowLike, type BookingFacts,
} from '../lib/work/scheduled';
import { deriveState, STATE_WORDS, bookingFactsOf, workStateOf, workStatesFor } from '../lib/work/machine';
import { seatVerdict, whyNowOf, rankAttention, isBareOverdue, type AttentionRow } from '../lib/home/attention';
import { ladderReceiptKind } from '../lib/home/calm';
import {
  isLiveArtifact, withdrawnReasonOf, emptyTextArtifact, itemStatusClosed, preparedStatesFor, storedDraftWithdrawal,
  nonLiveKindsOf, type PreparedArtifact,
} from '../lib/prepare/read';
import { draftReadinessOf, mayClaimReady, visibleWords, EMPTY_DRAFT_NOTE, READY_CLAIMS } from '../lib/prepare/card-readiness';

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
let pass = 0; const failures: string[] = [];
const gate = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); } else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// ── A small in-memory PostgREST fake: eq · in · is · gte · lte · like · order · range · limit ·
//    maybeSingle. Selects return whole rows (the readers read named fields only). ─────────────────
type Row = Record<string, unknown>;
function fakeClient(tables: Record<string, Row[]>) {
  const reads: string[] = [];
  return {
    reads,
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let orderBy: { col: string; asc: boolean } | null = null;
      let from = 0; let to = Infinity; let single = false;
      const val = (r: Row, c: string) => r[c.split(/->>?/)[0]];
      const b: Record<string, unknown> = {
        select() { reads.push(table); return b; },
        eq(c: string, v: unknown) { if (!c.includes('->')) filters.push((r) => val(r, c) === v); return b; },
        in(c: string, v: unknown[]) { filters.push((r) => v.includes(val(r, c))); return b; },
        is(c: string, v: unknown) { filters.push((r) => (val(r, c) ?? null) === v); return b; },
        gte(c: string, v: string) { filters.push((r) => String(val(r, c) ?? '') >= v); return b; },
        lte(c: string, v: string) { filters.push((r) => String(val(r, c) ?? '') <= v); return b; },
        gt(c: string, v: string) { filters.push((r) => String(val(r, c) ?? '') > v); return b; },
        not() { return b; },
        like(c: string, p: string) { const re = new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`); filters.push((r) => re.test(String(val(r, c) ?? ''))); return b; },
        filter() { return b; },
        order(c: string, o?: { ascending?: boolean }) { orderBy ??= { col: c, asc: o?.ascending !== false }; return b; },
        range(f: number, t: number) { from = f; to = t; return b; },
        limit(n: number) { to = from + n - 1; return b; },
        maybeSingle() { single = true; return b; },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          try {
            let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
            if (orderBy) { const { col, asc } = orderBy; rows = [...rows].sort((x, y) => (String(x[col] ?? '') < String(y[col] ?? '') ? -1 : 1) * (asc ? 1 : -1)); }
            rows = rows.slice(from, to === Infinity ? undefined : to + 1).map((r) => ({ ...r }));
            return Promise.resolve(res({ data: single ? rows[0] ?? null : rows, error: null }));
          } catch (e) { return rej ? Promise.resolve(rej(e)) : Promise.reject(e); }
        },
      };
      return b;
    },
  };
}

const U = 'user-item-actions';
const NOW = '2026-09-24T09:00:00.000Z';
const art = (o: Partial<PreparedArtifact>): PreparedArtifact => ({ kind: 'reply_draft', title: null, content: 'Thanks — I will send it Friday.', by: 'Clara', at: NOW, attachment: null, provenance: null, ...o });

async function main() {
  const detail = src('components/home/item-detail.tsx');
  const detailCode = code('components/home/item-detail.tsx');

  // ═══ IA · EVERY ITEM KIND'S HEADER CARRIES DONE · DISMISS, WIRED TO ITS OWN DOOR ═══
  console.log('\nIA — every item room\'s header carries Done · Dismiss through its kind\'s own door');
  gate('IA1 the deed words have one home (Done · Dismiss)', ITEM_DEED_WORDS.done === 'Done' && ITEM_DEED_WORDS.dismiss === 'Dismiss');
  {
    const e = resolveRequestOf('email', 'i1', 'done'); const ed = resolveRequestOf('email', 'i1', 'dismiss');
    const c = resolveRequestOf('commitment', 'c1', 'done'); const cd = resolveRequestOf('commitment', 'c1', 'dismiss');
    const f = resolveRequestOf('followup', 'c2', 'done'); const fd = resolveRequestOf('followup', 'c2', 'dismiss');
    gate('IA2 inbox kinds (mail reply · meeting action · invite · any inbox source) → the complete (already handled) / dismiss doors',
      e.url === '/api/inbox/i1/complete' && e.init.method === 'POST' && JSON.parse(String(e.init.body)).resolution_reason === 'already_handled'
      && ed.url === '/api/inbox/i1/dismiss' && ed.init.method === 'POST');
    gate('IA3 a commitment AND a follow-up (a waiting-on commitment) → the commitment PATCH door (done · dismissed)',
      c.url === '/api/commitments/c1' && c.init.method === 'PATCH' && JSON.parse(String(c.init.body)).status === 'done'
      && JSON.parse(String(cd.init.body)).status === 'dismissed'
      && f.url === '/api/commitments/c2' && JSON.parse(String(fd.init.body)).status === 'dismissed'
      && RESOLUTION_FAMILY.followup === 'commitment');
    gate('IA4 every door is an EXISTING logged/undoable route (no new close path)',
      existsSync(join(ROOT, 'app/api/inbox/[id]/complete/route.ts')) && existsSync(join(ROOT, 'app/api/inbox/[id]/dismiss/route.ts'))
      && /export async function PATCH/.test(src('app/api/commitments/[id]/route.ts'))
      && /settleAsksForItem/.test(src('app/api/commitments/[id]/route.ts')));
  }
  {
    const email = detail.slice(detail.indexOf('function EmailDetail('), detail.indexOf('function MeetingDetail('));
    const commit = detail.slice(detail.indexOf('function CommitmentDetail('), detail.indexOf('function InputStationCard('));
    const follow = detail.slice(detail.indexOf('function FollowUpDetail('), detail.indexOf('function CommitmentSourceSection('));
    gate('IA5 the EMAIL room (every inbox kind) hands the header its pair, through resolveRequestOf(\'email\', …)',
      // ⟲ RE-POINTED (W16): the emphasis is the page's one composition's (Done leads only on the confirm widget).
      /resolve: itemDismissed \? null : \{ onDone: markHandled, onDismiss: dismissItem, emphasis: doneEmphasisOf\(view, emailConfirm\)/.test(email)
      && /resolveRequestOf\('email', id, 'dismiss'\)/.test(email) && /resolveRequestOf\('email', id, 'done'\)/.test(email));
    gate('IA6 the COMMITMENT room hands the header its pair, through resolveRequestOf(\'commitment\', …) (a handoff gate\'s card owns its close)',
      /resolve: isHandoff \|\| done \? null : \{ onDone: \(\) => act\('done'\), onDismiss: \(\) => act\('dismissed'\)/.test(commit)
      && /resolveRequestOf\('commitment', id,/.test(commit));
    gate('IA7 the FOLLOW-UP room hands the header its pair through ITS door (the commitment family — never the inbox route)',
      /resolve: sent \|\| closed \? null : \{ onDone: \(\) => resolveFollowUp\('done'\), onDismiss: \(\) => resolveFollowUp\('dismiss'\)/.test(follow)
      && /resolveRequestOf\('followup', id, deed\)/.test(follow) && !/fetch\(`\/api\/inbox\/\$\{id\}\/complete`/.test(follow)
      && /looksDoneConfirmOf\(view, 'commitment', id,/.test(follow));
    const frame = detail.slice(detail.indexOf('function ItemRoomFrame('), detail.indexOf('function DeepDiveShell('));
    const filedAt = frame.indexOf('{FILED_LABEL}'); const groupAt = frame.indexOf('<ResolveGroup resolve={room.resolve} />'); const menuAt = frame.indexOf('room.verbs.length > 0');
    gate('IA8 THE FRAME renders the group on the RIGHT, beside Details (after the Details handle, before ⋯) — one frame, every kind',
      filedAt > 0 && groupAt > filedAt && menuAt > groupAt && /\{room\.resolve && <ResolveGroup/.test(frame));
    gate('IA9 the group\'s buttons speak the one vocabulary and fire the handed deed (no fetch of its own)',
      /function ResolveGroup/.test(detailCode) && /ITEM_DEED_WORDS\.done/.test(detailCode) && /ITEM_DEED_WORDS\.dismiss/.test(detailCode)
      && !/function ResolveGroup[\s\S]{0,1600}fetch\(/.test(detailCode));
  }

  // ═══ IB · A PREPARED PRIMARY KEEPS PRIORITY; DONE LEADS ONLY WHEN THE MACHINE SAYS SO ═══
  console.log('\nIB — the prepared primary stays THE primary; Done leads on looks_done / settled');
  gate('IB1 emphasis: looks_done · settled → Done leads', resolveEmphasisOf('looks_done') === 'done' && resolveEmphasisOf('settled') === 'done');
  gate('IB2 emphasis: every state with a prepared primary (send · decision · ask · review) or motion → neither leads (secondary pair)',
    ['awaiting_approval', 'awaiting_decision', 'awaiting_input', 'ready', 'preparing', 'unjudged', 'committed', 'parked', 'scheduled', null, undefined]
      .every((s) => resolveEmphasisOf(s as string | null) === 'none'));
  {
    const group = detailCode.slice(detailCode.indexOf('function ResolveGroup'), detailCode.indexOf('function ItemRoomFrame('));
    gate('IB3 only Done can wear the lead style, and only on emphasis; Dismiss is always quiet',
      /resolve\.emphasis === 'done' \? lead : quiet/.test(group) && (group.match(/\? lead :/g) ?? []).length === 1
      && /data-deed="dismiss"[\s\S]{0,400}\$\{quiet\}/.test(group));
  }

  // ═══ IC · ONE CTA ROW — NO DUPLICATE DEED CONTROLS ═══
  console.log('\nIC — one CTA row: no second Done / Dismiss on the page');
  {
    const roomVerbBlocks = [...detailCode.matchAll(/verbs: [^\n]*\[([\s\S]*?)\n    \],/g)].map((m) => m[1]);
    const dup = roomVerbBlocks.filter((b) => HEADER_OWNED_VERB_KEYS.some((k) => new RegExp(`key: '${k}'`).test(b)));
    gate('IC1 no room\'s ⋯ menu carries a done/dismiss verb (the header group owns both deeds)', roomVerbBlocks.length >= 3 && dup.length === 0,
      `blocks=${roomVerbBlocks.length} dup=${dup.length}`);
    // ⟲ RE-POINTED (W16 · THE ITEM PAGE IS A FEW KIT WIDGETS): the looks-done STRIP is retired. Its state
    // renders as the kit's confirm widget ("Mark done" · "Keep open" — the owner's words); its Mark done is
    // the SAME door as the header's Done (one door, never a second close path), and the header Done is
    // emphasised exactly then (precedence: `the-item-page-is-a-few-widgets` over this gate's old wording).
    // ⟲ RE-POINTED (W16.2 · CONFIRM IS A REAL KIT WIDGET): the host no longer mounts a component — it
    // composes the kit's `kind: 'confirm'` card (confirmCardOf) with the SAME line and the SAME two doors.
    const host = detailCode.slice(detailCode.indexOf('function confirmCardOf'), detailCode.indexOf('function confirmArtifactOf'));
    gate('IC2 the confirm widget keeps the evidence line and Keep open; its Mark done is the header Done\'s own door (never a second close path)',
      /kind: 'confirm', id: 'confirm', line: confirm\.line,/.test(host) && /await confirm\.onDone\(\)/.test(host) && !/Not yet/.test(host)
      && /looksDoneConfirmOf\(view, 'inbox', id, markHandled\)/.test(detailCode) && /onDone: markHandled, onDismiss: dismissItem/.test(detailCode));
    gate('IC3 the less common verbs stay in ⋯ (reply · forward · no longer relevant · draft email)',
      /key: 'moot', label: 'No longer relevant'/.test(detailCode) && /key: 'reply', label: 'Reply'/.test(detailCode) && /key: 'draft', label:/.test(detailCode));
  }

  // ═══ SC · SCHEDULED IS NOT OVERDUE ═══
  console.log('\nSC — scheduled: derived at read from a booked event, never seated before its day, never overdue, looks done after');
  gate('SC1 the word lives in STATE_WORDS (one home, client-safe) and carries its when',
    STATE_WORDS.scheduled === SCHEDULED_WORD && scheduledWordOf('Wed, Sep 30, 11:00') === 'scheduled — Wed, Sep 30, 11:00'
    && isScheduledWord('scheduled — Wed, Sep 30, 11:00') && isScheduledWord('scheduled') && !isScheduledWord('ready to send'));
  gate('SC2 the when is the event\'s own zone (the user\'s calendar), a revisit is date-only',
    scheduledWhenOf('2026-09-30T09:00:00Z', 'Europe/Lisbon') === 'Wed, Sep 30, 10:00'
    && scheduledWhenOf('2026-09-30T11:00:00Z', 'UTC') === 'Wed, Sep 30, 11:00' && scheduledWhenOf('2026-10-02') === 'Fri, Oct 2');
  gate('SC3 a meeting-shaped obligation (four corpus languages) — a send obligation is not',
    meetingShaped('Join call with Sam 30 minutes later') && meetingShaped('Réunion de suivi') && meetingShaped('Termin am Montag')
    && meetingShaped('Chamada de alinhamento') && !meetingShaped('Send the interim report') && !meetingShaped('Recall the invoice'));
  const ev = (o: Partial<CalendarRowLike>): CalendarRowLike => ({ id: 'ev1', start_time: '2026-09-30T11:00:00.000Z', end_time: '2026-09-30T11:30:00.000Z', title: 'Sync with Sam', attendees: [{ email: 'sam@acme.test', name: 'Sam Lee' }], status: 'confirmed', timezone: 'UTC', ...o });
  const facts: BookingFacts = { addresses: ['sam@acme.test'], names: ['sam lee'], text: 'Join call 30 minutes later', verdictWork: 'reply', afterISO: '2026-09-22T10:00:00.000Z' };
  {
    const b = bookedEventFor(facts, [ev({})], NOW);
    gate('SC4 the counterparty in a future event on a meeting-shaped obligation → that booking (by address)', b.upcoming?.id === 'ev1' && !b.held);
    gate('SC5 by NAME too (an attendee without an address)',
      bookedEventFor({ ...facts, addresses: [] }, [ev({ attendees: [{ name: 'Sam Lee' }] })], NOW).upcoming?.id === 'ev1');
    gate('SC6 never a guess: a declined counterparty, a cancelled event, a stranger\'s event, a non-meeting obligation → no booking',
      !bookedEventFor(facts, [ev({ attendees: [{ email: 'sam@acme.test', responseStatus: 'declined' }] })], NOW).upcoming
      && !bookedEventFor(facts, [ev({ status: 'cancelled' })], NOW).upcoming
      && !bookedEventFor(facts, [ev({ attendees: [{ email: 'alex@other.test' }] })], NOW).upcoming
      && !bookedEventFor({ ...facts, text: 'Send the interim report' }, [ev({})], NOW).upcoming);
    gate('SC7 a `schedule` verdict makes any obligation meeting-shaped; the SOONEST booking wins',
      bookedEventFor({ ...facts, text: 'Sort the next step', verdictWork: 'schedule' }, [ev({ id: 'late', start_time: '2026-10-08T10:00:00Z', end_time: null }), ev({ id: 'soon' })], NOW).upcoming?.id === 'soon');
    const held = bookedEventFor(facts, [ev({ start_time: '2026-09-23T11:00:00Z', end_time: '2026-09-23T11:30:00Z' })], NOW);
    const before = bookedEventFor(facts, [ev({ start_time: '2026-09-20T11:00:00Z', end_time: '2026-09-20T11:30:00Z' })], NOW);
    gate('SC8 a meeting that ENDED after the obligation arose is HELD; one before it is not', held.held?.id === 'ev1' && !held.upcoming && !before.held);
  }
  {
    const base = { open: true, verdict: { work: 'reply' }, judgedAt: NOW, prepared: [], liveAsk: false, sentStamp: false, nowISO: NOW };
    const up = { upcoming: { id: 'ev1', start: '2026-09-30T11:00:00.000Z', end: '2026-09-30T11:30:00.000Z', title: 'Sync', tz: 'UTC', allDay: false }, held: null };
    const s = deriveState({ ...base, booked: up });
    gate('SC9 the ladder: a booked future event → `scheduled` with its when (primary none)',
      s.state === 'scheduled' && s.scheduledAt === up.upcoming.start && s.scheduledLine === 'Wed, Sep 30, 11:00' && s.primary === 'none');
    gate('SC10 unjudged and committed (a sent invite that booked it) read scheduled too — the booking is the truer word',
      deriveState({ ...base, verdict: null, booked: up }).state === 'scheduled' && deriveState({ ...base, sentStamp: true, booked: up }).state === 'scheduled');
    gate('SC11 a PREPARED PRIMARY keeps priority over scheduled (a staged Send · a live ask · a decision)',
      deriveState({ ...base, prepared: [art({})], booked: up }).state === 'awaiting_approval'
      && deriveState({ ...base, liveAsk: true, booked: up }).state === 'awaiting_input'
      && deriveState({ ...base, verdict: { work: 'decide', options: [{}, {}] }, booked: up }).state === 'awaiting_decision');
    gate('SC12 a judged-none item stays settled/parked whatever the calendar holds', deriveState({ ...base, verdict: { work: 'none' }, booked: up }).state === 'settled');
    gate('SC13 a judged REVISIT date on live work → scheduled (date-only when)',
      (() => { const r = deriveState({ ...base, verdict: { work: 'reply', revisit: { after: '2026-10-02' } } }); return r.state === 'scheduled' && r.scheduledLine === 'Fri, Oct 2'; })());
    const heldIn = { upcoming: null, held: { id: 'ev0', start: '2026-09-23T11:00:00.000Z', end: '2026-09-23T11:30:00.000Z', title: 'Sync', tz: 'UTC', allDay: false } };
    const h = deriveState({ ...base, booked: heldIn });
    gate('SC14 AFTER the event: looks_done (confirm) with the evidence line — never due again', h.state === 'looks_done' && h.heldEventId === 'ev0' && h.looksDoneLine === 'You met on Sep 23'); // ⟲ W16 · the confirm widget's plain line
    gate('SC15 "Not yet" on that event keeps it down (sticky per event)', deriveState({ ...base, booked: heldIn, refusedBookings: ['ev0'] }).state !== 'looks_done');
  }
  {
    const row = (o: Partial<AttentionRow>): AttentionRow => ({ key: 'c-1', entityId: 'c1', source: 'commitment', whyNow: '', prepared: null, overdue: true, dueDate: '2026-09-24', dueToday: true, fresh: true, ...o });
    const before = { ...row({}), ...scheduledSeatOf('2026-09-30T11:00:00.000Z', '2026-09-24') };
    const onDay = { ...row({}), ...scheduledSeatOf('2026-09-30T11:00:00.000Z', '2026-09-30') };
    gate('SC16 the seat facts clear overdue / due-today and mark the day', before.overdue === false && before.dueToday === false && before.scheduledToday === false && onDay.scheduledToday === true);
    gate('SC17 never a top-five seat before the event\'s day (held, never deleted) — seated on the day',
      seatVerdict(before).seated === false && seatVerdict(before).refusal === 'scheduled'
      && rankAttention([before], 5).served.length === 0 && rankAttention([before], 5).held.length === 1
      && seatVerdict(onDay).seated === true);
    const clause = whyNowOf({ source: 'commitment', who: 'Sam', dueDate: '2026-09-20', overdue: true, dueToday: false, stateWord: scheduledWordOf('Wed, Sep 30, 11:00') }, new Date(NOW));
    gate('SC18 the row\'s clause is the machine\'s word with its when — never "overdue", never the due words',
      clause === 'scheduled — Wed, Sep 30, 11:00' && !/overdue|due/i.test(clause) && !isBareOverdue(clause));
    gate('SC19 a scheduled row speaks no receipt (calm ladder)', ladderReceiptKind('reply_draft', 'scheduled — Wed, Sep 30, 11:00') === false);
    const brief = src('app/api/home/brief/route.ts');
    gate('SC20 the brief serves the word with its when and hands the seat facts to every row AFTER its due facts (they win)',
      /word: scheduledWordOf\(st\.scheduledLine\), scheduledAt: st\.scheduledAt/.test(brief)
      && /judgedNothing:[^\n]*\n[\s\S]{0,200}\.\.\.scheduledSeatOf\(machineOf\(entityId\)\?\.scheduledAt, todayStr\),/.test(brief)
      && /overdue: !!draft\.overdue,\s*\n\s*dueToday: !!draft\.dueToday,/.test(brief));
    gate('SC21 the room serves the when on the machine\'s line; the header composes the one word; a scheduled commitment shows no Due/Overdue',
      /line: st\.looksDoneLine \?\? st\.scheduledLine \?\? null/.test(src('app/api/items/view/route.ts'))
      && /if \(m\.state === 'scheduled'\) return scheduledWordOf\(m\.line\);/.test(detail)
      && /const overdue = !scheduled && /.test(detail) && /\{data\?\.dueDate && !scheduled && /.test(detail));
  }
  // The two READERS, end to end over the fake (the booking read, the source-message party, the batch).
  {
    const t = Date.now();
    const iso = (ms: number) => new Date(t + ms).toISOString();
    const DAY = 86_400_000;
    const tables: Record<string, Row[]> = {
      commitments: [
        { id: 'c-sched', user_id: U, status: 'open', description: 'Join the call 30 minutes later', counterparty: 'Sam Lee <sam@acme.test>', created_at: iso(-2 * DAY), source: 'manual', source_id: null, direction: 'you_owe' },
        { id: 'c-src', user_id: U, status: 'open', description: 'Join the onboarding call', counterparty: 'Jordan', created_at: iso(-2 * DAY), source: 'email', source_id: '11111111-1111-4111-8111-111111111111', direction: 'you_owe' },
        { id: 'c-held', user_id: U, status: 'open', description: 'Meet Riley to walk through the plan', counterparty: 'riley@acme.test', created_at: iso(-5 * DAY), source: 'manual', source_id: null, direction: 'you_owe' },
        { id: 'c-send', user_id: U, status: 'open', description: 'Send the interim report', counterparty: 'sam@acme.test', created_at: iso(-2 * DAY), source: 'manual', source_id: null, direction: 'you_owe' },
      ],
      emails: [{ id: '11111111-1111-4111-8111-111111111111', user_id: U, from_address: 'jordan@acme.test', to_addresses: ['me@acme.test'], is_from_user: false }],
      calendar_events: [
        { id: 'ev-a', user_id: U, start_time: iso(6 * DAY), end_time: iso(6 * DAY + 1_800_000), title: 'Call', attendees: [{ email: 'sam@acme.test' }], status: 'confirmed', timezone: 'UTC' },
        { id: 'ev-b', user_id: U, start_time: iso(3 * DAY), end_time: iso(3 * DAY + 1_800_000), title: 'Onboarding', attendees: [{ email: 'jordan@acme.test' }], status: 'confirmed', timezone: 'UTC' },
        { id: 'ev-c', user_id: U, start_time: iso(-2 * DAY), end_time: iso(-2 * DAY + 1_800_000), title: 'Plan walk-through', attendees: [{ email: 'riley@acme.test' }], status: 'confirmed', timezone: 'UTC' },
      ],
      item_plans: ['c-sched', 'c-src', 'c-held', 'c-send'].map((id) => ({ id: `p-${id}`, user_id: U, kind: 'judgment', entity_id: `commitment:${id}`, tasks: { verdict: { work: id === 'c-send' ? 'produce' : 'reply' } }, created_at: iso(-DAY), updated_at: iso(-60_000) })),
      item_deliverables: [], room_turns: [],
    };
    const sb = fakeClient(tables) as never;
    const batch = await workStatesFor(sb, U, ['c-sched', 'c-src', 'c-held', 'c-send'].map((id) => ({ kind: 'commitment' as const, id })));
    const single = await workStateOf(sb, U, { kind: 'commitment', id: 'c-sched' });
    gate('SC22 THE BATCHED READER: the booked call reads scheduled (its when served) — found by the counterparty\'s address',
      batch.get('commitment:c-sched')?.state === 'scheduled' && batch.get('commitment:c-sched')?.scheduledAt === tables.calendar_events[0].start_time,
      JSON.stringify(batch.get('commitment:c-sched')));
    gate('SC23 …and through the SOURCE MESSAGE\'s sender when the counterparty text carries no address',
      batch.get('commitment:c-src')?.state === 'scheduled', JSON.stringify(batch.get('commitment:c-src')));
    gate('SC24 …a meeting held after the obligation arose → looks_done ("you met …"); a send obligation is untouched',
      batch.get('commitment:c-held')?.state === 'looks_done' && /^You met on /.test(batch.get('commitment:c-held')?.looksDoneLine ?? '') /* ⟲ W16 wording */
      && batch.get('commitment:c-send')?.state !== 'scheduled', JSON.stringify([batch.get('commitment:c-held'), batch.get('commitment:c-send')]));
    gate('SC25 THE SINGLE READER agrees with the batch (one ladder, one booking read)',
      single.state === 'scheduled' && single.scheduledAt === batch.get('commitment:c-sched')?.scheduledAt);
    gate('SC26 bookingFactsOf never pays the calendar read for a non-meeting obligation or a handoff',
      bookingFactsOf('commitment', tables.commitments[3], { work: 'produce' }) === null
      && bookingFactsOf('commitment', { ...tables.commitments[0], source: 'handoff' }, { work: 'reply' }) === null
      && !!bookingFactsOf('commitment', tables.commitments[0], { work: 'reply' }));
  }

  // ═══ ST · A SETTLED ITEM RENDERS NO ACTION CARD ═══
  console.log('\nST — settled items drop their action cards; the history stays readable');
  gate('ST1 the closed statuses are explicit per table (an unknown status stays open)',
    itemStatusClosed('inbox', 'completed') && itemStatusClosed('inbox', 'dismissed') && !itemStatusClosed('inbox', 'pending') && !itemStatusClosed('inbox', 'snoozed')
    && itemStatusClosed('commitment', 'done') && itemStatusClosed('commitment', 'dismissed') && !itemStatusClosed('commitment', 'open'));
  {
    const settled = art({ settled: true });
    gate('ST2 THE ONE READER: an artifact on a settled item is never live, and says why', !isLiveArtifact(settled) && withdrawnReasonOf(settled) === 'the work is already settled');
    gate('ST3 settled is never a reason to REGENERATE words nor to re-prepare (no AI on closed work)',
      storedDraftWithdrawal([art({ settled: true, payload: { store: 'source_data', field: 'draft' } })]) === null
      && nonLiveKindsOf({ all: [settled] }).size === 0);
    const tables: Record<string, Row[]> = {
      commitments: [{ id: 'c-done', user_id: U, status: 'done', description: 'Send the deck', created_at: NOW, direction: 'you_owe', counterparty: 'sam@acme.test', thread_id: null }],
      item_deliverables: [{ id: 'd1', user_id: U, kind: 'commitment', entity_id: 'c-done', task_id: 'nudge', type: 'nudge_draft', title: 'Nudge', content: 'Hi Sam — here is the deck.', metadata: {}, created_at: NOW }],
    };
    const st = await preparedStatesFor(fakeClient(tables) as never, U, [
      { kind: 'commitment', id: 'c-done' },
      { kind: 'inbox', id: 'i-done', row: { source_data: { subject: 'Re: deck', draft: { body: 'Thanks Sam — sending it today.' } }, status: 'completed' } as never },
      { kind: 'inbox', id: 'i-open', row: { source_data: { subject: 'Re: deck', draft: { body: 'Thanks Sam — sending it today.' } }, status: 'pending' } as never },
    ]);
    gate('ST4 the batched reader stamps every artifact on a CLOSED commitment / inbox row settled → nothing live (still in `all`, readable)',
      (st.get('commitment:c-done')?.all.length ?? 0) > 0 && st.get('commitment:c-done')?.live.length === 0
      && (st.get('inbox:i-done')?.all.length ?? 0) > 0 && st.get('inbox:i-done')?.live.length === 0
      && (st.get('inbox:i-open')?.live.length ?? 0) > 0,
      JSON.stringify({ c: st.get('commitment:c-done')?.all.length, i: st.get('inbox:i-done')?.live.length, o: st.get('inbox:i-open')?.live.length }));
    gate('ST5 the machine: a closed item is settled (no Send primary, no state word)',
      deriveState({ open: false, verdict: { work: 'reply' }, judgedAt: NOW, prepared: [art({})], liveAsk: false, sentStamp: false }).state === 'settled'
      && STATE_WORDS.settled === null);
    const rail = code('components/home/item-rail.tsx');
    gate('ST6 THE RAIL (every card kind, one gate): the machine says settled → no artifact card, no decision',
      // ⟲ RE-POINTED (W16): RailView now types `machineState` (the item page reads it) — same predicate, no cast.
      /const itemSettled = view\.machineState\?\.state === 'settled';/.test(rail)
      && /const artifacts = itemSettled \? \[\] : artifactsIn;/.test(rail) && /const decision = itemSettled \? null : decisionIn;/.test(rail));
    gate('ST7 each room\'s own card list drops on settled too (email · commitment · follow-up), and the room view serves only live artifacts',
      /const artifactList: StreamArtifact\[\] = itemDismissed \|\| roomSettled\(view\) \? \[\] :/.test(detail)
      && /const commitArtifacts = \(isHandoff \|\| done \|\| roomSettled\(view\)\) \? \[\] :/.test(detail)
      && /artifacts=\{sent \|\| closed \|\| roomSettled\(view\) \? \[\] :/.test(detail)
      && /prepared: preparedArts\.filter\(isLiveArtifact\)/.test(src('app/api/items/view/route.ts')));
  }

  // ═══ EM · AN EMPTY DRAFT NEVER SAYS READY, NEVER SENDS ═══
  console.log('\nEM — an empty draft is never "reply ready" / "ready to send" and never carries Send');
  gate('EM1 the card\'s one predicate: recipients AND words → ready; no words → empty (or withheld); no recipient → needs_recipient',
    draftReadinessOf({ recipients: ['sam@acme.test'], body: '<p>Thanks</p>' }) === 'ready'
    && draftReadinessOf({ recipients: ['sam@acme.test'], body: '' }) === 'empty'
    && draftReadinessOf({ recipients: ['sam@acme.test'], body: '<p><br></p>&nbsp; ' }) === 'empty'
    && draftReadinessOf({ recipients: ['sam@acme.test'], body: '', withheld: 'I held this back.' }) === 'withheld'
    && draftReadinessOf({ recipients: [], body: 'Thanks' }) === 'needs_recipient'
    && draftReadinessOf({ recipients: ['a@b.test'], body: 'x', sent: true }) === 'sent');
  gate('EM2 only `ready` may claim readiness', mayClaimReady('ready') && !mayClaimReady('empty') && !mayClaimReady('withheld') && !mayClaimReady('needs_recipient')
    && READY_CLAIMS.includes('reply ready') && READY_CLAIMS.includes('ready to send') && visibleWords('<div>&nbsp;</div>') === '');
  gate('EM3 THE ONE READER: an empty reply/nudge draft is not prepared work (never live → the machine never offers Send on it)',
    emptyTextArtifact(art({ content: '  ' })) && !isLiveArtifact(art({ content: '<p></p>' })) && withdrawnReasonOf(art({ content: '' })) === 'it has no words yet'
    && !emptyTextArtifact(art({ kind: 'deliverable', content: '' }))
    && deriveState({ open: true, verdict: { work: 'reply' }, judgedAt: NOW, prepared: [art({ content: ' ' })], liveAsk: false, sentStamp: false }).state !== 'awaiting_approval');
  {
    const card = code('components/home/email-card.tsx');
    gate('EM4 THE EMAIL CARD (item · compose · coworker · standalone lanes): Send and the ready receipt ride `sendable` only',
      /const readiness = draftReadinessOf\(\{ recipients: to, body, withheld, sent \}\);/.test(card)
      && /const sendable = props\.state === 'ready' && mayClaimReady\(readiness\);/.test(card)
      && /\.\.\.\(sendable \? \{ onSend: send,/.test(card)
      && /: sendable \? \(itemLane \? 'reply ready' : 'ready to send'\) : undefined,/.test(card)
      && !/props\.state === 'ready' \? \{ onSend/.test(card) && !/props\.state === 'ready' \? \(itemLane/.test(card));
    gate('EM5 the empty card shows the honest line (withheld words first, verbatim) with the editor open',
      /readiness === 'empty' && !redrafting \? \{ bodyNote: EMPTY_DRAFT_NOTE \}/.test(card) && /onEditBody: editBody,/.test(card)
      && EMPTY_DRAFT_NOTE.length > 20 && !/ready/i.test(EMPTY_DRAFT_NOTE));
    gate('EM6 the rooms mount a reply / follow-up card only over WORDS (never a "drafted — ready" label over an empty draft)',
      // ⟲ RE-POINTED (W16): the follow-up's nudge is now the kit EMAIL widget, mounted over the LIVE pooled
      // nudge — the served list is THE ONE READER's live set, and an empty draft is never live (EM3).
      /\.\.\.\(!sent && !!draft\?\.trim\(\) && verdict\?\.work !== 'decide'/.test(detail)
      && /const followNudgeLive = \(view\?\.prepared \?\? \[\]\)\.some\(\(p\) => p\.kind === 'nudge_draft' \|\| p\.kind === 'reply_draft'\);/.test(detail)
      && /\.\.\.\(followNudgeLive \? \[\{\s*key: 'nudge', label: 'Follow-up drafted/.test(detail));
  }

  console.log(`\n${failures.length ? '❌' : '✅'} smoke-item-actions: ${pass} passed, ${failures.length} failed`);
  if (failures.length) { for (const f of failures) console.log(`   ✗ ${f}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
