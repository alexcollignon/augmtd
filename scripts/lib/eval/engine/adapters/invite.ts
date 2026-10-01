// W26 · J11 — INVITE NEED + TIME PARSING (the `invite` card). Two questions: does this item call for
// booking a meeting at all, and if so which slot did the thread actually STATE (date + clock time in
// the user's zone) — never an invented time. AUGMTD: the pipeline on a fresh world — understanding →
// judgeWork (need = the schedule verdict) → groundInviteFromText over the thread's own words (the
// slot must be evidenced by the text; a proposed slot is marked as ours, which scores as "unstated").
// Plain: the thread, "do we need to book something, and for exactly when?".
import type { SurfaceAdapter, LabelField, EvalCase } from '../types';
import { plainScaffold, parseJSON, understandAllThenJudge, truthDate, normDate } from './shared';
import { localDate, localClock, resolveWorld } from '../world';
import { CASES } from '../fixtures/invite';
// W26 loss diagnosis — the SERVED VIEW's product steps (pure, zero AI, zero IO; the product's own functions).
import { scheduleOfferDecision } from '../../../../../lib/prepare/schedule-offer';
import { ownWordsOf } from '../../../../../lib/evidence/relevance';
import { confineInviteToStatedWindow } from '../../../../../lib/prepare/truth';

/** Verdict kinds that serve NO invite at all (the offer lane skips them too: lib/prepare/pass.ts:179). */
const NO_OFFER_WORK = new Set(['schedule', 'none', 'failed']);

/** Saved-run recovery (zero AI): work · startISO · proposed from the produce() text shape. */
export function recoverInviteRaw(value: Record<string, unknown>, text?: string): Record<string, unknown> {
  if ('work' in value || !text) return value;
  let m = /^no invite \((\w+)\)/.exec(text);
  if (m) return { ...value, work: m[1], startISO: '', proposed: false };
  m = /^invite · (no slot|\S+)( \(proposed\))? · /.exec(text);
  if (m) return { ...value, work: 'schedule', startISO: m[1] === 'no slot' ? '' : m[1], proposed: !!m[2] };
  return value;
}


/**
 * W26 loss diagnosis (Sep 29) — THE SERVED INVITE, not the judge's raw lane. produce() used to score
 * only the `schedule` verdict's grounding, so two served paths were invisible to the eval:
 *   1. THE SCHEDULE OFFER (lib/prepare/schedule-offer.ts, run by the prepare pass beside EVERY
 *      non-schedule, non-none inbox verdict — lib/prepare/pass.ts:179): when the NEWEST inbound's own
 *      words state an explicit date + clock time near a meeting word and nothing with the counterparty
 *      is booked ±12h, an invite at THAT time is prepared and rendered (lib/prepare/read.ts:468) beside
 *      the reply. On standard, the judge reads "does Tue 3pm work?" as `reply` on 26 of 33 invite
 *      cases — the product still serves the invite through this lane. The IO half reads the item
 *      envelope (source_data.body = the newest message in a real sync — W27.C: the fixture now seeds it
 *      so too) and the user's zone from their calendar (W27.C: primed from the world's zone); so the
 *      eval runs the PURE decision (`scheduleOfferDecision`) over the newest inbound's own words, the
 *      world's zone and the world's calendar — what a real account's envelope + calendar carry.
 *   2. THE WINDOW CONFINEMENT (lib/prepare/truth confineInviteToStatedWindow — pass.ts:752 and the
 *      card's on-demand build both run it): a grounded slot behind the clock or outside the stated
 *      window is dropped before it can render.
 * And a PROPOSED slot is ours, not the thread's: it scores `unstated` on BOTH date and time (the
 * header always said so; the code only unstated the time).
 * Idempotent: the projected value carries `served: true`. A saved value without the raw `work`
 * (runs that predate this) is returned unchanged — servedView recovers
 * `work`/`startISO`/`proposed` from the saved text first (recoverInviteRaw).
 */
function servedInvite(value: Record<string, unknown>, c: EvalCase, now: Date): Record<string, unknown> {
  if (value.served === true || typeof value.work !== 'string') return value;
  const work = value.work;
  const rw = resolveWorld(c.world, now);
  const tz = rw.tz;
  const key = String(c.params?.item ?? rw.threads[0]?.itemKey ?? rw.threads[0]?.key);
  const t = rw.threads.find((x) => x.itemKey === key || x.key === key);
  const none = { ...value, need: 'no_invite', date: 'unstated', time: 'unstated', served: true };
  if (work === 'schedule') {
    const inv = { startISO: String(value.startISO ?? ''), endISO: '', proposed: value.proposed === true, timezone: tz };
    if (inv.startISO && t) {
      const wide = t.messages.map((m) => m.body).join('\n\n');
      confineInviteToStatedWindow(inv, { narrow: t.subject, wide }, null, now.getTime());
    }
    const stated = !!inv.startISO && !inv.proposed;
    return {
      ...value, need: 'invite', served: true, confined: !!value.startISO && !inv.startISO,
      date: stated ? localDate(new Date(inv.startISO), tz) : 'unstated',
      time: stated ? localClock(new Date(inv.startISO), tz) : 'unstated',
    };
  }
  if (NO_OFFER_WORK.has(work) || !t) return none;
  const newest = [...t.messages].reverse().find((m) => !m.from.me);
  if (!newest) return none;
  const probe = scheduleOfferDecision({
    ownWords: ownWordsOf(newest.body).slice(0, 4000), receivedAt: newest.at.toISOString(), nowISO: now.toISOString(),
    fallbackTz: tz, existing: null, bookedNear: false, hasCounterparty: true,
  });
  if (probe.action !== 'prepare') return { ...none, offer: probe.action === 'none' ? probe.why : null };
  const at = Date.parse(probe.stated.startISO);
  const cp = newest.from.email.toLowerCase();
  const bookedNear = rw.events.some((e) => Math.abs(e.start.getTime() - at) <= 12 * 3_600_000 && e.attendees.some((a) => a.email.toLowerCase() === cp));
  if (bookedNear) return { ...none, offer: 'already on the calendar with them around that time' };
  const s = new Date(probe.stated.startISO);
  return { ...value, need: 'invite', served: true, offer: 'stated_time', date: localDate(s, tz), time: localClock(s, tz) };
}

const needsInvite = (t: Record<string, unknown>) => t.need === 'invite';

export const INVITE_FIELDS: LabelField[] = [
  {
    kind: 'enum', name: 'need', silence: 'no_invite',
    labels: { invite: 'a meeting/call should be booked now', no_invite: 'nothing to book (or it is already booked / past)' },
    costs: { no_invite: { invite: 2 } },
  },
  {
    kind: 'enum', name: 'date', when: needsInvite,
    labels: { 'YYYY-MM-DD': 'the date the thread states for it', unstated: 'the thread does not state a date' },
    costs: { unstated: { '*': 3 } },
  },
  {
    kind: 'enum', name: 'time', when: needsInvite,
    labels: { 'HH:MM': 'the start time the thread states, 24h, in MY time zone', unstated: 'the thread does not state a time' },
    // An invented time where none was stated is the visible failure (−3).
    costs: { unstated: { '*': 3 } },
  },
];

const normClock = (v: unknown): string => {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s || /^(none|null|unstated|n\/a)$/.test(s)) return 'unstated';
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s);
  if (!m) return s;
  let h = Number(m[1]);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m[2] ?? '00'}`;
};

export const inviteAdapter: SurfaceAdapter = {
  id: 'judgment.invite',
  family: 'judgment',
  title: 'Invite — is a booking needed, and for the time actually stated',
  stage: '1a',
  producer: { file: 'lib/home/prepare-action.ts', fn: 'judgeWork → groundInviteFromText', slot: 'classification', effortKey: 'work.judge' },
  tiers: ['standard', 'eu'],
  status: 'ready',
  planned: [
    { group: 'stated-slot', count: 4, note: '"Tuesday 3pm works" → invite + that slot' },
    { group: 'tz-boundary', count: 3, note: '"3pm your time" / "15:00 Lisbon" across a zone boundary (world.tz)' },
    { group: 'vague', count: 3, note: '"next week sometime" → invite, date/time unstated (ask, never invent)' },
    { group: 'past-slot', count: 3, note: 'a slot already in the past → no_invite' },
    { group: 'dst-week', count: 2, note: 'a DST-change week' },
    { group: 'counter-proposal', count: 3, note: 'a counter-proposal supersedes the first slot → the newest' },
    { group: 'already-booked', count: 2, note: 'the calendar already holds it (world.events) → no_invite' },
    { group: 'edge-missing', count: 2, note: 'a meeting request with no date or time at all → invite, unstated', edge: 'missing' },
    { group: 'edge-irrelevant', count: 2, note: 'dates in the thread that are about something else (a delivery date)', edge: 'irrelevant' },
    { group: 'edge-long', count: 2, note: 'the slot agreed in message 7 of a 9-message thread', edge: 'long' },
    { group: 'edge-harmful', count: 2, note: 'an invite request that asks for credentials in the same mail', edge: 'harmful' },
    { group: 'edge-ambiguous', count: 2, note: '"Tuesday or Wednesday afternoon, whichever suits" → date/time unstated', edge: 'ambiguous' },
  ],
  cases: () => CASES as EvalCase[],
  scoring: { kind: 'labelled', fields: INVITE_FIELDS, primary: { field: 'time', metric: 'cost_weighted' } },
  estimate: () => ({ augmtd: { calls: 3, inTok: 7000, outTok: 700 }, plainIn: 1300, plainOut: 150 }),
  resolveTruth: (c, now) => ({
    ...c.truth,
    date: c.truth.date === 'unstated' || c.truth.date == null ? 'unstated' : truthDate(c.truth.date, now, c.world.tz ?? 'UTC'),
    time: normClock(c.truth.time),
  }),

  async produce(ctx, c, s) {
    const key = String(c.params?.item ?? s.resolved.threads[0]?.itemKey);
    const v = await understandAllThenJudge(ctx, s, key);
    if ((v as { failed?: boolean }).failed) return { text: `(judge failed: ${v.reason})`, value: null };
    // W26 loss diagnosis: the raw verdict + slot ride the value; servedInvite projects what the
    // product SERVES (the schedule offer beside a non-schedule verdict · the window confinement).
    if (v.work !== 'schedule') {
      const value = servedInvite({ work: v.work, startISO: '', proposed: false }, c as EvalCase, ctx.now);
      return { text: `no invite (${v.work}) — ${v.reason}${value.offer === 'stated_time' ? ` · schedule offer: ${value.date} ${value.time}` : ''}`, value };
    }
    const { groundInviteFromText } = await import('../../../../../lib/home/prepare-action');
    const t = s.resolved.threads.find((x) => x.itemKey === key);
    const tz = s.resolved.tz;
    const sourceText = t ? t.messages.map((m) => `From: ${m.from.name} <${m.from.email}> · ${m.at.toISOString()}\n${m.body}`).join('\n\n') : '';
    const known = t ? [...new Set(t.messages.flatMap((m) => [m.from, ...m.to, ...m.cc]).filter((p) => !p.me).map((p) => p.email))] : [];
    const inv = await groundInviteFromText(ctx.admin, ctx.userId, {
      sourceText, askText: t?.subject ?? 'Meeting', knownEmails: known, anchorISO: ctx.now.toISOString(), timezone: tz, sourceLabel: 'email',
    });
    const value = servedInvite({ work: 'schedule', startISO: inv.startISO || '', proposed: inv.proposed === true }, c as EvalCase, ctx.now);
    return { text: `invite · ${inv.startISO || 'no slot'}${inv.proposed ? ' (proposed)' : ''}${value.confined ? ' (dropped by the window confinement)' : ''} · ${inv.title}`, value };
  },
  // W26 loss diagnosis: a saved run's value predates the raw fields — recover them from the saved
  // produce() text (the same parse scratchpad invite-inject.py did), so --recheck alone reproduces it.
  servedView: (value, c, now, text) => servedInvite(recoverInviteRaw(value, text), c as EvalCase, now),

  plainPrompt(c, now) {
    const key = String(c.params?.item ?? c.world.threads?.[0]?.key);
    const subj = (c.world.threads ?? []).find((t) => t.key === key)?.subject ?? '';
    return {
      user: plainScaffold(c, now,
        `About the thread "${subj}": should I book a meeting/call now? If yes, for exactly which date and start time — only what the thread actually states, converted to my time zone.`,
        INVITE_FIELDS),
    };
  },
  parse(text, c) {
    const v = parseJSON(text);
    if (!v) return null;
    return { ...v, date: normDate(v.date, c.world.tz ?? 'UTC') ?? 'unstated', time: normClock(v.time) };
  },
  stubAnswer: (c, now) => JSON.stringify({
    need: c.truth.need, date: c.truth.date === 'unstated' || c.truth.date == null ? 'unstated' : truthDate(c.truth.date, now, c.world.tz ?? 'UTC'), time: c.truth.time ?? 'unstated',
  }),
};
