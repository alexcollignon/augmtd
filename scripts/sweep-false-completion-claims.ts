// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE FALSE-COMPLETION SWEEP (stabilization W5a · invariant 8 A CLAIM RENDERS). DETERMINISTIC —
// ZERO AI.
//
// Lists every pooled text artifact on an OPEN `you_owe` commitment (a paste pack, a reply/nudge
// draft) whose words announce a deed the facts deny — "I've finished… here's the updated…" with
// nothing done and nothing staged (the fabricated-deed class, found live Sep 23). It asks THE SAME
// predicate the ONE reader asks (`stampTruth` → `claimsUndoneWork`), so the census and the served
// page can never disagree.
//
// Dry-run by default (prints every tripped artifact + the claim). --apply files the artifact into
// the version chain (`metadata.version_of = 'superseded:false-claim'`) so the pass re-prepares under
// the completion floor — nothing else is written. Owner-gated. --user <email> or --all is required.
//   npx tsx scripts/sweep-false-completion-claims.ts [--apply] [--user email] [--all]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { poolRowsToArtifacts, stampTruth, commitmentTruthFacts } from '../lib/prepare/read';
import { completionClaimIn } from '../lib/prepare/truth';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const userArg = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null;

(async () => {
  if (!ALL && !userArg) { console.log('usage: --user <email> | --all  [--apply]'); process.exit(1); }
  const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const targets = ALL ? users!.users : users!.users.filter((u) => u.email === userArg);
  let commitments = 0, artifacts = 0, tripped = 0, written = 0;
  const byKind: Record<string, number> = {};

  for (const u of targets) {
    const { data: cs } = await sb.from('commitments').select('id, description, created_at, status, direction')
      .eq('user_id', u.id).eq('status', 'open').eq('direction', 'you_owe').limit(3000);
    const rows = (cs ?? []) as Array<Record<string, unknown>>;
    if (!rows.length) continue;
    commitments += rows.length;
    const ids = rows.map((c) => String(c.id));
    const pool = new Map<string, Array<Record<string, unknown>>>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data: dels } = await sb.from('item_deliverables')
        .select('id, entity_id, task_id, type, title, content, metadata, created_at')
        .eq('user_id', u.id).eq('kind', 'commitment').in('entity_id', ids.slice(i, i + 200))
        .order('created_at', { ascending: false }).limit(5000);
      for (const d of (dels ?? []) as Array<Record<string, unknown>>) {
        const arr = pool.get(String(d.entity_id)) ?? []; arr.push(d); pool.set(String(d.entity_id), arr);
      }
    }
    for (const c of rows) {
      const drows = pool.get(String(c.id)) ?? [];
      if (!drows.length) continue;
      const arts = stampTruth(poolRowsToArtifacts(drows, 'commitment'), commitmentTruthFacts(c as never));
      for (const a of arts) {
        if (a.kind !== 'reply_draft' && a.kind !== 'nudge_draft' && a.kind !== 'paste_pack') continue;
        artifacts++;
        if (!a.falseClaim) continue;
        tripped++;
        byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
        const claim = completionClaimIn(a.content) ?? '';
        console.log(`  · ${u.email} · "${String(c.description ?? '').slice(0, 60)}" → ${a.kind}${a.by ? ` by ${a.by}` : ''} claims "${claim.slice(0, 60)}"`);
        if (APPLY && a.payload?.store === 'pool' && a.payload.rowId) {
          const rowId = a.payload.rowId;
          const meta = (drows.find((r) => String(r.id) === rowId)?.metadata ?? {}) as Record<string, unknown>;
          const { error } = await sb.from('item_deliverables')
            .update({ metadata: { ...meta, version_of: 'superseded:false-claim' } })
            .eq('id', rowId).eq('user_id', u.id);
          if (error) console.log(`    ✗ write failed: ${error.message}`); else written++;
        }
      }
    }
  }
  console.log(`\nopen you_owe commitments=${commitments} · text artifacts=${artifacts} · false completion claims=${tripped} ${JSON.stringify(byKind)} · written=${written}${APPLY ? '' : ' (dry-run — pass --apply)'}`);
})();
