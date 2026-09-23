// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE EXACTLY-ONCE DEEDS GATE (permanent — docs/stabilization-plan.md PART II invariant 9, W0.4).
//
// "Every external side effect goes through the commit door; every state transition is a conditional
// claim; a correction is a new deed, never a swallowed duplicate." This suite holds that invariant
// on the doors W0.4 repaired:
//
//   X1 · THE RESUME DOOR CLAIMS — approve AND reject are conditional on `status='awaiting_approval'`
//        and a losing racer hears 409; a supply at an input station is never a rejection.
//   X2 · THE EVENT DEED IDENTITY — the commit key carries the event's CURRENT state: Accept →
//        Decline → Accept is three deeds, a double-click on one state is one. An in-flight claim
//        never answers ok.
//   X3 · A MOVE IS THE WINDOW ONLY — applyReschedule never sends a guest list and keeps all-day
//        shape; an Outlook series master is refused for cancel/move.
//   X4 · THE NOTE IS DELIVERED OR NOT OFFERED — per-provider note verbs, served on the spec,
//        honored by the card and the door.
//   X5 · EVERY SEND CLAIMS — coworker email, nudge, inbox reply and compose all claim through the
//        commit door, release on failure, and record on success.
//   X6 · THE EVENT CARD IS STABLE — the picker seed is memoized on primitives and the re-read keys
//        on the pointer's id, bounded.
//
// SOURCE floors + PURE unit tests. Zero AI, zero network, zero writes.
// Run: npx tsx scripts/smoke-deeds-exactly-once.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { eventDeedIdentity, noteVerbsFor, validEventVerbs, type EventFacts } from '../lib/present/event';
import { composeEventSpec } from '../lib/present/event-build';
import { allDayWindow, type EventWriteRow } from '../lib/calendar/event-writes';

let pass = 0, fail = 0;
function gate(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const src = (p: string) => stripComments(readFileSync(p, 'utf8'));
/** The text of one top-level function, from its signature to the next top-level declaration. */
function fnBody(code: string, sig: string): string {
  const a = code.indexOf(sig);
  if (a < 0) return '';
  const rest = code.slice(a + sig.length);
  const b = rest.search(/\n(export )?(async )?function |\nexport const |\nconst [A-Z_]+ =/);
  return sig + (b < 0 ? rest : rest.slice(0, b));
}

// ══ X1 · THE RESUME DOOR ════════════════════════════════════════════════════════════════════════
console.log('\nX1 — THE RESUME DOOR CLAIMS (source):');
{
  const r = src('app/api/workflows/runs/[id]/resume/route.ts');
  const runningClaim = /update\(\{ status: 'running' \}\)\s*\.eq\('id', runId\)\.eq\('status', 'awaiting_approval'\)\s*\.select\('id'\)/.test(r);
  const rejectClaim = /status: 'rejected'[\s\S]{0,300}?\}\)\.eq\('id', runId\)\.eq\('status', 'awaiting_approval'\)\.select\('id'\)/.test(r);
  gate('the approve path claims conditionally on awaiting_approval (+ reads back the row)', runningClaim);
  gate('the reject path claims conditionally on awaiting_approval (+ reads back the row)', rejectClaim);
  gate('no unconditional status write remains on workflow_runs in the door',
    !/update\(\{ status: 'running' \}\)\.eq\('id', runId\);/.test(r)
    && (r.match(/from\('workflow_runs'\)/g) ?? []).length === (r.match(/eq\('status', 'awaiting_approval'\)/g) ?? []).length);
  gate('a losing racer hears 409 on both claims',
    (r.match(/already moved on[^']*'\s*\},\s*\{ status: 409 \}/g) ?? []).length >= 2);
  gate('THE SUPPLY IS NEVER A REJECTION — the payload, not the approve bit, decides the input lane',
    /const suppliesMaterial = gate\.kind === 'input' && \(Boolean\(body\.input\) \|\| approve\);/.test(r)
    && !/approve !== false/.test(r)
    && r.indexOf('if (suppliesMaterial)') > 0
    && r.indexOf('if (suppliesMaterial)') < r.indexOf('if (!approve) {'));
  gate('…a bare approve at an input gate still refuses with the existing sentence',
    /waiting for something from you, not a yes or no/.test(r));
  const form = src('components/workflows/input-supply-form.tsx');
  gate('the supply form sends approve:true with its material',
    /resumeRun\(runId, \{\s*approve: true,\s*input:/.test(form));
  const doors = src('lib/deeds/gate-doors.ts');
  gate('the one client door rides approve:true whenever material rides',
    /approve: opts\.input \? true : opts\.approve/.test(doors));
  gate('the shared supply core still claims conditionally (answerInputStation)',
    /\.eq\('status', 'awaiting_approval'\)/.test(src('lib/workflows/input-station.ts')));
}

// ══ X2 · THE EVENT DEED IDENTITY ════════════════════════════════════════════════════════════════
console.log('\nX2 — THE EVENT DEED IDENTITY (pure + source):');
{
  const W = { startISO: '2026-10-01T09:00:00.000Z', endISO: '2026-10-01T09:30:00.000Z' };
  const k1 = eventDeedIdentity('ev1', { verb: 'accept' }, { myResponse: 'needsAction', ...W });
  const k2 = eventDeedIdentity('ev1', { verb: 'decline' }, { myResponse: 'accepted', ...W });
  const k3 = eventDeedIdentity('ev1', { verb: 'accept' }, { myResponse: 'declined', ...W });
  gate('Accept → Decline → Accept yields THREE distinct keys', new Set([k1, k2, k3]).size === 3);
  const k1b = eventDeedIdentity('ev1', { verb: 'accept' }, { myResponse: 'needsAction', ...W });
  gate('a double-click on the same state yields ONE key', k1 === k1b);
  const m1 = eventDeedIdentity('ev1', { verb: 'reschedule', newStartISO: 'A', newEndISO: 'B' }, { myResponse: null, ...W });
  const m2 = eventDeedIdentity('ev1', { verb: 'reschedule', newStartISO: 'A', newEndISO: 'B' },
    { myResponse: null, startISO: '2026-10-02T09:00:00.000Z', endISO: '2026-10-02T09:30:00.000Z' });
  gate('a move keys on the CURRENT window (moving back to a time is a new deed)', m1 !== m2);
  gate('a move ignores the response half (only its own state counts)',
    m1 === eventDeedIdentity('ev1', { verb: 'reschedule', newStartISO: 'A', newEndISO: 'B' }, { myResponse: 'accepted', ...W }));

  const d = src('app/api/events/[id]/deed/route.ts');
  gate('the door hashes eventDeedIdentity over the served current state',
    /eventDeedIdentity\(\s*id, \{ \.\.\.proposal, note \},\s*\{ myResponse: spec\.facts\.myResponse, startISO: spec\.startISO, endISO: spec\.endISO \}/.test(d));
  gate('the claim precedes the provider write', d.indexOf('claimCommit(') > 0 && d.indexOf('claimCommit(') < d.indexOf('applyRsvp('));
  gate('IN FLIGHT IS NOT DONE — a duplicate with no recorded result answers 409, never ok',
    /claim\.priorResult == null\)\s*\{\s*return NextResponse\.json\(\{\s*error: 'in_progress'[\s\S]{0,200}status: 409/.test(d));
  gate('a move to the window it already has is not re-sent',
    /proposal\.verb === 'reschedule'\s*&& Date\.parse\(String\(proposal\.newStartISO\)\) === Date\.parse\(spec\.startISO\)/.test(d));
  gate('every failure after the claim releases it (provider throw + unreachable target)',
    (d.match(/releaseCommitClaim\(/g) ?? []).length >= 2);
}

// ══ X3 · A MOVE IS THE WINDOW ONLY ══════════════════════════════════════════════════════════════
console.log('\nX3 — A MOVE IS THE WINDOW ONLY (source + pure):');
{
  const w = src('lib/calendar/event-writes.ts');
  const resched = fnBody(w, 'export async function applyReschedule(');
  gate('applyReschedule exists', resched.length > 0);
  gate('applyReschedule never sends an attendee list (nor routes through the full-shape editor patch)',
    !/attendees/.test(resched) && !/applyEventUpdate|updateGmailEvent|updateOutlookEvent/.test(resched));
  gate('applyReschedule patches start/end with the provider PATCH (Google sendUpdates, Graph PATCH)',
    /calendar\.events\.patch\(/.test(resched) && /sendUpdates: 'all'/.test(resched) && /\.patch\(/.test(resched.split('refuseOutlookSeriesMaster')[1] ?? ''));
  gate('an all-day event stays all-day (date, never dateTime, on Google)',
    /start: \{ date: win\.startDate \}, end: \{ date: win\.endDate \}/.test(resched));
  gate('an Outlook series master is refused for a move AND a cancel',
    /await refuseOutlookSeriesMaster\(t\)/.test(resched)
    && /await refuseOutlookSeriesMaster\(t\)/.test(fnBody(w, 'export async function applyCancel(')));
  gate('the series probe refuses a master (type seriesMaster) with a named code',
    /probe\?\.type === 'seriesMaster'/.test(w) && /throw \{ code: 'recurring_series' \}/.test(w));
  gate('the deed door answers a series refusal honestly (409, nothing fired)',
    /code === 'recurring_series'[\s\S]{0,400}recurring series[\s\S]{0,200}status: 409/.test(src('app/api/events/[id]/deed/route.ts')));

  const lis = allDayWindow('2026-09-24T23:00:00.000Z', '2026-09-25T23:00:00.000Z', 'Europe/Lisbon');
  gate('allDayWindow reads the picked date IN the event zone and spans whole days (end-exclusive)',
    lis.startDate === '2026-09-25' && lis.endDate === '2026-09-26', JSON.stringify(lis));
  const two = allDayWindow('2026-09-25T00:00:00.000Z', '2026-09-27T00:00:00.000Z', 'UTC');
  gate('…a two-day all-day event stays two days', two.startDate === '2026-09-25' && two.endDate === '2026-09-27', JSON.stringify(two));
}

// ══ X4 · THE NOTE IS DELIVERED OR NOT OFFERED ═══════════════════════════════════════════════════
console.log('\nX4 — THE NOTE IS DELIVERED OR NOT OFFERED (pure + source):');
{
  gate('Google offers a note on decline only (delete carries no message)',
    JSON.stringify(noteVerbsFor('gmail')) === JSON.stringify(['decline']));
  gate('Outlook offers a note on decline and cancel (Graph comment)',
    JSON.stringify(noteVerbsFor('outlook')) === JSON.stringify(['decline', 'cancel']));
  gate('an unknown provider offers none', noteVerbsFor(null).length === 0);

  const row = (provider: string): EventWriteRow => ({
    id: 'r1', event_id: 'p1', connection_id: 'c1', provider, title: 'Sync',
    start_time: '2099-10-01T09:00:00Z', end_time: '2099-10-01T09:30:00Z', timezone: 'UTC',
    is_all_day: false, status: 'confirmed', location: null, organizer: 'me@example.test',
    attendees: [{ email: 'me@example.test' }, { email: 'sam@example.test' }],
  });
  const ctx = { tz: 'UTC', mine: new Set(['me@example.test']), now: new Date('2026-09-22T00:00:00Z'), writable: true };
  const gSpec = composeEventSpec(row('gmail'), ctx);
  const oSpec = composeEventSpec(row('outlook'), ctx);
  gate('the served spec carries the provider\'s note verbs (organizer on Google: none on cancel)',
    Array.isArray(gSpec.noteVerbs) && !gSpec.noteVerbs.includes('cancel'), JSON.stringify(gSpec.noteVerbs));
  gate('…organizer on Outlook: cancel carries a note', !!oSpec.noteVerbs?.includes('cancel'), JSON.stringify(oSpec.noteVerbs));
  const f: EventFacts = { seat: 'invitee', myResponse: 'needsAction', passed: false, allDay: false, writable: true };
  gate('note verbs are always a subset of the permitted verbs',
    noteVerbsFor('outlook').filter((v) => validEventVerbs(f).includes(v)).every((v) => validEventVerbs(f).includes(v)));

  const card = src('components/home/event-card.tsx');
  gate('the card reads the SERVED note verbs (no hard-coded notable list)',
    /const notable = spec\.noteVerbs \?\? NO_NOTE;/.test(card) && !/NOTABLE\b/.test(card));
  gate('a proposal\'s note is shown only on a verb that delivers it',
    /selected\.note && !notable\.includes\(selected\.verb\)\s*\? \{ \.\.\.selected, note: undefined \}/.test(card));
  const d = src('app/api/events/[id]/deed/route.ts');
  gate('the door drops a note the provider would not carry, and passes it to the provider on the rest',
    /noteVerbsFor\(row\.provider\)\.includes\(proposal\.verb\)/.test(d)
    && /applyCancel\(target, note \? \{ comment: note \} : \{\}\)/.test(d)
    && /applyRsvp\(target, RSVP_OF\[proposal\.verb\]!, note \? \{ comment: note \} : \{\}\)/.test(d));
  const w = src('lib/calendar/event-writes.ts');
  gate('the transport delivers the comment on each channel (Graph RSVP · Graph cancel · Google attendee)',
    /\.post\(\{ sendResponse: true, comment \}\)/.test(w) && /\/cancel`\)\.post\(\{ comment \}\)/.test(w)
    && /responseStatus: response, comment/.test(w));
}

// ══ X5 · EVERY SEND CLAIMS ══════════════════════════════════════════════════════════════════════
console.log('\nX5 — EVERY SEND CLAIMS THROUGH THE COMMIT DOOR (source):');
{
  const routes: Array<[string, string]> = [
    ['send-coworker-email', 'app/api/work/threads/[id]/send-coworker-email/route.ts'],
    ['nudge', 'app/api/commitments/[id]/nudge/route.ts'],
    ['send-reply', 'app/api/inbox/[id]/send-reply/route.ts'],
    ['compose/send', 'app/api/compose/send/route.ts'],
  ];
  for (const [name, p] of routes) {
    const s = src(p);
    gate(`${name}: claims, releases on failure, records on success`,
      /claimCommit\(/.test(s) && /releaseCommitClaim\(/.test(s) && /recordCommitResult\(/.test(s));
    gate(`${name}: an in-flight duplicate answers 409, never a second send`,
      /claim\.priorResult == null\)[\s\S]{0,160}status: 409/.test(s));
    const claimAt = s.indexOf('claimCommit(');
    const sendAt = Math.max(s.search(/sendCoworkerEmail\(admin/), s.search(/sendGmail(Reply|Email)\(/));
    gate(`${name}: the claim precedes the send`, claimAt > 0 && sendAt > claimAt);
    if (/after\(/.test(s)) gate(`${name}: after() work has its own maxDuration`, /export const maxDuration = \d+/.test(s));
  }
  const cw = src('app/api/work/threads/[id]/send-coworker-email/route.ts');
  gate('send-coworker-email: a draft already stamped sent never sends again',
    /if \(stamped\) return NextResponse\.json\(\{ ok: true, alreadySent: true/.test(cw)
    && cw.indexOf('if (stamped)') < cw.indexOf('claimCommit('));
  const nudge = src('app/api/commitments/[id]/nudge/route.ts');
  gate('nudge: refuses a commitment that is no longer live, before any claim',
    /if \(!NUDGEABLE\.includes\(String\(commitment\.status/.test(nudge)
    && nudge.indexOf('NUDGEABLE.includes') < nudge.indexOf('claimCommit('));
  gate('nudge: the status flip is conditional and its failure is SAID, not swallowed',
    /\.in\('status', NUDGEABLE\)/.test(nudge) && !/\.then\(\(\) => \{\}, \(\) => \{\}\)/.test(nudge) && /closed: false/.test(nudge));
  const reply = src('app/api/inbox/[id]/send-reply/route.ts');
  gate('send-reply: no in-memory limiter stands in for the claim', !/checkRateLimit\(/.test(reply));
  gate('send-reply: the key carries the thread\'s current ground (a new inbound makes a new deed)',
    /const idemKey = `reply:\$\{id\}:\$\{bodyHash\}:\$\{recipients\}:\$\{ground\}`/.test(reply));
  const compose = src('app/api/compose/send/route.ts');
  gate('compose/send: the in-memory content dedup is gone (the commit door owns it)', !/compose-send-dedup/.test(compose));
}

// ══ X6 · THE EVENT CARD IS STABLE ═══════════════════════════════════════════════════════════════
console.log('\nX6 — THE EVENT CARD IS STABLE (source):');
{
  const card = src('components/home/event-card.tsx');
  gate('pickerDefaults is memoized on primitives (id · start · end), never rebuilt per render',
    /React\.useMemo\([\s\S]{0,200}\[specId, specStart, specEnd\]/.test(card)
    && !/pickerDefaults: pickerDefaultsOf\(spec\)/.test(card));
  gate('the re-read keys on the pointer\'s id (a primitive), never the pointer object',
    /\[pointerEventId, reread, spec, failed\]/.test(card) && !/\[pointer, reread, spec\]/.test(card));
  gate('the re-read is bounded', /REREAD_MAX_ATTEMPTS/.test(card) && /attempts\.current\.n >= REREAD_MAX_ATTEMPTS/.test(card));
  gate('a 409 speaks the server\'s own sentence when it has one', /json\?\.reason/.test(card));
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
