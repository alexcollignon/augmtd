// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE EXPIRED-VERDICT RE-JUDGE (July 30) — post-deploy remediation, reusable after ANY expiry-law
// change. Judgments cached BEFORE a coercion fix may carry `resolution:'expired'` earned under the
// old law (the hallucinated-expiry hole: a fabricated past date auto-dismissed live work), and a
// cached verdict lives until the next day-roll while its CONSEQUENCE (the dismissal) persists
// forever. For each recent expired verdict: restore the object, drop the stale judgment, and
// RE-JUDGE FRESH under the current law — the new verdict decides (expired again → re-dismissed
// with the same stamps; live → it stays on the plate). Items not yet consequenced just lose the
// stale cache (the next pass re-judges free of charge).
// Dry-run by default; --apply commits. --user email | --all; --hours N (default 24).
//   npx tsx scripts/sweep-expired-rejudge.ts [--apply] [--all] [--hours 24]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { judgeWork } from '../lib/work/judge';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const hours = Number(process.argv[process.argv.indexOf('--hours') + 1]) || 24;
const userArg = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null;

(async () => {
  const { data: users } = await sb.auth.admin.listUsers();
  const targets = ALL ? users!.users : users!.users.filter((u) => u.email === (userArg ?? 'alextcollignon@gmail.com'));
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  let scanned = 0, cachesDropped = 0, rejudged = 0, revived = 0;

  for (const u of targets) {
    const { data: plans } = await sb.from('item_plans').select('id, entity_id, tasks, updated_at')
      .eq('user_id', u.id).eq('kind', 'judgment').gte('updated_at', since).limit(500);
    let touched = false;
    for (const p of plans ?? []) {
      const v = ((p.tasks ?? {}) as { verdict?: { work?: string; resolution?: string; reason?: string } }).verdict;
      if (v?.resolution !== 'expired') continue;
      scanned++;
      const m = /^(inbox|commitment):(.+)$/.exec(String(p.entity_id));
      if (!m) continue;
      const [, kind, id] = m;
      // Was the expiry CONSEQUENCED (auto-dismissed by apply-verdict)?
      let consequenced = false;
      if (kind === 'inbox') {
        const { data: it } = await sb.from('inbox_items').select('id, status, source_data, work_title').eq('id', id).eq('user_id', u.id).maybeSingle();
        const sd = (it?.source_data ?? {}) as Record<string, unknown>;
        consequenced = it?.status === 'dismissed' && sd.resolution_reason === 'no_longer_relevant';
        if (consequenced && APPLY) {
          const { resolution_reason: _r, resolved_at: _a, ...rest } = sd;
          await sb.from('inbox_items').update({ status: 'pending', source_data: rest }).eq('id', id).eq('user_id', u.id);
        }
        if (consequenced) console.log(`  ${u.email} · inbox "${String(it?.work_title).slice(0, 55)}" was auto-dismissed as expired ("${String(v.reason).slice(0, 70)}")`);
      } else {
        const { data: c } = await sb.from('commitments').select('id, status, resolved_reason, description').eq('id', id).eq('user_id', u.id).maybeSingle();
        consequenced = c?.status === 'dismissed' && c?.resolved_reason === 'no_longer_relevant';
        if (consequenced && APPLY) {
          await sb.from('commitments').update({ status: 'open', resolved_at: null, resolved_reason: null, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', u.id);
        }
        if (consequenced) console.log(`  ${u.email} · commitment "${String(c?.description).slice(0, 55)}" was auto-dismissed as expired ("${String(v.reason).slice(0, 70)}")`);
      }
      if (!APPLY) { if (!consequenced) cachesDropped++; continue; }
      // Drop the stale-law verdict either way — the anchor must not entrench the old coercion.
      await sb.from('item_plans').delete().eq('id', p.id);
      cachesDropped++;
      touched = true;
      if (!consequenced) continue; // still pending — the next pass re-judges under the new law
      // RE-JUDGE FRESH under the current law; the new verdict decides.
      rejudged++;
      const fresh = await judgeWork(sb, u.id, { kind: kind as 'inbox' | 'commitment', id });
      if (fresh.work === 'none' && fresh.resolution === 'expired') {
        // Honestly expired under the NEW law too — re-apply the same dismissal.
        const now = new Date().toISOString();
        if (kind === 'inbox') {
          const { data: it } = await sb.from('inbox_items').select('source_data').eq('id', id).eq('user_id', u.id).maybeSingle();
          await sb.from('inbox_items').update({ status: 'dismissed', source_data: { ...((it?.source_data ?? {}) as Record<string, unknown>), resolved_at: now, resolution_reason: 'no_longer_relevant' } }).eq('id', id).eq('user_id', u.id);
        } else {
          await sb.from('commitments').update({ status: 'dismissed', resolved_at: now, resolved_reason: 'no_longer_relevant' }).eq('id', id).eq('user_id', u.id);
        }
        console.log(`    → still expired under the new law (re-dismissed): "${String(fresh.reason).slice(0, 80)}"`);
      } else {
        revived++;
        console.log(`    → LIVE under the new law (stays on the plate): ${fresh.work} — "${String(fresh.reason).slice(0, 80)}"`);
      }
    }
    if (touched) await sb.from('profiles').update({ home_brief: null }).eq('id', u.id).then(() => {}, () => {});
  }
  console.log(`\nexpired-verdicts scanned=${scanned} · caches dropped=${cachesDropped} · re-judged=${rejudged} · revived=${revived}${APPLY ? '' : ' (dry-run — pass --apply)'}`);
})();
