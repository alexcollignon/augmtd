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
      // Flip the item back to pending so classifyItem surfaces it again on the Home. Also CLEAR
      // source_data.resolved_at/resolved_reason — a reopened item is no longer "cleared today", so it
      // must drop out of the Day-cleared ring's count (which keys on that timestamp, not updated_at).
      const { data: pre } = await supabase.from('inbox_items').select('source_data').eq('id', entityId).eq('user_id', user.id).maybeSingle();
      const preSd = { ...((pre?.source_data ?? {}) as Record<string, unknown>) };
      delete preSd.resolved_at;
      delete preSd.resolved_reason;
      delete preSd.resolution_reason;
      const { error } = await supabase
        .from('inbox_items')
        .update({ status: 'pending', source_data: preSd, updated_at: new Date().toISOString() })
        .eq('id', entityId)
        .eq('user_id', user.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      // Name the specific item so the log reads "Restored: <subject>" (not a vague "Restored an item").
      const { data: it } = await supabase.from('inbox_items').select('work_title, source_data').eq('id', entityId).eq('user_id', user.id).maybeSingle();
      const itemTitle = (it?.work_title || (it?.source_data as { subject?: string } | null)?.subject || 'an item') as string;
      await logActivity(supabase, user.id, {
        type: 'restored',
        title: `Restored: ${itemTitle}`,
        entityType: 'inbox_item',
        entityId,
      });
      await bustBriefCache();
      return NextResponse.json({ success: true });
    }

    if (entityType === 'commitment') {
      // Reopen the commitment so it re-enters the Home brief (which reads only status='open'). Also
      // CLEAR resolved_at/resolved_reason so a reopened commitment drops out of the Day-cleared ring.
      // resolved_at/resolved_reason may not exist on older schemas → retry status-only on error.
      let error;
      ({ error } = await supabase
        .from('commitments')
        .update({ status: 'open', resolved_at: null, resolved_reason: null, updated_at: new Date().toISOString() })
        .eq('id', entityId)
        .eq('user_id', user.id));
      if (error) {
        ({ error } = await supabase
          .from('commitments')
          .update({ status: 'open', updated_at: new Date().toISOString() })
          .eq('id', entityId)
          .eq('user_id', user.id));
      }
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      // Name the specific commitment so the log reads "Restored: <description>".
      const { data: c } = await supabase.from('commitments').select('description').eq('id', entityId).eq('user_id', user.id).maybeSingle();
      await logActivity(supabase, user.id, {
        type: 'restored',
        title: `Restored: ${c?.description || 'a commitment'}`,
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
      const nowIso = new Date().toISOString();
      const unmuted = new Set<string>();
      for (const col of ['from_name', 'from'] as const) {
        // Fetch-then-per-row so we can CLEAR each item's source_data.resolved_at (unmuting reopens it,
        // so it must leave the Day-cleared ring). A bulk .update() can't do the per-row jsonb strip.
        const { data: rows } = await supabase.from('inbox_items')
          .select('id, source_data')
          .eq('user_id', user.id)
          .eq('status', 'dismissed')
          .in('work_state', ['noted', 'noise'])
          .eq(`source_data->>${col}`, sender);
        for (const row of (rows ?? []) as Array<{ id: string; source_data: Record<string, unknown> | null }>) {
          if (unmuted.has(row.id)) continue;
          unmuted.add(row.id);
          const sd = { ...((row.source_data ?? {}) as Record<string, unknown>) };
          delete sd.resolved_at;
          delete sd.resolved_reason;
          await supabase.from('inbox_items')
            .update({ status: 'pending', source_data: sd, updated_at: nowIso })
            .eq('id', row.id)
            .eq('user_id', user.id)
            .eq('status', 'dismissed');
        }
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

    if (entityType === 'initiative') {
      // Un-mute an initiative CLUSTER (entityId = the initiative key) → delete its muted_initiatives row so
      // it reappears in In-motion + Projects suggestions. Cluster-only; the underlying items were never
      // touched. Grab the label first so the log reads "Restored: <initiative>".
      const { data: row } = await supabase.from('muted_initiatives').select('label').eq('user_id', user.id).eq('initiative_key', entityId).maybeSingle();
      const { error } = await supabase.from('muted_initiatives').delete().eq('user_id', user.id).eq('initiative_key', entityId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await logActivity(supabase, user.id, {
        type: 'restored',
        title: `Restored: ${row?.label || 'an initiative'}`,
        entityType: 'initiative',
        entityId,
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
