/**
 * Smoke-test the stage-2 item-plan generation against REAL items.
 * Usage: npx tsx scripts/test-item-plan.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { generateItemPlan } from '@/lib/home/item-plan';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // Grab a couple of real open commitments + a meeting to plan over.
  const { data: commits } = await supabase
    .from('commitments')
    .select('id, user_id, description, counterparty, status, direction')
    .eq('status', 'open')
    .limit(3);

  if (!commits?.length) { console.log('No open commitments found.'); return; }

  for (const c of commits) {
    const context = `Commitment: ${c.description}\nCounterparty: ${c.counterparty || 'unknown'}\nDirection: ${c.direction || 'n/a'}`;
    console.log('\n════════════════════════════════════════════════════════');
    console.log('ITEM:', c.description);
    console.log('user:', c.user_id, '| counterparty:', c.counterparty);
    try {
      const plan = await generateItemPlan(supabase as any, c.user_id, {
        kind: 'commitment', entityId: c.id, context,
      });
      console.log('TASKS:');
      for (const t of plan.tasks) {
        const tag = t.actor === 'system' ? `✦ SYSTEM${t.capability ? ` (${t.capability})` : ''}` : '○ YOU';
        console.log(`  [${tag}] ${t.text}`);
      }
    } catch (e) {
      console.error('  GENERATION FAILED:', (e as Error).message);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
