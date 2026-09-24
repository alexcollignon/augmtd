// ─── TEMP PURGE: the owner's hand-selected test accounts (Aug 31) — never committed ──────────
// Deletes EXACTLY the nine accounts the owner checked in the Supabase auth dashboard, via the
// platform's own deleteUserFully (storage → delete_user_account RPC → auth row) — runs, threads,
// KB, inbox, everything cascades. HARD ALLOWLIST: any account not on this list is untouchable.
//
// Dry-run: npx tsx --env-file=.env.local scripts/tmp-purge-selected-users.ts
// Execute: npx tsx --env-file=.env.local scripts/tmp-purge-selected-users.ts --execute
import { createClient } from '@supabase/supabase-js';

const SELECTED = [
  'smoke-probe-2@augmtd-internal.test',
  'mariamabozaid000@gmail.com',
  'themoonlight.noor@gmail.com',
  'mariamabozaid91@gmail.com',
  'noura.elsayed.mohamed@gmail.com',
  'arashad.psn@gmail.com',
  'smoke-probe@augmtd-internal.test', // the probe host — resolveProbeUser re-provisions on next smoke run
  'aymanmfawzy@gmail.com',
  'mahmoudmadylancer@gmail.com',
];

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const execute = process.argv.includes('--execute');

  // Resolve emails → ids from the auth admin API (never trust hand-copied uuids).
  const byEmail = new Map<string, string>();
  for (let page = 1; page <= 10; page++) {
    const { data } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    for (const u of data?.users ?? []) if (u.email && SELECTED.includes(u.email)) byEmail.set(u.email, u.id);
    if (!data?.users?.length || data.users.length < 200) break;
  }

  console.log(`${execute ? 'EXECUTING' : 'DRY RUN'} — ${byEmail.size}/${SELECTED.length} selected accounts found\n`);
  for (const email of SELECTED) {
    const id = byEmail.get(email);
    if (!id) { console.log(`  · ${email} — not found (already gone)`); continue; }
    const count = async (table: string) =>
      (await sb.from(table).select('id', { count: 'exact', head: true }).eq('user_id', id)).count ?? 0;
    const [emails, items, runs, threads, kb, ents] = await Promise.all([
      count('emails'), count('inbox_items'), count('workflow_runs'), count('work_threads'),
      count('knowledge_files'), count('work_entities'),
    ]);
    const { data: mem } = await sb.from('company_members').select('company_id, companies(name)').eq('user_id', id);
    const cos = (mem ?? []).map((m) => (m.companies as { name?: string } | null)?.name ?? m.company_id).join(', ') || 'none';
    console.log(`  · ${email} (${id.slice(0, 8)}) — companies: ${cos} | emails ${emails} · items ${items} · runs ${runs} · threads ${threads} · kb ${kb} · entities ${ents}`);

    if (execute) {
      try {
        const { deleteUserFully } = await import('../lib/workspace/cascade-delete');
        await deleteUserFully(sb, id);
        console.log(`    → DELETED`);
      } catch (e) {
        console.log(`    → FAILED: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  if (!execute) console.log('\nNothing deleted. Re-run with --execute to purge the above.');
}

main().catch((e) => { console.error(e); process.exit(1); });
