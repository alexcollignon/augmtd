// Backfill `source_data.is_cc_only` (+ to/cc) on existing inbox_items by recomputing the user's
// recipient role from the linked `emails` row's to/cc vs the user's own addresses. Guarded:
// dry-run by default; pass --apply to write. Optional --user=<id> to scope to one user.
//
//   npx tsx scripts/backfill-cc-only.ts                 # dry-run, all users
//   npx tsx scripts/backfill-cc-only.ts --user=<id>     # dry-run, one user
//   npx tsx scripts/backfill-cc-only.ts --user=<id> --apply
//
// Non-destructive: only sets is_cc_only/to/cc; never touches draft/status/work_state.

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { computeRecipientRole } from '../lib/inbox/recipient-role';

const APPLY = process.argv.includes('--apply');
const userArg = process.argv.find((a) => a.startsWith('--user='))?.split('=')[1] || null;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function userAddresses(userId: string): Promise<Set<string>> {
  const set = new Set<string>();
  const { data: prof } = await supabase.from('profiles').select('email').eq('id', userId).maybeSingle();
  if (prof?.email) set.add(String(prof.email).toLowerCase());
  const { data: authUser } = await supabase.auth.admin.getUserById(userId);
  if (authUser?.user?.email) set.add(authUser.user.email.toLowerCase());
  const { data: conns } = await supabase.from('connections').select('metadata, provider_account_id').eq('user_id', userId);
  for (const c of (conns ?? []) as Array<{ metadata: { email?: string } | null; provider_account_id?: string | null }>) {
    const e = (c.metadata?.email || c.provider_account_id || '').toLowerCase();
    if (e) set.add(e);
  }
  return set;
}

async function main() {
  console.log(`[backfill-cc-only] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} user=${userArg ?? 'ALL'}`);

  // Which users to process.
  let userIds: string[];
  if (userArg) userIds = [userArg];
  else {
    const { data } = await supabase.from('inbox_items').select('user_id').eq('source', 'email').limit(100000);
    userIds = [...new Set((data ?? []).map((r) => r.user_id as string))];
  }

  let totalScanned = 0, totalChanged = 0, totalCcOnly = 0;

  for (const userId of userIds) {
    const addrs = await userAddresses(userId);
    if (addrs.size === 0) { console.warn(`  ! user ${userId}: no addresses resolved — skipping`); continue; }

    // All active email inbox items for this user.
    const { data: items } = await supabase
      .from('inbox_items')
      .select('id, source_id, source_data, work_title')
      .eq('user_id', userId)
      .eq('source', 'email')
      .limit(100000);

    for (const it of items ?? []) {
      totalScanned++;
      const sd = (it.source_data ?? {}) as Record<string, unknown>;
      if (!it.source_id) continue;
      const { data: em } = await supabase
        .from('emails')
        .select('to_addresses, cc_addresses')
        .eq('id', it.source_id as string)
        .maybeSingle();
      if (!em) continue;
      const role = computeRecipientRole(em.to_addresses as string[], em.cc_addresses as string[], addrs);

      const prev = sd.is_cc_only;
      // Only write when something actually changes (idempotent).
      const changed = prev !== role.is_cc_only
        || JSON.stringify(sd.to) !== JSON.stringify(role.to)
        || JSON.stringify(sd.cc) !== JSON.stringify(role.cc);
      if (!changed) continue;
      totalChanged++;
      if (role.is_cc_only) totalCcOnly++;

      if (prev !== role.is_cc_only) {
        console.log(`  ~ ${String(it.work_title).slice(0, 55)} :: is_cc_only ${prev} -> ${role.is_cc_only}`);
      }

      if (APPLY) {
        const { error } = await supabase.from('inbox_items')
          .update({ source_data: { ...sd, is_cc_only: role.is_cc_only, to: role.to, cc: role.cc } })
          .eq('id', it.id as string).eq('user_id', userId);
        if (error) console.error(`    x update failed for ${it.id}:`, error.message);
      }
    }
  }

  console.log(`\n[backfill-cc-only] scanned=${totalScanned} changed=${totalChanged} (cc_only now true=${totalCcOnly}) ${APPLY ? 'WRITTEN' : '(dry-run — pass --apply to write)'}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
