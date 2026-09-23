// ════════════════════════════════════════════════════════════════════════════════════════════════
// REWATCH SENT (stabilization W9.2 WHAT YOU SEND ANYWHERE CLOSES WITHIN SECONDS). GUARDED; DRY-RUN BY DEFAULT.
//
// Push watches registered before W9.2 cover the INBOX only (Gmail labelIds ['INBOX'] · one Outlook
// subscription on the inbox). The daily renew cron (app/api/cron/renew-push-subscriptions) migrates
// them to THE PUSH SHAPE (lib/email-sync/push-shape.ts — Gmail INBOX+SENT · Outlook + a Sent Items
// subscription) at most SHAPE_MIGRATION_PER_RUN per run; this script does it on demand.
//
//   npx tsx scripts/rewatch-sent.ts                     census: which active connections are stale
//   npx tsx scripts/rewatch-sent.ts --apply --yes       re-register them (provider API writes — OWNER-GATED)
//   … [--connection <id>]                               one connection only
//
// Idempotent: Gmail users.watch REPLACES the mailbox's watch (the stored history cursor is preserved);
// Outlook renews the inbox subscription and adds/renews the Sent one; each stamps
// metadata.push_watch_shape, so a re-run finds nothing to do. ZERO AI. Output is masked (ids only).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { fetchAllRows } from '../lib/utils/fetch-all';
import { pushShapeStale, PUSH_WATCH_SHAPE } from '../lib/email-sync/push-shape';

const argv = process.argv;
const APPLY = argv.includes('--apply');
const YES = argv.includes('--yes');
const connArg = argv.includes('--connection') ? argv[argv.indexOf('--connection') + 1] : null;

async function main() {
  if (APPLY && !YES) {
    console.error('--apply writes to the providers (re-registers push watches). Re-run with --apply --yes.');
    process.exit(1);
  }
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } });

  const rows = await fetchAllRows<any>((from, to) => {
    let q = sb.from('connections').select('*')
      .in('provider', ['gmail', 'outlook']).eq('status', 'active').not('push_expires_at', 'is', null);
    if (connArg) q = q.eq('id', connArg);
    return q.order('id', { ascending: true }).range(from, to);
  });
  const stale = rows.filter((c) => pushShapeStale(c));
  const byProvider = (p: string) => stale.filter((c) => c.provider === p).length;
  console.log(`Registered active connections: ${rows.length} · stale shape (≠ ${PUSH_WATCH_SHAPE}): ${stale.length} (gmail ${byProvider('gmail')} · outlook ${byProvider('outlook')})`);
  for (const c of stale) console.log(`  · ${c.provider} ${String(c.id).slice(0, 8)} shape=${c.metadata?.push_watch_shape ?? 'none'}`);

  if (!APPLY) { console.log('\nDRY RUN — nothing written. --apply --yes re-registers these.'); return; }

  const { renewGmailWatch } = await import('../lib/google/gmail-watch');
  const { renewOutlookSubscription } = await import('../lib/microsoft/outlook-subscriptions');
  let ok = 0; let failed = 0;
  for (const c of stale) {
    try {
      if (c.provider === 'gmail') await renewGmailWatch(c, sb);
      else await renewOutlookSubscription(c, sb);
      ok++; console.log(`  ✓ ${c.provider} ${String(c.id).slice(0, 8)}`);
    } catch (e) {
      failed++; console.log(`  ✗ ${c.provider} ${String(c.id).slice(0, 8)} — ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`\nRe-registered ${ok}, failed ${failed} (failures stay stale → the daily renew retries them).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
