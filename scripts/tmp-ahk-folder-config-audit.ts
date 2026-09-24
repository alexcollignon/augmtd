// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE AGNOSTIC CLAUSE, W4.4 — folder-config audit for the live AHK workflows.
//
// lib/tenders/member-directory.ts used to hard-code the folder name ('AHK Member companies') and
// the doc source-attribution line ('Quelle: AHK-Mitgliederverzeichnis') as module constants. Both
// are now PARAMETERS with a generic default (DEFAULT_MEMBER_FOLDER_NAME / DEFAULT_MEMBER_SOURCE_
// LABEL); the ops scripts that actually run against the live client (ahk-member-sync.ts,
// ahk-member-enrich.ts) now carry the client's real values as local consts instead of importing
// them from lib.
//
// THIS DOES NOT REQUIRE A LIVE MIGRATION: a workflow step's `config.profiles_folder` / `config.
// folder` is a plain STRING stored on the `workflows` row in the database — it was never sourced
// from the lib constant at run time, so changing the lib's default touches zero live workflows.
// This script is a READ-ONLY audit: it lists every step across the known AHK accounts that binds
// to a folder by name (the same FOLDER_CONFIG_KEYS table lib/knowledge/rename-folder.ts walks) so
// the folder-name assumption baked into this wave's ops scripts ('AHK Member companies') is
// verified against what is actually live, not assumed.
//
// If a folder ever needs to change for a real client, the ONLY safe door is
// lib/knowledge/rename-folder.ts's renameKnowledgeFolder() (THE RENAME HEAL) — it re-points every
// step + the profile manifest atomically. Never hand-edit `workflows.steps` config folder strings
// directly; that is exactly the half-move the heal exists to prevent.
//
// Read-only by construction — there is no --apply. It only prints.
//   npx tsx --env-file=.env.local scripts/tmp-ahk-folder-config-audit.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { FOLDER_CONFIG_KEYS } from '../lib/knowledge/rename-folder';

// The AHK accounts named in CLAUDE.md's THE AHK TWO-AGENT ENGAGEMENT section — the only accounts
// this audit is scoped to. Never a broad table scan.
const AHK_ACCOUNTS = [
  '08fe4449-e5eb-431d-9156-02e9324e5903', // owner-operated
  '9d3921b2-5a52-4b5b-9815-bc49d37ce0a7', // Thorsten
  'de4e8824', // deliberately-unpatched sibling (id prefix as recorded in CLAUDE.md)
];

const sb: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type Step = { id?: string; type?: string; tool?: string; config?: Record<string, unknown> };

(async () => {
  console.log('\n═══ AHK folder-config audit (read-only) ═══\n');
  for (const prefix of AHK_ACCOUNTS) {
    const { data: users } = await sb.from('workflows').select('user_id').ilike('user_id', `${prefix}%`).limit(1);
    const userId = (users?.[0] as { user_id?: string } | undefined)?.user_id ?? prefix;

    const { data: rows, error } = await sb.from('workflows')
      .select('id, name, steps').ilike('user_id', `${prefix}%`);
    if (error) { console.log(`  [${prefix}] query failed: ${error.message}`); continue; }
    if (!rows?.length) { console.log(`  [${prefix}] no workflows found`); continue; }

    console.log(`── ${userId} (${rows.length} workflow${rows.length === 1 ? '' : 's'}) ──`);
    for (const wf of rows as { id: string; name: string; steps: unknown }[]) {
      const steps = Array.isArray(wf.steps) ? (wf.steps as Step[]) : [];
      for (const s of steps) {
        const key = s?.tool ? FOLDER_CONFIG_KEYS[s.tool] : undefined;
        if (!key) continue;
        const val = s.config?.[key];
        console.log(`    "${wf.name}" (${wf.id.slice(0, 8)}) · ${s.tool}.${key} = ${JSON.stringify(val)}`);
      }
    }
  }
  console.log('\n(no writes — this script only reads)\n');
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
