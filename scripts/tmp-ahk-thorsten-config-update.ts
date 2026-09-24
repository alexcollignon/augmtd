// ════════════════════════════════════════════════════════════════════════════════════════════════
// In-place config update to Thorsten's EXISTING "AHK Tender Matching" row (8355952a). Owner call:
//   • dedupe        → FALSE
//   • report language → 'en'  (match step config.language + output_config.output_language)
//   • folder_noun   → 'member companies'  (English form)
// Everything else (2-step relay, min_value, schedule, email-from-Max, criteria) is UNTOUCHED.
// Idempotent: reads the row, patches only these fields, updates in place. Never creates a second row.
//
//   npx tsx --env-file=.env.local scripts/tmp-ahk-thorsten-config-update.ts [--apply]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const USER = '9d3921b2-5a52-4b5b-9815-bc49d37ce0a7';
const WF_ID = '8355952a-c2e8-4cb7-98f6-4c4af4a43e42';
const APPLY = process.argv.includes('--apply');

const sb: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

(async () => {
  const { data: wf, error } = await sb.from('workflows')
    .select('id, user_id, name, steps, output_config').eq('id', WF_ID).maybeSingle();
  if (error) throw new Error(error.message);
  if (!wf) throw new Error(`workflow ${WF_ID} not found`);
  if ((wf as any).user_id !== USER) throw new Error('workflow does not belong to Thorsten — refusing');

  const steps = JSON.parse(JSON.stringify((wf as any).steps)) as any[];
  const match = steps.find((s) => s?.tool === 'match_to_profiles');
  if (!match) throw new Error('match_to_profiles step not found');
  match.config = match.config ?? {};
  const beforeStep = { dedupe: match.config.dedupe, language: match.config.language, folder_noun: match.config.folder_noun };
  match.config.dedupe = false;
  match.config.language = 'en';
  match.config.folder_noun = 'member companies';

  const output_config = { ...((wf as any).output_config ?? {}) };
  const beforeOut = output_config.output_language;
  output_config.output_language = 'en';

  console.log(`\n═══ Thorsten ${WF_ID} — ${APPLY ? 'APPLY' : 'dry run'}`);
  console.log('  BEFORE:', JSON.stringify({ ...beforeStep, output_language: beforeOut }));
  console.log('  AFTER :', JSON.stringify({ dedupe: false, language: 'en', folder_noun: 'member companies', output_language: 'en' }));
  if (!APPLY) { console.log('\n(dry run — nothing written)\n'); return; }

  const { error: uErr } = await sb.from('workflows')
    .update({ steps: steps as never, output_config: output_config as never, updated_at: new Date().toISOString() })
    .eq('id', WF_ID);
  if (uErr) throw new Error(uErr.message);
  console.log('  updated in place.\n');
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
