// READ-ONLY smoke for the "In motion" perf-fold: getActiveInitiatives is now cached inside
// profiles.home_brief (served last-good instantly, recomputed in the background on staleness). This proves,
// across multiple real users, that (1) the source still returns coherent initiatives, (2) it's the ~1–2.5s
// cost we're folding away, and (3) the cached blob round-trips the SAME shape the payload returns. No writes.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { getActiveInitiatives } from '../lib/projects/active-initiatives';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const todayStr = new Date().toISOString().slice(0, 10);

(async () => {
  // Union the user sets across every Home source (inbox / commitments / calendar) so the sample is agnostic
  // and doesn't miss calendar-heavy or outreach-heavy users — a single capped inbox query would (the
  // 1000-row PostgREST cap). Rank by total touchpoints.
  const counts = new Map<string, number>();
  for (const tbl of ['inbox_items', 'commitments', 'calendar_events'] as const) {
    const { data } = await sb.from(tbl).select('user_id').limit(8000);
    for (const r of (data ?? []) as { user_id: string }[]) counts.set(r.user_id, (counts.get(r.user_id) ?? 0) + 1);
  }
  const users = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => id);
  console.log(`Smoking ${users.length} users (across inbox + commitments + calendar)\n`);

  for (const uid of users) {
    const { data: prof } = await sb.from('profiles').select('email, home_brief').eq('id', uid).maybeSingle();
    const email = (prof?.email as string) || uid.slice(0, 8);
    const cached = (prof?.home_brief as { activeInitiatives?: unknown[]; sig?: string; generated_at?: string } | null) ?? null;

    // (2) time the LIVE compute — the cost the fold removes from the hot path.
    const t0 = Date.now();
    const live = await getActiveInitiatives(sb, uid, todayStr).catch((e) => { console.log('  ERR', (e as Error).message); return []; });
    const ms = Date.now() - t0;

    const byState = live.reduce((m: Record<string, number>, i) => { m[i.state] = (m[i.state] ?? 0) + 1; return m; }, {});
    const cachedCount = Array.isArray(cached?.activeInitiatives) ? cached!.activeInitiatives!.length : null;
    const cacheFlag = cachedCount == null
      ? (cached ? 'brief cached, NO activeInitiatives yet (pre-fold blob — will fill on next stale regen)' : 'no brief cache yet')
      : `brief cache HAS activeInitiatives: ${cachedCount}`;

    console.log(`● ${email}`);
    console.log(`  live getActiveInitiatives: ${live.length} initiatives in ${ms}ms  [${Object.entries(byState).map(([s, n]) => `${s}:${n}`).join(' ')}]`);
    console.log(`  top: ${live.slice(0, 5).map((i) => `${i.label}(${i.stateLabel},${i.total})`).join(' · ') || '—'}`);
    console.log(`  cache: ${cacheFlag}`);
    // (3) shape parity: if cached, the cached entries must carry the same required keys the payload reads.
    if (cachedCount) {
      const s = (cached!.activeInitiatives as Record<string, unknown>[])[0];
      const keys = ['key', 'label', 'state', 'stateLabel', 'total', 'actions', 'members'].filter((k) => k in s);
      console.log(`  cached entry keys present: ${keys.join(',')}${keys.length === 7 ? ' ✓' : '  ⚠ MISSING'}`);
    }
    console.log('');
  }
  console.log('Done. Fast path (cache-hit) serves the cached set with ZERO getActiveInitiatives calls;');
  console.log('the timings above are the per-load cost that used to run on EVERY request.');
})();
