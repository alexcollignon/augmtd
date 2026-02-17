/**
 * Check execution plans in database
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkExecutionPlans() {
  console.log('🔍 Checking executable work items in database...\n');

  const { data, error } = await supabase
    .from('inbox_items')
    .select('id, work_title, is_executable, execution_status, execution_plan, created_at')
    .eq('is_executable', true)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  if (!data || data.length === 0) {
    console.log('⏭️  No executable work items found');
    return;
  }

  console.log(`✅ Found ${data.length} executable work items:\n`);
  console.log('='.repeat(80));

  for (const item of data) {
    console.log(`\n📊 ${item.work_title}`);
    console.log(`   Status: ${item.execution_status}`);
    console.log(`   Created: ${new Date(item.created_at).toLocaleString()}`);

    if (item.execution_plan) {
      const plan = item.execution_plan as any;
      console.log(`\n   📝 Deliverable: ${plan.deliverable_description}`);
      console.log(`   📦 Type: ${plan.deliverable_type}`);
      if (plan.estimated_time) {
        console.log(`   ⏱️  Estimated: ${plan.estimated_time}`);
      }
      if (plan.deadline) {
        console.log(`   ⏰ Deadline: ${plan.deadline}`);
      }

      console.log(`\n   🔧 Steps (${plan.steps?.length || 0}):`);
      plan.steps?.forEach((step: any, i: number) => {
        console.log(`      ${step.number}. ${step.action}`);
        if (step.skill) {
          console.log(`         Skill: ${step.skill}`);
        }
      });
    }

    console.log('\n' + '='.repeat(80));
  }
}

checkExecutionPlans().catch(console.error);
