// Backfill `source_data.understanding` on existing PENDING inbox_items that predate the unified
// understanding (Part 2). Reruns the SAME per-email classification pass (`processEmail`) — feeding it
// the item's real To/CC + the user's own addresses — and writes the resulting understanding back onto
// source_data. Guarded: dry-run by default; --apply to write. --user=<id> to scope; --limit=<n> caps
// the number of AI calls (each item is one AI call — keep the batch small).
//
//   npx tsx scripts/backfill-understanding.ts --user=<id>                 # dry-run
//   npx tsx scripts/backfill-understanding.ts --user=<id> --limit=20 --apply
//
// Non-destructive: only sets source_data.understanding (+ refreshes work_state from the same pass);
// never touches draft/status. Skips items that already have a valid understanding (idempotent). New
// syncs get understanding automatically at process time — this only backfills the pre-existing pending
// items; a full re-run of classification (rerun route) would also populate them.

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { processEmail } from '../lib/ai/email-processor';
import { coerceUnderstanding } from '../lib/inbox/item-understanding';

const APPLY = process.argv.includes('--apply');
const userArg = process.argv.find((a) => a.startsWith('--user='))?.split('=')[1] || null;
const limitArg = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] || '0') || Infinity;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function userAddresses(userId: string): Promise<{ addrs: string[]; name: string | null }> {
  const set = new Set<string>();
  const { data: prof } = await supabase.from('profiles').select('email, full_name').eq('id', userId).maybeSingle();
  if (prof?.email) set.add(String(prof.email).toLowerCase());
  const { data: authUser } = await supabase.auth.admin.getUserById(userId);
  if (authUser?.user?.email) set.add(authUser.user.email.toLowerCase());
  const { data: conns } = await supabase.from('connections').select('metadata, provider_account_id').eq('user_id', userId);
  for (const c of (conns ?? []) as Array<{ metadata: { email?: string } | null; provider_account_id?: string | null }>) {
    const e = (c.metadata?.email || c.provider_account_id || '').toLowerCase();
    if (e) set.add(e);
  }
  return { addrs: [...set], name: prof?.full_name ? String(prof.full_name) : null };
}

async function main() {
  console.log(`[backfill-understanding] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} user=${userArg ?? 'ALL'} limit=${limitArg}`);

  let userIds: string[];
  if (userArg) userIds = [userArg];
  else {
    const { data } = await supabase.from('inbox_items').select('user_id').eq('source', 'email').eq('status', 'pending').limit(100000);
    userIds = [...new Set((data ?? []).map((r) => r.user_id as string))];
  }

  let scanned = 0, computed = 0, done = 0;

  for (const userId of userIds) {
    if (computed >= limitArg) break;
    const { addrs, name } = await userAddresses(userId);
    if (!addrs.length) { console.warn(`  ! user ${userId}: no addresses resolved — skipping`); continue; }

    const { data: items } = await supabase
      .from('inbox_items')
      .select('id, source_data, work_title, work_state')
      .eq('user_id', userId).eq('source', 'email').eq('status', 'pending')
      .order('created_at', { ascending: false }).limit(100000);

    for (const it of items ?? []) {
      if (computed >= limitArg) break;
      scanned++;
      const sd = (it.source_data ?? {}) as Record<string, any>;
      if (coerceUnderstanding(sd.understanding)) continue; // already has a valid one — idempotent
      if (!(sd.from || sd.from_address)) continue;
      computed++; // one AI call — the limit caps THIS (dry-run and apply alike)
      try {
        const processed = await processEmail({
          id: sd.email_id || (it.id as string), user_id: userId, message_id: sd.message_id || '',
          from_address: sd.from || sd.from_address || '', from_name: sd.from_name || '',
          subject: sd.subject || '', body: sd.body || '', received_at: sd.received_at || new Date().toISOString(),
          recipient_position: sd.is_cc_only ? 'cc' : 'to', recipient_email: addrs[0],
          to_addresses: (sd.to as string[]) || [], cc_addresses: (sd.cc as string[]) || [],
          user_addresses: addrs, user_name: name || undefined,
        }, supabase);
        const u = processed.understanding;
        console.log(`  ~ ${String(it.work_title).slice(0, 55)} :: ${u ? `${u.role}/${u.relevance}/${u.language}` : 'NULL (fallback)'}`);
        if (APPLY && u) {
          done++;
          const { error } = await supabase.from('inbox_items')
            .update({ source_data: { ...sd, understanding: u } })
            .eq('id', it.id as string).eq('user_id', userId);
          if (error) console.error(`    x update failed for ${it.id}:`, error.message);
        }
      } catch (e) { console.warn(`    x processEmail failed for ${it.id}:`, (e as Error).message); }
    }
  }

  console.log(`\n[backfill-understanding] scanned=${scanned} needed=${computed} written=${done} ${APPLY ? '' : '(dry-run — pass --apply to write)'}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
