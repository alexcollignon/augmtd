// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE BUCKET BACKFILL (Sep 14) — every storage-backed `knowledge_files` row written before THE FILE
// CARRIES ITS BUCKET law (lib/knowledge/file-bucket.ts) records a path and no bucket, so every
// reader signed `drive-uploads` and a row whose bytes live in `email-attachments` (a mail
// attachment, a /work chat upload) or `work-artifacts` (a generated deliverable) fell back to plain
// text — the owner-visible "the PDF viewer shows text now" bug.
//
// This sweep does NOT guess from the path shape alone: the origin kind gives a PRIOR, and then the
// object's EXISTENCE is verified in that bucket (a signed-URL mint = a bounded existence check, no
// bytes transferred) before anything is written. A row whose bytes exist nowhere is left alone and
// reported — the text fallback is the honest answer for it.
//
// Dry-run by default; --apply commits. --all sweeps every user.
//   npx tsx scripts/backfill-kb-file-bucket.ts [--apply] [--all] [--user email] [--limit N]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { KB_BUCKETS, DEFAULT_KB_BUCKET, bucketOfKbFile } from '../lib/knowledge/file-bucket';
import { fetchAllRows } from '../lib/utils/fetch-all';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const userArg = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null;
const LIMIT = process.argv.includes('--limit') ? Number(process.argv[process.argv.indexOf('--limit') + 1]) : 20000;

/** The PRIOR: where a row of this provenance most likely put its bytes. Probed, never trusted. */
function priorFor(originKind: string | null): string[] {
  const head = originKind === 'email_attachment' || originKind === 'chat' ? 'email-attachments'
    : originKind === 'generated' ? 'work-artifacts'
    : DEFAULT_KB_BUCKET;
  return [head, ...KB_BUCKETS.filter((b) => b !== head)];
}

async function existsIn(bucket: string, path: string): Promise<boolean> {
  const { data } = await sb.storage.from(bucket).createSignedUrl(path, 60);
  return !!data?.signedUrl;
}

(async () => {
  const { data: users } = await sb.auth.admin.listUsers();
  const targets = ALL ? users!.users : users!.users.filter((u) => u.email === (userArg ?? 'alextcollignon@gmail.com'));
  const tally: Record<string, number> = {};
  let scanned = 0, alreadyStamped = 0, unchanged = 0, moved = 0, missing = 0;

  for (const u of targets) {
    // PostgREST caps ONE response at 1000 rows no matter the .limit — a full listing must page
    // (the repo's oldest lesson; a partial sweep would leave the broken rows invisible again).
    type Row = { id: string; filename: string; storage_path: string | null; origin: unknown };
    const rows = await fetchAllRows<Row>((from, to) => sb.from('knowledge_files')
      .select('id, filename, storage_path, origin')
      .eq('user_id', u.id).not('storage_path', 'is', null)
      .order('id', { ascending: true }).range(from, to), { maxRows: LIMIT });
    for (const r of rows ?? []) {
      scanned++;
      const origin = (r.origin as Record<string, unknown> | null) ?? null;
      if (typeof origin?.bucket === 'string' && origin.bucket) { alreadyStamped++; continue; }
      const kind = typeof origin?.kind === 'string' ? (origin.kind as string) : null;
      let found: string | null = null;
      for (const b of priorFor(kind)) { if (await existsIn(b, String(r.storage_path))) { found = b; break; } }
      if (!found) {
        missing++;
        console.log(`  · no object anywhere — left as text: "${r.filename}" (${kind ?? 'no origin'})`);
        continue;
      }
      tally[found] = (tally[found] ?? 0) + 1;
      const wasServedAs = bucketOfKbFile(r);
      if (found === wasServedAs) unchanged++; else {
        moved++;
        console.log(`  ${APPLY ? '✓' : '·'} ${found.padEnd(17)} (was served as ${wasServedAs}) — "${r.filename}"`);
      }
      if (APPLY) {
        await sb.from('knowledge_files').update({ origin: { ...(origin ?? {}), bucket: found } }).eq('id', r.id);
      }
    }
  }

  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'} — scanned ${scanned} storage-backed rows across ${targets.length} user(s)`);
  console.log(`  already stamped: ${alreadyStamped}`);
  console.log(`  stamped, bucket unchanged (drive-uploads was right): ${unchanged}`);
  console.log(`  stamped, PREVIEW WAS BROKEN before this: ${moved}`);
  console.log(`  bytes missing everywhere (honest text fallback): ${missing}`);
  console.log(`  by bucket: ${Object.entries(tally).map(([b, n]) => `${b}=${n}`).join(' · ') || '—'}`);
  if (!APPLY) console.log('\nRe-run with --apply to write.');
})();
