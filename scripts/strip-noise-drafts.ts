// Strip prod-cron re-polluted noise drafts (the known ~2h re-pollution until the next deploy ships
// the judge-gated cron). Same predicate as the P1 promise gate: a noise row (kind receipt/newsletter/
// notification, or an automated sender), not rules-overridden to needs_reply, carrying a draft →
// remove the draft only (the item itself is untouched). Idempotent; safe to re-run.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { resolveKind } from '../lib/inbox/rules/write-back';
import { isAutomatedSender } from '../lib/inbox/automated';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const USERS = ['08fe4449-e5eb-431d-9156-02e9324e5903', 'c723c2f2-e069-4ab8-980e-ac3585028fec', 'e009a499-41d4-4c44-ad53-53a0e851d143'];

(async () => {
  const { data: uidRows } = await sb.from('work_entities').select('user_id').limit(2000);
  const rene = [...new Set(((uidRows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id))].find((u) => u.startsWith('ae306f38'));
  if (rene) USERS.push(rene);
  for (const uid of USERS) {
    const { data: items } = await sb.from('inbox_items')
      .select('id, work_title, rule_type, type_override, source_data')
      .eq('user_id', uid).eq('status', 'pending').not('source_data->draft', 'is', null).limit(500);
    let n = 0;
    for (const it of (items ?? []) as Array<Record<string, unknown>>) {
      if (it.rule_type === 'needs_reply' || it.type_override === 'needs_reply') continue;
      const sd = (it.source_data ?? {}) as Record<string, unknown>;
      const k = resolveKind(sd, (it.rule_type as string) ?? null);
      const noise = k === 'receipt' || k === 'newsletter' || k === 'notification'
        || isAutomatedSender((sd.from_address as string) ?? null, (sd.from_name as string) ?? null, String(it.work_title ?? ''));
      if (!noise) continue;
      const { draft: _draft, ...rest } = sd;
      await sb.from('inbox_items').update({ source_data: rest }).eq('id', it.id);
      n++;
    }
    console.log(uid.slice(0, 8), 'stripped', n);
  }
})();
