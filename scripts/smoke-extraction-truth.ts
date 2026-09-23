// ════════════════════════════════════════════════════════════════════════════════════════════════
// EXTRACTION TRUTH — THE GATE (stabilization W3.4a · invariant 14 TIME TRUTH). ZERO AI, ZERO DB.
//
// Tier 1 — the pure cores on fixtures: the forward anchor (a spoken date never lands in a past
// year), the stated window (due_date = the window's END, code-verified, never invented), the
// self-party law, the open-duplicate law, the seat law's ADDRESSED reading, THE MAY RULE, and the
// deed-ref floor. Tier 2 — source floors on every write seam the laws cross (both meeting-insights
// prompts carry the clock; every commitment write door runs the shared predicates; the sweeps ask
// the SAME predicates and are dry-run by default).
// Run: npx tsx scripts/smoke-extraction-truth.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import {
  anchorDueDate, statedWindow, dueDateFromSource, denotesUser, repairSelfParty, isOpenDuplicate,
} from '../lib/commitments/extraction-truth';
import { isNearDuplicate } from '../lib/commitments/extract';
import { enforceWeekdayDatePairs } from '../lib/utils/weekday-floor';
import { stripGroundingRefs } from '../lib/utils/strip-grounding-refs';
import { seatStripsObligation, textNamesUser } from '../lib/inbox/recipient-role';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const src = (p: string) => readFileSync(p, 'utf8');
const j = (v: unknown) => JSON.stringify(v);

// ── TIER 1 · THE PURE CORES ──────────────────────────────────────────────────────────────────────
console.log('THE FORWARD ANCHOR (the 2024 incident class):');
ok('a spoken "27th of August" the model wrote as 2024 re-anchors to the meeting\'s year',
  anchorDueDate('2024-08-27', '2026-09-01T10:00:00Z') === '2026-08-27');
ok('a date inside the forward window stands untouched', anchorDueDate('2026-09-30', '2026-09-01') === '2026-09-30');
ok('a month already long past resolves to NEXT year, never an earlier one', anchorDueDate('2025-01-05', '2026-12-20') === '2027-01-05');
ok('garbage and impossible days → null (never invented)',
  anchorDueDate('next friday', '2026-09-01') === null && anchorDueDate('2026-02-30', '2026-01-01') === null);

console.log('THE STATED WINDOW:');
const A = '2026-09-10T09:00:00Z';
const w1 = statedWindow('Schedule a 15-minute call with Sam — week of September 16', A);
ok('"week of September 16" → due = that week\'s Sunday', w1?.end === '2026-09-20' && w1?.start === '2026-09-16', j(w1));
const w2 = statedWindow('Schedule meeting with Sam — September 30 or October 1', A);
ok('a choice of slots is open until its LAST one', w2?.end === '2026-10-01', j(w2));
ok('"Sep 15 or 16" (one month, two days) → the 16th', statedWindow('Call Sam — Sep 15 or 16, late in day', A)?.end === '2026-09-16');
ok('"16–20 de setembro" (PT range) → the 20th', statedWindow('Entregar 16–20 de setembro', A)?.end === '2026-09-20');
ok('month-only after a window preposition → the month\'s last day',
  statedWindow('Schedule a conversation — September', A)?.end === '2026-09-30');
ok('"before Oct 2" ends the day before', statedWindow('Send the deck before Oct 2', A)?.end === '2026-10-01');
ok('a date before its own source is a REFERENCE, not a due', statedWindow('Follow up on the Aug 12 meeting notes', A) === null);
ok('a written year long before the source refuses the whole parse', statedWindow('Report for September 3, 2024', A) === null);
ok('"may" the verb is never the month; nothing stated → null',
  statedWindow('Monday 15 may be fine', A) === null && statedWindow('Send the Q3 proposal', A) === null);
ok('the window END wins when the model\'s date sits inside it (source states it)',
  dueDateFromSource({ modelDate: '2026-09-16', description: 'Call Sam — week of September 16', sourceText: 'can we talk the week of Sept 16?', anchorIso: A }) === '2026-09-20');
ok('a window the SOURCE never stated mints nothing (the title cannot invent a date)',
  dueDateFromSource({ modelDate: null, description: 'Call Sam — week of September 16', sourceText: 'can we talk soon?', anchorIso: A }) === null);
ok('no window, no model date → null; a model date alone is forward-anchored',
  dueDateFromSource({ modelDate: null, description: 'Send the deck', anchorIso: A }) === null
  && dueDateFromSource({ modelDate: '2024-09-25', description: 'Send the deck', anchorIso: A }) === '2026-09-25');

console.log('THE SELF-PARTY LAW:');
const user = { name: 'Jordan Rivers', aliases: ['jordan@acme-example.com'] };
ok('the user\'s first name, full name and address denote the user; a stranger does not',
  denotesUser('Jordan', user) && denotesUser('Jordan Rivers <jordan@acme-example.com>', user)
  && !denotesUser('Sam', user) && !denotesUser('Jordan Smith', user));
ok('a namesake on the OTHER side is the likelier reading (ambiguous → not the user)', !denotesUser('Jordan', user, 'Jordan Smith'));
const r1 = repairSelfParty({ description: 'Schedule a call with Jordan — week of September 16', counterparty: null, direction: 'you_owe' }, user, 'Sam Vendor <sam@acme-example.com>');
ok('"call with <user>" is re-derived from the source\'s other party, title rewritten from their side',
  r1.changed && r1.description === 'Schedule a call with Sam Vendor — week of September 16' && !!r1.counterparty && /Sam/.test(r1.counterparty), j(r1));
const r2 = repairSelfParty({ description: 'Schedule a walkthrough with the team', counterparty: 'Jordan', direction: 'awaiting' }, user, null);
ok('a counterparty that IS the user: awaiting-on-yourself is your own task, counterparty never the user',
  r2.direction === 'you_owe' && r2.counterparty === null, j(r2));
const r3 = repairSelfParty({ description: 'Review the draft with Jordan', counterparty: 'Sam', direction: 'awaiting' }, user, 'Sam');
ok('an awaiting "review with <user>" is the other party\'s debt WITH the user — true as written, untouched', !r3.changed, j(r3));

console.log('THE OPEN-DUPLICATE LAW:');
const near = (a: string, b: string) => isNearDuplicate(a, b);
const base = { description: 'Send the pilot proposal to Sam', direction: 'you_owe', counterparty: 'Sam Vendor', created_at: '2026-09-01T10:00:00Z' };
ok('same thread + near text → one obligation', isOpenDuplicate({ ...base, thread_id: 't1' }, { ...base, description: 'Send Sam the pilot proposal', thread_id: 't1' }, near));
ok('same counterparty within 14 days → one obligation', isOpenDuplicate(base, { ...base, description: 'Send the pilot proposal over to Sam', created_at: '2026-09-10T10:00:00Z' }, near));
ok('same counterparty 30 days apart → two obligations', !isOpenDuplicate(base, { ...base, created_at: '2026-10-05T10:00:00Z', thread_id: 'x' }, near));
ok('opposite directions are never merged', !isOpenDuplicate(base, { ...base, direction: 'awaiting' }, near));
ok('distinct deliverables sharing a party are never merged', !isOpenDuplicate(base, { ...base, description: 'Book the venue for the offsite' }, near));

console.log('THE SEAT LAW — the ADDRESSED reading:');
const seat = { to: ['sam@acme-example.com'], cc: ['jordan@acme-example.com'], userAddresses: ['jordan@acme-example.com'], userName: 'Jordan Rivers' };
ok('a greeting naming the user addresses them', textNamesUser('Re: plan\nDear Sam and Jordan,\n\nplease review.', seat));
ok('a vocative request addresses them', textNamesUser('Dear Sam,\nCould you share it? Jordan, could you send the pricing?', seat));
ok('a third-person mention does NOT (the census\'s rescue class)', seatStripsObligation('Dear Sam,\nplease send the CV. I will loop in Jordan later.\nBest', seat));
ok('the user\'s name in a quoted Cc header line under the signature does NOT',
  seatStripsObligation('Hi Sam,\nsee the attached.\nBest,\nCasey\n\nFrom: Casey < >\nCc: "Jordan Rivers"< >\nSubject: plan', seat));
ok('accents fold — a greeting "Olá Zoë" addresses a user named Zoe',
  textNamesUser('Olá Zoë e Sam,\nobrigado', { ...seat, userName: 'Zoe Rivers' }));

console.log('THE MAY RULE + THE DEED-REF FLOOR:');
ok('"Monday 15 may be fine" is untouched by the weekday floor', enforceWeekdayDatePairs('Monday 15 may be fine for you.', { now: new Date('2026-09-22T12:00:00Z') }) === 'Monday 15 may be fine for you.');
const U = '3f2a9c10-1b2c-4d5e-8f90-a1b2c3d4e5f6';
ok('[commit:<uuid>] / [inbox:<uuid>] never reach prose; markdown links survive',
  stripGroundingRefs(`Owed to Sam [commit:${U}] and [inbox:${U}].`) === 'Owed to Sam and.'
  && stripGroundingRefs(`[deck](/item/${U})`) === `[deck](/item/${U})`);

// ── TIER 2 · SOURCE FLOORS ───────────────────────────────────────────────────────────────────────
console.log('SOURCE FLOORS:');
const bm = src('lib/integrations/meeting-bot/bot-manager.ts');
ok('BOTH meeting-insights prompts carry the code-computed clock (user tz + the meeting\'s own date)',
  (bm.match(/\$\{clock\}/g) ?? []).length >= 2 && bm.includes('async function meetingClockBlock')
  && bm.includes('userTimezone(') && bm.includes('localNow(') && /NEVER write an earlier year/.test(bm));
ok('the code half re-anchors both mirrors (insights + fallback extractor) before any write',
  bm.includes('return anchorInsightDates(') && /extractActionItemsWithAI[\s\S]{0,4000}anchorDueDate\(a\.dueDate/.test(bm));
ok('every extractMeetingInsights / extractActionItemsWithAI caller hands the meeting date',
  bm.includes('liveNotes || undefined, startTime)') && bm.includes('combinedNotes || undefined, transcript.start_time')
  && bm.includes('segments, supabase, transcript.start_time') && bm.includes('meetingDate: startTime')
  && src('app/api/meetings/notes/[id]/process/route.ts').includes('transcript.start_time ?? transcript.created_at'));
const ex = src('lib/commitments/extract.ts');
ok('writeCommitments runs the stated window, the self-party law and the open-duplicate law',
  ex.includes('dueDateFromSource({') && ex.includes('repairSelfParty(') && ex.includes('isOpenDuplicate(')
  && ex.includes("in('status', ['open', 'suggested'])") && ex.includes('denotesUser(rawCp, userForms)'));
ok('the email door hands the source date, the source text and the user; the meeting door the meeting date',
  ex.includes('anchorAt: receivedAt ?? null') && ex.includes('sourceText: `${subject') && ex.includes('anchorAt: meta.meetingDate ?? null')
  && src('app/api/internal/backfill-intelligence/route.ts').includes('meetingDate: meetingDateOf.get(tid)'));
ok('the seat law cuts quoted headers and reads the ADDRESSED user, not any mention',
  src('lib/inbox/recipient-role.ts').includes('QUOTED_HEADER_RE') && src('lib/inbox/recipient-role.ts').includes('GREETING_RE')
  && ex.includes('seatStripsObligation('));
for (const [f, needles] of [
  ['scripts/sweep-stated-windows.ts', ['statedWindow', 'anchorDueDate']],
  ['scripts/sweep-self-counterparty.ts', ['repairSelfParty', 'denotesUser']],
  ['scripts/sweep-duplicate-commitments.ts', ['isOpenDuplicate', 'isNearDuplicate']],
  ['scripts/sweep-cc-seat.ts', ['seatStripsObligation']],
] as const) {
  const s = src(f);
  ok(`${f} asks the SAME predicates and is dry-run by default (--apply owner-gated)`,
    needles.every((n) => s.includes(n)) && s.includes("process.argv.includes('--apply')") && /if \(APPLY\)/.test(s));
}
ok('the weekday floor\'s may rule is exported once and shared with the window parser',
  src('lib/utils/weekday-floor.ts').includes('export const MAY_VERB_TAIL') && src('lib/commitments/extraction-truth.ts').includes("import { MAY_VERB_TAIL } from '@/lib/utils/weekday-floor'")
  && !src('tests/unit/weekday-floor.test.ts').includes('it.fails('));
// ⟲ RE-POINTED (W2.3): sibling gates now sit between this suite and smoke-laws on the shared board
// string (every wave appends); the law is "rides the board before smoke-laws", not string adjacency.
ok('the gate rides the board', (() => { const b = src('package.json'); const i = b.indexOf('scripts/smoke-extraction-truth.ts'); const j = b.indexOf('scripts/smoke-laws.ts'); return i > 0 && j > i; })());

console.log(`\n${pass} passed · ${fail} failed`);
if (fail) process.exit(1);
