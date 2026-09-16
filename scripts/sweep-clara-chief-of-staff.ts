// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CLARA PROMOTION (owner, Sep 7): Personal Assistant → CHIEF OF STAFF on live rows.
//
// ensureWorkers is INSERT-ONLY (the 085e40e lesson: a seed change never reaches an existing row),
// so a persona rewrite needs its own release step — exactly like the Luca repositioning. This
// updates `description` + `instructions` on every `worker_role='personal_assistant'` worker row to
// the CURRENT seed values. The name (Clara) and the role KEY are never touched — the key is the
// identity (Slack app mapping, email local-parts, AgentOS routing all hang off it).
//
// Idempotent: a row already carrying the current copy is skipped. Dry-run by default.
//
//   npx tsx scripts/sweep-clara-chief-of-staff.ts            # dry-run — lists what would change
//   npx tsx scripts/sweep-clara-chief-of-staff.ts --apply    # writes
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';
import { buildWorkers } from '../lib/workers/seed';

const APPLY = process.argv.includes('--apply');
const ROLE = 'personal_assistant';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('! NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing'); process.exit(1); }
  const sb = createClient(url, key);

  // The seed is the single source of truth for the new copy — never a second transcription here.
  const seed = buildWorkers('00000000-0000-0000-0000-000000000000').find((w) => w.worker_role === ROLE);
  if (!seed) { console.error(`! no seed definition for worker_role='${ROLE}'`); process.exit(1); }
  const description = seed.description;
  const instructions = seed.instructions;

  const { data: rows, error } = await sb
    .from('custom_agents')
    .select('id, user_id, name, description, instructions')
    .eq('worker_role', ROLE)
    .eq('is_worker', true);
  if (error) { console.error(`! read failed: ${error.message}`); process.exit(1); }

  const all = rows ?? [];
  const stale = all.filter((r) => r.description !== description || r.instructions !== instructions);

  console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} — worker_role='${ROLE}': ${all.length} row(s), ${stale.length} stale`);
  for (const r of stale) {
    console.log(`  · user ${r.user_id} — ${r.name}${r.description === description ? '' : ' [description]'}${r.instructions === instructions ? '' : ' [instructions]'}`);
  }
  if (!stale.length) { console.log('nothing to do — every row already carries the chief-of-staff copy.'); process.exit(0); }
  if (!APPLY) { console.log('\n(dry-run — re-run with --apply to write)'); process.exit(0); }

  let updated = 0;
  for (const r of stale) {
    const { error: upErr } = await sb
      .from('custom_agents')
      .update({ description, instructions })   // name + worker_role deliberately untouched
      .eq('id', r.id);
    if (upErr) console.log(`  ! user ${r.user_id}: ${upErr.message}`);
    else { updated++; console.log(`  ✓ user ${r.user_id} — updated`); }
  }
  console.log(`\nupdated ${updated}/${stale.length} row(s)`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
