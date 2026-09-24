import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { executeSendCalendarInvite } from '@/lib/tools/send-calendar-invite';
import { executeForwardEmail } from '@/lib/tools/forward-email';
import { claimCommit, recordCommitResult, releaseCommitClaim } from '@/lib/work/commit-door';
import { logPreparedOutcome } from '@/lib/prepare/outcome';
import { logActivity } from '@/lib/activity/log';
import { noteItemAction } from '@/lib/entities/on-action';
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

// ── W5: stamp the AMBIENT prepared artifact as sent + log its OUTCOME (R1 — accepted verbatim vs
// edited before approve, judged by comparing the approved payload to what the pass prepared).
// Non-fatal: a sent action is never lost to bookkeeping.
async function stampAmbientSent(
  supabase: SupabaseClient, userId: string, kind: ItemPlanKind, entityId: string,
  which: 'prepared_invite' | 'prepared_forward', approved: Record<string, unknown>, compareKeys: string[],
): Promise<void> {
  try {
    // W2.1 — A COMMITMENT'S POOLED INVITE IS STAMPED SPENT HERE (mirror of source_data's sent_at):
    // THE ONE READER excludes `metadata.sent_at` rows, so the card, the chip and the machine all
    // see the deed at once. Without this the pool row would read "invite prepared" forever.
    if (kind === 'commitment' || kind === 'followup') {
      if (which !== 'prepared_invite') return;
      const { data: rows } = await supabase.from('item_deliverables').select('id, metadata, created_at')
        .eq('user_id', userId).eq('kind', 'commitment').eq('entity_id', entityId)
        .not('metadata->invite', 'is', null).order('created_at', { ascending: false }).limit(3);
      const row = ((rows ?? []) as Array<{ id: string; metadata: Record<string, unknown> | null; created_at?: string | null }>).find((r) => !r.metadata?.sent_at);
      if (!row) return;
      const inv = (row.metadata?.invite ?? {}) as Record<string, unknown>;
      await supabase.from('item_deliverables').update({ metadata: { ...(row.metadata ?? {}), sent_at: new Date().toISOString() } }).eq('id', row.id).eq('user_id', userId);
      const edited = compareKeys.some((k) => JSON.stringify(inv[k] ?? '') !== JSON.stringify(approved[k] ?? ''));
      await logPreparedOutcome(supabase, userId, {
        outcome: edited ? 'edited' : 'accepted', artifact: 'invite', itemKind: 'commitment', itemId: entityId,
        door: 'items_execute', senderClass: 'unknown', preparedAt: row.created_at ?? null,
      });
      return;
    }
    if (kind !== 'email' && kind !== 'awareness') return;
    const { data: it } = await supabase.from('inbox_items').select('source_data')
      .eq('id', entityId).eq('user_id', userId).maybeSingle();
    const sd = (it?.source_data ?? {}) as Record<string, unknown>;
    const art = sd[which] as Record<string, unknown> | undefined;
    if (!art) return;
    await supabase.from('inbox_items').update({
      source_data: { ...sd, [which]: { ...art, sent_at: new Date().toISOString() } },
    }).eq('id', entityId).eq('user_id', userId);
    const edited = compareKeys.some((k) => JSON.stringify(art[k] ?? '') !== JSON.stringify(approved[k] ?? ''));
    await logPreparedOutcome(supabase, userId, {
      outcome: edited ? 'edited' : 'accepted',
      artifact: which === 'prepared_invite' ? 'invite' : 'forward',
      itemKind: 'inbox', itemId: entityId,
      door: 'items_execute', source: sd, preparedAt: typeof art.generated_at === 'string' ? art.generated_at : null,
    });
  } catch { /* bookkeeping only */ }
  // W14.2 · THE NARRATION FOLLOWS ITS ARTIFACT FROM THE SEND DOOR: the prepared invite/forward is
  // spent; its prep narration archives when the item holds nothing else live (THE ONE settle).
  try {
    const itemKind = kind === 'commitment' || kind === 'followup' ? 'commitment' as const : kind === 'email' || kind === 'awareness' ? 'inbox' as const : null;
    if (itemKind) {
      const { settlePrepNarration } = await import('@/lib/prepare/narration');
      await settlePrepNarration(supabase, userId, { kind: itemKind, id: entityId }, { retired: 1 });
    }
  } catch { /* narration hygiene is never fatal */ }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await request.json()) as { kind: ItemPlanKind; entityId: string; taskId?: string; action: ExecuteAction; idempotencyKey?: string };
    const { kind, entityId, taskId, action } = body;
    if (!entityId || !VALID_KINDS.includes(kind)) {
      return NextResponse.json({ error: 'kind and entityId are required' }, { status: 400 });
    }
    if (!action || (action.type !== 'calendar_invite' && action.type !== 'forward')) {
      return NextResponse.json({ error: 'unsupported action type' }, { status: 400 });
    }

    // ── W5: THE COMMIT DOOR — one atomic claim per irreversible act. A double-approve or a retried
    // request finds the claim taken and gets the PRIOR result back: exactly-once at the send edge.
    // Pre-migration (ledger table absent) the claim reports 'unavailable' and the route proceeds.
    const idemKey = (body.idempotencyKey || `${action.type}:${kind}:${entityId}`).slice(0, 200);
    const fireOnce = async (fire: () => Promise<string>): Promise<
      { dup: true; result: string } | { dup: false; result: string; failed: boolean }
    > => {
      const claim = await claimCommit(supabase, user.id, {
        idempotencyKey: idemKey, actionType: action.type, payload: action as unknown as Record<string, unknown>,
      });
      if (claim.status === 'duplicate') return { dup: true, result: claim.priorResult ?? 'Already sent.' };
      const result = await fire();
      const failed = /^(Cannot|Failed)\b/.test(result);
      if (claim.status === 'claimed') {
        // A failed executor releases the claim (nothing sent — a retry must be able to fire);
        // a success stamps the result, completing the approval record.
        if (failed) await releaseCommitClaim(supabase, user.id, idemKey);
        else await recordCommitResult(supabase, user.id, idemKey, result);
      }
      return { dup: false, result, failed };
    };

    // ── FORWARD (S5 send-type) — the same approve-before-commit gate as the invite, a different executor.
    // Only ever reached from an explicit Approve click on the ForwardPreviewCard. Never auto-fired.
    if (action.type === 'forward') {
      const to = Array.isArray(action.to) ? action.to.map((a) => String(a).trim()).filter((a) => a.includes('@')) : [];
      const cc = Array.isArray(action.cc) ? action.cc.map((a) => String(a).trim()).filter((a) => a.includes('@')) : [];
      if (to.length === 0) return NextResponse.json({ error: 'Add at least one recipient before forwarding.' }, { status: 400 });

      // COMMIT — the real forward (user already approved), through the door: claimed exactly once.
      const fired = await fireOnce(() => executeForwardEmail(
        { threadId: entityId, to, cc, note: action.note || '' },
        user.id,
        supabase,
      ));
      if (fired.dup) return NextResponse.json({ ok: true, alreadyExecuted: true, result: fired.result });
      const result = fired.result;
      if (fired.failed) return NextResponse.json({ ok: false, error: result }, { status: 502 });
      // The ambient prepared forward (if the pass made one) is now spent — stamp + outcome (R1).
      await stampAmbientSent(supabase, user.id, kind, entityId, 'prepared_forward',
        { to, note: action.note || '' }, ['to', 'note']);

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

      // THE DEED MOVES THE BRIEF (Sep 8) — the commit door is an action the brain hears: the
      // room's opening is re-authored and the deed lands as one appended event line, so the
      // pinned brief can never keep asking for a send the reader just made.
      if (kind === 'email' || kind === 'awareness' || kind === 'followup') {
        const uid = user.id; const eid = entityId;
        after(async () => {
          await noteItemAction(supabase, uid, { kind: 'inbox_item', id: eid },
            { said: `Forwarded to ${to[0].split('<')[0].trim()}${to.length > 1 ? ` +${to.length - 1}` : ''}.` }).catch(() => {});
        });
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

    // ── COMMIT — the ONE real irreversible call (user already approved), through the door: claimed
    // exactly once. Same executor as workflows.
    const fired = await fireOnce(() => executeSendCalendarInvite(
      {
        title, startISO, endISO, attendees,
        description: action.description || '',
        location: action.location || '',
        timezone: action.timezone || 'UTC',
        includeMeetLink: action.includeMeetLink !== false,
      },
      user.id,
      supabase,
    ));
    if (fired.dup) return NextResponse.json({ ok: true, alreadyExecuted: true, result: fired.result });
    const result = fired.result;

    // The executor is non-throwing: a failure comes back as a "Cannot…/Failed…" string. Surface it as
    // an error so the card shows it (and we do NOT mark the step done).
    if (fired.failed) {
      return NextResponse.json({ ok: false, error: result }, { status: 502 });
    }
    // The ambient prepared invite (if the pass made one) is now spent — stamp + outcome (R1).
    await stampAmbientSent(supabase, user.id, kind, entityId, 'prepared_invite',
      { title, startISO, endISO, attendees }, ['title', 'startISO', 'attendees']);

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

    // THE DEED MOVES THE BRIEF (Sep 8) — same seam as the forward branch above.
    if (kind === 'email' || kind === 'awareness' || kind === 'followup') {
      const uid = user.id; const eid = entityId;
      const guests = attendees.map((a) => a.split('@')[0]).slice(0, 2).join(', ');
      after(async () => {
        await noteItemAction(supabase, uid, { kind: 'inbox_item', id: eid },
          { said: `Invite sent${guests ? ` to ${guests}` : ''}${attendees.length > 2 ? ` +${attendees.length - 2}` : ''}.` }).catch(() => {});
      });
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
