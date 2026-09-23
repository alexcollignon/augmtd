// ─── THE SCALE GATE (stabilization W4.3) ───────────────────────────────────────────────────────
// THE LAW: every per-user/per-connection cron walks its rotation under a WALL-CLOCK GUARD and
// reports what it left behind (the draft-sweep coverage-repair class, Aug 14 — 18 profiles shared
// 240s serially with a 20s floor, 360s of budget in a 300s route; the route died mid-loop every
// run and the tail users never got a pass). This gate asserts the class holds on every cron this
// wave touched, source-level, zero-AI, zero-DB — a structural check, not a live run.
//
//   S1 — label-sweep has a wall-clock guard + `usersLeftBehind` honesty + rides the shared
//        least-recently-served rotation (lib/work/sweep-users.ts), not an unordered profiles walk.
//   S2 — sync-calendar has a wall-clock guard + `connectionsLeftBehind` honesty.
//   S3 — sync-calendar's retired auto-join bot creation is gated behind the workspace `meetings`
//        feature flag (never called unconditionally).
//   S4 — the retention route is DRY-RUN BY DEFAULT and DOUBLE-GATED (a query param alone, or an
//        env flag alone, must never delete).
//   S5 — the ai_usage_events created_at index migration exists.
//
// Run: npx tsx scripts/smoke-scale.ts
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

console.log('S1 — label-sweep: wall-clock guard + honest left-behind + shared rotation');
{
  const src = read('app/api/cron/label-sweep/route.ts');
  ok('imports the shared sweep-users rotation', /from ['"]@\/lib\/work\/sweep-users['"]/.test(src));
  ok('calls activeUserIds + orderLeastRecentlyServed (not a bare profiles walk)', /activeUserIds\(/.test(src) && /orderLeastRecentlyServed\(/.test(src));
  ok('stamps its own rotation marker via stampServed', /stampServed\(/.test(src));
  ok('has a route-level wall-clock deadline', /routeDeadline\s*=\s*Date\.now\(\)\s*\+\s*265_000/.test(src));
  ok('checks the deadline before starting a user', /Date\.now\(\)\s*\+\s*budgetMs\s*>\s*routeDeadline/.test(src));
  ok('has a per-user inner-loop deadline too (one account can\'t burn the whole route)', /Date\.now\(\)\s*>\s*userDeadline/.test(src));
  ok('reports usersLeftBehind honestly in the response', /usersLeftBehind/.test(src) && /NextResponse\.json\(\{[\s\S]*usersLeftBehind/.test(src));
  ok('never re-introduces the unordered full-profiles walk', !/sb\.from\('profiles'\)\.select\('id, email_settings'\)/.test(src));
}

console.log('S2 — sync-calendar: wall-clock guard + honest left-behind');
{
  const src = read('app/api/cron/sync-calendar/route.ts');
  ok('has a route-level wall-clock deadline', /routeDeadline\s*=\s*Date\.now\(\)\s*\+\s*265_000/.test(src));
  ok('checks the deadline before starting a connection', /Date\.now\(\)\s*\+\s*perConnBudgetMs\s*>\s*routeDeadline/.test(src));
  ok('reports connectionsLeftBehind honestly in the response', /connectionsLeftBehind/.test(src) && /NextResponse\.json\(\{[\s\S]*connectionsLeftBehind/.test(src));
  ok('reads connections via fetchAllRows (no silent 1000-row cap)', /fetchAllRows</.test(src));
}

// ⟲ RE-POINTED (W6, Sep 23 — THE BOT REMOVAL): S3 used to assert the retired auto-join bot's
// orphan recovery stayed behind the `meetings` feature flag in sync-calendar. The owner retired the
// bot outright ("we're only using the in-person recording action"), so the law is now the stronger
// form: NO sync path schedules or re-queues a bot at all, and the helper itself is gone.
console.log('S3 — sync paths: the removed auto-join bot is scheduled from nowhere');
{
  const syncPaths = [
    'app/api/cron/sync-calendar/route.ts',
    'app/api/connections/sync/route.ts',
    'app/api/meetings/create/route.ts',
    'app/api/webhooks/gmail/push/route.ts',
    'app/api/webhooks/outlook/push/route.ts',
  ];
  for (const p of syncPaths) ok(`${p} never calls createBotsForCalendarEvents`, !read(p).includes('createBotsForCalendarEvents'));
  ok('the helper is gone from bot-manager', !read('lib/integrations/meeting-bot/bot-manager.ts').includes('createBotsForCalendarEvents'));
  ok('the bot client is gone', !existsSync(join(ROOT, 'lib/integrations/meeting-bot/client.ts')));
}

console.log('S4 — retention: dry-run by default, double-gated');
{
  const path = 'app/api/cron/retention/route.ts';
  ok('route file exists', existsSync(join(ROOT, path)));
  const src = read(path);
  ok('reads a query-param apply flag', /searchParams\.get\('apply'\)\s*===\s*'1'/.test(src));
  ok('reads an env RETENTION_APPLY flag', /process\.env\.RETENTION_APPLY\s*===\s*'true'/.test(src));
  ok('requires BOTH before ever deleting (AND, not OR)', /const\s+apply\s*=\s*wantsApply\s*&&\s*envAllows/.test(src));
  ok('has a wall-clock deadline', /deadline\s*=\s*Date\.now\(\)\s*\+\s*265_000/.test(src));
  ok('deletes in bounded batches (a batch size cap exists)', /BATCH_SIZE/.test(src) && /MAX_BATCHES_PER_TABLE/.test(src));
  ok('never deletes without the apply gate (delete() calls sit inside `if (apply)`)', /if\s*\(apply\)\s*\{[\s\S]*?delete\(/.test(src));
  ok('excludes room_turns (found live: read as permanent history, not a cache)', /room_turns/.test(src) && /NOT PRUNED/.test(src));
  ok('is authenticated via hasBearer(CRON_SECRET), same as every other cron', /hasBearer\(request, 'CRON_SECRET'\)/.test(src));
}

console.log('S5 — the ai_usage_events created_at index migration exists');
{
  const dir = join(ROOT, 'supabase/migrations');
  const files = readdirSync(dir);
  const match = files.find((f) => f === '20260922c_usage_created_at_index.sql');
  ok('migration file 20260922c_usage_created_at_index.sql exists', !!match);
  if (match) {
    const src = readFileSync(join(dir, match), 'utf8');
    ok('creates a plain (non-CONCURRENT) index on created_at', /CREATE INDEX IF NOT EXISTS idx_ai_usage_events_created_at ON ai_usage_events \(created_at DESC\)/.test(src));
    const sqlOnly = src.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    ok('does not use CREATE INDEX CONCURRENTLY in an actual statement (illegal inside the dashboard SQL editor\'s implicit transaction)', !/CREATE INDEX CONCURRENTLY/i.test(sqlOnly));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
