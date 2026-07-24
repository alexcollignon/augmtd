// VERB-FIRST ASKS — backfill-LIGHT (just-works P4). Recomputes `source_data.understanding` (which now
// carries the imperative `ask`) for ONLY the items the deck actually shows: pending, actionable
// (relevance reply/action or an actionable rule/work_state), capped per user. Everything else picks the
// field up naturally as new mail flows through processEmail. Cross-user. Preserves the rest of
// source_data (read-merge-write per item). Dry-run by default; --apply to write.
//
//   npx tsx scripts/backfill-visible-asks.ts                  # dry-run (report what would change)
//   npx tsx scripts/backfill-visible-asks.ts --apply
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { computeUnderstanding } from '../lib/ai/email-processor';

const APPLY = process.argv.includes('--apply');
const CAP_PER_USER = 40;
const BATCH = 6;
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function addrsOf(uid: string): Promise<string[]> {
  const set = new Set<string>();
  const { data: prof } = await sb.from('profiles').select('email').eq('id', uid).maybeSingle();
  if (prof?.email) set.add(String(prof.email).toLowerCase());
  const { data: conns } = await sb.from('connections').select('metadata, provider_account_id').eq('user_id', uid);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const c of (conns ?? []) as any[]) { const e = (c.metadata?.email || c.provider_account_id || '').toLowerCase(); if (e) set.add(e); }
  return [...set];
}

async function main() {
  console.log(`[visible-asks] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} cap/user=${CAP_PER_USER}`);
  const { data: users } = await sb.from('connections').select('user_id');
  const uids = [...new Set(((users ?? []) as Array<{ user_id: string }>).map((u) => u.user_id))];
  for (const uid of uids) {
    const userAddrs = await addrsOf(uid);
    const { data: rows } = await sb.from('inbox_items')
      .select('id, work_title, source_data')
      .eq('user_id', uid).eq('source', 'email').eq('status', 'pending')
      .or('work_state.in.(work_prepared,decision_required,action_required),rule_type.in.(needs_reply,to_do,waiting_on)')
      .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(80);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = ((rows ?? []) as any[])
      .filter((it) => (it.source_data?.from || it.source_data?.from_address))
      .filter((it) => {
        const u = it.source_data?.understanding;
        // Only VISIBLE-actionable rows that don't already carry a verb-first ask.
        return (!u || u.relevance === 'reply' || u.relevance === 'action') && !u?.ask;
      })
      .slice(0, CAP_PER_USER);
    if (!items.length) { console.log(`user ${uid.slice(0, 8)} — nothing to do`); continue; }
    let asks = 0, written = 0, failed = 0;
    for (let i = 0; i < items.length; i += BATCH) {
      await Promise.all(items.slice(i, i + BATCH).map(async (it) => {
        const sd = it.source_data ?? {};
        try {
          const u = await computeUnderstanding({
            id: sd.email_id || it.id, user_id: uid, message_id: sd.message_id || '',
            from_address: sd.from || sd.from_address || '', from_name: sd.from_name || '',
            subject: sd.subject || '', body: sd.body || '', received_at: sd.received_at || new Date().toISOString(),
            recipient_position: sd.is_cc_only ? 'cc' : 'to', recipient_email: userAddrs[0],
            to_addresses: sd.to || [], cc_addresses: sd.cc || [], user_addresses: userAddrs, user_name: undefined,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any, sb);
          if (!u) { failed++; return; }
          if (u.ask) asks++;
          if (APPLY) {
            const { error } = await sb.from('inbox_items').update({ source_data: { ...sd, understanding: u } }).eq('id', it.id).eq('user_id', uid);
            if (error) failed++; else written++;
          }
        } catch { failed++; }
      }));
    }
    console.log(`user ${uid.slice(0, 8)} — recomputed ${items.length} · verb-first asks: ${asks} · written ${written} · failed ${failed}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
