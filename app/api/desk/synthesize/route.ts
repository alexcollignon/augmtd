import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { synthesizeDeskCard } from '@/lib/desk/synthesize-desk-card';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const itemIds: string[] = body.itemIds ?? [];
  if (itemIds.length === 0) return NextResponse.json({ synthesized: 0 });

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let synthesized = 0;
  for (const itemId of itemIds.slice(0, 20)) { // cap at 20 per call
    try {
      await synthesizeDeskCard(itemId, user.id, adminClient, supabase);
      synthesized++;
    } catch (err) {
      console.error(`[/api/desk/synthesize] Failed for ${itemId}:`, err);
    }
  }

  return NextResponse.json({ synthesized });
}
