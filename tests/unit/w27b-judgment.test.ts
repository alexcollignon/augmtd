// W27.B · THE WORK VERDICT, THE INPUT ASK, THE INVITE AND THE NEXT MOVE — the zero-AI half of each fix
// (docs/laws-registry: time-truth · no-silent-caps · untrusted-input-is-data · staging-law).
//   A · TIME TRUTH in the invite: the model reports the wall clock AS STATED + the zone the source names;
//       code converts (DST-true, the user's zone when none is stated — never the server's) and refuses
//       a past slot.
//   B · the schedule offer's trigger reads EN/FR/PT/DE/ES dates, weekdays, relative days, 24h + am/pm.
//   C · A SECRET IS NEVER AN INPUT: a password/login/code/key never becomes an "attach it here" card.
//   D · NO SILENT CAPS: the requires budget reports what it leaves behind (judge + resolver).
//   E · company documents (no body of work) may stage; another body of work's file never does.
//   F · the MOVE: earned calm is a real answer; truncation is detected; the voice teaches dates.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveStatedZone, statedMeetingTime, wallClockToInstant } from '@/lib/core/zoned-time';
import { slotFromModel } from '@/lib/home/prepare-action';
import { isSecretInput, moveDeclaresCalm, userOnlyInputOf } from '@/lib/room/cta-law';
import { applyAttachVerdict, buildTruth, isCompanyDocument, splitSecrets, stageEligible } from '@/lib/prepare/requirements';
import { budgetRequires, REQUIRES_BUDGET, renderWorkOptions, WORK_MEANING, WORK_VERBS, JUDGE_VERSION } from '@/lib/work/surface-registry';
import { coerceVerdict } from '@/lib/work/judge';
import { compositionTruncated, ROOM_BRIEF_VERSION } from '@/lib/room/brief';
import { TEAM_VOICE } from '@/lib/room/voice';
import type { UniversalCandidate } from '@/lib/knowledge/resolve';

const src = (p: string) => readFileSync(p, 'utf8');

describe('A · the invite slot: wall clock from the model, the instant from code', () => {
  it('no zone in the email → the USER\'s zone (never the server\'s): a Lisbon "Tuesday 3pm" is 14:00Z in October', () => {
    expect(wallClockToInstant('2026-10-06T15:00', 'Europe/Lisbon')).toBe('2026-10-06T14:00:00.000Z');
    // …and 15:00Z in winter (WET) — the region's rule on THAT date.
    expect(wallClockToInstant('2026-12-01T15:00', 'Europe/Lisbon')).toBe('2026-12-01T15:00:00.000Z');
    // A stated zone the source never wrote is not believed — the user's zone reads it.
    const noZone = 'Does Tuesday Oct 6 at 3pm work for the review?';
    expect(resolveStatedZone('CET', noZone)).toBeNull();
    expect(slotFromModel({ local: '2026-10-06T15:00', statedZone: 'CET' }, { timezone: 'Europe/Lisbon', sourceText: noZone, nowMs: Date.parse('2026-09-29T10:00:00Z') }).iso)
      .toBe('2026-10-06T14:00:00.000Z');
  });
  it('a stated zone resolves through its region ON THAT DATE — across the DST edge', () => {
    const cet = 'Call on Oct 24 or Oct 26, 17:00 CET';
    const z = resolveStatedZone('CET', cet);
    expect(z).toEqual({ tz: 'Europe/Paris', fixedOffsetMin: null });
    expect(wallClockToInstant('2026-10-24T17:00', 'Europe/Lisbon', z)).toBe('2026-10-24T15:00:00.000Z'); // CEST
    expect(wallClockToInstant('2026-10-26T17:00', 'Europe/Lisbon', z)).toBe('2026-10-26T16:00:00.000Z'); // CET, the Monday after
    // "2.30 pm BST" in summer → London summer time.
    const bst = resolveStatedZone('BST', 'Can we talk at 2.30 pm BST on Jul 7?');
    expect(wallClockToInstant('2026-07-07T14:30', 'Europe/Lisbon', bst)).toBe('2026-07-07T13:30:00.000Z');
    // US East across its own (later) DST edge.
    const et = resolveStatedZone('America/New_York', 'I am in New York — 10:00 works');
    expect(wallClockToInstant('2026-10-30T10:00', 'Europe/Lisbon', et)).toBe('2026-10-30T14:00:00.000Z');
    expect(wallClockToInstant('2026-11-02T10:00', 'Europe/Lisbon', et)).toBe('2026-11-02T15:00:00.000Z');
    // A region the model named for an abbreviation the text wrote.
    expect(resolveStatedZone('Europe/Paris', '9.30 CET works')).toEqual({ tz: 'Europe/Paris', fixedOffsetMin: null });
    // A literal offset, only when written.
    expect(resolveStatedZone('UTC+2', 'let us say 11:00 (UTC+2)')).toEqual({ tz: null, fixedOffsetMin: 120 });
    expect(resolveStatedZone('UTC+2', 'let us say 11:00')).toBeNull();
    expect(wallClockToInstant('2026-10-06T11:00', 'Europe/Lisbon', { tz: null, fixedOffsetMin: 120 })).toBe('2026-10-06T09:00:00.000Z');
  });
  it('a past slot is no slot — the honest partial (invariant 14)', () => {
    const now = Date.parse('2026-09-29T16:59:00Z');
    const past = slotFromModel({ local: '2026-09-29T09:00' }, { timezone: 'Europe/Lisbon', sourceText: '', nowMs: now });
    expect(past).toMatchObject({ iso: '', past: true });
    expect(slotFromModel({ local: '2026-09-30T09:00' }, { timezone: 'Europe/Lisbon', sourceText: '', nowMs: now }).iso).toBe('2026-09-30T08:00:00.000Z');
  });
  it('an unparseable or impossible wall time is dropped; a legacy offset reply is read as its wall time', () => {
    expect(wallClockToInstant('next tuesday', 'UTC')).toBe('');
    expect(wallClockToInstant('2026-02-30T10:00', 'UTC')).toBe('');
    expect(wallClockToInstant('2026-10-06T15:00:00+02:00', 'Europe/Lisbon')).toBe('2026-10-06T14:00:00.000Z');
  });
  it('the grounding asks for the wall clock, keeps the tail, and never parses an offset-less ISO in the server zone', () => {
    const pa = src('lib/home/prepare-action.ts');
    expect(pa).toMatch(/clipTailForPrompt\(sourceText \|\| '', 3500\)/);
    expect(pa).toMatch(/"start_local"/);
    expect(pa).not.toMatch(/new Date\(startISO\)\.toISOString\(\)/);
    expect(pa).not.toMatch(/\(sourceText \|\| ''\)\.slice\(0, 2500\)/);
  });
});

describe('B · the schedule offer trigger is language-agnostic', () => {
  const MON = '2026-09-28T10:00:00Z'; // a Monday
  const at = (t: string, tz = 'Europe/Lisbon') => statedMeetingTime(t, MON, tz)?.startISO ?? null;
  it.each([
    ['FR weekday + date + 15h', 'On peut faire la réunion vendredi 2 octobre à 15h ?', '2026-10-02T14:00:00.000Z'],
    ['PT feira + "1 de outubro" + 14h30', 'Podemos fazer a reunião na quinta-feira, 1 de outubro, às 14h30?', '2026-10-01T13:30:00.000Z'],
    ['DE numeric 06.10. + Uhr', 'Wie wäre ein Termin am 06.10. um 10 Uhr?', '2026-10-06T09:00:00.000Z'],
    ['ES weekday + a las', '¿Hacemos la llamada el jueves a las 11:00?', '2026-10-01T10:00:00.000Z'],
    ['EN tomorrow + am/pm', 'Call tomorrow at 3pm?', '2026-09-29T14:00:00.000Z'],
    ['EN weekday + "9.30" + review', 'Project review on Thursday at 9.30', '2026-10-01T08:30:00.000Z'],
    ['EN "next" weekday + prepositional hour', 'Can we do the call next Tuesday at 10?', '2026-09-29T09:00:00.000Z'],
    ['stated zone wins', 'Board prep Wednesday 14:00 CET', '2026-09-30T12:00:00.000Z'],
    ['9h30', 'Let us meet Oct 12 at 9h30', '2026-10-12T08:30:00.000Z'],
  ])('%s', (_n, text, want) => { expect(at(text)).toBe(want); });
  it('a deadline, a duration and a greeting are not meetings', () => {
    expect(at('Please review by Friday 5pm')).toBeNull();
    expect(at('Merci de valider avant vendredi 17h pour la réunion')).toBeNull();
    expect(at('We run a 2h workshop on Friday')).toBeNull();
    expect(at('Guten Morgen, können wir das Gespräch um 10 Uhr führen?')).toBeNull();
    expect(at('Please send the signed offer by Oct 12, 5pm.')).toBeNull();
  });
});

describe('C · a secret is never an input', () => {
  it.each(['the admin password', 'login credentials', 'the login details', 'verification code', 'API key', 'credit card number', 'PIN',
    'mot de passe du portail', 'senha do portal', 'Zugangsdaten', 'contraseña'])('%s is a secret', (l) => { expect(isSecretInput(l)).toBe(true); });
  it.each(['the signed contract', 'bank details letter', 'our company credentials deck', 'the org report', 'pinned roadmap', 'options sheet'])('%s is not', (l) => {
    expect(isSecretInput(l)).toBe(false);
  });
  it('the code floor splits secrets out before any model runs', () => {
    const { kept, secrets } = splitSecrets([{ label: 'the audit report' }, { label: 'your portal password' }]);
    expect(kept.map((r) => r.label)).toEqual(['the audit report']);
    expect(secrets.map((r) => r.label)).toEqual(['your portal password']);
  });
  it('a model verdict can never keep a secret — even listed attachable — and a failed verdict is no verdict', () => {
    const reqs = [{ label: 'the audit report' }, { label: 'the admin login' }, { label: 'the access badge scan' }];
    const v = applyAttachVerdict(reqs, { attachable: [1, 2, 3], secret: [3] })!;
    expect(v.kept.map((r) => r.label)).toEqual(['the audit report']);
    expect(v.secrets.map((r) => r.label).sort()).toEqual(['the access badge scan', 'the admin login']);
    expect(applyAttachVerdict(reqs, { nope: true } as never)).toBeNull();
  });
  it('the drafter is told a secret is never sent; the resolver never asks for one', () => {
    expect(buildTruth([], [], { secrets: ['the admin password'] })).toMatch(/NEVER SENT \(a secret[^)]*\): the admin password/);
    const r = src('lib/prepare/requirements.ts');
    expect(r).toMatch(/const split = await attachableSplit\(admin, userId, requires\);/);
    expect(r).toMatch(/SECRETS: a password, login, PIN/);
    // The move floor already asks for a credential instead of offering to send it — the same class.
    expect(userOnlyInputOf('Share your login details with Sam')?.kind).toBe('credential');
  });
  it('the judge never inventories a secret as a require', async () => {
    const v = await coerceVerdict({ work: 'reply', requires: [{ label: 'the signed NDA' }, { label: 'the admin password' }], reason: 'r' }, [], { todayStr: '2026-09-29', nowHHMM: '10:00', itemText: '' });
    expect(v?.requires?.map((r) => r.label)).toEqual(['the signed NDA']);
  });
});

describe('D · no silent caps on requires', () => {
  it('the budget reports what it leaves behind', () => {
    const list = Array.from({ length: REQUIRES_BUDGET + 2 }, (_, i) => ({ label: `doc ${i + 1}` }));
    const b = budgetRequires(list);
    expect(b.kept).toHaveLength(REQUIRES_BUDGET);
    expect(b.leftBehind.map((r) => r.label)).toEqual([`doc ${REQUIRES_BUDGET + 1}`, `doc ${REQUIRES_BUDGET + 2}`]);
    expect(REQUIRES_BUDGET).toBeGreaterThanOrEqual(7); // an RFP listing 7 documents is kept whole
  });
  it('the judge keeps a 7-document RFP whole and reports an over-budget remainder on the verdict', async () => {
    const ctx = { todayStr: '2026-09-29', nowHHMM: '10:00', itemText: '' };
    const seven = Array.from({ length: 7 }, (_, i) => ({ label: `certificate ${i + 1}` }));
    const v7 = await coerceVerdict({ work: 'send_file', requires: seven, reason: 'r' }, [], ctx);
    expect(v7?.requires).toHaveLength(7);
    expect(v7?.requiresLeftBehind).toBeUndefined();
    const many = Array.from({ length: REQUIRES_BUDGET + 3 }, (_, i) => ({ label: `annex ${i + 1}` }));
    const vm = await coerceVerdict({ work: 'send_file', requires: many, reason: 'r' }, [], ctx);
    expect(vm?.requires).toHaveLength(REQUIRES_BUDGET);
    expect(vm?.requiresLeftBehind).toHaveLength(3);
  });
  it('the resolver has no silent .slice(0, 5); the truth names what was not checked', () => {
    expect(src('lib/prepare/requirements.ts')).not.toMatch(/\.filter\(\(r\) => r\.label\?\.trim\(\)\)\.slice\(0, 5\)/);
    expect(src('lib/work/judge.ts')).not.toMatch(/\(r\.requires as unknown\[\]\)\.slice\(0, 5\)/);
    expect(buildTruth([], [], { leftBehind: ['annex 13'] })).toMatch(/NOT CHECKED \(over the resolver's budget of \d+ — NOT in hand\): annex 13/);
  });
});

describe('E · company documents count as available', () => {
  const cand = (over: Partial<UniversalCandidate>): UniversalCandidate => ({ source: 'kb', id: 'f', filename: 'VAT certificate.pdf', snippet: '', score: 1, entityId: null, ...over });
  it('a KB file of no body of work may stage — on a loose item or a deal item', () => {
    expect(isCompanyDocument(cand({}))).toBe(true);
    expect(stageEligible(cand({}), null)).toBe(true);
    expect(stageEligible(cand({}), 'deal-1')).toBe(true);
  });
  it('another body of work\'s file, a drive name hit, and a weak hit never stage', () => {
    expect(stageEligible(cand({ entityId: 'deal-2' }), 'deal-1')).toBe(false);
    expect(stageEligible(cand({ entityId: 'deal-2' }), null)).toBe(false);
    expect(stageEligible(cand({ source: 'gdrive' }), 'deal-1')).toBe(false);
    expect(stageEligible(cand({ score: 0.4 }), null)).toBe(false);
    expect(stageEligible(cand({ entityId: 'deal-1' }), 'deal-1')).toBe(true);
  });
});

describe('F · the judge, the move and the voice', () => {
  it('the judge is shown VERBS with their meaning — every verb, and produce is NEW work', () => {
    for (const v of WORK_VERBS) expect(renderWorkOptions()).toContain(`- "${v}": `);
    expect(WORK_MEANING.produce).toMatch(/does not exist yet/);
    expect(WORK_MEANING.produce).not.toMatch(/\bexists to review\b/);
    expect(WORK_MEANING.schedule).toMatch(/does Tuesday 3pm work/);
    const j = src('lib/work/judge.ts');
    expect(j).toContain('renderWorkOptions()');
    expect(j).not.toContain('renderComponentOptions()');
    expect(j).toMatch(/A REQUEST TO HAND OVER A SECRET is not work to do/);
    expect(j).toMatch(/reply vs schedule:/);
    expect(j).toMatch(/reply vs produce:/);
    expect(j).toMatch(/Leave out anything the facts show is already attached to the item or already given earlier in the thread/);
    // The two opposite "costs nothing" rules are gone from the prompt — one order instead.
    const prompt = j.slice(j.indexOf('const judgePrompt ='), j.indexOf('const judgeOnce'));
    expect(prompt).not.toMatch(/none costs nothing/);
    expect(prompt).not.toMatch(/judging it costs nothing/);
    expect(prompt).toMatch(/WHEN YOU CANNOT TELL whether the user owes anything, choose "none"/);
    expect(prompt).toMatch(/Once you know work is owed, doubt about the dates never makes it "none"/);
    expect(JUDGE_VERSION).toBeGreaterThanOrEqual(22);
  });
  it('earned calm: a calm-label move is no move', () => {
    for (const l of ['None', 'No urgent action', 'Nothing needed.', 'No action required', 'N/A', '']) expect(moveDeclaresCalm(l)).toBe(true);
    for (const l of ['Review the reply', 'Send the logo to Sam', 'Attach your RIB', 'Wait for Sam and then send']) expect(moveDeclaresCalm(l)).toBe(false);
  });
  it('the move prompt ranks the board and allows null; decisions are emitted before prose', () => {
    const b = src('lib/room/brief.ts');
    expect(b).toMatch(/EARNED CALM, a real answer and not a gap/);
    expect(b).toMatch(/"move":\{"label":"…","target":"<board ref>"\}\|null/);
    expect(b).not.toMatch(/null ONLY if no board item fits/);
    const keyOrder = /JSON only, in this key order: \{"asks".*"move".*"brief".*"offers"/.exec(b);
    expect(keyOrder).not.toBeNull();
    // NOISE leads the laws; the grounding clip declares itself; no raw head cut.
    expect(b.indexOf('NOISE OWES NOTHING: when THE PRESENT')).toBeLessThan(b.indexOf('Decide first, then write'));
    expect(b).toMatch(/clipForPrompt\(g\.text, GROUNDING_BUDGET\)/);
    expect(b).not.toMatch(/g\.text\.slice\(0, 5000\)/);
    // The COHERENCE example never names the seat in the third person; no real names.
    expect(b).not.toMatch(/Clara still needs/);
    expect(b).toMatch(/Draft a reply to Sam requesting the delivery/);
    expect(ROOM_BRIEF_VERSION).toBeGreaterThanOrEqual(22);
  });
  it('truncation is detected, never silent', () => {
    expect(compositionTruncated('{"asks":[],"move":null,"brief":"Sam is waiting on', null)).toBe(true);
    expect(compositionTruncated('', null)).toBe(false); // an outage, not a truncation
    expect(compositionTruncated('{"brief":"ok"}', { brief: 'ok' })).toBe(false);
  });
  it('the one voice teaches dates, never a relative delta (TIME TRUTH)', () => {
    expect(TEAM_VOICE).not.toMatch(/\bdays? ago\b/);
    expect(TEAM_VOICE).toMatch(/since Jul 3/);
  });
});
