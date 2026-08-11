import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { ProfileLoader } from '@/lib/context/profile-loader';

// ─── THE INTRO STEP (enterprise onboarding) ──────────────────────────────────────────────────
// Thirty seconds after joining: name + role + what the work involves. Feeds the SAME identity
// context profile every planning/generation/chat prompt reads (buildUserContextBlock's
// "ABOUT YOU" block) — real context from minute one, not a form that goes nowhere. Sovereign
// workspaces have no mailbox to learn from, so this is often the ONLY identity signal at start.

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { fullName?: string; role?: string; focus?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }

  const fullName = String(body.fullName ?? '').trim().slice(0, 120);
  const role = String(body.role ?? '').trim().slice(0, 120);
  const focus = String(body.focus ?? '').trim().slice(0, 240);
  if (!fullName) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // The display name — coworker email signatures, report-backs, and the UI all read this.
  await admin.from('profiles').update({ full_name: fullName }).eq('id', user.id);

  // Identity + email-style defaults via the one existing initializer (merge-safe upsert).
  try {
    await ProfileLoader.initializeUser(user.id, fullName, role, user.email ?? '');
  } catch (e) {
    console.error('[user/intro] initializeUser failed:', e);
  }

  // The focus line lands as identity responsibilities — rendered verbatim in "ABOUT YOU".
  if (focus) {
    try {
      const { data: existing } = await admin
        .from('context_profiles')
        .select('profile_data')
        .eq('user_id', user.id)
        .eq('profile_type', 'identity')
        .maybeSingle();
      const responsibilities = focus
        .split(/[,;]/)
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, 5);
      await admin
        .from('context_profiles')
        .update({ profile_data: { ...(existing?.profile_data ?? {}), responsibilities } })
        .eq('user_id', user.id)
        .eq('profile_type', 'identity');
    } catch (e) {
      console.error('[user/intro] responsibilities merge failed:', e);
    }
  }

  return NextResponse.json({ ok: true });
}
