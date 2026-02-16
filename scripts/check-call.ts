import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import { createAttendeeBot } from '../lib/integrations/attendee/client';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkCall() {
  const { data: callEvent } = await supabase
    .from('calendar_events')
    .select('*')
    .eq('title', 'Call')
    .eq('user_id', 'f2c3451e-6d33-4c04-9343-765e2f8012ab')
    .single();

  if (!callEvent) {
    console.log('❌ Call meeting not found');
    return;
  }

  console.log('📞 Call meeting found:');
  console.log('   Title:', callEvent.title);
  console.log('   Start:', callEvent.start_time);
  console.log('   End:', callEvent.end_time);
  console.log('   Link:', callEvent.meeting_link);
  console.log('   Bot ID:', callEvent.attendee_bot_id || '(none)');
  console.log('   Bot State:', callEvent.attendee_bot_state || '(none)');

  const now = new Date();
  const start = new Date(callEvent.start_time);
  const end = new Date(callEvent.end_time);

  console.log('\n⏰ Time check:');
  console.log('   Now:', now.toISOString());
  console.log('   Meeting start:', start.toISOString());
  console.log('   Meeting end:', end.toISOString());

  const status = now < start ? 'Upcoming' : now > end ? 'Ended' : 'In progress';
  console.log('   Status:', status);

  if (!callEvent.attendee_bot_id && callEvent.meeting_link) {
    console.log('\n🤖 Creating bot for Call meeting...');
    try {
      const bot = await createAttendeeBot(callEvent.meeting_link, 'AUGMTD Assistant');
      console.log('   Bot created:', bot.id);
      console.log('   Bot state:', bot.state);

      await supabase
        .from('calendar_events')
        .update({
          attendee_bot_id: bot.id,
          attendee_bot_state: bot.state,
          attendee_bot_created_at: new Date().toISOString(),
        })
        .eq('id', callEvent.id);

      console.log('   ✅ Bot saved to database');
      console.log('\nThe bot should join the meeting now!');
      console.log('Check the meeting participants for "AUGMTD Assistant"');
    } catch (error: any) {
      console.error('   ❌ Error creating bot:', error.message);
    }
  } else if (callEvent.attendee_bot_id) {
    console.log('\n✅ Bot already exists for this meeting');
    console.log('   Bot ID:', callEvent.attendee_bot_id);
    console.log('   Bot State:', callEvent.attendee_bot_state);
    console.log('\nIf the bot isn\'t showing in the meeting, it might be:');
    console.log('   - Still joining (state: joining)');
    console.log('   - Meeting ended before bot could join');
    console.log('   - Attendee.dev API issue');
  } else {
    console.log('\n❌ No meeting link found');
  }
}

checkCall().catch(console.error);
