import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { upsertContacts } from '@/lib/contacts/extract-contacts';

export const maxDuration = 60;

/**
 * POST /api/connections/backfill-contacts
 * One-time endpoint to seed relationship_graph from the existing emails table.
 * Safe to call multiple times — upserts with frequency increment.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Get the user's own email to exclude from contacts
  const { data: connection } = await adminSupabase
    .from('connections')
    .select('metadata, provider_account_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(1)
    .single();

  const userEmail = (connection?.metadata as any)?.email || connection?.provider_account_id || '';

  // Skip if contacts already exist — this is a one-time seed
  const { count: existing } = await adminSupabase
    .from('relationship_graph')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id);
  if ((existing ?? 0) > 0) {
    return NextResponse.json({ message: 'Already seeded', contactsTotal: existing });
  }

  // Read up to 5000 emails from the emails table
  const { data: emails, error: emailsError } = await adminSupabase
    .from('emails')
    .select('from_address, from_name, to_addresses, cc_addresses, received_at')
    .eq('user_id', user.id)
    .order('received_at', { ascending: false })
    .limit(5000);

  if (emailsError) {
    return NextResponse.json({ error: 'Failed to fetch emails' }, { status: 500 });
  }

  if (!emails?.length) {
    return NextResponse.json({ message: 'No emails found', contactsUpserted: 0 });
  }

  await upsertContacts({
    userId: user.id,
    userEmail,
    emails: emails.map(e => ({
      from_address: e.from_address,
      from_name: e.from_name ?? null,
      to_addresses: e.to_addresses ?? null,
      cc_addresses: e.cc_addresses ?? null,
      received_at: e.received_at ?? null,
    })),
    adminSupabase,
  });

  // Count how many contacts we now have
  const { count } = await adminSupabase
    .from('relationship_graph')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id);

  return NextResponse.json({ message: 'Done', emailsProcessed: emails.length, contactsTotal: count ?? 0 });
}
