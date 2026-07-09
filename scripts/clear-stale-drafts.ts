// Clear stale reply drafts from inbox_items that should NOT carry one — items whose own
// classification isn't "needs a reply" (work_state='noted' FYI, or anything classifyItem doesn't
// resolve to needs_reply, incl. noise/waiting/fyi/bystander). Reuses the SAME gate the drafters use
// (`shouldDraftReply`) so it can't drift. Guarded: dry-run by default; pass --apply to write.
//
//   npx tsx scripts/clear-stale-drafts.ts                # dry-run, all users
//   npx tsx scripts/clear-stale-drafts.ts --user=<id>    # dry-run, one user
//   npx tsx scripts/clear-stale-drafts.ts --user=<id> --apply
//
// Only removes source_data.draft; never touches status/work_state/body.

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { shouldDraftReply, setInboxRules } from '../lib/inbox/classify-item';
import { loadUserRules } from '../lib/inbox/rules/load';

const APPLY = process.argv.includes('--apply');
const userArg = process.argv.find((a) => a.startsWith('--user='))?.split('=')[1] || null;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  console.log(`[clear-stale-drafts] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} user=${userArg ?? 'ALL'}`);

  let userIds: string[];
  if (userArg) userIds = [userArg];
  else {
    const { data } = await supabase.from('inbox_items')
      .select('user_id').eq('source', 'email').not('source_data->draft', 'is', null).limit(100000);
    userIds = [...new Set((data ?? []).map((r) => r.user_id as string))];
  }

  let totalWithDraft = 0, totalStale = 0;

  for (const userId of userIds) {
    // Load the user's own deterministic rules so classifyItem matches runtime behaviour.
    try { setInboxRules(await loadUserRules(userId, supabase)); } catch { setInboxRules(null); }

    const { data: items } = await supabase.from('inbox_items')
      .select('id, work_state, rule_type, type_override, status, source, source_data, work_title')
      .eq('user_id', userId)
      .eq('source', 'email')
      .not('source_data->draft', 'is', null)
      .limit(100000);

    for (const it of items ?? []) {
      const sd = (it.source_data ?? {}) as Record<string, unknown>;
      if (!sd.draft) continue;
      totalWithDraft++;
      // The single shared gate: only genuine needs_reply items keep a draft.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const keep = shouldDraftReply(it as any);
      if (keep) continue;
      totalStale++;
      const draftSnip = String((sd.draft as { body?: string })?.body ?? '').slice(0, 50).replace(/\n/g, ' ');
      console.log(`  x ${String(it.work_title).slice(0, 50)} :: ws=${it.work_state} rule=${it.rule_type} cc_only=${sd.is_cc_only} :: "${draftSnip}"`);
      if (APPLY) {
        const { draft: _drop, ...rest } = sd;
        void _drop;
        const { error } = await supabase.from('inbox_items')
          .update({ source_data: rest })
          .eq('id', it.id as string).eq('user_id', userId);
        if (error) console.error(`    ! update failed for ${it.id}:`, error.message);
      }
    }
  }

  console.log(`\n[clear-stale-drafts] with_draft=${totalWithDraft} stale_to_clear=${totalStale} ${APPLY ? 'CLEARED' : '(dry-run — pass --apply to clear)'}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
