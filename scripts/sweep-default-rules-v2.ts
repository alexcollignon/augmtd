// M3 SWEEP (work-surface plan) — retire the v1 AI TAXONOMY default rules ("Marketing",
// "Notifications", "FYI") for users whose STORED rows still carry them UNEDITED. A rule the user
// touched (name or ai_match differs from the v1 seed) is NEVER modified — their rules are theirs.
// Users with no stored rows serve defaults virtually and got v2 the moment defaults.ts changed.
// Dry-run by default; `--apply` deletes the retired rows.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');

// The exact v1 seeds being retired — name + ai_match must BOTH match (unedited) to qualify.
const RETIRED: Array<{ name: string; ai_match: string }> = [
  { name: 'Notifications', ai_match: 'An automated alert, reminder, or confirmation from a system or service.' },
  { name: 'Marketing', ai_match: 'A promotional or commercial email (ads, newsletters, offers).' },
  { name: 'FYI', ai_match: 'Contains useful information relevant to me but does not require a reply.' },
];

(async () => {
  const { data: rules } = await sb.from('inbox_rules').select('id, user_id, name, ai_match, source').eq('source', 'default');
  const rows = (rules ?? []) as Array<{ id: string; user_id: string; name: string; ai_match: string | null; source: string }>;
  let retired = 0, kept = 0;
  for (const r of rows) {
    const seed = RETIRED.find((s) => s.name === r.name);
    if (!seed) continue;
    if ((r.ai_match ?? '').trim() !== seed.ai_match) { kept++; console.log(`  keep (user-edited) [${r.user_id.slice(0, 8)}] "${r.name}"`); continue; }
    retired++;
    console.log(`  ${APPLY ? 'RETIRE' : 'would retire'} [${r.user_id.slice(0, 8)}] "${r.name}"`);
    if (APPLY) await sb.from('inbox_rules').delete().eq('id', r.id);
  }
  console.log(`══ retired:${retired} · kept (edited):${kept}${APPLY ? ' (APPLIED)' : ' (dry-run)'}`);
  process.exit(0);
})();
