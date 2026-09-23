// ════════════════════════════════════════════════════════════════════════════════════════════════
// W10 THE MAILBOX IS THE USER'S — the guarded AUGMTD-label cleanup (ops door).
//
// Runs THE ONE function (lib/inbox/rules/mailbox-labels.ts `removeAugmtdLabels`) — the same one the
// Settings button calls. Removes ONLY what AUGMTD created: the AUGMTD/ Gmail labels (+ the parent)
// and the `AUGMTD:` Outlook categories. Scope per account, by the account's own choice:
//   auto_label === true → the RETIRED labels only (every kind label + FYI/Meeting/Notifications/
//                         Marketing); the live postures stay.
//   unset / false       → every AUGMTD label.
//
//   npx tsx scripts/remove-augmtd-labels.ts                       # DB census only (zero provider calls)
//   npx tsx scripts/remove-augmtd-labels.ts --provider-census     # + a READ-ONLY provider census
//   npx tsx scripts/remove-augmtd-labels.ts --user <email|id>     # one account
//   npx tsx scripts/remove-augmtd-labels.ts --all --apply --yes   # OWNER-GATED provider writes
//
// Dry-run by default. `--apply` alone refuses; `--apply --yes` writes. A dry run never persists a
// refreshed token, so it performs no DB write either.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { fetchAllRows } from '../lib/utils/fetch-all';
import { removeAugmtdLabels, cleanupScopeFor } from '../lib/inbox/rules/mailbox-labels';

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const val = (f: string) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] ?? null : null);
const APPLY = has('--apply');
const YES = has('--yes');
const ALL = has('--all');
const PROVIDER_CENSUS = has('--provider-census');
const USER = val('--user');

if (APPLY && !YES) {
  console.error('Refusing: --apply writes to real mailboxes. Re-run with --apply --yes (owner-gated).');
  process.exit(2);
}
if (APPLY && !ALL && !USER) {
  console.error('Refusing: name the scope — --user <email|id> or --all.');
  process.exit(2);
}

(async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  // Accounts with an active mail connection (the only mailboxes AUGMTD could have labelled).
  const conns = await fetchAllRows<{ user_id: string; provider: string }>((from, to) =>
    sb.from('connections').select('user_id, provider').eq('status', 'active').in('provider', ['gmail', 'outlook'])
      .order('id', { ascending: true }).range(from, to));
  let userIds = [...new Set(conns.map((c) => c.user_id))];
  if (USER) {
    const isId = /^[0-9a-f-]{36}$/i.test(USER);
    const { data: prof, error } = await sb.from('profiles').select('id').eq(isId ? 'id' : 'email', USER).maybeSingle();
    if (error || !prof) { console.error(`No account for --user ${USER}${error ? `: ${error.message}` : ''}`); process.exit(1); }
    userIds = userIds.filter((u) => u === prof.id);
    if (!userIds.length) { console.log('That account has no active Gmail/Outlook connection — nothing to clean.'); return; }
  }

  // The DB census — what the default change means per account (zero provider calls).
  const profiles = await fetchAllRows<{ id: string; email_settings: Record<string, unknown> | null }>((from, to) =>
    sb.from('profiles').select('id, email_settings').in('id', userIds).order('id', { ascending: true }).range(from, to));
  const setting = new Map(profiles.map((p) => [p.id, p.email_settings]));
  const bucket = { unset: 0, explicitTrue: 0, explicitFalse: 0 };
  for (const u of userIds) {
    const v = (setting.get(u) ?? {})?.auto_label;
    if (v === true) bucket.explicitTrue++; else if (v === false) bucket.explicitFalse++; else bucket.unset++;
  }
  const byProvider = conns.filter((c) => userIds.includes(c.user_id)).reduce<Record<string, number>>((m, c) => { m[c.provider] = (m[c.provider] ?? 0) + 1; return m; }, {});
  console.log('════ AUGMTD LABEL CLEANUP — CENSUS ════');
  console.log(`accounts with an active mail connection: ${userIds.length} (connections: ${Object.entries(byProvider).map(([k, n]) => `${k} ${n}`).join(' · ')})`);
  console.log(`auto_label: unset ${bucket.unset} → labels now OFF, scope ALL · explicit true ${bucket.explicitTrue} → labels stay (posture only), scope RETIRED · explicit false ${bucket.explicitFalse} → scope ALL`);
  console.log('NB: before W10 the settings PUT wrote every default into the row, so an "explicit true" may be a merge artefact of toggling any other email setting, not a choice.');

  if (!APPLY && !PROVIDER_CENSUS) {
    console.log('\nDRY RUN (DB only). Add --provider-census for a read-only mailbox census, or --apply --yes to remove (owner-gated).');
    return;
  }

  const totals = { accounts: 0, labelsFound: 0, labelsRemoved: 0, messagesTouched: 0, leftBehind: 0, errors: 0 };
  for (const uid of userIds) {
    const scope = cleanupScopeFor(setting.get(uid) as { auto_label?: unknown } | null);
    const r = await removeAugmtdLabels(sb, uid, { apply: APPLY, providerRead: true, scope });
    totals.accounts++;
    for (const c of r.connections) {
      totals.labelsFound += c.labelsFound.length;
      totals.labelsRemoved += c.labelsRemoved.length;
      totals.messagesTouched += c.messagesTouched;
      totals.leftBehind += c.leftBehind;
      if (c.error) totals.errors++;
      console.log(`  ${uid.slice(0, 8)} · ${c.provider} · scope ${r.scope} · found ${c.labelsFound.length}${c.labelsFound.length ? ` [${c.labelsFound.join(', ')}]` : ''}${APPLY ? ` · removed ${c.labelsRemoved.length} · messages ${c.messagesTouched}` : ''}${c.leftBehind ? ` · LEFT ${c.leftBehind}` : ''}${c.error ? ` · error: ${c.error.slice(0, 100)}` : ''}`);
    }
  }
  console.log(`\n${APPLY ? 'APPLIED' : 'PROVIDER CENSUS (read-only)'} — accounts ${totals.accounts} · AUGMTD labels found ${totals.labelsFound}${APPLY ? ` · removed ${totals.labelsRemoved} · Outlook messages patched ${totals.messagesTouched}` : ''} · left behind ${totals.leftBehind} · errors ${totals.errors}`);
  if (totals.leftBehind) console.log('Something was left behind by the clock — re-run to finish.');
})();
