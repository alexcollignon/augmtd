// THE DISMISS DOOR (stabilization W0.3b) — the quiet way out. The row settles as `dismissed`;
// nothing ran, nothing is logged as a deed. Session user only; ownership is the read itself.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { dismissChange } from '@/lib/work/pending-change';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const out = await dismissChange(supabase, user.id, id);
  if (out.status === 'not_found') return NextResponse.json({ error: 'that change is not on file' }, { status: 404 });
  if (out.status === 'not_pending') return NextResponse.json({ error: 'not_pending', reason: 'This change has already been settled.', spec: out.spec }, { status: 409 });
  return NextResponse.json({ ok: true, spec: out.spec });
}
