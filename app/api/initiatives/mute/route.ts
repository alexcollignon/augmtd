import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/activity/log';

// POST /api/initiatives/mute — mark an initiative CLUSTER "not relevant". Persistent + revive-able (the
// spine reappears it when new activity post-dates muted_at, see lib/projects/active-initiatives.ts).
// Cluster-only: it never touches the underlying emails/commitments — only hides the GROUPING from the Home
// "In motion" strip + Projects suggestions. Logs to the Activity timeline (undoable via /api/restore) and
// feeds the brain's learning layer (the curation is a preference signal). RLS-safe (cookie client).
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { key, label } = await request.json().catch(() => ({} as { key?: string; label?: string }));
    if (!key || typeof key !== 'string') return NextResponse.json({ error: 'key required' }, { status: 400 });
    const cleanLabel = (label && typeof label === 'string' ? label : key).slice(0, 200);

    const { error } = await supabase.from('muted_initiatives').upsert(
      { user_id: user.id, initiative_key: key, label: cleanLabel, muted_at: new Date().toISOString() },
      { onConflict: 'user_id,initiative_key' },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Activity timeline — undoable (initiative_muted → restore un-mutes).
    await logActivity(supabase, user.id, {
      type: 'initiative_muted',
      title: `Marked "${cleanLabel}" not relevant`,
      entityType: 'initiative',
      entityId: key,
      metadata: { label: cleanLabel },
    });
    // Brain learning signal — the curation is a preference ("this cluster isn't my work"). Best-effort;
    // reuses the generic 'action_taken' type (no new CHECK-constraint value needed). Non-fatal.
    await supabase.from('learning_signals').insert({
      user_id: user.id, inbox_item_id: null, signal_type: 'action_taken',
      signal_data: { action: 'initiative_muted', initiative_key: key, label: cleanLabel },
    }).then(() => {}, () => {});

    // Bust the cached Home brief so In-motion recomputes WITHOUT the muted initiative on next load.
    try { await supabase.from('profiles').update({ home_brief: null }).eq('id', user.id); } catch { /* non-fatal */ }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Initiative mute error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
