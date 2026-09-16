// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE STALE-LABEL SWEEP — the retro-repair half of THE LABEL FOLLOWS THE PRESENT (LAW 3).
//
// The live seams (lib/email-sync/sync-emails.ts + lib/inbox/reactivate-on-reply.ts) re-derive an
// item's understanding on every NEW INBOUND from here on. The rows that already stand — an account's
// whole standing backlog of frozen asks, the one the owner caught on the Home — heal through the
// SAME path: this sweep re-derives them with `refreshUnderstandingForArrival`, never with a private
// copy of the mapping. What the sweep fixes is what the sync does; there is one implementation.
//
// BY LAW, NOT BY HAND: rows are selected by the predicate (`claimNeedsRepair`) — a stamped claim
// that names an older message than the item now carries, or an unstamped legacy claim on an item
// whose current message postdates its own founding. No subject, sender or account is named here.
//
// Dry-run by default: prints item · old ask → new ask. --apply writes.
//   npx tsx --env-file=.env.local scripts/sweep-stale-labels.ts [--apply] [--user <email|uuid-prefix>]
//                                                              [--limit N] [--all]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { fetchAllRows } from '../lib/utils/fetch-all';
import { coerceUnderstanding } from '../lib/inbox/item-understanding';
import { claimNeedsRepair, refreshUnderstandingForArrival, type MessageForUnderstanding } from '../lib/inbox/refresh-understanding';
import { userAddresses } from '../lib/inbox/ensure-mail-kind';

/* eslint-disable @typescript-eslint/no-explicit-any */
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const arg = (f: string) => (process.argv.includes(f) ? process.argv[process.argv.indexOf(f) + 1] : null);
const USER = arg('--user');
const LIMIT = Number(arg('--limit') ?? 60);

const clip = (s: unknown, n = 62) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);

(async () => {
  const { data: listed } = await sb.auth.admin.listUsers();
  let targets = listed!.users;
  if (!ALL) {
    if (!USER) { console.error('Refusing to run unscoped. Pass --user <email|uuid-prefix> or --all.'); process.exit(1); }
    targets = targets.filter((u) => u.email === USER || u.id.startsWith(USER));
    if (!targets.length) { console.error(`No user matched "${USER}".`); process.exit(1); }
  }

  console.log(`\nTHE STALE-LABEL SWEEP — ${APPLY ? 'APPLY' : 'DRY RUN'} · ${targets.length} account(s) · cap ${LIMIT}/account\n`);

  for (const u of targets) {
    // The oldest lesson in this repo: a full listing pages, or PostgREST silently caps it at 1000.
    const rows = await fetchAllRows<any>((from, to) =>
      sb.from('inbox_items').select('id, created_at, status, work_title, source_data')
        .eq('user_id', u.id).eq('source', 'email').eq('status', 'pending')
        .order('created_at', { ascending: true }).range(from, to),
    );
    const all = rows
      .map((r) => ({ r, why: claimNeedsRepair(r) }))
      .filter((x) => x.why !== null)
      // Freshest arrivals first — those are the rows the deck is speaking today.
      .sort((a, b) => String((b.r.source_data ?? {}).received_at ?? '').localeCompare(String((a.r.source_data ?? {}).received_at ?? '')));
    const needs = all.slice(0, LIMIT);

    console.log(`${u.email ?? u.id} · ${rows.length} pending email items · ${all.length} claim(s) to repair` +
      (all.length > needs.length ? ` · taking the ${needs.length} freshest, ${all.length - needs.length} left for the next run` : ''));
    if (!needs.length) { console.log(''); continue; }

    const addrs = await userAddresses(sb as any, u.id);
    let ok = 0, failed = 0;
    for (const { r, why } of needs) {
      const sd = (r.source_data ?? {}) as Record<string, unknown>;
      const oldAsk = coerceUnderstanding(sd.understanding)?.ask ?? null;
      const message: MessageForUnderstanding = {
        message_id: String(sd.message_id ?? r.id),
        received_at: (sd.received_at as string) ?? null,
        subject: (sd.subject as string) ?? null,
        body: String(sd.body ?? '').slice(0, 6000),
        from_address: (sd.from_address as string) ?? (sd.from as string) ?? null,
        from_name: (sd.from_name as string) ?? null,
        to_addresses: (sd.to as string[]) ?? [],
        cc_addresses: (sd.cc as string[]) ?? [],
      };
      let fresh: string | null = null;
      const outcome = await refreshUnderstandingForArrival({
        userId: u.id, item: r, message, userAddresses: addrs, client: sb,
        dryRun: !APPLY, onDerived: (f) => { fresh = f.ask ?? '(no ask — relevance ' + f.relevance + ')'; },
      });
      if (outcome === 'refreshed') ok++; else failed++;
      console.log(
        `  [${why}] ${r.id.slice(0, 8)} · "${clip(sd.subject)}"\n` +
        `      old: ${oldAsk ?? '—'}\n` +
        `      new: ${fresh ?? `(${outcome})`}`,
      );
    }
    console.log(`  → ${ok} re-derived${APPLY ? ' + written' : ' (dry run — nothing written)'}, ${failed} unchanged/failed\n`);
  }
})();
