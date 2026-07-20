// Meetings→Projects unification — Phase 0 backfill. Each meeting FOLDER becomes a PROJECT (dedup: a folder
// whose name matches an existing project reuses it, never a duplicate). Then remap membership:
//   meeting_transcripts.folder_id      -> project_id (+ project_locked, a manual filing that must stick)
//   shared_note_receipts.folder_id     -> project_id (the recipient's per-user filing of a shared note)
// Old folder_id columns are LEFT intact for rollback. Requires 20260716_shared_receipts_project.sql applied.
//
// Usage: npx tsx scripts/migrate-folders-to-projects.ts <userId|all> [--apply]
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { normalizeInitiative } from '../lib/inbox/item-understanding';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');
const nameKey = (s: string) => normalizeInitiative(s)?.replace(/\s+/g, '') || s.toLowerCase().replace(/\s+/g, '');

async function migrateUser(uid: string) {
  const { data: folders } = await sb.from('meeting_folders').select('id, name').eq('user_id', uid);
  if (!folders?.length) return { folders: 0, created: 0, reused: 0, transcripts: 0, receipts: 0 };
  const { data: projects } = await sb.from('projects').select('id, name').eq('user_id', uid);
  const byKey = new Map<string, string>(); // project name key -> project id (dedup target)
  for (const p of projects ?? []) byKey.set(nameKey(p.name), p.id);

  const folderToProject = new Map<string, string>();
  let created = 0, reused = 0;
  for (const f of folders) {
    const k = nameKey(f.name);
    let pid = byKey.get(k);
    if (pid) { reused++; }
    else {
      if (APPLY) {
        const { data: proj, error } = await sb.from('projects').insert({ user_id: uid, name: f.name, status: 'active', auto: false }).select('id').single();
        if (error || !proj) { console.log(`   ! failed to create project for folder "${f.name}": ${error?.message}`); continue; }
        pid = proj.id;
      } else { pid = `NEW(${f.name})`; }
      byKey.set(k, pid as string); created++;
    }
    if (!pid) continue;
    folderToProject.set(f.id, pid);
    console.log(`   folder "${f.name}" -> ${reused && byKey.get(k) === pid ? 'reuse' : 'project'} ${String(pid).slice(0, 8)}`);
  }

  let transcripts = 0, receipts = 0;
  for (const [fid, pid] of folderToProject) {
    if (String(pid).startsWith('NEW(')) continue; // dry run
    const { data: tRows } = await sb.from('meeting_transcripts').select('id').eq('user_id', uid).eq('folder_id', fid).is('project_id', null);
    if (tRows?.length) { transcripts += tRows.length; if (APPLY) await sb.from('meeting_transcripts').update({ project_id: pid, project_locked: true }).eq('user_id', uid).eq('folder_id', fid).is('project_id', null); }
    const { data: rRows } = await sb.from('shared_note_receipts').select('id').eq('folder_id', fid);
    if (rRows?.length) { receipts += rRows.length; if (APPLY) await sb.from('shared_note_receipts').update({ project_id: pid }).eq('folder_id', fid); }
  }
  // Also: transcripts with NO folder but an auto-magnet-eligible initiative are already handled by the magnet;
  // here we only move the manually-foldered ones.
  return { folders: folders.length, created, reused, transcripts, receipts };
}

async function main() {
  const arg = process.argv[2];
  let uids: string[];
  if (!arg || arg === 'all') { const { data } = await sb.from('meeting_folders').select('user_id'); uids = [...new Set((data ?? []).map((r: any) => r.user_id))].filter(Boolean); }
  else uids = [arg];
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} over ${uids.length} user(s)\n`);
  const tot = { folders: 0, created: 0, reused: 0, transcripts: 0, receipts: 0 };
  for (const uid of uids) {
    console.log(`user ${uid.slice(0, 8)}:`);
    const r = await migrateUser(uid);
    for (const k of Object.keys(tot) as (keyof typeof tot)[]) tot[k] += r[k];
    console.log(`  → ${r.folders} folders, ${r.created} projects created, ${r.reused} reused, ${r.transcripts} meetings remapped, ${r.receipts} shared receipts remapped\n`);
  }
  console.log(`TOTAL: ${JSON.stringify(tot)}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
