/**
 * Run Profile Migration Script
 *
 * This script runs the modular profiles migration and validates the results.
 * Run with: npx tsx scripts/run-profile-migration.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing Supabase credentials in .env.local');
  console.error('Required variables:');
  console.error('  - NEXT_PUBLIC_SUPABASE_URL');
  console.error('  - SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function runMigration() {
  console.log('🚀 Starting modular profiles migration...\n');

  try {
    // Step 1: Read migration SQL
    const migrationPath = path.join(
      __dirname,
      '../supabase/migrations/20260214_migrate_to_modular_profiles.sql'
    );
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    console.log('📄 Migration file loaded');
    console.log('📊 Running migration SQL...\n');

    // Step 2: Execute migration (using Supabase SQL endpoint)
    // Note: This requires splitting the SQL into statements or using a SQL client
    // For now, we'll provide instructions

    console.log('⚠️  MANUAL STEP REQUIRED:');
    console.log('1. Go to your Supabase Dashboard');
    console.log('2. Navigate to SQL Editor');
    console.log('3. Run the migration file: supabase/migrations/20260214_migrate_to_modular_profiles.sql');
    console.log('4. Come back here and press Enter to validate\n');

    // Wait for user confirmation
    await new Promise(resolve => {
      process.stdin.once('data', resolve);
    });

    // Step 3: Validate migration
    console.log('\n✅ Validating migration...\n');

    // Check if new table exists
    const { data: newTable, error: tableError } = await supabase
      .from('context_profiles')
      .select('count')
      .limit(1);

    if (tableError) {
      console.error('❌ Error: context_profiles table not found');
      console.error(tableError.message);
      return;
    }

    console.log('✓ context_profiles table exists');

    // Count old profiles
    const { count: oldCount } = await supabase
      .from('user_context_profiles')
      .select('*', { count: 'exact', head: true });

    console.log(`✓ Found ${oldCount} users in user_context_profiles`);

    // Count new profiles
    const { count: newCount } = await supabase
      .from('context_profiles')
      .select('*', { count: 'exact', head: true });

    console.log(`✓ Found ${newCount} profiles in context_profiles`);

    // Expected: 3 profiles per user (identity, email_communication, domain_knowledge)
    const expectedCount = (oldCount || 0) * 3;
    if (newCount === expectedCount) {
      console.log(`✅ Perfect! Expected ${expectedCount} profiles, got ${newCount}`);
    } else {
      console.log(`⚠️  Warning: Expected ${expectedCount} profiles, got ${newCount}`);
    }

    // Get breakdown by profile type
    const { data: breakdown } = await supabase
      .from('context_profiles')
      .select('profile_type')
      .then(result => {
        const counts: Record<string, number> = {};
        result.data?.forEach(row => {
          counts[row.profile_type] = (counts[row.profile_type] || 0) + 1;
        });
        return { data: counts };
      });

    console.log('\n📊 Profile type breakdown:');
    Object.entries(breakdown || {}).forEach(([type, count]) => {
      console.log(`   ${type}: ${count}`);
    });

    // Sample a random user to verify data
    const { data: sampleProfiles } = await supabase
      .from('context_profiles')
      .select('user_id, profile_type, confidence_score, learned_from_count')
      .limit(3);

    if (sampleProfiles && sampleProfiles.length > 0) {
      console.log('\n📝 Sample profile:');
      console.log(`   User: ${sampleProfiles[0].user_id}`);
      sampleProfiles.forEach(p => {
        console.log(`   - ${p.profile_type}: ${p.confidence_score}% confident (${p.learned_from_count} signals)`);
      });
    }

    console.log('\n✅ Migration validation complete!');
    console.log('\n📚 Next steps:');
    console.log('1. Test loading profiles with ProfileLoader');
    console.log('2. Update email drafting code to use new structure');
    console.log('3. After validation, run cleanup (rename/drop old table)');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
runMigration()
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
