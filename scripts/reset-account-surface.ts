// ACCOUNT SURFACE RESET (one-room era). Clears DERIVED state only — everything regenerates from
// real data. NEVER touches source data (emails, inbox items, commitments, meetings, KB, coworker
// threads) and never the brain's memory (work_entities/entity_links stay; recognition intact).
//
//   Surface reset:  room_turns · item_plans (plans + judgment caches) · activity_events ·
//                   profiles.home_brief cache · prepared drafts on inbox source_data
//                   (draft / nudge_draft / prepared_by) · item_deliverables (prepared pool)
//   Projecthood reset (R4 clean state): untrack ALL initiatives — only human-created projects
//                   exist from here (reversible: Track again any time; links/goals/rules kept).
//
// Usage: npx tsx scripts/reset-account-surface.ts <user_id> [--apply]   (dry-run by default)
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const userId = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!userId || !/^[0-9a-f-]{36}$/.test(userId)) { console.error('usage: reset-account-surface.ts <user_id> [--apply]'); process.exit(1); }

(async () => {
  console.log(`${APPLY ? 'APPLYING' : 'DRY-RUN'} surface + projecthood reset for ${userId.slice(0, 8)}…\n`);

  const count = async (table: string, extra?: (q: ReturnType<typeof sb.from> extends { select: infer _ } ? any : any) => any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = sb.from(table).select('id', { count: 'exact', head: true }).eq('user_id', userId);
    if (extra) q = extra(q);
    const { count: c } = await q;
    return c ?? 0;
  };

  // 1 — room conversations
  const turns = await count('room_turns');
  if (APPLY) await sb.from('room_turns').delete().eq('user_id', userId);
  console.log(`room_turns: ${turns}`);

  // 2 — plans + judgment caches
  const plans = await count('item_plans');
  if (APPLY) await sb.from('item_plans').delete().eq('user_id', userId);
  console.log(`item_plans (incl. judgments): ${plans}`);

  // 3 — activity log
  const acts = await count('activity_events');
  if (APPLY) await sb.from('activity_events').delete().eq('user_id', userId);
  console.log(`activity_events: ${acts}`);

  // 4 — Home brief cache
  if (APPLY) await sb.from('profiles').update({ home_brief: null }).eq('id', userId);
  console.log('profiles.home_brief: cleared');

  // 5 — prepared drafts on inbox items (strip draft / nudge_draft / prepared_by from source_data)
  let stripped = 0;
  for (const key of ['draft', 'nudge_draft', 'prepared_by', 'prepared_invite', 'prepared_forward'] as const) {
    const { data } = await sb.from('inbox_items').select('id, source_data')
      .eq('user_id', userId).not(`source_data->${key}`, 'is', null).limit(2000);
    for (const r of (data ?? []) as Array<{ id: string; source_data: Record<string, unknown> }>) {
      const sd = { ...r.source_data };
      if (!(key in sd)) continue;
      delete sd[key];
      stripped++;
      if (APPLY) await sb.from('inbox_items').update({ source_data: sd }).eq('id', r.id);
    }
  }
  console.log(`inbox prepared drafts stripped: ${stripped}`);

  // 6 — the prepared-work pool
  const dels = await count('item_deliverables');
  if (APPLY) await sb.from('item_deliverables').delete().eq('user_id', userId);
  console.log(`item_deliverables: ${dels}`);

  // 7 — projecthood: untrack everything (R4 clean state; reversible, memory kept)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: tracked } = await (sb.from('work_entities').select('id', { count: 'exact', head: true }) as any)
    .eq('user_id', userId).eq('kind', 'initiative').eq('tracked', true);
  if (APPLY) await sb.from('work_entities').update({ tracked: false, updated_at: new Date().toISOString() })
    .eq('user_id', userId).eq('kind', 'initiative').eq('tracked', true);
  console.log(`tracked initiatives untracked: ${tracked ?? 0}`);

  console.log(`\n${APPLY ? 'DONE — the surfaces regenerate on next load/prepare.' : 'Dry-run only. Re-run with --apply.'}`);
})();
