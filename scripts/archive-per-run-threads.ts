// Archive legacy per-run workflow threads, keeping only the most recent ACTIVE
// thread per (workflow_id, user_id) — the pre-flight preview for migration
// 20260727_task_thread_per_workflow.sql (which does the same archive before
// creating the unique partial index). Idempotent: re-running finds nothing.
//
//   npx tsx scripts/archive-per-run-threads.ts                # dry-run, all users
//   npx tsx scripts/archive-per-run-threads.ts --user=<id>    # dry-run, one user
//   npx tsx scripts/archive-per-run-threads.ts --user=<id> --apply
//
// Only flips work_threads.status 'active'→'archived'; never deletes. Archived
// threads leave the Conversations list (it filters status='active') but stay
// readable — Drive, Ready-for-you and the chat GET don't filter status.

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const userArg = process.argv.find((a) => a.startsWith('--user='))?.split('=')[1] || null;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  console.log(`[archive-per-run-threads] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} user=${userArg ?? 'ALL'}`);

  let query = supabase
    .from('work_threads')
    .select('id, user_id, workflow_id, title, updated_at')
    .not('workflow_id', 'is', null)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(100000);
  if (userArg) query = query.eq('user_id', userArg);

  const { data: threads, error } = await query;
  if (error) throw error;

  // Group by (workflow_id, user_id); rows are ordered newest-first, so the first
  // seen per key is the keeper.
  const keep = new Map<string, { id: string; title: string }>();
  const archive: { id: string; key: string; title: string }[] = [];
  for (const t of threads ?? []) {
    const key = `${t.workflow_id}:${t.user_id}`;
    if (!keep.has(key)) keep.set(key, { id: t.id, title: t.title });
    else archive.push({ id: t.id, key, title: t.title });
  }

  const byKey = new Map<string, number>();
  for (const a of archive) byKey.set(a.key, (byKey.get(a.key) ?? 0) + 1);
  for (const [key, n] of byKey) {
    const keeper = keep.get(key)!;
    console.log(`  workflow ${key}: ${n + 1} active threads → keeping "${keeper.title}" (${keeper.id}), archiving ${n}`);
  }
  console.log(`[archive-per-run-threads] ${keep.size} task threads kept, ${archive.length} to archive`);

  if (!APPLY || archive.length === 0) {
    if (!APPLY) console.log('Dry-run only. Pass --apply to write.');
    return;
  }

  // Batch the update in chunks to stay under URL/param limits.
  const ids = archive.map((a) => a.id);
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { error: updErr } = await supabase
      .from('work_threads')
      .update({ status: 'archived' })
      .in('id', chunk);
    if (updErr) throw updErr;
    console.log(`  archived ${Math.min(i + 100, ids.length)}/${ids.length}`);
  }
  console.log('[archive-per-run-threads] done');
}

main().catch((e) => { console.error(e); process.exit(1); });
