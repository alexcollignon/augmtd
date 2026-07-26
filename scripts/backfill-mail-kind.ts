// M1 BACKFILL (work-surface plan) — add `mailKind` to PENDING items' stored understanding.
// HOME-NEUTRAL by construction (the established backfill law): computeUnderstanding runs fresh but
// we MERGE ONLY `mailKind` into the stored understanding — role/relevance/bulk/language/initiative
// are untouched, so no routing changes. Pending items only (the live sync stamps new mail), capped.
// Usage: npx tsx scripts/backfill-mail-kind.ts [--user <uid>] [--apply]   (dry-run default)
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { computeUnderstanding } from '../lib/ai/email-processor';
import { coerceUnderstanding } from '../lib/inbox/item-understanding';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');
const ONLY = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null;
const CAP = 120; // per user

(async () => {
  const { data: profs } = await sb.from('profiles').select('id, email');
  for (const p of (profs ?? []) as Array<{ id: string; email: string | null }>) {
    if (ONLY && p.id !== ONLY) continue;
    const uid = p.id;
    const { data: items } = await sb.from('inbox_items')
      .select('id, source_data, connection_id').eq('user_id', uid).eq('source', 'email').eq('status', 'pending')
      .order('created_at', { ascending: false }).limit(300);
    const rows = ((items ?? []) as Array<{ id: string; source_data: Record<string, unknown>; connection_id: string | null }>)
      .filter((it) => {
        // Any pending item lacking a kind — including fast-pathed mail with NO understanding at
        // all. Writing `{ mailKind }` alone is ROUTING-INERT by construction: every routing
        // consumer goes through coerceUnderstanding, which returns null without role+relevance;
        // only the label resolver (resolveKind) reads the raw field. Home-neutral holds.
        const raw = (it.source_data?.understanding ?? null) as { mailKind?: string } | null;
        void coerceUnderstanding; // (kept import — the routing-inert argument above depends on it)
        return !raw?.mailKind;
      }).slice(0, CAP);
    if (!rows.length) continue;

    const { data: conns } = await sb.from('connections').select('id, metadata, provider_account_id').eq('user_id', uid);
    const addrs = ((conns ?? []) as Array<Record<string, unknown>>)
      .map((c) => ((c.metadata as { email?: string } | null)?.email) || (c.provider_account_id as string)).filter(Boolean) as string[];
    if (p.email) addrs.push(p.email);

    let stamped = 0, dist: Record<string, number> = {};
    for (const it of rows) {
      const sd = it.source_data ?? {};
      try {
        const fresh = await computeUnderstanding({
          user_id: uid, id: it.id,
          subject: String(sd.subject || ''), body: String(sd.body || '').slice(0, 4000),
          from_address: String(sd.from_address || ''), from_name: String(sd.from_name || ''),
          to_addresses: (sd.to as string[]) ?? [], cc_addresses: (sd.cc as string[]) ?? [],
          received_at: (sd.received_at as string) ?? null, user_addresses: addrs, recipient_email: addrs[0] ?? null,
        } as never, sb, { useEntityContext: true });
        const kind = fresh?.mailKind;
        if (!kind) continue;
        dist[kind] = (dist[kind] ?? 0) + 1;
        stamped++;
        if (APPLY) {
          const stored = (sd.understanding ?? {}) as Record<string, unknown>;
          await sb.from('inbox_items')
            .update({ source_data: { ...sd, understanding: { ...stored, mailKind: kind } } })
            .eq('id', it.id).eq('user_id', uid);
        }
      } catch { /* per-item non-fatal */ }
    }
    console.log(`══ ${uid.slice(0, 8)} — ${stamped}/${rows.length} kinds ${APPLY ? 'STAMPED' : 'judged (dry-run)'} · ${JSON.stringify(dist)}`);
  }
  process.exit(0);
})();
