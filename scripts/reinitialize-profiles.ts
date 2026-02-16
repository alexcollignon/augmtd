/**
 * Reinitialize profiles with fixed code
 */

import { ProfileLoader } from '@/lib/context/profile-loader';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function reinitialize() {
  const userId = 'f2c3451e-6d33-4c04-9343-765e2f8012ab';
  const fullName = 'Alexandre Collignon';
  const role = 'Founder';
  const email = 'alex@augmtd.ai';

  console.log('🔄 Reinitializing profiles with FIXED code...\n');
  console.log(`User: ${fullName}`);
  console.log(`Role: ${role} → Should map to "executive" authority`);
  console.log(`Email: ${email}\n`);

  await ProfileLoader.initializeUser(userId, fullName, role, email);

  console.log('✓ Profiles initialized!\n');

  // Verify
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: profiles } = await supabase
    .from('context_profiles')
    .select('profile_type, profile_data, confidence_score')
    .eq('user_id', userId)
    .order('profile_type');

  console.log('📊 Verification:\n');
  profiles?.forEach(p => {
    console.log(`${p.profile_type}:`);
    if (p.profile_type === 'identity') {
      console.log(`  authority: ${p.profile_data.authority} ${p.profile_data.authority === 'executive' ? '✅' : '❌'}`);
      console.log(`  role: ${p.profile_data.role}`);
      console.log(`  confidence: ${p.confidence_score}%`);
    }
    if (p.profile_type === 'meeting_behavior') {
      const noMeetingDays = p.profile_data.noMeetingDays;
      const isCorrect = Array.isArray(noMeetingDays) && noMeetingDays.length === 0;
      console.log(`  noMeetingDays: ${JSON.stringify(noMeetingDays)} ${isCorrect ? '✅' : '❌'}`);
    }
    console.log('');
  });
}

reinitialize().catch(console.error);
