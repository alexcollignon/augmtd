// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CHANGE RE-READ DOOR (stabilization W0.3b) — a persisted confirm card is a POINTER, never a
// snapshot. A stored `change_card` turn keeps `{changeId}`; this door re-derives the spec — its
// status against the clock (applied elsewhere, dismissed, expired) — so a reloaded card can never
// offer Apply on a change that already ran.
//
// GET ONLY. Read-only, user-scoped, zero AI. NOT YOURS IS INDISTINGUISHABLE FROM NOT THERE.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { readChange, specOf } from '@/lib/work/pending-change';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rec = await readChange(supabase, user.id, id);
  if (!rec) return NextResponse.json({ error: 'that change is not on file' }, { status: 404 });
  return NextResponse.json({ spec: specOf(rec) });
}
