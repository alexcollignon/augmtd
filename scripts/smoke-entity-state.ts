// PHASE B→C — ENTITY STATE synthesis smoke (cross-user). Runs refreshEntityStates over the backfilled
// registry, then verifies: states grounded, next-moves honest ("none" allowed), and the REASONED PRIORITY
// is sane — a real weight DISTRIBUTION (not everything urgent), every weight carrying a reason. Also
// proves sig-gating: a second pass must cost ZERO AI. Prints the top-of-mind list a chief of staff would.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { refreshEntityStates } from '../lib/entities/state';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const USERS = ['08fe4449-e5eb-431d-9156-02e9324e5903', 'c723c2f2-e069-4ab8-980e-ac3585028fec'];

(async () => {
  for (const uid of USERS) {
    const t0 = Date.now();
    const before = new Date().toISOString();
    await refreshEntityStates(sb, uid);
    const { data: usage1 } = await sb.from('ai_usage_events').select('id').eq('user_id', uid).gte('created_at', before).eq('source', 'brain_synthesis');
    const pass1 = (usage1 ?? []).length;
    // Sig-gate proof: pass 2 must need zero AI.
    const before2 = new Date().toISOString();
    await refreshEntityStates(sb, uid);
    const { data: usage2 } = await sb.from('ai_usage_events').select('id').eq('user_id', uid).gte('created_at', before2).eq('source', 'brain_synthesis');
    const pass2 = (usage2 ?? []).length;

    const { data: ents } = await sb.from('work_entities')
      .select('name, state, next_move, priority')
      .eq('user_id', uid).eq('kind', 'initiative').eq('status', 'active').not('state', 'is', null);
    const rows = (ents ?? []) as Array<{ name: string; state: any; next_move: any; priority: any }>;
    const withPrio = rows.filter((r) => typeof r.priority?.weight === 'number');
    const buckets = { high: 0, mid: 0, routine: 0, low: 0 };
    for (const r of withPrio) { const w = r.priority.weight; if (w >= 80) buckets.high++; else if (w >= 50) buckets.mid++; else if (w >= 20) buckets.routine++; else buckets.low++; }
    const withReason = withPrio.filter((r) => (r.priority.reason || '').length > 0).length;
    const honestNone = rows.filter((r) => !r.next_move).length;

    console.log(`\n════ user ${uid.slice(0, 8)} — synthesized in ${Math.round((Date.now() - t0) / 1000)}s ════`);
    console.log(`  pass1 AI calls: ${pass1} · pass2 (sig-gated): ${pass2} ${pass2 === 0 ? '✓ zero' : '⚠️'}`);
    console.log(`  states: ${rows.length} · priority dist: 80+:${buckets.high} 50-79:${buckets.mid} 20-49:${buckets.routine} <20:${buckets.low} · with reason: ${withReason}/${withPrio.length} · honest no-move: ${honestNone}`);
    console.log(`  TOP OF MIND (by reasoned priority):`);
    for (const r of [...withPrio].sort((a, b) => b.priority.weight - a.priority.weight).slice(0, 6)) {
      console.log(`   ${String(r.priority.weight).padStart(3)}  ${r.name.slice(0, 30).padEnd(30)} [${r.state?.momentum}] ${r.priority.reason?.slice(0, 44) ?? ''}${r.next_move ? `  → ${r.next_move.title.slice(0, 38)}` : ''}`);
    }
  }
})();
