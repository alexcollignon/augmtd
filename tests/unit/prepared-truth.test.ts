import { describe, it, expect } from 'vitest';
import {
  completionClaimIn, claimsUndoneWork, inviteOutsideStatedWindow, slotInPast, localDateOf, windowOfItemText,
  proposalAnnotation,
} from '@/lib/prepare/truth';
import { stampTruth, isLiveArtifact, commitmentTruthFacts, inboxTruthFacts, poolRowsToArtifacts } from '@/lib/prepare/read';
import { pickFreeSlots, proposeFreeSlots } from '@/lib/prepare/free-slots';
import { inviteCardOf, proposalAnnotationOf } from '@/lib/prepare/invite-card';

// ═══ THE COMPLETION FLOOR (W5a — the fabricated-deed class; fail-safe by construction) ═══
describe('completionClaimIn — the narrow vocabulary', () => {
  it('catches the live class (first-person done-verbs, the hand-over shape, "is now done")', () => {
    expect(completionClaimIn("I've finished the group redistribution and here's the updated allocation breakdown.")).toMatch(/finished/i);
    expect(completionClaimIn('Please find the updated report below.')).toMatch(/find the updated/i);
    expect(completionClaimIn('Attached is the signed contract.')).toMatch(/attached is/i);
    expect(completionClaimIn('Everything is now done on our side.')).toMatch(/done/i);
    expect(completionClaimIn('I have sent the invoice this morning.')).toMatch(/sent/i);
  });
  it('catches PT / DE / FR equivalents', () => {
    expect(completionClaimIn('Já enviei o relatório atualizado.')).toBeTruthy();
    expect(completionClaimIn('Segue em anexo a proposta.')).toBeTruthy();
    expect(completionClaimIn('Ich habe den Bericht gesendet.')).toBeTruthy();
    expect(completionClaimIn('Anbei die Unterlagen.')).toBeTruthy();
    expect(completionClaimIn("J'ai terminé la répartition.")).toBeTruthy();
    expect(completionClaimIn('Vous trouverez ci-joint le document.')).toBeTruthy();
  });
  it('stays silent on status, futures, negations and questions (the fail-safe half)', () => {
    expect(completionClaimIn('I have not finished the redistribution yet — I need the scope first.')).toBeNull();
    expect(completionClaimIn('I will send the updated breakdown once we agree the scope.')).toBeNull();
    expect(completionClaimIn('Could you confirm which groups are in scope? Then I can finalise it.')).toBeNull();
    expect(completionClaimIn('Ich habe noch nicht gesendet.')).toBeNull();
    expect(completionClaimIn("Je n'ai pas envoyé le rapport.")).toBeNull();
    expect(completionClaimIn('It is done when you approve.')).toBeNull();
    expect(completionClaimIn('')).toBeNull();
    expect(completionClaimIn(null)).toBeNull();
  });
});

describe('claimsUndoneWork — speaks only with its facts', () => {
  const words = "I've finished the redistribution. Here's the updated breakdown.";
  it('fires on an OPEN obligation with nothing staged', () => {
    expect(claimsUndoneWork(words, { obligationOpen: true, staged: false })).toBeTruthy();
  });
  it('is silent when the obligation is not open (the deed may be real) or something is staged', () => {
    expect(claimsUndoneWork(words, { obligationOpen: false, staged: false })).toBeNull();
    expect(claimsUndoneWork(words, { obligationOpen: true, staged: true })).toBeNull();
  });
});

// ═══ THE WINDOW FLOOR (W5a — a proposal outside what they stated) ═══
describe('inviteOutsideStatedWindow', () => {
  const text = 'Schedule meeting with Sam — September 30 or October 1';
  const anchor = '2026-09-18T10:00:00Z';
  it('parses the stated window from the item\'s own words', () => {
    expect(windowOfItemText(text, anchor)).toMatchObject({ start: '2026-09-30', end: '2026-10-01' });
  });
  it('flags a proposal outside the window and accepts one inside it (in the invite\'s own zone)', () => {
    expect(inviteOutsideStatedWindow({ startISO: '2026-09-23T08:00:00Z', timezone: 'Europe/Lisbon' }, text, anchor)).toBe(true);
    expect(inviteOutsideStatedWindow({ startISO: '2026-09-30T09:00:00Z', timezone: 'Europe/Lisbon' }, text, anchor)).toBe(false);
    expect(inviteOutsideStatedWindow({ startISO: '2026-10-01T15:00:00Z', timezone: 'Europe/Lisbon' }, text, anchor)).toBe(false);
    // the zone matters: 23:30Z on Oct 1 is Oct 2 in Lisbon? No — Lisbon is UTC+1 in summer → 00:30 Oct 2 → outside.
    expect(inviteOutsideStatedWindow({ startISO: '2026-10-01T23:30:00Z', timezone: 'Europe/Lisbon' }, text, anchor)).toBe(true);
  });
  it('claims nothing without a stated window, a start, or a parseable slot', () => {
    expect(inviteOutsideStatedWindow({ startISO: '2026-09-23T08:00:00Z' }, 'Schedule a 15-minute call with Sam', anchor)).toBe(false);
    expect(inviteOutsideStatedWindow({ startISO: '' }, text, anchor)).toBe(false);
    expect(inviteOutsideStatedWindow({ startISO: 'garbage' }, text, anchor)).toBe(false);
    expect(inviteOutsideStatedWindow(null, text, anchor)).toBe(false);
  });
  it('slotInPast / localDateOf', () => {
    const now = Date.parse('2026-09-23T12:00:00Z');
    expect(slotInPast('2026-09-23T10:00:00Z', now)).toBe(true);
    expect(slotInPast('2026-09-24T10:00:00Z', now)).toBe(false);
    expect(slotInPast('', now)).toBe(false);
    expect(localDateOf('2026-09-30T23:30:00Z', 'Europe/Lisbon')).toBe('2026-10-01');
    expect(localDateOf('nope', 'UTC')).toBeNull();
  });
});

// ═══ THE ONE READER stamps both floors; the live predicate honors them ═══
describe('stampTruth at the one reader', () => {
  const row = (over: Record<string, unknown>) => ({ id: 'r', task_id: null, type: 'draft', title: 'x', content: 'body', created_at: '2026-09-20T10:00:00Z', metadata: {}, ...over });
  const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
  it('an invite outside the commitment\'s stated window is outsideWindow — not live', () => {
    const facts = commitmentTruthFacts({ description: 'Schedule meeting with Sam — September 30 or October 1', created_at: '2026-09-18T10:00:00Z', status: 'open', direction: 'you_owe' });
    const arts = poolRowsToArtifacts([row({ task_id: 'prepare-pass-invite', metadata: { invite: { title: 'Sync', startISO: '2026-09-23T09:00:00Z', timezone: 'Europe/Lisbon', proposed: true } } })], 'commitment');
    // guard against the fixture itself expiring: the flag is about the window, not the clock
    stampTruth(arts, facts);
    expect(arts[0].outsideWindow).toBe(true);
    expect(isLiveArtifact(arts[0])).toBe(false);
  });
  it('an invite inside the window stays live (window-wise)', () => {
    const facts = commitmentTruthFacts({ description: 'Schedule meeting with Sam — the week of ' + future.slice(0, 10), created_at: new Date().toISOString(), status: 'open', direction: 'you_owe' });
    const arts = poolRowsToArtifacts([row({ task_id: 'prepare-pass-invite', metadata: { invite: { title: 'Sync', startISO: future, timezone: 'UTC', proposed: true } } })], 'commitment');
    stampTruth(arts, facts);
    expect(arts[0].outsideWindow).toBeUndefined();
  });
  it('a paste pack claiming an undone deed on an open you_owe commitment is falseClaim — not live', () => {
    const facts = commitmentTruthFacts({ description: 'Redistribute the group allocation', created_at: '2026-09-18T10:00:00Z', status: 'open', direction: 'you_owe' });
    const arts = poolRowsToArtifacts([row({ type: 'document', content: "I've finished the group redistribution. Here's the updated allocation breakdown.", metadata: { pastePack: true, note: 'Words ready' } })], 'commitment');
    stampTruth(arts, facts);
    expect(arts[0].kind).toBe('paste_pack');
    expect(arts[0].falseClaim).toBe(true);
    expect(isLiveArtifact(arts[0])).toBe(false);
  });
  it('the same words on an AWAITING commitment (they owe) or with an attachment staged are not judged', () => {
    const awaiting = commitmentTruthFacts({ description: 'Send the report', created_at: '2026-09-18T10:00:00Z', status: 'open', direction: 'awaiting' });
    const a1 = poolRowsToArtifacts([row({ content: 'I have sent the report.', metadata: {} })], 'commitment');
    stampTruth(a1, awaiting);
    expect(a1[0].falseClaim).toBeUndefined();
    const owe = commitmentTruthFacts({ description: 'Send the report', created_at: '2026-09-18T10:00:00Z', status: 'open', direction: 'you_owe' });
    const a2 = poolRowsToArtifacts([row({ content: 'Attached is the report.', metadata: { attachment: { fileId: 'f', filename: 'report.pdf' } } })], 'commitment');
    stampTruth(a2, owe);
    expect(a2[0].falseClaim).toBeUndefined();
  });
  it('inbox facts turn the completion floor OFF (unverifiable) and keep the window floor', () => {
    const f = inboxTruthFacts({ subject: 'Call', body: 'Can we talk September 30 or October 1?', received_at: '2026-09-18T10:00:00Z' });
    expect(f?.obligationOpen).toBe(false);
    expect(f?.text).toContain('September 30');
  });
  it('null facts stamp nothing', () => {
    const arts = poolRowsToArtifacts([row({ content: 'I have sent it.', metadata: {} })], 'commitment');
    stampTruth(arts, null);
    expect(arts[0].falseClaim).toBeUndefined();
  });
});

// ═══ THE SLOT FLOORS — never the past, and inside the window ═══
describe('free slots honor the clock and the window', () => {
  it('pickFreeSlots never proposes a slot at or before now', () => {
    // "today" is a Monday; now is Tuesday 15:00Z, so Tuesday 10:00 and 14:00 are behind the clock.
    const nowMs = Date.parse('2026-09-22T15:00:00Z');
    const slots = pickFreeSlots({ todayStr: '2026-09-21', tz: 'UTC', busy: [], count: 3, nowMs });
    expect(slots.length).toBe(3);
    for (const s of slots) expect(Date.parse(s.startISO)).toBeGreaterThan(nowMs);
    expect(slots[0].startISO).toBe('2026-09-22T16:00:00.000Z');
  });
  it('proposeFreeSlots confines proposals to the stated window and refuses a closed one', async () => {
    const fake = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ gte: () => ({ lte: () => ({ limit: async () => ({ data: [] }) }) }) }) }) }) }) } as never;
    const today = '2026-09-23';
    const inWin = await proposeFreeSlots(fake, 'u', { tz: 'UTC', todayStr: today, fromDayStr: '2026-09-30', toDayStr: '2026-10-01', count: 3 });
    expect(inWin.length).toBeGreaterThan(0);
    for (const s of inWin) expect(s.startISO.slice(0, 10) >= '2026-09-30' && s.startISO.slice(0, 10) <= '2026-10-01').toBe(true);
    const closed = await proposeFreeSlots(fake, 'u', { tz: 'UTC', todayStr: today, fromDayStr: '2026-09-15', toDayStr: '2026-09-16', count: 3 });
    expect(closed).toEqual([]);
    // a window opening in the past is clamped to tomorrow, never proposing behind the clock
    const clamped = await proposeFreeSlots(fake, 'u', { tz: 'UTC', todayStr: today, fromDayStr: '2026-09-20', toDayStr: '2026-09-25', count: 3 });
    for (const s of clamped) expect(s.startISO.slice(0, 10) >= '2026-09-24').toBe(true);
  });
});

// ═══ THE LABEL — "inside what they stated" is a verification claim ═══
describe('the proposal annotation renders from provenance only', () => {
  it('proposalAnnotationOf / proposalAnnotation', () => {
    expect(proposalAnnotationOf('stated_window')).toBe('our proposal — inside what they stated');
    expect(proposalAnnotationOf('calendar')).toBe('our proposal — free on your calendar');
    expect(proposalAnnotationOf(undefined)).toBe('our proposal');
    expect(proposalAnnotation('calendar')).toBe('our proposal — free on your calendar');
  });
  it('inviteCardOf: a proposed slot with no provenance never claims "inside what they stated"', () => {
    const base = { title: 'Sync', startISO: '2026-10-01T09:00:00Z', endISO: '2026-10-01T09:30:00Z', attendees: [], timezone: 'UTC', proposed: true };
    expect(inviteCardOf(base).options[0].annotation).toBe('our proposal');
    expect(inviteCardOf({ ...base, proposedFrom: 'calendar' }).options[0].annotation).toBe('our proposal — free on your calendar');
    expect(inviteCardOf({ ...base, proposedFrom: 'stated_window' }).options[0].annotation).toBe('our proposal — inside what they stated');
    expect(inviteCardOf({ ...base, proposed: false }).options[0].annotation).toBe('filled in above');
  });
});
