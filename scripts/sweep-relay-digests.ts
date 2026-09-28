// ════════════════════════════════════════════════════════════════════════════════════════════════
// W18 · A RELAY IS A NOTICE — RETRO-REPAIR BY LAW (lib/inbox/relay-digest.ts). GUARDED.
//
// The law repairs the future (the ONE understanding pass floors every new relay). This sweep applies
// the SAME floor to the standing backlog: the account's PENDING inbox items that seat as work
// (relevance reply/action or ownership you_owe, not already a no-move notice) and that the relay law
// now reads as an automated digest of the user's own mail. ZERO AI: the structural citation of the
// user's own window + the stored signals (the reasoned flag does not exist on legacy rows).
//
//   DRY RUN (default)  — read-only: counts + item ids (no names, no subjects), with how many of the
//                        user's own items each one cites.
//   --apply --user <id> — writes the floored understanding through the ONE repair door
//                        (`floorStandingRelay`: conditional on still-pending, the user's re-type wins).
//                        A posture flip, not a hiding — the item stays behind its door as a notice.
//
// Run: npx tsx scripts/sweep-relay-digests.ts --user <uuid> [--apply]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { fetchAllRows } from '../lib/utils/fetch-all';
import { coerceUnderstanding } from '../lib/inbox/item-understanding';
import { isNoMoveNotice, rawMailKindOf, listMailOf } from '../lib/inbox/notice-demotion';
import { floorStandingRelay } from '../lib/inbox/relay-digest';

async function main() {
  const argv = process.argv.slice(2);
  const APPLY = argv.includes('--apply');
  const i = argv.indexOf('--user');
  const USER = i >= 0 ? argv[i + 1] : null;
  if (!USER || !/^[0-9a-f-]{36}$/i.test(USER)) { console.error('REFUSED: --user <uuid> is required (dry run and apply alike).'); process.exit(2); }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('no Supabase env'); process.exit(2); }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  type Row = { id: string; type_override: string | null; work_state: string | null; source_data: Record<string, unknown> | null };
  const rows = await fetchAllRows<Row>((f, t) => sb.from('inbox_items')
    .select('id, type_override, work_state, source_data')
    .eq('user_id', USER).eq('status', 'pending').eq('source', 'email')
    .order('created_at', { ascending: true }).order('id', { ascending: true }).range(f, t));
  const { data: prof } = await sb.from('profiles').select('full_name').eq('id', USER).maybeSingle();
  const userName = (prof?.full_name as string | null) ?? null;

  const seated = rows.filter((r) => {
    if (r.type_override) return false;
    const sd = r.source_data ?? {};
    const u = coerceUnderstanding(sd.understanding);
    if (!u || u.relay === true) return false;
    const claims = u.relevance !== 'awareness' || u.ownership === 'you_owe';
    if (!claims) return false;
    return !isNoMoveNotice({ u, rawKind: rawMailKindOf(sd), fromEmail: (sd.from as string) ?? null, fromName: (sd.from_name as string) ?? null, subject: (sd.subject as string) ?? null, workState: r.work_state, listMail: listMailOf(sd) });
  });
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN (read-only, zero AI)'} · account ${USER.slice(0, 8)} · pending mail ${rows.length} · seated as work ${seated.length}`);
  const hits: Array<{ id: string; cited: number; wrote: boolean }> = [];
  for (const r of seated) {
    const res = await floorStandingRelay(sb, USER, r.id, { dryRun: !APPLY, userName });
    if (res.relay) hits.push({ id: r.id, cited: res.cited.length, wrote: res.wrote });
  }
  console.log(`relays the law would demote: ${hits.length}`);
  for (const h of hits) console.log(`  ${h.id}  cites ${h.cited} of the user's own items${APPLY ? (h.wrote ? ' · floored' : ' · NOT written') : ''}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
