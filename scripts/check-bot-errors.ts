import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(__dirname, '../.env.local') });

import { getAttendeeBot } from '../lib/integrations/attendee/client';

const failedBots = [
  'bot_vpBrXexSTa8Le3fF',
  'bot_lspH563vkNInobFB',
  'bot_BObJkL1S4fPxB5IA',
  'bot_X0YWABja9jztlGiV',
  'bot_isZfTyN3MdpKSF1A',
  'bot_T6V8XKk4wQK3kljQ',
];

async function checkBotErrors() {
  console.log('🔍 Checking failed bots for error details\n');

  for (const botId of failedBots) {
    console.log(`\nBot: ${botId}`);
    console.log('─'.repeat(50));

    try {
      const bot = await getAttendeeBot(botId);
      console.log('Status:', JSON.stringify(bot, null, 2));
    } catch (error: any) {
      console.log('Error fetching bot:', error.message);
      console.log('Full error:', error);
    }
  }
}

checkBotErrors().catch(console.error);
