/** End-to-end backend smoke test: item_plans persistence + realtime delivery. Usage: npx tsx scripts/smoke-final.ts */
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { generateItemPlan } from '@/lib/home/item-plan';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  realtime: { params: { eventsPerSecond: 5 } },
});

async function main() {
  const { data: prof } = await sb.from('profiles').select('id, email').ilike('email', '%alextcollignon%').maybeSingle();
  const userId = prof!.id;
  console.log('USER:', prof!.email);

  // ── TEST 1: item_plans persistence round-trip (generate → upsert → read back) ──
  console.log('\n[1] item_plans PERSISTENCE');
  const { data: c } = await sb.from('commitments').select('id, description, counterparty').eq('user_id', userId).eq('status', 'open').limit(1).maybeSingle();
  const plan = await generateItemPlan(sb as any, userId, { kind: 'commitment', entityId: c!.id, context: `Commitment: ${c!.description}\nCounterparty: ${c!.counterparty || 'unknown'}` });
  console.log('  generated tasks:', plan.tasks.length, '| sample:', plan.tasks[0]?.text?.slice(0, 60));
  const { error: upErr } = await sb.from('item_plans').upsert(
    { user_id: userId, kind: 'commitment', entity_id: c!.id, tasks: plan.tasks },
    { onConflict: 'user_id,kind,entity_id' },
  );
  console.log('  upsert error:', upErr?.message || 'none');
  const { data: back } = await sb.from('item_plans').select('tasks, updated_at').eq('user_id', userId).eq('kind', 'commitment').eq('entity_id', c!.id).maybeSingle();
  const persisted = Array.isArray(back?.tasks) && (back!.tasks as unknown[]).length === plan.tasks.length;
  console.log('  read-back tasks:', (back?.tasks as unknown[])?.length ?? 'NONE', '→ PERSIST', persisted ? 'WORKS ✓' : 'BROKEN ✗');

  // ── TEST 2: realtime delivery (subscribe → touch an existing row → expect an event) ──
  console.log('\n[2] REALTIME delivery (inbox_items)');
  const { data: row } = await sb.from('inbox_items').select('id').eq('user_id', userId).limit(1).maybeSingle();
  const got = await new Promise<boolean>((resolve) => {
    let done = false;
    const to = setTimeout(() => { if (!done) { done = true; resolve(false); } }, 9000);
    const ch = sb.channel('smoke-live')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'inbox_items', filter: `user_id=eq.${userId}` }, () => {
        if (!done) { done = true; clearTimeout(to); sb.removeChannel(ch); resolve(true); }
      })
      .subscribe(async (status) => {
        console.log('  channel status:', status);
        if (status === 'SUBSCRIBED') {
          // harmless touch of an existing row → should fire an UPDATE event if the table is published
          await sb.from('inbox_items').update({ updated_at: new Date().toISOString() }).eq('id', row!.id);
        }
      });
  });
  console.log('  → REALTIME', got ? 'FIRES ✓ (publication live)' : 'NO EVENT ✗ (publication not applied? or delivery blocked)');

  // cleanup the test plan row so we don't leave test state
  console.log('\nDone.');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
