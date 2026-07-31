// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE KIND-UPGRADE SWEEP (July 31) — repairs the fallback-finality backlog: items whose kind label
// came from the STRUCTURAL FALLBACK (automated→Notification, bulk→Newsletter) and were stamped
// FINAL before the reasoned tier ever ran (the "receipts wearing Notification" class). For each:
// the reasoned completer judges the kind from the email's own content (with the own-coworker fact),
// the pair re-applies (the ONE-KIND-LABEL reconcile strips the stale placeholder in the mailbox),
// and the stamp goes final. No keyword lists — the reasoned tier simply gets the turn it was owed.
// Dry-run counts candidates; --apply does the reasoning. Capped per user per run (re-run to drain).
//   npx tsx scripts/sweep-kind-upgrade.ts [--apply] [--all] [--user email] [--cap 40] [--days 7]
// Scoped to the last N days (default 7) — recent mail is what the user actually sees; older
// fallback labels age out of relevance and aren't worth the reasoning spend.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { writeBackLabels, GmailLabelCache } from '../lib/inbox/rules/write-back';
import { ensureMailKind, userAddresses } from '../lib/inbox/ensure-mail-kind';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const CAP = Number(process.argv[process.argv.indexOf('--cap') + 1]) || 40;
const DAYS = Number(process.argv[process.argv.indexOf('--days') + 1]) || 7;
const userArg = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null;

(async () => {
  const { data: users } = await sb.auth.admin.listUsers();
  const targets = ALL ? users!.users : users!.users.filter((u) => u.email === (userArg ?? 'alextcollignon@gmail.com'));
  let candidates = 0, upgraded = 0, confirmed = 0, failed = 0;

  for (const u of targets) {
    const { data: prof } = await sb.from('profiles').select('email_settings').eq('id', u.id).maybeSingle();
    if (((prof?.email_settings ?? {}) as { auto_label?: boolean }).auto_label === false) continue;
    const { data: conns } = await sb.from('connections').select('provider, metadata').eq('user_id', u.id).eq('status', 'active');
    const tokensByProvider = new Map((conns ?? []).map((c) => [c.provider, (c.metadata as { tokens?: string } | null)?.tokens]));
    const gmailTokens = tokensByProvider.get('gmail');
    const gmailCache = gmailTokens ? new GmailLabelCache(gmailTokens) : undefined;

    // The backlog class: STAMPED (final or fallback) yet no reasoned kind and no override — the
    // structural placeholder locked in before the reasoned tier ran.
    const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
    let rows: Array<{ id: string; source_data: Record<string, unknown>; rule_type: string | null; work_state: string | null }> = [];
    for (let off = 0; off < 4000; off += 1000) {
      const { data } = await sb.from('inbox_items').select('id, source_data, rule_type, work_state')
        .eq('user_id', u.id).eq('status', 'pending').eq('source', 'email').gte('created_at', since).range(off, off + 999);
      rows = rows.concat((data ?? []) as typeof rows);
      if (!data || data.length < 1000) break;
    }
    const pool = rows.filter((it) => {
      const sd = (it.source_data ?? {}) as Record<string, unknown>;
      const und = (sd.understanding ?? null) as { mailKind?: string } | null;
      return (sd.labeled === true || sd.labeled === 'fallback') && !und?.mailKind && !sd.kind_override;
    });
    candidates += pool.length;
    if (!APPLY) { console.log(`${u.email}: ${pool.length} fallback-final candidate(s)`); continue; }

    let budget = CAP;
    let addrs: string[] | null = null;
    for (const it of pool) {
      if (budget-- <= 0) break;
      const sd = (it.source_data ?? {}) as Record<string, unknown>;
      if (!addrs) addrs = await userAddresses(sb, u.id);
      const kind = await ensureMailKind(sb, u.id, { id: it.id, source_data: sd }, addrs);
      if (!kind) {
        // The reasoned tier had its turn and judged none/failed — stamp final so we stop revisiting
        // ONLY on a real judgment; a compute failure leaves the stamp for a later run.
        continue;
      }
      const provider = sd.provider as string | undefined;
      const tokens = provider ? tokensByProvider.get(provider) : undefined;
      const oldFallback = String(sd.mail_kind ?? '');
      let applied = 'skipped-no-tokens';
      if (tokens) {
        const ruleType = it.rule_type && it.rule_type !== 'none' ? it.rule_type : null;
        const ok = await writeBackLabels({
          provider: provider as 'gmail' | 'outlook', encryptedTokens: tokens, sd,
          ruleType, workState: it.work_state,
          gmailThreadId: (sd.thread_id as string) ?? null, gmailCache,
          outlookMessageId: (sd.outlook_id as string) ?? (sd.message_id as string) ?? null,
        });
        applied = ok;
        await new Promise((r) => setTimeout(r, 60));
      }
      await sb.from('inbox_items').update({ source_data: { ...sd, labeled: true } }).eq('id', it.id).eq('user_id', u.id);
      const line = `  ${u.email} · "${String(sd.subject ?? '').slice(0, 55)}" → ${kind} (${applied})${oldFallback ? ` was ${oldFallback}` : ''}`;
      if (applied === 'failed') { failed++; console.log(line + ' ⚠'); }
      else { upgraded++; console.log(line); }
      confirmed++;
    }
  }
  console.log(`\ncandidates=${candidates}${APPLY ? ` · reasoned=${confirmed} · labels-updated=${upgraded} · label-failures=${failed}` : ' (dry-run — pass --apply)'}`);
})();
