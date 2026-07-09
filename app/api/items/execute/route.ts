import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { executeSendCalendarInvite } from '@/lib/tools/send-calendar-invite';
import { executeForwardEmail } from '@/lib/tools/forward-email';
import { logActivity } from '@/lib/activity/log';
import type { ItemPlanKind, ItemPlanTask } from '@/lib/home/item-plan';

export const maxDuration = 60;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// POST /api/items/execute — stage 3a "commit" half of prepare → approve → commit.
//
// ⚠️ SAFETY INVARIANT: this route COMMITS an irreversible action (sends a real calendar invite). It is
// ONLY ever called from an explicit user APPROVE click on the prepared action card — never auto-fired,
// never chained. Nothing here runs without that click.
//
// Body: { kind, entityId, taskId, action }
//   action = { type:'calendar_invite', title, startISO, endISO, attendees[], description?, timezone? }
//     — the (possibly user-EDITED) params from the InvitePreviewCard. We send via the SAME executor a
//     workflow tool step / coworker would use (`executeSendCalendarInvite`) → resolves the user's
//     Google/Outlook connection → real event + attendee notifications.
//
// On success: mark the step done:true in the plan (so the stepper shows ✓), log an activity event
// (Activity panel), and return { ok:true, result }. Non-fatal on the side-effects (done/log) — a sent
// invite is never lost to a failed bookkeeping write.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const VALID_KINDS: ItemPlanKind[] = ['email', 'meeting', 'commitment', 'awareness', 'followup'];

type CalendarInviteAction = {
  type: 'calendar_invite';
  title: string;
  startISO: string;
  endISO: string;
  attendees: string[];
  description?: string;
  location?: string;
  timezone?: string;
  includeMeetLink?: boolean;
};

// The S5 send-type — a forward, gated the same way as the invite (approve-before-commit).
type ForwardAction = {
  type: 'forward';
  to: string[];
  cc?: string[];
  note?: string;
};

type ExecuteAction = CalendarInviteAction | ForwardAction;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await request.json()) as { kind: ItemPlanKind; entityId: string; taskId?: string; action: ExecuteAction };
    const { kind, entityId, taskId, action } = body;
    if (!entityId || !VALID_KINDS.includes(kind)) {
      return NextResponse.json({ error: 'kind and entityId are required' }, { status: 400 });
    }
    if (!action || (action.type !== 'calendar_invite' && action.type !== 'forward')) {
      return NextResponse.json({ error: 'unsupported action type' }, { status: 400 });
    }

    // ── FORWARD (S5 send-type) — the same approve-before-commit gate as the invite, a different executor.
    // Only ever reached from an explicit Approve click on the ForwardPreviewCard. Never auto-fired.
    if (action.type === 'forward') {
      const to = Array.isArray(action.to) ? action.to.map((a) => String(a).trim()).filter((a) => a.includes('@')) : [];
      const cc = Array.isArray(action.cc) ? action.cc.map((a) => String(a).trim()).filter((a) => a.includes('@')) : [];
      if (to.length === 0) return NextResponse.json({ error: 'Add at least one recipient before forwarding.' }, { status: 400 });

      // COMMIT — the real forward (user already approved). Same executor a workflow tool step would use.
      const result = await executeForwardEmail(
        { threadId: entityId, to, cc, note: action.note || '' },
        user.id,
        supabase,
      );
      const failed = /^(Cannot|Failed)\b/.test(result);
      if (failed) return NextResponse.json({ ok: false, error: result }, { status: 502 });

      // Mark the step done (best-effort — a sent forward is never lost to a bookkeeping failure).
      if (taskId) {
        try {
          const { data: row } = await supabase
            .from('item_plans').select('tasks')
            .eq('user_id', user.id).eq('kind', kind).eq('entity_id', entityId).maybeSingle();
          if (row && Array.isArray(row.tasks)) {
            const tasks = (row.tasks as ItemPlanTask[]).map((t) => (t.id === taskId ? { ...t, done: true } : t));
            await supabase.from('item_plans')
              .update({ tasks, updated_at: new Date().toISOString() })
              .eq('user_id', user.id).eq('kind', kind).eq('entity_id', entityId);
          }
        } catch (e) {
          console.error('[items/execute] forward mark-done failed (non-fatal):', e);
        }
      }

      await logActivity(supabase, user.id, {
        type: 'message_sent',
        title: `Forwarded to ${to[0]}${to.length > 1 ? ` +${to.length - 1}` : ''}`,
        entityType: kind,
        entityId,
        metadata: { forwarded: true, recipients: to.length + cc.length, result },
      });

      return NextResponse.json({ ok: true, result });
    }

    // Validate the committable params BEFORE firing (approve-before-commit strictness — a bad card
    // never sends a broken invite; the user is told to complete it).
    const title = (action.title || '').trim();
    const startISO = (action.startISO || '').trim();
    const endISO = (action.endISO || '').trim();
    const attendees = Array.isArray(action.attendees)
      ? action.attendees.map((a) => String(a).trim()).filter((a) => a.includes('@'))
      : [];
    if (!title) return NextResponse.json({ error: 'Add a title before sending the invite.' }, { status: 400 });
    if (!startISO || !endISO || isNaN(new Date(startISO).getTime()) || isNaN(new Date(endISO).getTime())) {
      return NextResponse.json({ error: 'Set a valid date and time before sending the invite.' }, { status: 400 });
    }
    if (attendees.length === 0) {
      return NextResponse.json({ error: 'Add at least one attendee before sending the invite.' }, { status: 400 });
    }

    // ── COMMIT — the ONE real irreversible call (user already approved). Same executor as workflows.
    const result = await executeSendCalendarInvite(
      {
        title, startISO, endISO, attendees,
        description: action.description || '',
        location: action.location || '',
        timezone: action.timezone || 'UTC',
        includeMeetLink: action.includeMeetLink !== false,
      },
      user.id,
      supabase,
    );

    // The executor is non-throwing: a failure comes back as a "Cannot…/Failed…" string. Surface it as
    // an error so the card shows it (and we do NOT mark the step done).
    const failed = /^(Cannot|Failed)\b/.test(result);
    if (failed) {
      return NextResponse.json({ ok: false, error: result }, { status: 502 });
    }

    // ── Mark the step done in the plan (best-effort — a sent invite is never lost to a bookkeeping
    // failure). A [System] step carries `done:true` so the stepper renders a ✓ (this is the first
    // [System]-done write; the [You] checkbox path is separate in /api/items/plan).
    if (taskId) {
      try {
        const { data: row } = await supabase
          .from('item_plans').select('tasks')
          .eq('user_id', user.id).eq('kind', kind).eq('entity_id', entityId).maybeSingle();
        if (row && Array.isArray(row.tasks)) {
          const tasks = (row.tasks as ItemPlanTask[]).map((t) => (t.id === taskId ? { ...t, done: true } : t));
          await supabase.from('item_plans')
            .update({ tasks, updated_at: new Date().toISOString() })
            .eq('user_id', user.id).eq('kind', kind).eq('entity_id', entityId);
        }
      } catch (e) {
        console.error('[items/execute] mark-done failed (non-fatal):', e);
      }
    }

    // ── Activity log (non-fatal) — surfaces in the Activity panel. Not undoable (a real send).
    await logActivity(supabase, user.id, {
      type: 'invite_sent',
      title: `Sent calendar invite: ${title}`,
      entityType: kind,
      entityId,
      metadata: { attendees, startISO, endISO, result },
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error('[items/execute] error:', error);
    return NextResponse.json({ error: 'Could not send the invite.' }, { status: 500 });
  }
}
