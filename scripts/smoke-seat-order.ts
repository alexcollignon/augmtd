/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — THE TOP FIVE ARE WHAT MATTERS NOW (stabilization W14.3, Sep 24 — docs/laws-registry.md
 * `the-top-five-are-what-matters-now`).
 *
 * Found live on the owner's Home (Sep 24): the five held a recent demo request, a WEEKS-old client
 * task, an automated marketplace notice, a domain-sale pitch and a task about a provider the company
 * no longer uses. Cause: `fresh` (rank 1) was the machine's "first judged within the day", and the
 * not-judged backfill judged hundreds of OLD items that morning — every one read fresh.
 *
 * ZERO-AI, zero DB, deterministic: the pure seat clock, the seat tests, the band law and THE ORDER
 * within a band, plus source floors for the two serving seams (the brief's choke point and the held
 * ledger's own cut). Exit 1 on any failure.   npx tsx scripts/smoke-seat-order.ts
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  seatClockOf, seatVerdict, attentionRank, rankAttention, kindFlooredForSeat,
  FRESH_ARRIVAL_HOURS, LIFE_WINDOW_DAYS, STALE_AFTER_DAYS, NEAR_DEADLINE_DAYS,
  type AttentionRow,
} from '../lib/home/attention';

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
let pass = 0; const failures: string[] = [];
const gate = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); } else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const NOW = new Date('2026-09-24T09:00:00Z');
const TODAY = '2026-09-24';
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const dayOffset = (d: number) => new Date(Date.parse(`${TODAY}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);

/** A row as the brief's choke builds it: the clock computed from the row's own activity + due. */
const row = (key: string, o: Partial<AttentionRow> & { activityAt?: string | null } = {}): AttentionRow => {
  const dueDate = o.dueDate ?? null;
  return {
    key, entityId: key, source: 'reply', whyNow: 'x', prepared: 'Clara',
    overdue: !!dueDate && dueDate < TODAY, dueToday: dueDate === TODAY, dueDate,
    ...seatClockOf({ activityAt: o.activityAt ?? null, dueDate }, NOW),
    ...o,
  };
};
const keys = (rs: AttentionRow[]) => rs.map((r) => r.key).join(',');

console.log('\nS1 · FRESH MEANS ARRIVED — the item\'s own activity, never judgment time');
{
  gate('S1a the window numbers are the stated ones (36h · 14d · 21d · 7d)',
    FRESH_ARRIVAL_HOURS === 36 && LIFE_WINDOW_DAYS === 14 && STALE_AFTER_DAYS === 21 && NEAR_DEADLINE_DAYS === 7);
  gate('S1b an arrival 10h ago is fresh', seatClockOf({ activityAt: hoursAgo(10) }, NOW).fresh === true);
  gate('S1c an arrival 40h ago is not', seatClockOf({ activityAt: hoursAgo(40) }, NOW).fresh === false);
  // THE SEP 24 CASE: judged this morning (the backfill), arrived 52 days ago.
  const judgedTodayButOld = row('old', { activityAt: ago(52) });
  gate('S1d JUDGED-TODAY-BUT-OLD is not fresh (the clock never sees judgment time)', judgedTodayButOld.fresh === false);
  gate('S1e …and it does not take band 1', attentionRank(judgedTodayButOld) !== 1);
  gate('S1f an absent activity computes NOTHING (three-valued — the legacy behaviour holds)',
    Object.keys(seatClockOf({ activityAt: null }, NOW)).length === 0 && Object.keys(seatClockOf({ activityAt: 'garbage' }, NOW)).length === 0);

  const brief = code('app/api/home/brief/route.ts');
  gate('S1g the brief\'s fresh fact is the seat clock over the row\'s OWN activity',
    /\.\.\.seatClockOf\(\{ activityAt: rowActivityAt, dueDate: f\.dueDate \?\? null \}, now\)/.test(brief));
  gate('S1h …never the machine\'s judged-first "surfaced" fact',
    !/fresh:\s*machineOf\([^)]*\)\?\.surfaced/.test(brief));
  gate('S1i an inbox row\'s activity is the deck\'s own activityAt (last_activity_at › newest inbound › created_at)',
    /const rowActivityAt = source === 'commitment' \? \(commitActivityAt\.get\(entityId\) \?\? null\) : \(raw \? activityAt\(raw\) \|\| null : null\);/.test(brief)
    && /\(it\?\.last_activity_at as string\) \|\| \(it\?\.source_data\?\.received_at as string\) \|\| \(it\?\.created_at as string\)/.test(brief));
  gate('S1j a commitment\'s activity is its SOURCE message\'s arrival (else created_at), lifted by its thread',
    /arrivedAt\.get\(`\$\{c\.source\}:\$\{c\.source_id\}`\)\) \|\| iso\(c\.created_at/.test(brief)
    && /from\('emails'\)\s*\.select\('id, received_at'\)/.test(brief)
    && /from\('meeting_transcripts'\)\s*\.select\('id, start_time, created_at'\)/.test(brief)
    && /const at = onThread > arrival \? onThread : arrival;/.test(brief));
  gate('S1k …read through the paged reader (NO SILENT CAPS)',
    (brief.match(/fetchAllRows<\{ (id: string; received_at|id: string; start_time|thread_id: string \| null; received_at)/g) ?? []).length === 3);
}

console.log('\nS2 · THE BANDS — today\'s meeting › fresh arrival › overdue/due-today WITH life › everything else');
{
  const cal = row('cal', { activityAt: ago(5), calendarAdjacent: true, adjacencyToday: true });
  const fresh = row('fresh', { activityAt: hoursAgo(3) });
  const overdueAlive = row('od-alive', { activityAt: ago(4), dueDate: dayOffset(-2) });
  const dueTodayAlive = row('today', { activityAt: ago(10), dueDate: TODAY });
  const overdueNoLife = row('od-dead', { activityAt: ago(18), dueDate: dayOffset(-12) });
  const tomorrowMtg = row('tmrw', { activityAt: ago(3), calendarAdjacent: true, adjacencyToday: false });
  const plain = row('plain', { activityAt: ago(6) });
  gate('S2a today\'s meeting = 0', attentionRank(cal) === 0);
  gate('S2b a fresh arrival = 1', attentionRank(fresh) === 1);
  gate('S2c overdue with activity inside 14d = 2', attentionRank(overdueAlive) === 2);
  gate('S2d due today = 2 (the same band)', attentionRank(dueTodayAlive) === 2);
  gate('S2e overdue WITHOUT life (18d quiet, deadline 12d gone) falls to the tail = 3',
    overdueNoLife.lifeSign === false && attentionRank(overdueNoLife) === 3);
  gate('S2f a stated deadline within 7 days IS a sign of life (quiet 18d, due in 5d)',
    seatClockOf({ activityAt: ago(18), dueDate: dayOffset(5) }, NOW).lifeSign === true);
  gate('S2g tomorrow\'s meeting joins everything else = 3', attentionRank(tomorrowMtg) === 3 && attentionRank(plain) === 3);
  gate('S2h A FRESH ARRIVAL OUTRANKS AN OLD OVERDUE WITHOUT LIFE',
    keys(rankAttention([overdueNoLife, fresh], 1).served) === 'fresh');
  gate('S2i the whole ladder cuts in order',
    keys(rankAttention([plain, overdueNoLife, dueTodayAlive, fresh, tomorrowMtg, cal, overdueAlive], 5).served)
      === 'cal,fresh,od-alive,today,od-dead');
  gate('S2j looks-done stays below every row of real work (W11.2)',
    attentionRank(row('ld', { activityAt: hoursAgo(1), looksDone: true })) === 6);
}

console.log('\nS3 · THE ORDER WITHIN A BAND — soonest due › prepared › most recent activity › caller order');
{
  const a = row('due-later', { activityAt: ago(2), dueDate: dayOffset(-1) });
  const b = row('due-sooner', { activityAt: ago(9), dueDate: dayOffset(-3) });
  gate('S3a soonest due first', keys(rankAttention([a, b]).served) === 'due-sooner,due-later');
  const shaping = row('shaping', { activityAt: ago(3), dueDate: TODAY, prepared: null });
  const prepared = row('prepared', { activityAt: ago(8), dueDate: TODAY });
  gate('S3b at equal due, a prepared row before a needs-shaping one (Q4)', keys(rankAttention([shaping, prepared]).served) === 'prepared,shaping');
  const older = row('older', { activityAt: ago(6) });
  const newer = row('newer', { activityAt: ago(2) });
  gate('S3c then the most recent activity', keys(rankAttention([older, newer]).served) === 'newer,older');
  const w1 = row('heavy', { activityAt: ago(3) });
  const w2 = row('light', { activityAt: ago(3) });
  gate('S3d then the caller\'s order (the judged priority weight), stable', keys(rankAttention([w1, w2]).served) === 'heavy,light'
    && keys(rankAttention([w2, w1]).served) === 'light,heavy');
  gate('S3e an undated row sorts after a dated one inside its band',
    keys(rankAttention([row('undated', { activityAt: ago(4) }), row('dated', { activityAt: ago(4), dueDate: dayOffset(20) })]).served) === 'dated,undated');
  const brief = code('app/api/home/brief/route.ts');
  gate('S3f the brief hands the choke its rows in the judged weight order (the last tiebreak)',
    /\.map\(\(r, i\) => \(\{ r, i, w: itemWeights\[r\.entityId\] \?\? 20 \}\)\)\s*\.sort\(\(a, b\) => \(b\.w - a\.w\) \|\| \(a\.i - b\.i\)\)/.test(brief)
    && /rankAttention\(ordered, ATTENTION_BUDGET\)/.test(brief));
}

console.log('\nS4 · STALENESS DEMOTES — 21+ days quiet and no deadline within 7 days never seats');
{
  const stale = row('stale', { activityAt: ago(24) });
  gate('S4a 24 days quiet, no deadline → stale', stale.stale === true);
  gate('S4b …the seat refuses it (held, never deleted)', seatVerdict(stale).seated === false && seatVerdict(stale).refusal === 'stale');
  const r = rankAttention([stale], 5);
  gate('S4c an EMPTY five beats a stale seat — it is held, and the held list carries it',
    r.served.length === 0 && keys(r.held) === 'stale' && r.refused[0]?.refusal === 'stale');
  gate('S4d a stale OVERDUE row never seats either (the weeks-old client task)',
    seatVerdict(row('old-od', { activityAt: ago(29), dueDate: dayOffset(-29) })).refusal === 'stale');
  gate('S4e …nor a stale row beside today\'s meeting', seatVerdict(row('old-cal', { activityAt: ago(30), calendarAdjacent: true, adjacencyToday: true })).seated === false);
  gate('S4f a deadline within 7 days keeps a quiet row seatable', seatClockOf({ activityAt: ago(40), dueDate: dayOffset(3) }, NOW).stale === false);
  gate('S4g 20 days quiet is not yet stale', seatClockOf({ activityAt: ago(20) }, NOW).stale === false);
  gate('S4h a row with no computed clock is never refused as stale (three-valued)', seatVerdict(row('noclock')).seated === true);
}

console.log('\nS5 · NOTICES AND PITCHES NEVER SEAT — the kind floor, asked at the seat');
{
  const item = (u: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ source_data: { understanding: { role: 'addressed', relevance: 'action', ...u }, ...extra } });
  gate('S5a an automated notification with no you_owe is floored', kindFlooredForSeat(item({ mailKind: 'notification', ownership: 'none' })) === true);
  gate('S5b a cold pitch (the domain-sale class) is floored EVEN framed you_owe', kindFlooredForSeat(item({ mailKind: 'cold_outreach', ownership: 'you_owe' })) === true);
  gate('S5c …unless the user has written into the thread (a conversation)', kindFlooredForSeat(item({ mailKind: 'cold_outreach', ownership: 'you_owe' }), true) === false);
  gate('S5d a notification WITH you_owe stays seatable (the dunning notice)', kindFlooredForSeat(item({ mailKind: 'notification', ownership: 'you_owe' })) === false);
  gate('S5e a person\'s mail is never floored by kind', kindFlooredForSeat(item({ mailKind: 'customer', ownership: 'you_owe' })) === false);
  gate('S5f the structural header tier is read when no understanding exists (a verdict cached before the floor)',
    kindFlooredForSeat({ source_data: { has_unsubscribe: true } }) === true);
  const floored = row('pitch', { activityAt: hoursAgo(2), kindFloored: true });
  gate('S5g a FRESH floored row still never seats', seatVerdict(floored).refusal === 'kind_floor'
    && rankAttention([floored, row('real', { activityAt: ago(3) })], 5).served.map((r) => r.key).join(',') === 'real');
  const brief = code('app/api/home/brief/route.ts');
  gate('S5h the brief asks the floor for EVERY inbox row, with the thread\'s engagement fact',
    /kindFloored: source === 'commitment' \|\| !raw \? false\s*: kindFlooredForSeat\(raw, \(threadMsgsById\.get\(String\(sd\?\.thread_id \?\? ''\)\) \?\? \[\]\)\.some\(\(m\) => m\.is_from_user\)\)/.test(brief));
  gate('S5i the seat reads the ONE predicate (lib/work/kind-floor.ts), no second list',
    /return kindFloor\(\{\s*kind: \(sd\.kind_override as string\) \|\| u\?\.mailKind \|\| rawMailKindOf\(sd\) \|\| null,/.test(src('lib/home/attention.ts')));
}

console.log('\nS6 · ONE CUT — the held ledger\'s own five reads the same seat facts');
{
  const hm = code('lib/deeds/held-members.ts');
  gate('S6a the ledger candidates carry the seat clock and the kind floor',
    /\.\.\.seatClockOf\(\{ activityAt: at, dueDate: due \}, now\), kindFloored: kindFlooredForSeat\(x\.it\)/.test(hm));
  gate('S6b …and cut through the same choke', /const \{ served \} = rankAttention\(candidates, ATTENTION_BUDGET\);/.test(hm));
}

// ═══ W14.4 · THE JUDGE SAID NOTHING IS OWED — never a seat (owner call Sep 24) ═══
{
  const n = { key: 'n', entityId: 'n', source: 'reply', whyNow: '', calendarAdjacent: false, prepared: 'Clara', overdue: false, dueToday: true, fresh: true, judgedNothing: true } as any;
  gate('S7 a row the judge ruled none (or settled) is refused a seat even when fresh + due today (held, never deleted)',
    seatVerdict(n).seated === false && seatVerdict(n).refusal === 'judged_none'
    && rankAttention([n], 5).served.length === 0);
  gate('S7b the brief hands the judged-none fact to every row (judgedNoneIds or a settled machine state)',
    /judgedNothing: judgedNoneIds\.has\(entityId\) \|\| machineOf\(entityId\)\?\.state === 'settled'/.test(readFileSync(join(process.cwd(), 'app/api/home/brief/route.ts'), 'utf8')));
}

console.log(`\n${failures.length ? '❌' : '✅'} ${pass} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`   ✗ ${f}`); process.exit(1); }
