import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/activity/log';

// POST /api/restore — undo a reversible action by flipping its entity's status back so the item
// reappears on the Home. The single restore path used by BOTH the transient Home "Undo" toast and
// the Activity-log Undo affordance. RLS-safe (cookie client). Non-fatal: a failed restore returns a
// 4xx/5xx the caller surfaces quietly — it never mutates anything it doesn't own.
//
// Reversibility model (STRICT):
//   • inbox_item — dismissed / marked_done → status='pending' (reappears)
//   • commitment — commitment_done / commitment_dismissed → status='open' (reappears)
//   • sender     — sender_muted → the muted awareness items (fyi/noise) from that sender → 'pending'
// SENDS ARE NOT REVERSIBLE (reply_sent / nudge_sent) — those never reach this route.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { entityType, entityId } = await request.json().catch(() => ({} as { entityType?: string; entityId?: string }));
    if (!entityType || !entityId || typeof entityId !== 'string') {
      return NextResponse.json({ error: 'entityType and entityId required' }, { status: 400 });
    }

    // Bust the cached Home brief so the next load regenerates WITH the restored item. The
    // must-respond synthesis is cached in profiles.home_brief; an item dismissed before the last
    // regen isn't in that cache, so un-hiding it client-side does nothing until the brief is fresh.
    // Undo is infrequent → a regen on next load is fine. Non-fatal: ignore any error.
    const bustBriefCache = async () => {
      try { await supabase.from('profiles').update({ home_brief: null }).eq('id', user.id); } catch { /* non-fatal */ }
    };

    if (entityType === 'inbox_item') {
      // Flip the item back to pending so classifyItem surfaces it again on the Home.
      const { error } = await supabase
        .from('inbox_items')
        .update({ status: 'pending', updated_at: new Date().toISOString() })
        .eq('id', entityId)
        .eq('user_id', user.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      await logActivity(supabase, user.id, {
        type: 'restored',
        title: 'Restored an item',
        entityType: 'inbox_item',
        entityId,
      });
      await bustBriefCache();
      return NextResponse.json({ success: true });
    }

    if (entityType === 'commitment') {
      // Reopen the commitment so it re-enters the Home brief (which reads only status='open').
      const { error } = await supabase
        .from('commitments')
        .update({ status: 'open', updated_at: new Date().toISOString() })
        .eq('id', entityId)
        .eq('user_id', user.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      await logActivity(supabase, user.id, {
        type: 'restored',
        title: 'Restored a commitment',
        entityType: 'commitment',
        entityId,
      });
      await bustBriefCache();
      return NextResponse.json({ success: true });
    }

    if (entityType === 'sender') {
      // Best-effort: un-mute a sender — flip that sender's dismissed awareness (fyi/noise) items back
      // to pending. Mirrors dismiss-sender's matching (from_name OR from). Only touches awareness tiers
      // so it can't accidentally resurface an unrelated needs_reply. entityId = the sender label.
      const sender = entityId;
      for (const col of ['from_name', 'from'] as const) {
        await supabase.from('inbox_items')
          .update({ status: 'pending', updated_at: new Date().toISOString() })
          .eq('user_id', user.id)
          .eq('status', 'dismissed')
          .in('work_state', ['noted', 'noise'])
          .eq(`source_data->>${col}`, sender);
      }

      await logActivity(supabase, user.id, {
        type: 'restored',
        title: `Unmuted sender: ${sender}`,
        entityType: 'sender',
        entityId: sender,
      });
      await bustBriefCache();
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unsupported entityType' }, { status: 400 });
  } catch (error) {
    console.error('Restore error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
