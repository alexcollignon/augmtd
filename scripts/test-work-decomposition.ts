/**
 * Test script for work decomposition
 *
 * Usage: npx tsx scripts/test-work-decomposition.ts
 */

import { createClient } from '@supabase/supabase-js';
import { decomposeEmailWork } from '@/lib/execution/work-decomposition';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Test cases: Different types of email requests
const testEmails = [
  {
    name: 'Q1 Report Request',
    subject: 'Q1 Revenue Report Needed',
    body: `Hi,

Can you send me the Q1 revenue report by Friday? I need to see the breakdown by region and product line, with year-over-year comparisons.

Thanks!
John`,
    from: 'john@company.com',
  },
  {
    name: 'Board Deck Request',
    subject: 'Board Meeting Next Week',
    body: `Hey,

We have a board meeting next Thursday. Can you prepare a deck with:
- Q4 performance highlights
- Key metrics trends
- 2026 roadmap overview

Let me know if you need anything.

Sarah`,
    from: 'sarah@company.com',
  },
  {
    name: 'Simple Info Request (Not Executable)',
    subject: 'Quick Question',
    body: `Hi,

What time is the team standup tomorrow?

Thanks`,
    from: 'mike@company.com',
  },
  {
    name: 'Analysis Request',
    subject: 'Customer Churn Analysis',
    body: `Could you analyze the customer churn data from last quarter and identify the main reasons people are leaving? I need insights for the strategy meeting on Monday.`,
    from: 'exec@company.com',
  },
  {
    name: 'Weekly Report Request',
    subject: 'Weekly Metrics',
    body: `Please send me the weekly team metrics report - the usual format with project status, velocity, and blockers.`,
    from: 'manager@company.com',
  },
];

async function runTests() {
  console.log('🧪 Testing Work Decomposition\n');
  console.log('='.repeat(60));

  // Get a test user (you'll need to replace with actual user_id)
  const { data: users } = await supabase
    .from('profiles')
    .select('id, email')
    .limit(1);

  if (!users || users.length === 0) {
    console.error('❌ No users found in database');
    process.exit(1);
  }

  const testUserId = users[0].id;
  console.log(`\n📧 Testing with user: ${users[0].email} (${testUserId})\n`);

  // Run decomposition on each test email
  for (const email of testEmails) {
    console.log('\n' + '='.repeat(60));
    console.log(`\n📨 Test: ${email.name}`);
    console.log(`Subject: ${email.subject}`);
    console.log(`From: ${email.from}`);
    console.log(`\nBody:\n${email.body}\n`);

    try {
      const plan = await decomposeEmailWork(
        {
          subject: email.subject,
          body: email.body,
          from: email.from,
        },
        testUserId,
        supabase
      );

      if (plan) {
        console.log('✅ EXECUTABLE - Execution plan generated:\n');
        console.log(`📊 Deliverable: ${plan.deliverable_type}`);
        console.log(`📝 Description: ${plan.deliverable_description}`);
        if (plan.deadline) console.log(`⏰ Deadline: ${plan.deadline}`);
        if (plan.estimated_time) console.log(`⏱️  Estimated: ${plan.estimated_time}`);
        console.log(`\n🔧 Steps (${plan.steps.length}):`);
        plan.steps.forEach(step => {
          console.log(`  ${step.number}. ${step.action}`);
          if (step.skill) console.log(`     Skill: ${step.skill}`);
        });
      } else {
        console.log('⏭️  NOT EXECUTABLE - Skipped (not a deliverable request)');
      }
    } catch (error) {
      console.error('❌ ERROR:', error);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n✅ All tests complete!\n');
}

runTests().catch(console.error);
