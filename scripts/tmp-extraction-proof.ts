// Direct-door proof of the extraction fallback: a PROSE-ONLY previous output (no fence anywhere)
// through executeMatchToProfiles against the real profile folder. Owner account, dedupe OFF so the
// proof never consumes the seen-set. Fabricated companies only.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { executeMatchToProfiles } from '../lib/tools/match-to-profiles';

const OWNER = '08fe4449-e5eb-431d-9156-02e9324e5903';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const PROSE = `# Weekly opportunity round-up

No structured hand-over here — just what the last step wrote.

1. **Município de Exemplo** has opened a tender for the rehabilitation of a municipal water supply
   and sewage network, including trenching, pipe laying and road resurfacing across two parishes.
   Estimated value €2,100,000. Bids close 2026-11-14.

2. **Hospital Regional de Amostra** is calling for the supply, installation and maintenance of
   laboratory analysers and diagnostic imaging equipment for its pathology department, €780,000,
   deadline 2026-12-01.

3. **Autoridade de Exemplo dos Transportes** seeks a supplier of railway signalling and traction
   power equipment for a suburban line upgrade, €4,300,000, closing 2026-11-28.
`;

(async () => {
  const out = await executeMatchToProfiles(
    { profiles_folder: 'AHK Member companies', max_matches_per_item: 3, language: 'en', dedupe: false },
    { userId: OWNER, supabase: sb, previousOutputs: [{ output: PROSE }] },
  );
  console.log('\n──────── the report, first 14 lines ────────');
  console.log(out.split('\n').slice(0, 14).join('\n'));
  console.log('\n──────── sample match lines ────────');
  out.split('\n').filter(l => /^- \*\*\[/.test(l)).slice(0, 3).forEach(l => console.log(l));
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
