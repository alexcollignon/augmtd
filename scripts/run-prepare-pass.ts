// Run the CURRENT preparation pass for one account — used after a surface reset to regenerate the
// judged + prepared state from scratch under the engine as it exists on this branch.
// Usage: npx tsx scripts/run-prepare-pass.ts <user_id>
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { runPreparationPass } from '../lib/prepare/pass';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const userId = process.argv[2];
if (!userId || !/^[0-9a-f-]{36}$/.test(userId)) { console.error('usage: run-prepare-pass.ts <user_id>'); process.exit(1); }

(async () => {
  const r = await runPreparationPass(sb, userId);
  console.log('pass result:', JSON.stringify(r));
})();
