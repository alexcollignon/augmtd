import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { ensureWorkers } from '@/lib/workers/seed';

// POST /api/workers/init — idempotent per worker_role. The catalog + seeding core live in
// lib/workers/seed.ts (shared with the first-look bootstrap that runs on a user's first sync).
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const adminClient = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  try {
    const r = await ensureWorkers(adminClient, user.id);
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'seed failed' }, { status: 500 });
  }
}
