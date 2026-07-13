// P1 smoke for muted_initiatives — proves the spine suppresses a muted initiative from BOTH In-motion and
// Projects suggestions, and REVIVES it when activity post-dates the mute. Writes a test mute row then
// cleans it up. Read-mostly + self-cleaning. Run after applying 20260713_muted_initiatives.sql.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { getActiveInitiatives } from '../lib/projects/active-initiatives';
import { suggestProjects } from '../lib/projects/cluster';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const today = new Date().toISOString().slice(0,10);

(async () => {
  // Does the table exist?
  const probe = await sb.from('muted_initiatives').select('user_id').limit(1);
  if (probe.error) { console.log(`⚠ muted_initiatives not queryable yet (${probe.error.message}). Apply 20260713_muted_initiatives.sql, then re-run.`); 
    // Still prove no-regression: getActiveInitiatives degrades gracefully.
    const { data:p } = await sb.from('profiles').select('id').ilike('email','rene@zeroto100.ai').maybeSingle();
    if (p) { const inits = await getActiveInitiatives(sb, p.id as string, today); console.log(`  regression check: getActiveInitiatives still works → ${inits.length} initiatives (unaffected).`); }
    return;
  }

  for (const email of ['rene@zeroto100.ai','alextcollignon@gmail.com','madalena@zeroto100.ai']) {
  const { data:p } = await sb.from('profiles').select('id').ilike('email',email).maybeSingle();
  if (!p) { console.log(`${email}: no profile`); continue; }
  const uid = p.id as string;
  console.log(`\n=== ${email} ===`);

  const base = await getActiveInitiatives(sb, uid, today);
  const target = base.find(i => i.state !== 'awareness') ?? base[0];
  if (!target) { console.log('user has no initiatives to test'); continue; }
  console.log(`Baseline: ${base.length} initiatives. Target to mute: "${target.label}" (key=${target.key}, lastActivityAt=${target.lastActivityAt})`);

  try {
    // 1) Mute with muted_at = NOW (after the target's last activity) → should SUPPRESS.
    await sb.from('muted_initiatives').upsert({ user_id: uid, initiative_key: target.key, label: target.label, muted_at: new Date().toISOString() });
    const afterMute = await getActiveInitiatives(sb, uid, today);
    const sugg1 = await suggestProjects(sb, uid);
    const goneMotion = !afterMute.some(i => i.key === target.key);
    const goneSugg = !sugg1.some(s => s.name === target.label);
    console.log(`After mute (now): In-motion ${afterMute.length} (${goneMotion?'✓ suppressed':'✗ STILL THERE'}), suggestions ${goneSugg?'✓ suppressed':'✗ STILL THERE'}`);

    // 2) Simulate the mute being OLD relative to real arrivals: far-past muted_at → anything that ever
    //    arrived (email/commitment/outbound) post-dates it → REVIVE.
    await sb.from('muted_initiatives').update({ muted_at: '2000-01-01T00:00:00Z' }).eq('user_id', uid).eq('initiative_key', target.key);
    const afterRevive = await getActiveInitiatives(sb, uid, today);
    const revived = afterRevive.some(i => i.key === target.key);
    console.log(`After mute (stale, activity newer): In-motion ${afterRevive.length} (${revived?'✓ REVIVED':'✗ still suppressed'})`);

    console.log(`\n${goneMotion && goneSugg && revived ? '✅ P1 PASS — suppress + revive + one-brain (both surfaces)' : '❌ P1 FAIL'}`);
  } finally {
    await sb.from('muted_initiatives').delete().eq('user_id', uid).eq('initiative_key', target.key);
    console.log('(cleaned up test mute row)');
  }
  }
})();
