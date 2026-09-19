// THE AUTHORING DOOR — parse one sentence into validated primitives, WITHOUT writing anything.
// The surface calls this to show "understood as: …" before the user confirms. Classification tier
// (the factory, never a raw client); the code-validation floor lives in the registry, not here.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { parsePostureSentence } from '@/lib/postures/registry';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const res = await parsePostureSentence(supabase, user.id, String(body.sentence ?? ''));
  if (!res.ok) return NextResponse.json({ ok: false, reason: res.reason }, { status: 422 });
  return NextResponse.json({ ok: true, primitives: res.primitives, sentence: res.sentence, understood: res.understood });
}
