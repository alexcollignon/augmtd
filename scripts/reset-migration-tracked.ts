// ONE BRAIN (Projects declutter) — the projects→entities migration set tracked=true on EVERY migrated
// project, so "tracked" reflects migration history, not the user's intent. Prominence is now REASONED
// (portfolio route: engaged = alive), and `tracked` means only "the human explicitly pinned this".
// This reset clears the blanket flag so pinning starts from a clean slate; nothing is hidden — the
// portfolio still leads with reasoned-prominent entities. Re-runnable. Usage: [--apply]
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');
(async () => {
  const { data, count } = await sb.from('work_entities').select('user_id', { count: 'exact' }).eq('kind', 'initiative').eq('tracked', true);
  const byUser = new Map<string, number>();
  for (const r of (data ?? []) as Array<{ user_id: string }>) byUser.set(r.user_id, (byUser.get(r.user_id) ?? 0) + 1);
  console.log(`tracked=true entities: ${count ?? 0}`, [...byUser.entries()].map(([u, n]) => `${u.slice(0, 8)}:${n}`).join(' · '));
  if (!APPLY) { console.log('\nDry-run. Re-run with --apply to reset tracked→false (prominence stays reasoned).'); return; }
  const { error } = await sb.from('work_entities').update({ tracked: false }).eq('kind', 'initiative').eq('tracked', true);
  console.log(error ? `✗ ${error.message}` : '✓ reset — pin is now a clean human-only override');
})();
