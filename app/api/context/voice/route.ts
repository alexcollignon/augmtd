import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { setVoiceProfile } from '@/lib/context/voice-profile';

// POST /api/context/voice — write the user's email voice into Memory (context_profiles).
// Voice lives in Memory, not the (deletable, coworker-facing) skills library. The interview's
// voice-kind output routes here; the inbox drafter + coworkers read it via build-user-context.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { content } = (await request.json()) as { content?: string };
  if (!content?.trim()) return NextResponse.json({ error: 'content is required' }, { status: 400 });

  await setVoiceProfile(user.id, content, supabase);
  return NextResponse.json({ ok: true });
}
