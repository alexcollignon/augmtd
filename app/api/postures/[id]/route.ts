// A posture's own door: re-say (re-parses through the authoring door) · toggle · delete.
// Both write through the registry's ONE writer onto the SAME `inbox_rules` row — the surface never
// assembles primitives itself, so the validation floor cannot be routed around.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { updatePosture, deletePosture } from '@/lib/postures/registry';

export const maxDuration = 60;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const res = await updatePosture(supabase, user.id, id, {
    sentence: typeof body.sentence === 'string' ? body.sentence : undefined,
    enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    primitives: body.primitives,
  });
  if (!res.ok) return NextResponse.json({ ok: false, reason: res.reason }, { status: 422 });
  return NextResponse.json({ ok: true, posture: res.posture, understood: res.understood });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const res = await deletePosture(supabase, user.id, id);
  if (!res.ok) return NextResponse.json({ ok: false, reason: res.reason }, { status: 500 });
  return NextResponse.json({ ok: true });
}
