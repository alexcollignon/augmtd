// TEMP — fuzzy folder resolution + probe tier flip. Never committed.
import { createClient } from '@supabase/supabase-js';
import { executeStep } from '../lib/workflows/execute-step';
import { resolveProbeUser } from './probe-user';

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const uid = await resolveProbeUser(sb);
  await sb.from('tenant_configs').upsert({ user_id: uid, tier: 'bedrock_optimised' }, { onConflict: 'user_id' });
  console.log('probe tier → bedrock_optimised');
  for (const name of ['HR | CV Screening', 'the finance 3 way match folder', 'Credit Review', 'Screening']) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await executeStep(
      { type: 'tool', id: 's1', label: 'read', tool: 'read_kb_folder', config: { folder: name } } as any,
      { userId: uid, supabase: sb, previousOutputs: [], workflowName: 'fuzzy-test' } as any,
    );
    const text = String((out as { output?: unknown }).output ?? '');
    console.log(`"${name}" → ${text.split('\n')[0].slice(0, 100)} [${(text.match(/=== FILE: /g) ?? []).length} sections]`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
