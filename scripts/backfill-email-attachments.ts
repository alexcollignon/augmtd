// FILE SPINE (Prepared-Work A3) — backfill: ingest ALL users' stored email attachments into the KB via
// the ONE funnel (ingestFile): noise-filtered, content-hash deduped, entity-linked. Idempotent — safe to
// re-run. Dry-run default; --apply commits. Usage: npx tsx scripts/backfill-email-attachments.ts [--apply]
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { ingestItemAttachments, isNoiseAttachment } from '../lib/knowledge/ingest';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');

(async () => {
  const { data: items } = await sb.from('inbox_items')
    .select('id, user_id, source_data').not('source_data->attachments', 'is', null).limit(2000);
  const rows = (items ?? []) as Array<{ id: string; user_id: string; source_data: Record<string, unknown> }>;
  const byUser = new Map<string, typeof rows>();
  for (const r of rows) (byUser.get(r.user_id) ?? byUser.set(r.user_id, []).get(r.user_id)!).push(r);

  for (const [uid, urows] of byUser) {
    let ingested = 0, deduped = 0, skipped = 0, candidates = 0;
    for (const it of urows) {
      const atts = (it.source_data as { attachments?: Array<Record<string, unknown>> }).attachments ?? [];
      const real = atts.filter((a) => !isNoiseAttachment(a as never));
      candidates += real.length;
      if (!APPLY) { skipped += atts.length - real.length; continue; }
      const r = await ingestItemAttachments(sb, uid, it);
      ingested += r.ingested; deduped += r.deduped; skipped += r.skipped;
    }
    console.log(`${uid.slice(0, 8)}: ${urows.length} emails · ${candidates} real attachment(s)` +
      (APPLY ? ` → ingested ${ingested} · deduped ${deduped} · skipped ${skipped}` : ' (dry-run)'));
  }
  if (!APPLY) console.log('\nDry-run. Re-run with --apply.');
})();
