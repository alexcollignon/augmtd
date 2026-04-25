import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { deleteUserFully } from '@/lib/workspace/cascade-delete';
import { createClient as createAdminClient } from '@supabase/supabase-js';

export async function POST() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    await deleteUserFully(adminClient, user.id);
  } catch (err) {
    console.error('[DeleteSelf] Failed:', err);
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
