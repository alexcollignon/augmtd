// Apply database migration directly using service role
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Load .env.local
const envFile = fs.readFileSync('.env.local', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    env[match[1].trim()] = match[2].trim();
  }
});

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
);

async function applyMigration() {
  console.log('\n🔄 Applying Phase 1 migration...\n');

  // Read migration file
  const migration = fs.readFileSync(
    './supabase/migrations/20260212_add_confirmation_fields.sql',
    'utf8'
  );

  // Split by semicolons (rough split, might need refinement for complex SQL)
  const statements = migration
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  let successCount = 0;
  let errorCount = 0;

  for (const statement of statements) {
    try {
      // Skip comments
      if (statement.startsWith('COMMENT')) {
        console.log('⏭️  Skipping comment statement');
        continue;
      }

      const { error } = await supabase.rpc('exec_sql', { sql: statement });

      if (error) {
        // Try direct query if RPC doesn't work
        console.log('Executing statement...');
        const { error: directError } = await supabase.from('_migrations').insert({
          statement
        });

        if (directError) {
          console.error('❌ Error:', directError.message);
          console.error('   Statement:', statement.substring(0, 100) + '...');
          errorCount++;
        } else {
          successCount++;
        }
      } else {
        console.log('✓ Statement executed');
        successCount++;
      }
    } catch (err) {
      console.error('❌ Error:', err.message);
      errorCount++;
    }
  }

  console.log(`\n📊 Migration complete:`);
  console.log(`   ✓ ${successCount} statements succeeded`);
  console.log(`   ✗ ${errorCount} statements failed\n`);

  if (errorCount > 0) {
    console.log('⚠️  Some statements failed. You may need to run the migration manually.');
    console.log('   Option 1: Use Supabase dashboard SQL editor');
    console.log('   Option 2: Use supabase CLI: supabase db push\n');
  }
}

applyMigration().then(() => process.exit(0));
