/**
 * Debug Attendee Integration
 *
 * Run with: npx tsx scripts/debug-attendee.ts
 */

import dotenv from 'dotenv';
import { resolve } from 'path';

// Load .env.local
dotenv.config({ path: resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import { createBotsForCalendarEvents } from '../lib/integrations/attendee/bot-manager';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function debugAttendee() {
  const userId = 'f2c3451e-6d33-4c04-9343-765e2f8012ab';

  console.log('🔍 Debugging Attendee Integration\n');

  // 1. Check if Attendee is enabled
  console.log('1️⃣ Checking if Attendee is enabled...');
  const { data: profile } = await supabase
    .from('profiles')
    .select('attendee_enabled')
    .eq('id', userId)
    .single();

  console.log(`   attendee_enabled: ${profile?.attendee_enabled}`);

  if (!profile?.attendee_enabled) {
    console.log('   ❌ Attendee is NOT enabled. Go to Settings and toggle it on.\n');
    return;
  }
  console.log('   ✅ Attendee is enabled\n');

  // 2. Check API key
  console.log('2️⃣ Checking API key...');
  const hasApiKey = !!process.env.ATTENDEE_API_KEY;
  console.log(`   ATTENDEE_API_KEY configured: ${hasApiKey}`);

  if (!hasApiKey) {
    console.log('   ❌ ATTENDEE_API_KEY not set in environment\n');
    return;
  }
  console.log('   ✅ API key is configured\n');

  // 3. Check for meetings without bots
  console.log('3️⃣ Checking for meetings without bots...');
  const now = new Date();
  const twoWeeksFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const { data: events } = await supabase
    .from('calendar_events')
    .select('id, title, meeting_link, start_time, attendee_bot_id')
    .eq('user_id', userId)
    .gte('start_time', now.toISOString())
    .lte('start_time', twoWeeksFromNow.toISOString())
    .is('attendee_bot_id', null)
    .not('meeting_link', 'is', null);

  console.log(`   Found ${events?.length || 0} meetings without bots:`);
  events?.forEach(e => {
    console.log(`   - ${e.title} (${e.start_time})`);
    console.log(`     Link: ${e.meeting_link}`);
  });
  console.log();

  // 4. Try to create bots
  console.log('4️⃣ Attempting to create bots...');
  try {
    const result = await createBotsForCalendarEvents(userId, supabase);
    console.log(`   ✅ Created ${result.created} bots`);

    if (result.errors.length > 0) {
      console.log('   ❌ Errors:');
      result.errors.forEach(err => console.log(`      - ${err}`));
    }
  } catch (error) {
    console.log('   ❌ Error creating bots:', error);
  }
  console.log();

  // 5. Check calendar events again
  console.log('5️⃣ Checking calendar events after bot creation...');
  const { data: updatedEvents } = await supabase
    .from('calendar_events')
    .select('id, title, attendee_bot_id, attendee_bot_state')
    .eq('user_id', userId)
    .gte('start_time', now.toISOString())
    .not('meeting_link', 'is', null)
    .order('start_time', { ascending: true })
    .limit(5);

  console.log(`   Recent meetings with links:`);
  updatedEvents?.forEach(e => {
    console.log(`   - ${e.title}`);
    console.log(`     Bot ID: ${e.attendee_bot_id || '(none)'}`);
    console.log(`     Bot State: ${e.attendee_bot_state || '(none)'}`);
  });
}

debugAttendee().catch(console.error);
