// ════════════════════════════════════════════════════════════════════════════════════════════════
// ONE DEED, READ BACK — the card rehydrates from the stored fact rather than from client state
// (A7's preview law: what was counted is what is done, across a reload and across a device).
// Read-only, user-scoped, zero AI.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { readBulkDeed } from '@/lib/deeds/bulk';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const deed = await readBulkDeed(supabase, user.id, id);
  if (!deed) return NextResponse.json({ error: 'that deed is not on file' }, { status: 404 });
  return NextResponse.json({ deed });
}
