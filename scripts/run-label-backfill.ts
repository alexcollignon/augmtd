// ONE-TIME LABEL BACKFILL — the fixed sweep's exact flow (kind-complete → pair-apply → honest
// stamp), run to completion over ALL pending items (the cron sweep only covers a 3-day window;
// scoped to the LAST 7 DAYS (the user's call — older pending mail stays as-is). SAME engine parts — ensureMailKind
// + writeBackLabels — so this is the product labeling, not a parallel implementation.
// Usage: npx tsx scripts/run-label-backfill.ts [--user <uid>]
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { writeBackLabels, GmailLabelCache } from '../lib/inbox/rules/write-back';
import { ensureMailKind, userAddresses } from '../lib/inbox/ensure-mail-kind';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const ONLY = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null;

(async () => {
  const { data: profs } = await sb.from('profiles').select('id, email_settings');
  for (const p of (profs ?? []) as Array<{ id: string; email_settings: { auto_label?: boolean } | null }>) {
    if (ONLY && p.id !== ONLY) continue;
    if ((p.email_settings ?? {}).auto_label === false) continue;
    const { data: conns } = await sb.from('connections').select('provider, metadata').eq('user_id', p.id).eq('status', 'active');
    const tokensByProvider = new Map((conns ?? []).map((c) => [c.provider, (c.metadata as { tokens?: string } | null)?.tokens]));
    if (!tokensByProvider.size) continue;
    const gmailTokens = tokensByProvider.get('gmail');
    const gmailCache = gmailTokens ? new GmailLabelCache(gmailTokens) : undefined;

    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data: items } = await sb.from('inbox_items')
      .select('id, source_data, work_state, rule_type')
      .eq('user_id', p.id).eq('status', 'pending').eq('source', 'email')
      .gte('created_at', since).limit(600);
    let applied = 0, kinds = 0, finals = 0, failedN = 0;
    let addrs: string[] | null = null;
    for (const it of (items ?? []) as Array<Record<string, unknown>>) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sd = (it.source_data ?? {}) as any;
      if (sd.labeled === true) continue;
      if (!sd.thread_id && !sd.message_id) continue;
      const provider = sd.provider as string | undefined;
      const tokens = provider ? tokensByProvider.get(provider) : undefined;
      if (!tokens) continue;
      const ruleType = it.rule_type && it.rule_type !== 'none' ? (it.rule_type as string) : null;
      if (ruleType === 'done') continue;
      let kindComputed = false;
      if (!sd.understanding?.mailKind && !sd.kind_override) {
        if (!addrs) addrs = await userAddresses(sb, p.id);
        const kind = await ensureMailKind(sb, p.id, { id: it.id as string, source_data: sd }, addrs);
        kindComputed = true;
        if (kind) kinds++;
      }
      const bulk = ((sd.gmail_labels ?? []) as string[]).includes('CATEGORY_PROMOTIONS') || sd.has_unsubscribe === true;
      const ok = await writeBackLabels({
        provider: provider as 'gmail' | 'outlook', encryptedTokens: tokens, sd, ruleType,
        workState: it.work_state as string | null,
        hints: { bulk, noise: it.work_state === 'noise' },
        gmailThreadId: sd.thread_id, gmailCache,
        outlookMessageId: sd.outlook_id ?? sd.message_id,
      });
      if (ok === 'applied' || (ok === 'noop' && kindComputed)) {
        await sb.from('inbox_items').update({ source_data: { ...sd, labeled: true } }).eq('id', it.id as string);
        if (ok === 'applied') applied++; else finals++;
      } else if (ok === 'failed') failedN++;
      await new Promise((r) => setTimeout(r, 60));
    }
    console.log(`${p.id.slice(0, 8)} · applied=${applied} kindsComputed=${kinds} finalNoop=${finals} failed=${failedN}`);
  }
  console.log('backfill done');
})();
