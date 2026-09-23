/**
 * smoke-clocks — W9.5 THE CLOCKS SAY WHAT THEY DO (stabilization program; invariant 10 NO SILENT
 * CAPS + invariant 14 TIME TRUTH applied to our own crons). ZERO AI, ZERO DB — reads source only.
 *
 *   C1 — every cron route in app/api/cron has a vercel.json schedule, OR a documented
 *        `// SCHEDULE: NOT SCHEDULED — <reason>` line; every vercel.json cron path has a route.
 *   C2 — every route's `// SCHEDULE (vercel.json): \`<expr>\`` line equals vercel.json (parsed), and
 *        no comment in a cron route claims a cadence ("every 4 hours", "every minute", "hourly",
 *        "daily", "every 6h" …) that its schedule does not run.
 *   C3 — fetch-emails: paged + ordered least-recently-synced, bounded concurrency, a wall-clock
 *        guard, and `leftBehind` / `unfinished` in the response.
 *   C4 — activeUserIds counts only LIVE connections (dead ones take no sweep slot) and still counts
 *        recent items/transcripts (the sovereign tier has no connection).
 *   C5 — label-sweep is budgeted (the decision: not a fan-out lane) — its item read excludes final
 *        rows, is ordered, counted, and what the cap/clock leaves is reported (`itemsLeftBehind`).
 *   C6 — retention's scheduled run is an HONEST dry-run: the scheduled path carries no `?apply=1`,
 *        the report states `wouldDelete` / `wouldLeaveBehind` and the switch; a failed count is -1.
 *   C7 — the reply-reconcile throttle is not per-instance: a DB-backed conditional claim on a
 *        registered item_plans kind gates the run; the Maps are a fast path only.
 *   C8 — knowledge-sync (unscheduled, with its reason) is still made safe for the day it is:
 *        provider-backed sources only, paged, least-recently-synced, in-flight skip, left-behind.
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

// ── the schedule parser (pure) ──────────────────────────────────────────────────────────────────
/** The period in minutes of a 5-field cron expression of the shapes vercel.json uses
 *  (`*\/N * * * *`, `M * * * *`, `M *\/N * * *`, `M H * * *`). null = a shape this gate does not know. */
export function cronPeriodMinutes(expr: string): number | null {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const [min, hour, dom, mon, dow] = f;
  if (dom !== '*' || mon !== '*' || dow !== '*') return null;
  const step = (x: string) => { const m = /^\*\/(\d+)$/.exec(x); return m ? Number(m[1]) : null; };
  if (step(min) != null && hour === '*') return step(min)!;
  if (/^\d+$/.test(min) && hour === '*') return 60;
  if (/^\d+$/.test(min) && step(hour) != null) return 60 * step(hour)!;
  if (/^\d+$/.test(min) && /^\d+$/.test(hour)) return 1440;
  return null;
}
/** Every cadence a comment line claims for THIS route, in minutes. */
export function claimedCadences(line: string): number[] {
  const out: number[] = [];
  const l = line.toLowerCase();
  let m: RegExpExecArray | null;
  const reN = /\b(?:runs?|run|cron|scheduled?)?\s*every\s+(\d+)\s*(minutes?|mins?|m|hours?|hrs?|h)\b/g;
  while ((m = reN.exec(l))) out.push(/^(h|hours?|hrs?)$/.test(m[2]) ? Number(m[1]) * 60 : Number(m[1]));
  if (/\bevery minute\b/.test(l)) out.push(1);
  if (/\bruns? hourly\b|\bruns? every hour\b/.test(l)) out.push(60);
  if (/\bruns? (?:daily|nightly|once a day)\b/.test(l)) out.push(1440);
  return out;
}

// self-test of the parser (a gate that cannot parse proves nothing)
ok('parser: */15 → 15', cronPeriodMinutes('*/15 * * * *') === 15);
ok('parser: 5 * → 60', cronPeriodMinutes('5 * * * *') === 60);
ok('parser: 0 */6 → 360', cronPeriodMinutes('0 */6 * * *') === 360);
ok('parser: 30 3 → 1440', cronPeriodMinutes('30 3 * * *') === 1440);
ok('claims: "Runs every 4 hours" → 240', claimedCadences(' * Runs every 4 hours. The push').join() === '240');
ok('claims: "runs every minute via Vercel Cron" → 1', claimedCadences('// ─── Workflow dispatcher — runs every minute via Vercel Cron').includes(1));

const vercel = JSON.parse(read('vercel.json')) as { crons?: Array<{ path: string; schedule: string }> };
const schedByRoute = new Map<string, string>();
for (const c of vercel.crons ?? []) {
  const route = c.path.split('?')[0].replace(/^\/api\/cron\//, '');
  schedByRoute.set(route, c.schedule);
}
const cronDir = join(ROOT, 'app/api/cron');
const routes = readdirSync(cronDir).filter((d) => existsSync(join(cronDir, d, 'route.ts')));

// Routes outside this wave's fence carry no SCHEDULE line yet; they are still held to C2's
// no-false-cadence check. Each entry says why. (Can only shrink.)
const SCHEDULE_LINE_EXEMPT: Record<string, string> = {
  'renew-push-subscriptions': 'W9.2 owns this route file; its header claims no cadence (checked below)',
};

console.log('C1 — every cron route is scheduled, or says why not');
for (const r of routes) {
  const src = read(`app/api/cron/${r}/route.ts`);
  const documented = /\/\/ SCHEDULE: NOT SCHEDULED — \S[\s\S]{40,}/.test(src);
  ok(`${r}: scheduled in vercel.json or documented unscheduled`, schedByRoute.has(r) || documented);
  if (schedByRoute.has(r)) ok(`${r}: not both scheduled and "NOT SCHEDULED"`, !/SCHEDULE: NOT SCHEDULED/.test(src));
}
for (const r of schedByRoute.keys()) ok(`vercel.json /api/cron/${r} has a route`, routes.includes(r));

console.log('C2 — header comments match the schedule');
for (const r of routes) {
  const src = read(`app/api/cron/${r}/route.ts`);
  const sched = schedByRoute.get(r);
  const line = /\/\/ SCHEDULE \(vercel\.json\): `([^`]+)`/.exec(src);
  if (sched) {
    if (SCHEDULE_LINE_EXEMPT[r]) ok(`${r}: SCHEDULE line exempt (${SCHEDULE_LINE_EXEMPT[r]})`, true);
    else ok(`${r}: SCHEDULE line equals vercel.json (${sched})`, !!line && line[1].trim() === sched.trim(), line ? `says ${line[1]}` : 'no SCHEDULE line');
  }
  const period = sched ? cronPeriodMinutes(sched) : null;
  if (sched) ok(`${r}: schedule shape parses`, period != null, sched);
  const comments = src.split('\n').filter((l) => /^\s*(\/\/|\*|\/\*\*)/.test(l));
  const wrong: string[] = [];
  for (const c of comments) {
    for (const claim of claimedCadences(c)) {
      if (!sched) { wrong.push(`claims ${claim}min but unscheduled: ${c.trim()}`); continue; }
      if (period != null && claim !== period) wrong.push(`claims ${claim}min vs ${period}min: ${c.trim()}`);
    }
  }
  ok(`${r}: no comment claims a cadence the schedule does not run`, wrong.length === 0, wrong.join(' | '));
}

console.log('C3 — fetch-emails: wall-clock guard + least-recently-synced + left-behind');
{
  const src = read('app/api/cron/fetch-emails/route.ts');
  ok('pages the connection read (fetchAllRows)', /fetchAllRows</.test(src));
  ok('least-recently-synced first (last_sync ascending, never-synced first)', /\.order\('last_sync', \{ ascending: true, nullsFirst: true \}\)/.test(src));
  ok('bounded concurrency (no Promise.allSettled over every connection)', /FETCH_CONCURRENCY/.test(src) && !/Promise\.allSettled\(\s*connections\.map/.test(src));
  ok('never STARTS a connection past the start deadline', /Date\.now\(\)\s*>\s*startDeadline\)\s*\{\s*leftBehind\+\+/.test(src));
  ok('answers by a route deadline inside maxDuration', /ROUTE_DEADLINE_MS\s*=\s*(\d[\d_]*)/.test(src)
    && Number(/ROUTE_DEADLINE_MS\s*=\s*([\d_]+)/.exec(src)![1].replace(/_/g, '')) < 1000 * Number(/maxDuration\s*=\s*(\d+)/.exec(src)![1]));
  ok('reports leftBehind + unfinished in the response', /NextResponse\.json\(\{[\s\S]*leftBehind, unfinished/.test(src));
}

console.log('C4 — activeUserIds excludes dead connections, keeps the sovereign signals');
{
  const src = read('lib/work/sweep-users.ts');
  const fn = src.slice(src.indexOf('export async function activeUserIds'), src.indexOf('export async function orderLeastRecentlyServed'));
  ok('the connections read filters status to the live one', /from\('connections'\)\.select\('user_id'\)\.eq\('status', LIVE_CONNECTION_STATUS\)/.test(fn));
  ok("LIVE_CONNECTION_STATUS is 'active'", /LIVE_CONNECTION_STATUS = 'active'/.test(src));
  ok('recent inbox items still count (sovereign tier)', /from\('inbox_items'\)/.test(fn));
  ok('recent transcripts still count (sovereign tier)', /from\('meeting_transcripts'\)/.test(fn));
}

console.log('C5 — label-sweep: budgeted (not fanned), no silent per-user cap');
{
  const src = read('app/api/cron/label-sweep/route.ts');
  ok('the decision is written (why not a fan-out lane)', /WHY THIS STAYS A BUDGETED SERIAL WALK, NOT A FAN-OUT LANE/.test(src));
  ok('route wall clock + per-user clock + usersLeftBehind', /routeDeadline/.test(src) && /userDeadline/.test(src) && /usersLeftBehind/.test(src));
  ok('item read excludes rows already final (labeled = true) in the query', /\.or\('source_data->>labeled\.is\.null,source_data->>labeled\.neq\.true'\)/.test(src));
  ok('item read is ordered and counted exactly', /\.order\('created_at', \{ ascending: false \}\)/.test(src) && /count: 'exact'/.test(src));
  ok('what the slice or the clock left is counted', /itemsLeftBehind \+= Math\.max\(0, \(windowCount/.test(src) && /itemsLeftBehind \+= rows\.length - idx/.test(src));
  ok('itemsLeftBehind is in the response', /NextResponse\.json\(\{[^}]*itemsLeftBehind/.test(src));
  const fan = read('lib/work/sweep-fanout.ts');
  ok('the fan-out lanes are unchanged (label is not a half-added lane)', !/'label'/.test(fan));
}

console.log('C6 — retention: the scheduled run is an honest dry-run');
{
  const entry = (vercel.crons ?? []).find((c) => c.path.startsWith('/api/cron/retention'));
  ok('retention is scheduled', !!entry);
  ok('the scheduled path carries no ?apply=1 (deletion is the owner\'s decision)', !!entry && !/apply=1/.test(entry.path));
  const src = read('app/api/cron/retention/route.ts');
  ok('the header says the scheduled run never deletes + names the switch', /THE SCHEDULED RUN NEVER DELETES/.test(src) && /THE SWITCH \(owner-only\)/.test(src));
  ok('each result states wouldDelete + wouldLeaveBehind', /wouldDelete: number/.test(src) && /wouldLeaveBehind: number/.test(src));
  ok('a failed count reports -1, never "0 to prune"', /countError/.test(src) && /matching: -1, wouldDelete: -1/.test(src));
  ok('the dry-run log says WOULD DELETE and the response carries howToApply', /WOULD DELETE/.test(src) && /howToApply/.test(src));
  ok('still double-gated', /const\s+apply\s*=\s*wantsApply\s*&&\s*envAllows/.test(src));
}

console.log('C7 — the reply-reconcile throttle is DB-backed, not per-instance');
{
  const src = read('lib/inbox/reconcile-replied.ts');
  const reg = read('lib/store/item-plans.ts');
  ok("'reconcile_claim' is a registered item_plans kind homed here", /reconcile_claim:\s*spec\('marker', '`replied`', 'lib\/inbox\/reconcile-replied\.ts'/.test(reg));
  ok('the claim is conditional (insert-first, then an update filtered by the interval)', /insertPlan\(client, userId, RECONCILE_CLAIM_KIND/.test(src) && /q\.lt\('tasks->>at', cutoff\)/.test(src));
  const body = src.slice(src.indexOf('export async function reconcileRepliedItems'), src.indexOf('async function reconcileRepliedItemsNow'));
  ok('reconcileRepliedItems takes the claim before running', /await claimReconcileWindow\(client, userId\)/.test(body) && /claim === 'lost'/.test(body));
  const brief = read('app/api/home/brief/route.ts');
  ok('the Home brief still runs it behind the response (after())', /after\(async \(\) => \{\s*\n\s*try \{ await reconcileRepliedItems\(/.test(brief));
}

console.log('C8 — knowledge-sync: unscheduled with its reason, and safe for the day it is');
{
  const src = read('app/api/cron/knowledge-sync/route.ts');
  ok('the reason names the broken unchanged-file skip', /UNSAFE-1 · THE UNCHANGED-FILE SKIP NEVER FIRES/.test(src));
  ok('provider-backed sources only (never flips upload/augmtd sources to error)', /\.in\('provider', \[\.\.\.PROVIDER_SOURCES\]\)/.test(src) && /PROVIDER_SOURCES = \['google_drive', 'onedrive'\]/.test(src));
  ok('paged + least-recently-synced first', /fetchAllRows</.test(src) && /\.order\('last_synced_at', \{ ascending: true, nullsFirst: true \}\)/.test(src));
  ok('skips a source a user-triggered sync is indexing', /skippedInFlight/.test(src) && /IN_FLIGHT_GRACE_MS/.test(src));
  ok('wall clock + leftBehind in the response', /START_DEADLINE_MS/.test(src) && /leftBehind\+\+/.test(src) && /NextResponse\.json\(\{[\s\S]*leftBehind,/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
