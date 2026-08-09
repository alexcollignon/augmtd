// ─── SWEEP: consolidate legacy per-delegation threads (Aug 9) ─────────────────
// Every delegation used to mint its own "Handed to <Name>: <task>" work_thread — dozens of
// engine-file rows parading as conversations in the coworker chat list. The engine now appends
// to ONE standing "Handed to <Name>" thread per (user, worker); this sweep ARCHIVES the legacy
// per-item threads (status='archived' — recoverable, never deleted; artifacts stay on the row).
// Guarded: dry-run by default, --apply to execute.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: threads } = await admin.from('work_threads')
    .select('id, user_id, title, status, created_at')
    .like('title', 'Handed to %:%')
    .eq('status', 'active')
    .order('created_at');
  const rows = (threads ?? []) as Array<{ id: string; user_id: string; title: string }>;
  console.log(`${APPLY ? 'ARCHIVING' : 'DRY RUN'} — ${rows.length} legacy per-delegation thread(s)`);
  const byUser = new Map<string, number>();
  for (const t of rows) byUser.set(t.user_id, (byUser.get(t.user_id) ?? 0) + 1);
  for (const [uid, n] of byUser) console.log(`  ${uid.slice(0, 8)}: ${n}`);
  if (!APPLY) { console.log('Pass --apply to archive.'); return; }
  let done = 0;
  for (const t of rows) {
    const { error } = await admin.from('work_threads').update({ status: 'archived' }).eq('id', t.id).eq('status', 'active');
    if (!error) done++;
  }
  console.log(`archived ${done}/${rows.length}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
