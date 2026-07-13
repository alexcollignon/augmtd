// Backfill `initiative` on existing OPEN commitments (needs migration 20260710b applied first). A light
// per-commitment labeling call (description + counterparty → a deal/client label), normalized to match
// the email labels so a deal's commitments group with its emails. Additive: only sets `initiative`.
//
//   npx tsx scripts/backfill-commitment-initiative.ts            # dry-run
//   npx tsx scripts/backfill-commitment-initiative.ts --apply

import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '../lib/ai/factory';

const USER = '08fe4449-e5eb-431d-9156-02e9324e5903';
const APPLY = process.argv.includes('--apply');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function clean(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && !/^(null|none|n\/a|na|unknown)$/i.test(s) ? s.slice(0, 60) : null;
}

async function main() {
  const { data: commits, error } = await sb.from('commitments')
    .select('id, description, counterparty, initiative').eq('user_id', USER).in('status', ['open', 'pending']);
  if (error) { console.error('Query failed — is migration 20260710b applied?', error.message); process.exit(1); }
  const todo = (commits ?? []).filter((c: any) => !c.initiative && c.description);
  console.log(`[backfill-commitment-initiative] ${todo.length} open commitments to label (${(commits ?? []).length} total)`);
  if (!todo.length) { console.log('nothing to do'); return; }

  const { client, model } = await getAIClient(USER, 'classification', sb);
  let written = 0;
  await Promise.all(todo.map(async (c: any) => {
    try {
      const res = await aiCreate(client, {
        model, response_format: { type: 'json_object' as const }, max_tokens: 60, temperature: 0,
        messages: [{ role: 'user', content: `What deal/client/project is this commitment about? Give a short proper-noun label derived from the commitment itself (the client/company name or named project), or null for a one-off. Different clients → different labels. Never invent a label.\nCommitment: "${c.description}"${c.counterparty ? ` (with ${c.counterparty})` : ''}\nReturn ONLY JSON: {"initiative":"label or null"}` }],
      });
      const init = clean(JSON.parse((res.choices?.[0]?.message?.content || '{}').replace(/```json/gi, '').replace(/```/g, '').trim()).initiative);
      console.log(`  init="${init || '—'}"  ←  ${String(c.description).slice(0, 50)}`);
      if (APPLY && init) { const { error: e } = await sb.from('commitments').update({ initiative: init }).eq('id', c.id).eq('user_id', USER); if (!e) written++; }
    } catch (e) { console.warn('  x', (e as Error).message); }
  }));
  console.log(`\n[backfill-commitment-initiative] written=${written} ${APPLY ? '' : '(dry-run)'}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
