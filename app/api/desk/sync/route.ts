import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { syncDeskForUser } from '@/lib/desk/sync-desk';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    const { surfaced, needsSynthesis } = await syncDeskForUser(user.id, adminClient);

    // Fire-and-forget synthesis for new/updated cards
    if (needsSynthesis.length > 0) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
      fetch(`${appUrl}/api/desk/synthesize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': req.headers.get('cookie') ?? '',
        },
        body: JSON.stringify({ itemIds: needsSynthesis }),
      }).catch((err) => console.error('[desk/sync] synthesis trigger failed:', err));
    }

    return NextResponse.json({ surfaced, synthesizing: needsSynthesis.length });
  } catch (err) {
    console.error('[/api/desk/sync] Error:', err);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}
