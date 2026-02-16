import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(__dirname, '../.env.local') });

import { createClient as createServerClient } from '@supabase/supabase-js';
import { createClient as createBrowserClient } from '../lib/supabase/client';

const userId = 'f2c3451e-6d33-4c04-9343-765e2f8012ab';

async function checkRLS() {
  console.log('🔍 Checking RLS policies\n');

  // Test with service role (bypasses RLS)
  const supabaseAdmin = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Test with anon key (uses RLS)
  const supabaseBrowser = createBrowserClient();

  console.log('1️⃣ Testing inbox_items (with service role - bypasses RLS)');
  const { data: itemsAdmin, error: itemsAdminError } = await supabaseAdmin
    .from('inbox_items')
    .select('id, work_title')
    .eq('user_id', userId)
    .limit(5);

  console.log('   Items found:', itemsAdmin?.length || 0);
  console.log('   Error:', itemsAdminError || 'none');

  console.log('\n2️⃣ Testing connections (with service role)');
  const { data: connectionsAdmin, error: connectionsAdminError } = await supabaseAdmin
    .from('connections')
    .select('provider, status')
    .eq('user_id', userId);

  console.log('   Connections found:', connectionsAdmin?.length || 0);
  console.log('   Error:', connectionsAdminError || 'none');

  console.log('\n3️⃣ Checking if RLS is enabled on tables');
  const { data: rlsStatus } = await supabaseAdmin
    .from('pg_tables')
    .select('tablename, rowsecurity')
    .in('tablename', ['inbox_items', 'connections', 'profiles']);

  console.log('   RLS status:');
  rlsStatus?.forEach(t => {
    console.log(`   - ${t.tablename}: ${t.rowsecurity ? 'ENABLED' : 'DISABLED'}`);
  });

  console.log('\n4️⃣ Listing RLS policies');
  const { data: policies } = await supabaseAdmin.rpc('pg_policies', {}).select('*').in('tablename', ['inbox_items', 'connections']);

  if (!policies) {
    // Fallback query
    const query = `
      SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
      FROM pg_policies
      WHERE tablename IN ('inbox_items', 'connections', 'profiles')
      ORDER BY tablename, policyname;
    `;

    const { data: policiesRaw } = await supabaseAdmin.rpc('exec_sql', { query });
    console.log('   Policies:', policiesRaw);
  } else {
    console.log('   Policies found:', policies.length);
    policies.forEach((p: any) => {
      console.log(`   - ${p.tablename}.${p.policyname} (${p.cmd})`);
    });
  }
}

checkRLS().catch(console.error);
