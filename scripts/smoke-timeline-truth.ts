/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — W20.A · THE TIMELINE TELLS THE TRUTH (owner walk, Sep 28 — ONE FACT, ONE HOME · THE ADDRESS
 * LAW · TIME TRUTH).
 *
 * ZERO-AI, ZERO-DB, deterministic.
 *   A · SOURCE — the Timeline lands on "Everything" and remembers the reader's explicit toggle
 *       (guarded storage); the smart default is gone.
 *   B · SOURCE — the old Home header is retired on every lens: no OneHomeHeader, SyncStatus or
 *       DayClearedRing; Activity stays reachable through the one quiet glyph.
 *   C · PURE + SOURCE — every row has a real address or none: a commitment work item opens
 *       /item/<id>?kind=commitment; no work item is born with href '/'; the Gantt never renders a
 *       link or a click to '/', and a roomless row with no address is plain text.
 *   D · OUTCOME (pure) — an awaiting commitment extracted from the SAME message as an open visible row
 *       folds into it unconditionally; one from another message on the thread keeps the text floor.
 *   E · PURE + SOURCE — "attend the call" rows are dropped at write (calendar facts, never debts).
 *   F · PURE + SOURCE — a `promised` verdict re-dates only to a date stated in a sentence about the deed.
 * Exit 1 on any failure.
 *
 *   npx tsx scripts/smoke-timeline-truth.ts
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { refDoorHref } from '../lib/room/presentation';
import { rowDoorOf } from '../lib/work-items/gantt-date';
import { isDupOfVisible, foldDuplicateCommitments } from '../lib/home/dedupe-deck';
import { isAttendanceObligation } from '../lib/commitments/extraction-truth';
import { deedScopedDate, sentencesOf } from '../lib/commitments/deed-date';

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0;
const failures: string[] = [];
const gate = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// ── A · THE TIMELINE DEFAULT ─────────────────────────────────────────────────────────────────────
console.log('A · the Timeline lands on Everything');
{
  const tg = src('components/timeline/timeline-gantt.tsx');
  gate('A1 the mode initializer is Everything', /useState<Mode>\('all'\)/.test(tg));
  gate('A2 the smart default is gone (no touchedRef, no content-driven setMode)',
    !/touchedRef/.test(tg) && !/setMode\('all'\)/.test(tg) && !/SMART DEFAULT/.test(tg));
  gate('A3 the explicit toggle is remembered (one key, write on the click)',
    /const MODE_KEY = 'aug-timeline-mode'/.test(tg) && /const choose = \(m: Mode\) => \{ setMode\(m\); writeMode\(m\); \}/.test(tg)
    && /onClick=\{\(\) => choose\(mo\)\}/.test(tg));
  gate('A4 storage is guarded (try/catch on read and write) and read pre-paint, never in the initializer',
    /function readMode\(\): Mode \| null \{\n\s*try \{[^\n]*localStorage\.getItem\(MODE_KEY\)[^\n]*catch/.test(tg)
    && /function writeMode\(m: Mode\) \{\n\s*try \{ window\.localStorage\.setItem\(MODE_KEY, m\); \} catch/.test(tg)
    && /useLayoutEffect\(\(\) => \{ const m = readMode\(\); if \(m\) setMode\(m\); \}, \[\]\)/.test(tg));
}

// ── B · THE OLD HEADER IS RETIRED ────────────────────────────────────────────────────────────────
console.log('B · no old header on any lens');
{
  const hv = src('components/home/home-view.tsx');
  const one = src('components/one/one-home.tsx');
  gate('B1 no OneHomeHeader / SyncStatus / DayClearedRing in the Home host',
    !/OneHomeHeader|SyncStatus|DayClearedRing/.test(hv));
  gate('B2 the component is retired at its own address (FlatRow survives)',
    !/export function OneHomeHeader/.test(one) && /export type FlatRow/.test(one));
  gate('B3 the display-only state is gone (sync line + ring) — the realtime reload stays',
    !/setSyncing|setLastUpdatedAt|setRealtimeConnected|ringCleared|showRing|sessionCleared/.test(hv)
    && /\.channel\('home-live'\)/.test(hv) && /load\(true\);\n\s*\}, 300\)/.test(hv));
  gate('B4 Activity stays reachable on every lens: two glyph doors (dashboard + the zero-height lens door), no pill',
    (hv.match(/aria-label="Open activity"/g) || []).length === 2 && /<div className="relative h-0">/.test(hv)
    && !/<span className="hidden sm:inline">Activity<\/span>/.test(hv));
}

// ── C · EVERY ROW HAS A REAL ADDRESS OR NONE ─────────────────────────────────────────────────────
console.log('C · the address law on Timeline rows');
{
  gate('C1 a commitment ref opens its own door with the kind carried',
    refDoorHref('commit:abc') === '/item/abc?kind=commitment');
  const model = src('lib/work-items/model.ts');
  gate('C2 the spine builds commitment hrefs through the one producer (never the \'/\' placeholder)',
    /href: refDoorHref\(`commit:\$\{c\.id\}`\)/.test(model) && !/href: '\/'/.test(model));
  // SWEEP: no work-item producer anywhere under lib/work-items carries the placeholder.
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(join(ROOT, dir))) {
      const p = join(dir, f);
      if (statSync(join(ROOT, p)).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f) && /href:\s*'\/'/.test(src(p))) offenders.push(p);
    }
  };
  walk('lib/work-items');
  gate('C3 SWEEP: no href \'/\' under lib/work-items', offenders.length === 0, offenders.join(', '));
  gate('C4 rowDoorOf floors placeholders to null and keeps real doors',
    rowDoorOf('/') === null && rowDoorOf('') === null && rowDoorOf(null) === null && rowDoorOf('javascript:x') === null
    && rowDoorOf('/item/abc?kind=commitment') === '/item/abc?kind=commitment');
  const route = src('app/api/home/timeline/route.ts');
  gate('C5 the timeline route serves every row through the floor (both bands), the loose band marked roomless',
    (route.match(/href: rowDoorOf\(w\.href\)/g) || []).length === 2 && !/href: w\.href \?\? null/.test(route)
    && /id: 'loose'[^\n]*roomless: true/.test(route));
  const gc = src('components/entities/gantt-chart.tsx');
  gate('C6 the Gantt renders through the floor: no raw it.href link or push, no Link to \'/\'',
    (gc.match(/const door = rowDoorOf\(it\.href\)/g) || []).length === 2
    && !/href=\{it\.href\}/.test(gc) && !/router\.push\(it\.href\)/.test(gc) && !/<Link href="\/"/.test(gc));
  gate('C7 a roomless row/band with no address is plain text, never a button that opens nothing',
    /onOpenGroup && !g\.roomless\n\s*\? <button onClick=\{\(\) => onOpenGroup\(g\.id, 'work'\)\}/.test(gc)
    && /: <span title=\{tip\} className="min-w-0 flex-1 flex items-baseline gap-1\.5">\{inner\}<\/span>/.test(gc)
    && /const opens = !!door \|\| \(!!onOpenGroup && !g\.roomless\)/.test(gc) && /onClick=\{opens \?/.test(gc));
}

// ── D · ONE FACT, ONE HOME — same-message awaiting folds ─────────────────────────────────────────
console.log('D · a same-message awaiting commitment folds into its row');
{
  const row = { title: 'Confirm implementation call — Oct 12, 9:30 AM CET', sourceId: 'msg-2', threadId: 'thr-1', meetingId: null };
  const attend = { id: 'c1', description: 'Attend the scheduled call — Oct 12, 09:30 CET', direction: 'awaiting', source_id: 'msg-2', thread_id: 'thr-1' };
  const offer = { id: 'c2', description: 'Send the signed update offer', direction: 'awaiting', source_id: 'msg-1', thread_id: 'thr-1' };
  gate('D1 the same-message awaiting row folds although the wording shares almost nothing', isDupOfVisible(attend, [row]));
  gate('D2 an awaiting row from ANOTHER message on the thread keeps its own home (the text floor)', !isDupOfVisible(offer, [row]));
  const { kept, foldedIds } = foldDuplicateCommitments([attend, offer], [row]);
  gate('D3 the one fold (brief + spine share it) keeps exactly the separate obligation',
    foldedIds.join() === 'c1' && kept.map((k) => k.id).join() === 'c2');
  gate('D4 a you_owe row on the thread still folds structurally (unchanged)',
    isDupOfVisible({ id: 'c3', description: 'Reply with pricing', direction: 'you_owe', source_id: 'msg-9', thread_id: 'thr-1' }, [row]));
  const model = src('lib/work-items/model.ts');
  const brief = src('app/api/home/brief/route.ts');
  gate('D5 the Timeline spine and the Home brief both fold through the one dedupe',
    /isDupOfVisible\(c as any, pendingVisible\)/.test(model) && /foldDuplicateCommitments\(/.test(brief));
}

// ── E · THE ATTENDANCE FLOOR ─────────────────────────────────────────────────────────────────────
console.log('E · "attend the call" is a calendar fact, never a debt');
{
  for (const t of ['Attend the scheduled call — Oct 12, 09:30 CET', 'Join the meeting on Friday', 'Be at the meeting room — Jul 28, 12:30',
    'Participate in the kickoff session', 'Please attend the demo', 'Participer à la réunion du 12 octobre', 'Participar na reunião de segunda']) {
    gate(`E1 dropped: "${t}"`, isAttendanceObligation(t));
  }
  for (const t of ['Schedule a call with the team', 'Prepare for the meeting with the board', 'Join the call and present the deck',
    'Send the signed update offer', 'Review the contract by Friday', 'Book the demo room', 'Attend to the invoice backlog']) {
    gate(`E2 kept: "${t}"`, !isAttendanceObligation(t));
  }
  const ex = src('lib/commitments/extract.ts');
  gate('E3 the write door runs the floor before any candidate is judged a duplicate or written (counted, never silent)',
    /const attendance = clean\.filter\(\(c\) => isAttendanceObligation\(c\.description\)\);/.test(ex)
    && /attendance floor \$\{meta\.source\}/.test(ex)
    && ex.indexOf('isAttendanceObligation(c.description)') < ex.indexOf('for (const c of clean) {'));
  gate('E4 the extractor prompt says a mutual meeting is a calendar event, not a commitment',
    /is a CALENDAR EVENT, not a commitment/.test(ex));
}

// ── F · THE DEED-SCOPED RE-DATE ──────────────────────────────────────────────────────────────────
console.log('F · a promised re-date needs a date stated for THAT deed');
{
  const meetingReply = 'Thanks for the offer. Let\'s catch up on Monday, Oct. 12 at 9:30 CET to go through it.\nBest';
  gate('F1 a meeting date elsewhere in the message does not re-date "send the signed offer"',
    !deedScopedDate(meetingReply, '2026-10-12', 'Send the signed update offer'));
  gate('F2 a date stated in the deed\'s own sentence does',
    deedScopedDate('Thanks! I will return the signed offer by October 9. Talk soon.', '2026-10-09', 'Send the signed update offer'));
  gate('F3 generic verbs alone never scope ("I\'ll send an invite for Oct 12")',
    !deedScopedDate('I\'ll send an invite for Oct 12.', '2026-10-12', 'Send the signed update offer'));
  gate('F4 "Oct. 12" stays inside its sentence', sentencesOf('Meet Monday, Oct. 12 at 9:30. Thanks').length === 2);
  const ful = src('lib/commitments/fulfillment.ts');
  gate('F5 the promised branch requires the deed-scoped date beside the stated-date check',
    /dateStatedInText\(body, nd\)\n\s*&& deedScopedDate\(body, nd, obligation\.description\)/.test(ful));
}

console.log(`\nsmoke-timeline-truth: ${pass}/${pass + failures.length}`);
if (failures.length) { console.log('FAILED:', failures.join(' | ')); process.exit(1); }
