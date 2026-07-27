// REGISTRY HYGIENE (promise fix #5) — archive untracked entities whose ENTIRE membership is noise
// mail (receipt/newsletter/notification kind or automated sender): a Binance alert or subscription
// receipt is an account errand, not a body of work. Conservative by design:
//   • untracked + active only (a tracked project is the user's — never touched)
//   • must have ≥1 member, ALL of them noise inbox items
//   • any meeting / commitment / calendar member → KEPT (real work happened around it)
// Archived (soft — status flip, reversible from the portfolio's Archived tab), never deleted;
// links stay, so future real mail can still recognize into it and the user can reopen.
// Usage: npx tsx scripts/archive-noise-entities.ts [--user <uid>] [--apply]   (dry-run default)
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { resolveKind } from '../lib/inbox/rules/write-back';
import { isAutomatedSender } from '../lib/inbox/automated';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');
const ONLY = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null;

(async () => {
  const { data: profs } = await sb.from('profiles').select('id');
  for (const p of (profs ?? []) as Array<{ id: string }>) {
    if (ONLY && p.id !== ONLY) continue;
    const uid = p.id;
    const { data: ents } = await sb.from('work_entities').select('id, name')
      .eq('user_id', uid).eq('kind', 'initiative').eq('tracked', false).eq('status', 'active').limit(500);
    const rows = (ents ?? []) as Array<{ id: string; name: string }>;
    if (!rows.length) continue;
    const archived: string[] = [];
    for (const e of rows) {
      const { data: links } = await sb.from('entity_links').select('item_kind, item_id')
        .eq('user_id', uid).eq('entity_id', e.id).limit(60);
      const ls = (links ?? []) as Array<{ item_kind: string; item_id: string }>;
      if (!ls.length) continue;                                     // empty → reconcile owns it
      // Real WORK around it → keep. An email_thread link is the thread's structural identity (a
      // duplicate handle on the same mail, not extra work) — ignored for the judgment.
      if (ls.some((l) => l.item_kind === 'meeting' || l.item_kind === 'commitment' || l.item_kind === 'calendar_event')) continue;
      const inboxLinks = ls.filter((l) => l.item_kind === 'inbox_item');
      if (!inboxLinks.length) continue;
      const ids = inboxLinks.map((l) => l.item_id);
      const { data: items } = await sb.from('inbox_items').select('id, work_title, rule_type, source_data')
        .eq('user_id', uid).in('id', ids.slice(0, 60));
      const rowsI = (items ?? []) as Array<Record<string, unknown>>;
      if (!rowsI.length) continue;
      const allNoise = rowsI.every((it) => {
        const sd = (it.source_data ?? {}) as Record<string, unknown>;
        const k = resolveKind(sd, (it.rule_type as string) ?? null);
        return k === 'receipt' || k === 'newsletter' || k === 'notification'
          || isAutomatedSender((sd.from_address as string) ?? null, (sd.from_name as string) ?? null, String(it.work_title ?? ''));
      });
      if (!allNoise) continue;
      archived.push(e.name);
      if (APPLY) {
        await sb.from('work_entities').update({ status: 'archived', updated_at: new Date().toISOString() })
          .eq('id', e.id).eq('user_id', uid);
      }
    }
    if (archived.length) {
      console.log(`══ ${uid.slice(0, 8)} — ${archived.length}/${rows.length} noise entities ${APPLY ? 'ARCHIVED' : 'would archive (dry-run)'}`);
      for (const n of archived.slice(0, 40)) console.log(`   · ${n}`);
    }
  }
  process.exit(0);
})();
