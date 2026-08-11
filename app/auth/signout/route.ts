import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { getMyWorkspace } from '@/lib/workspace/features';

export async function POST(request: Request) {
  const supabase = await createClient();

  // A sovereign (corporate) member's door is /enterprise, not /login — resolve it
  // BEFORE the session dies. Best-effort: any failure falls back to /login.
  let dest = '/login';
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const ws = await getMyWorkspace(user.id, supabase);
      if (ws?.features.email === false) dest = '/enterprise';
    }
  } catch { /* fall through to /login */ }

  await supabase.auth.signOut();
  return NextResponse.redirect(new URL(dest, request.url), { status: 303 });
}
