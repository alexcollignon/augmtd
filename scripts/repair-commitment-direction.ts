// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DIRECTION REPAIR (W7.4 — EXTRACTION DIRECTION). GUARDED; DRY-RUN BY DEFAULT.
//
// The retired from-user backstop flipped every user-sent commitment to `awaiting` (it looked for
// "I'll…" in a description the title law forces into the imperative). This census lists the LIVE
// rows whose stored direction contradicts THE DIRECTION FLOOR (lib/commitments/direction.ts) — the
// same pure law the writer now applies. Legacy rows carry no `doer`, so the evidence is the object
// position: "Contact <counterparty> to…" stored `awaiting` is the user's own deed.
//
//   npx tsx scripts/repair-commitment-direction.ts [--user email | --all] [--apply --yes]
//
// ZERO AI. Prints ids + counts + the description's SHAPE only (the counterparty is masked).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { fetchAllRows } from '../lib/utils/fetch-all';
import { directionFloor } from '../lib/commitments/direction';
import type { UserForms } from '../lib/commitments/extraction-truth';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const argv = process.argv;
const APPLY = argv.includes('--apply');
const YES = argv.includes('--yes');
const ALL = argv.includes('--all');
const userArg = argv.includes('--user') ? argv[argv.indexOf('--user') + 1] : null;

type Row = { id: string; direction: string; description: string; counterparty: string | null; source: string | null; status: string };

(async () => {
  if (APPLY && !YES) { console.error('--apply requires --yes (the repair rewrites commitments.direction).'); process.exit(2); }
  const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const targets = ALL || !userArg ? users!.users : users!.users.filter((u) => u.email === userArg);
  const t = { live: 0, awaiting: 0, contradict: 0, bySource: {} as Record<string, number>, users: 0, applied: 0 };

  for (const u of targets) {
    const rows = await fetchAllRows<Row>((from, to) => sb.from('commitments')
      .select('id, direction, description, counterparty, source, status')
      .eq('user_id', u.id).in('status', ['open', 'suggested'])
      .order('id').range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: unknown }>);
    if (!rows.length) continue;
    const [{ data: prof }, { data: conns }, { data: selfP }] = await Promise.all([
      sb.from('profiles').select('full_name, email').eq('id', u.id).maybeSingle(),
      sb.from('connections').select('provider_account_id, metadata').eq('user_id', u.id),
      sb.from('work_entities').select('name, aliases, state').eq('user_id', u.id).eq('kind', 'person').filter('state->>self', 'eq', 'true').limit(1).maybeSingle(),
    ]);
    const forms: UserForms = {
      name: (prof as { full_name?: string } | null)?.full_name ?? (selfP as { name?: string } | null)?.name ?? null,
      aliases: [
        u.email, (prof as { email?: string } | null)?.email,
        ...((conns ?? []) as Array<{ provider_account_id: string | null; metadata: { email?: string } | null }>).flatMap((c) => [c.provider_account_id, c.metadata?.email]),
        ...(((selfP as { aliases?: string[] } | null)?.aliases) ?? []),
      ],
    };
    let hit = 0;
    for (const r of rows) {
      t.live++;
      if (r.direction === 'awaiting') t.awaiting++;
      const f = directionFloor({ direction: r.direction, description: r.description, counterparty: r.counterparty }, forms);
      if (f.direction === r.direction) continue;
      hit++; t.contradict++;
      const src = r.source ?? 'unknown';
      t.bySource[src] = (t.bySource[src] ?? 0) + 1;
      const shape = r.description.split(/\s+/).slice(0, 1).join(' ') + ' <counterparty> …';
      console.log(`  ${r.id.slice(0, 8)} · ${src} · stored ${r.direction} → ${f.direction} (${f.basis}) · "${shape}"`);
      if (APPLY) {
        const { error } = await sb.from('commitments').update({ direction: f.direction }).eq('id', r.id).eq('user_id', u.id);
        if (!error) t.applied++;
      }
    }
    if (hit) t.users++;
  }
  console.log(`\nlive commitments=${t.live} · stored awaiting=${t.awaiting} · contradict the direction floor=${t.contradict} (across ${t.users} users)`);
  console.log(`  by source: ${JSON.stringify(t.bySource)}`);
  console.log(APPLY ? `  applied=${t.applied}` : '  (dry-run — pass --apply --yes to write)');
})();
