// P0 PERF SMOKE (docs/just-works-plan.md) — measures the Home brief's REQUEST-PATH work per phase,
// warm vs cold, against hard gates. The route itself logs `[home/brief] slow …` per-phase when a real
// request exceeds 2.5s (the in-situ watchdog); this smoke reproduces the same phases standalone so a
// regression is caught without a browser session.
//
// The P0 contract for the GET path:
//   • WARM (aux side-cache present): profile read + rules + the query batch + context assembly only.
//     NO reconcile, NO clusters/outbound, NO AI. Gate: < 3s from this machine (Vercel is faster).
//   • COLD extras (first-ever load / 10-15min TTL expiry): reconcile + outbound + clusters. Gate: < 10s.
//   • The AI tail (synthesis/bundle-names/briefing/bootstrap) runs ONLY in after(), single-flight.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { reconcileRepliedItems } from '../lib/inbox/reconcile-replied';
import { resolveOutboundAwaiting } from '../lib/outbound/resolve';
import { buildInitiativeClusters } from '../lib/projects/initiative-clusters';
import { loadUserRules } from '../lib/inbox/rules/load';
import { buildBriefContext } from '../lib/home/brief-context';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const USERS = [
  { uid: '08fe4449-e5eb-431d-9156-02e9324e5903', label: 'user A' },
  { uid: 'c723c2f2-e069-4ab8-980e-ac3585028fec', label: 'user B' },
];
const WARM_GATE_MS = 3000;
const COLD_EXTRA_GATE_MS = 10_000;

const time = async <T>(fn: () => Promise<T>): Promise<[number, T]> => {
  const t = Date.now(); const r = await fn(); return [Date.now() - t, r];
};

(async () => {
  let fail = 0;
  for (const { uid, label } of USERS) {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    // ── WARM path (what every poll pays): profile + rules + query batch + context ──
    const [tProfile] = await time(async () => { await sb.from('profiles').select('full_name, home_brief').eq('id', uid).single(); });
    const [tRules] = await time(async () => { await loadUserRules(uid, sb); });
    const [tQueries, itemRows] = await time(async () => {
      const since24 = new Date(now.getTime() - 86_400_000).toISOString();
      const [items] = await Promise.all([
        sb.from('inbox_items').select('id, work_title, work_state, rule_type, type_override, source, source_id, source_meeting_transcript_id, source_data, created_at, last_activity_at')
          .eq('user_id', uid).eq('status', 'pending')
          .or('work_state.in.(work_prepared,decision_required,action_required),rule_type.in.(needs_reply,to_do,waiting_on)')
          .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(60),
        sb.from('commitments').select('*').eq('user_id', uid).eq('status', 'open'),
        sb.from('calendar_events').select('id, title, start_time, attendees, timezone, is_all_day')
          .eq('user_id', uid).eq('status', 'confirmed')
          .gte('start_time', new Date(now.getTime() - 30 * 60_000).toISOString())
          .lte('start_time', `${todayStr}T23:59:59Z`).order('start_time', { ascending: true }).limit(6),
        sb.from('inbox_items').select('id', { count: 'exact', head: true }).eq('user_id', uid).gte('created_at', since24),
        sb.from('inbox_items').select('id, work_title, source_data, rule_type, created_at, last_activity_at')
          .eq('user_id', uid).eq('status', 'pending').eq('work_state', 'noted')
          .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(200),
      ]);
      return (items.data ?? []) as Array<{ source_data?: { from_address?: string; from?: string; subject?: string } }>;
    });
    const [tContext] = await time(async () => {
      const seeds = itemRows.slice(0, 40).map((it) => ({
        fromAddress: String(it.source_data?.from_address || it.source_data?.from || '').toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/)?.[0] ?? null,
        subject: String(it.source_data?.subject ?? ''),
        at: now.toISOString(),
        posture: 'needs_reply',
      })).filter((s) => s.fromAddress);
      await buildBriefContext(uid, undefined, now, sb, seeds);
    });
    const warm = tProfile + tRules + tQueries + tContext;

    // ── COLD extras (first load / TTL expiry only) ──
    const [tReconcile] = await time(async () => { await reconcileRepliedItems(sb, uid, { bustBriefCache: async () => {} }); });
    const [tOutbound, outbound] = await time(() => resolveOutboundAwaiting(sb, uid, todayStr).catch(() => []));
    const [tClusters] = await time(async () => { await buildInitiativeClusters(sb, uid, { includeCalendar: false, outbound }).catch(() => new Map()); });
    const coldExtra = tReconcile + tOutbound + tClusters;

    const warmOk = warm < WARM_GATE_MS;
    const coldOk = coldExtra < COLD_EXTRA_GATE_MS;
    if (!warmOk) fail++;
    if (!coldOk) fail++;
    console.log(`\n═ ${label} ${uid.slice(0, 6)}`);
    console.log(` ${warmOk ? '✓' : '✗'} WARM path ${warm}ms (< ${WARM_GATE_MS})  — profile:${tProfile} rules:${tRules} queries:${tQueries} context:${tContext}`);
    console.log(` ${coldOk ? '✓' : '✗'} COLD extras ${coldExtra}ms (< ${COLD_EXTRA_GATE_MS}) — reconcile:${tReconcile} outbound:${tOutbound} clusters:${tClusters}`);
  }
  console.log(fail === 0 ? '\nALL PERF GATES PASS' : `\n${fail} GATE(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})();
