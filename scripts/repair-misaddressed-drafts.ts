// ════════════════════════════════════════════════════════════════════════════════════════════════
// REPAIR — MISADDRESSED + UNADDRESSED COMMITMENT DRAFTS (stabilization W7.3, TRUE ADDRESSEES).
//
// THE ONE READER already hides a misaddressed draft (its addressee denotes the user, or is not the
// commitment's current counterparty) and the re-prepare trip replaces it on the next open or sweep —
// so this script is a LEDGER step, not a correctness step. Dry-run lists + counts:
//   · MISADDRESSED — pooled commitment drafts the reader now withdraws (the "Nudge — <user>" class);
//   · UNADDRESSED  — live pooled drafts with no stamp and no title-derived name (legacy), with what
//                    THE ONE LADDER would address them to today (or "the card will ask").
// --apply files ONLY the misaddressed rows into the version chain (`version_of: 'superseded:addressee'`
// — the reader already skips them; the past folds, never deletes). Nothing else is written. Zero AI.
//
//   npx tsx scripts/repair-misaddressed-drafts.ts --user <email> | --all   [--apply]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { preparedStatesFor } from '../lib/prepare/read';
import { resolveCommitmentAddressee, addresseeLabel } from '../lib/prepare/addressee';
import { fetchAllRows } from '../lib/utils/fetch-all';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const userArg = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null;

(async () => {
  if (!ALL && !userArg) { console.log('usage: --user <email> | --all  [--apply]'); process.exit(1); }
  const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const targets = ALL ? users!.users : users!.users.filter((u) => u.email === userArg);
  let scanned = 0, drafts = 0, mis = 0, unaddressed = 0, wouldAddress = 0, filed = 0;
  for (const u of targets) {
    const open = await fetchAllRows<{ id: string; description: string | null }>((f, t) =>
      sb.from('commitments').select('id, description').eq('user_id', u.id).eq('status', 'open').order('id').range(f, t), { maxRows: 5000 });
    if (!open.length) continue;
    scanned += open.length;
    const states = await preparedStatesFor(sb as never, u.id, open.map((c) => ({ kind: 'commitment' as const, id: c.id })));
    for (const c of open) {
      const st = states.get(`commitment:${c.id}`);
      for (const a of st?.all ?? []) {
        if (a.kind !== 'nudge_draft' && a.kind !== 'reply_draft') continue;
        drafts++;
        const title = (c.description ?? '').slice(0, 70);
        if (a.misaddressed) {
          mis++;
          console.log(`  ✗ MISADDRESSED · ${u.email} · "${title}" — "${a.title ?? ''}" greets ${addresseeLabel(a.addressee) ?? '?'} (${a.addressee?.via ?? '?'})`);
          if (APPLY && a.payload?.store === 'pool' && a.payload.rowId) {
            const { data: row } = await sb.from('item_deliverables').select('metadata').eq('id', a.payload.rowId).eq('user_id', u.id).maybeSingle();
            const meta = (row?.metadata ?? {}) as Record<string, unknown>;
            if (!meta.version_of) {
              const { error } = await sb.from('item_deliverables').update({ metadata: { ...meta, version_of: 'superseded:addressee' } })
                .eq('id', a.payload.rowId).eq('user_id', u.id);
              if (!error) filed++; else console.log(`    write failed: ${error.message}`);
            }
          }
        } else if (!a.addressee) {
          unaddressed++;
          const r = await resolveCommitmentAddressee(sb as never, u.id, c.id);
          const to = r.recipients.map((x) => x.email).filter(Boolean);
          if (to.length) wouldAddress++;
          console.log(`  · UNADDRESSED · ${u.email} · "${title}" → ${to.length ? `the ladder addresses ${to.length} (${r.addressee?.via})` : r.suggestions.length ? `the card asks, offering ${r.suggestions.length}` : 'the card asks'}`);
        }
      }
    }
  }
  console.log(`\nopen commitments scanned=${scanned} · pooled drafts=${drafts} · misaddressed=${mis} · unaddressed=${unaddressed} (the ladder would address ${wouldAddress}) · filed=${filed}${APPLY ? '' : ' (dry-run — pass --apply to file the misaddressed rows)'}`);
})();
