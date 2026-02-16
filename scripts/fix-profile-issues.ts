/**
 * Fix profile issues:
 * 1. meeting_behavior.noMeetingDays = [] (empty, not all days)
 * 2. identity.authority = "executive" (based on Founder role)
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase credentials in environment variables');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function fixProfiles() {
  console.log('🔧 Fixing profile issues...\n');

  // Get user ID (you)
  const { data: users, error: usersError } = await supabase
    .from('profiles')
    .select('id, email, full_name')
    .eq('email', 'alex@augmtd.ai')
    .single();

  if (usersError || !users) {
    console.error('❌ Could not find user:', usersError);
    return;
  }

  const userId = users.id;
  console.log(`✓ Found user: ${users.full_name} (${users.email})`);
  console.log(`  User ID: ${userId}\n`);

  // Fix 1: meeting_behavior.noMeetingDays
  console.log('1️⃣  Fixing meeting_behavior.noMeetingDays...');

  const { data: meetingProfile, error: meetingError } = await supabase
    .from('context_profiles')
    .select('profile_data')
    .eq('user_id', userId)
    .eq('profile_type', 'meeting_behavior')
    .single();

  if (meetingError || !meetingProfile) {
    console.error('   ❌ Could not load meeting_behavior profile:', meetingError);
  } else {
    const updatedMeetingData = {
      ...meetingProfile.profile_data,
      noMeetingDays: [], // Clear the incorrect all-days value
    };

    const { error: updateError } = await supabase
      .from('context_profiles')
      .update({
        profile_data: updatedMeetingData,
        last_updated: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('profile_type', 'meeting_behavior');

    if (updateError) {
      console.error('   ❌ Failed to update:', updateError);
    } else {
      console.log('   ✓ Fixed: noMeetingDays = [] (empty array)');
      console.log('     Was: ["Monday", "Tuesday", ..., "Sunday"]');
      console.log('     Now: []\n');
    }
  }

  // Fix 2: identity.authority
  console.log('2️⃣  Fixing identity.authority...');

  const { data: identityProfile, error: identityError } = await supabase
    .from('context_profiles')
    .select('profile_data')
    .eq('user_id', userId)
    .eq('profile_type', 'identity')
    .single();

  if (identityError || !identityProfile) {
    console.error('   ❌ Could not load identity profile:', identityError);
  } else {
    const updatedIdentityData = {
      ...identityProfile.profile_data,
      authority: 'executive', // Founder = executive level authority
    };

    const { error: updateError } = await supabase
      .from('context_profiles')
      .update({
        profile_data: updatedIdentityData,
        confidence_score: 95.0, // High confidence - explicit role
        last_updated: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('profile_type', 'identity');

    if (updateError) {
      console.error('   ❌ Failed to update:', updateError);
    } else {
      console.log('   ✓ Fixed: authority = "executive"');
      console.log('     Was: "unknown"');
      console.log('     Now: "executive" (based on Founder role)');
      console.log('   ✓ Updated confidence_score to 95% (high confidence)\n');
    }
  }

  // Verify updates
  console.log('🔍 Verifying updates...\n');

  const { data: updatedProfiles, error: verifyError } = await supabase
    .from('context_profiles')
    .select('profile_type, profile_data, confidence_score')
    .eq('user_id', userId)
    .in('profile_type', ['meeting_behavior', 'identity']);

  if (verifyError || !updatedProfiles) {
    console.error('❌ Could not verify updates:', verifyError);
  } else {
    updatedProfiles.forEach(profile => {
      console.log(`${profile.profile_type}:`);
      if (profile.profile_type === 'meeting_behavior') {
        console.log(`  noMeetingDays: ${JSON.stringify(profile.profile_data.noMeetingDays)}`);
      } else if (profile.profile_type === 'identity') {
        console.log(`  authority: ${profile.profile_data.authority}`);
        console.log(`  confidence_score: ${profile.confidence_score}%`);
      }
      console.log('');
    });
  }

  console.log('✅ Profile fixes complete!');
}

fixProfiles().catch(console.error);
