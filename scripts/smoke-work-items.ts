// Smoke test the Phase-1 unified work-item spine (+ verify Phase-0 team data exists). READ-ONLY.
//   npx tsx scripts/smoke-work-items.ts
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { buildWorkItems, partitionByTime } from '../lib/work-items/model';
import { BUCKET_ORDER } from '../lib/work-items/timeframe';

const USER = '08fe4449-e5eb-431d-9156-02e9324e5903';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const todayStr = '2026-07-10';

(async () => {
  // ── Phase 0 sanity: does the team feed have data + roles? ──
  const { data: threads } = await sb.from('work_threads')
    .select('agent_id, artifacts, custom_agents!inner(name, worker_role, is_worker)')
    .eq('user_id', USER).eq('custom_agents.is_worker', true).not('artifacts', 'is', null).limit(20);
  const workerRoles = new Set((threads ?? []).map((t: any) => t.custom_agents?.worker_role).filter(Boolean));
  console.log(`=== Phase 0: coworker deliverable threads=${(threads ?? []).length}, roles seen=${[...workerRoles].join(', ') || '(none)'} ===\n`);

  // ── Phase 1: build the spine ──
  const items = await buildWorkItems(sb, USER, { todayStr });
  console.log(`=== Phase 1: buildWorkItems → ${items.length} work items ===`);

  const by = (f: (w: any) => string) => items.reduce((m: Record<string, number>, w) => { const k = f(w); m[k] = (m[k] || 0) + 1; return m; }, {});
  console.log('by kind  :', by((w) => w.kind));
  console.log('by state :', by((w) => w.state));
  console.log('by actor :', by((w) => w.actor));
  console.log('by bucket:', by((w) => w.when.bucket));

  // Honesty invariant: an UNDATED item must never be "overdue".
  const badOverdue = items.filter((w) => w.when.bucket === 'overdue' && !w.when.explicit);
  console.log(`\ninvariant — undated-but-overdue (must be 0): ${badOverdue.length}`);

  const { history, upcoming } = partitionByTime(items);
  console.log(`history(done/dismissed)=${history.length}  upcoming(pending)=${upcoming.length}`);

  // Sample the upcoming, grouped by bucket in display order (what the timeline would render).
  console.log('\n--- upcoming by bucket (timeline preview) ---');
  for (const bkt of BUCKET_ORDER) {
    const inB = upcoming.filter((w) => w.when.bucket === bkt);
    if (!inB.length) continue;
    console.log(`\n  [${bkt.toUpperCase()}] ${inB.length}`);
    for (const w of inB.slice(0, 4)) {
      console.log(`    ${w.actor === 'team' ? '★' : '·'} ${w.kind.padEnd(11)} ${w.when.explicit ? `(${w.when.explicit}) ` : ''}${(w.who || '—').slice(0, 18).padEnd(18)} | ${w.title.slice(0, 44)}`);
    }
  }
  console.log('\n--- recent history (done) ---');
  for (const w of history.slice(0, 6)) console.log(`    ✓ ${w.kind.padEnd(11)} ${(w.who || '—').slice(0, 18).padEnd(18)} | ${w.title.slice(0, 44)}`);
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
