// ════════════════════════════════════════════════════════════════════════════════════════════════
// Rebuild the OWNER's generic profile manifest from the member manifest already on the row.
// ZERO AI, zero portal traffic, no document re-sync — it is a pure re-derivation, which is exactly
// what makes it safe to run whenever the derived shape gains a field (here: the per-profile url).
//
//   npx tsx --env-file=.env.local scripts/tmp-refresh-profile-manifest.ts [--apply]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { readMemberManifest, profileManifestFrom } from '../lib/tenders/member-directory';
import { writeProfileManifest, readProfileManifest } from '../lib/matching/manifest';

// The live client's folder name — see the matching note in ahk-member-sync.ts.
const MEMBER_FOLDER_NAME = 'AHK Member companies';
const OWNER = '08fe4449-e5eb-431d-9156-02e9324e5903';
const FORBIDDEN = ['9d3921b2', 'de4e8824'];
const APPLY = process.argv.includes('--apply');

const sb: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

(async () => {
  if (FORBIDDEN.some((p) => OWNER.startsWith(p))) throw new Error('client account — refused');

  const before = await readProfileManifest(sb, OWNER, MEMBER_FOLDER_NAME);
  console.log(`\nbefore: ${before?.profiles.length ?? 0} profiles · ` +
    `${before?.profiles.filter((p) => !!p.url).length ?? 0} with a url`);

  const member = await readMemberManifest(sb, OWNER);
  if (!member) throw new Error('no member manifest on this account — nothing to re-derive');
  const profile = profileManifestFrom(member, MEMBER_FOLDER_NAME);
  console.log(`derived: ${profile.profiles.length} profiles · ` +
    `${profile.profiles.filter((p) => !!p.url).length} with a url · e.g. ${profile.profiles[0]?.url}`);

  if (!APPLY) { console.log('\n(dry run — nothing written)\n'); return; }
  await writeProfileManifest(sb, OWNER, profile);

  const after = await readProfileManifest(sb, OWNER, MEMBER_FOLDER_NAME);
  console.log(`\nafter:  ${after?.profiles.length ?? 0} profiles · ` +
    `${after?.profiles.filter((p) => !!p.url).length ?? 0} with a url`);
  console.log(`sample: ${after?.profiles[0]?.name} → ${after?.profiles[0]?.url}\n`);
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
