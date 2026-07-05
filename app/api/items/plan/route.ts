import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateItemPlan, type ItemPlanKind, type ItemPlanTask } from '@/lib/home/item-plan';

export const maxDuration = 30;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ITEM PLAN endpoints — the "What this takes" graded task breakdown for a Home deep-dive (stage 2).
//
// POST /api/items/plan  { kind, entityId }  → get-or-generate: return the stored plan if we have one,
//   else build the item's context, call generateItemPlan, persist, and return { tasks }.
// PATCH /api/items/plan { kind, entityId, taskId, done } → toggle a [You] task's `done` in the stored
//   jsonb. (System tasks aren't user-checkable — execution is stage 3.)
//
// Non-fatal: the deep-dive still works with just the stage-1 action bar if this fails.
// ════════════════════════════════════════════════════════════════════════════════════════════════

type Kind = ItemPlanKind;
const VALID_KINDS: Kind[] = ['email', 'meeting', 'commitment', 'awareness', 'followup'];

// Build the grounding context the planner reasons over — reuses the same shapes the compose drafter
// pulls, so the breakdown is specific to the real item (recipient names, next step, what to fetch).
async function buildContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  kind: Kind,
  entityId: string,
): Promise<string | null> {
  try {
    if (kind === 'meeting') {
      const { data: tr } = await supabase
        .from('meeting_transcripts')
        .select('id, title, summary, suggested_next_step, calendar_event_id, decisions, risks')
        .eq('id', entityId).eq('user_id', userId).maybeSingle();
      if (!tr) return null;
      let title = (tr.title as string) || 'Meeting';
      let attendeeNames: string[] = [];
      if (tr.calendar_event_id) {
        const { data: ev } = await supabase
          .from('calendar_events')
          .select('title, attendees')
          .eq('id', tr.calendar_event_id).eq('user_id', userId).maybeSingle();
        if (ev?.title) title = ev.title as string;
        const att = (ev?.attendees ?? []) as Array<{ email?: string; name?: string; displayName?: string }>;
        attendeeNames = att.map((a) => a.name || a.displayName || a.email || '').filter(Boolean).slice(0, 12);
      }
      const decisions = Array.isArray(tr.decisions)
        ? (tr.decisions as unknown[]).map((d) => (typeof d === 'string' ? d : (d as { text?: string })?.text || '')).filter(Boolean).slice(0, 8)
        : [];
      return [
        `Meeting: ${title}`,
        attendeeNames.length ? `Attendees: ${attendeeNames.join(', ')}` : '',
        (tr.summary as string) ? `Summary:\n${(tr.summary as string).slice(0, 2000)}` : '',
        (tr.suggested_next_step as string) ? `Suggested next step: ${tr.suggested_next_step}` : '',
        decisions.length ? `Decisions:\n- ${decisions.join('\n- ')}` : '',
      ].filter(Boolean).join('\n\n');
    }

    if (kind === 'commitment') {
      const { data: c } = await supabase
        .from('commitments')
        .select('id, description, counterparty, direction, source, source_id, due_date')
        .eq('id', entityId).eq('user_id', userId).maybeSingle();
      if (!c) return null;
      let sourceSubject: string | null = null;
      let sourceBody: string | null = null;
      if (c.source === 'email' && c.source_id) {
        const { data: e } = await supabase
          .from('emails').select('subject, body').eq('id', c.source_id).eq('user_id', userId).maybeSingle();
        if (e) {
          sourceSubject = (e.subject as string) || null;
          sourceBody = typeof e.body === 'string' ? (e.body as string).replace(/\s+/g, ' ').trim().slice(0, 1500) : null;
        }
      } else if (c.source === 'meeting' && c.source_id) {
        const { data: m } = await supabase
          .from('meeting_transcripts').select('title, summary').eq('id', c.source_id).eq('user_id', userId).maybeSingle();
        if (m) {
          sourceSubject = (m.title as string) || null;
          sourceBody = typeof m.summary === 'string' ? (m.summary as string).replace(/\s+/g, ' ').trim().slice(0, 1500) : null;
        }
      }
      return [
        `Commitment: ${c.description ?? ''}`,
        c.direction === 'awaiting' ? `You are WAITING ON ${c.counterparty || 'someone'} for this.` : `This is on YOUR plate${c.counterparty ? ` — owed to ${c.counterparty}` : ''}.`,
        (c.due_date as string) ? `Due: ${c.due_date}` : '',
        sourceSubject ? `From: ${sourceSubject}` : '',
        sourceBody ? `Original context:\n${sourceBody}` : '',
      ].filter(Boolean).join('\n\n');
    }

    // email | awareness | followup — the entity is an inbox item; ground on subject/sender/body.
    const { data: item } = await supabase
      .from('inbox_items')
      .select('id, work_title, source_data')
      .eq('id', entityId).eq('user_id', userId).maybeSingle();
    if (!item) return null;
    const sd = (item.source_data ?? {}) as Record<string, unknown>;
    const subj = String(sd.subject || item.work_title || '');
    const from = String(sd.from_name || sd.from || sd.from_address || '');
    return [
      subj ? `Subject: ${subj}` : '',
      from ? `From: ${from}` : '',
      typeof sd.body === 'string' ? `Message:\n${(sd.body as string).slice(0, 2500)}` : '',
    ].filter(Boolean).join('\n\n');
  } catch (e) {
    console.error('[items/plan] context build failed:', e);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { kind, entityId } = (await request.json()) as { kind: Kind; entityId: string };
    if (!entityId || !VALID_KINDS.includes(kind)) {
      return NextResponse.json({ error: 'kind and entityId are required' }, { status: 400 });
    }

    // Get-or-generate: an existing plan wins (persists the [You] checklist state).
    const { data: existing } = await supabase
      .from('item_plans')
      .select('tasks')
      .eq('user_id', user.id).eq('kind', kind).eq('entity_id', entityId)
      .maybeSingle();
    if (existing && Array.isArray(existing.tasks) && existing.tasks.length) {
      return NextResponse.json({ tasks: existing.tasks as ItemPlanTask[] });
    }

    const context = (await buildContext(supabase, user.id, kind, entityId)) || '';
    const plan = await generateItemPlan(supabase, user.id, { kind, entityId, context });

    // Persist (best-effort — a failed insert still returns the freshly generated plan). Supabase
    // returns an { error } object rather than throwing, so check it explicitly — a silently-failed
    // upsert is exactly what made the plan "regenerate every visit" before the migration existed.
    // Skip persisting the honest single-[You] fallback: it's not worth caching, and re-opening later
    // (once generation succeeds) should get a real plan rather than a stuck "Handle this".
    const isFallback = plan.tasks.length === 1 && plan.tasks[0].actor === 'you' && plan.tasks[0].text === 'Handle this';
    if (!isFallback) {
      try {
        const { error: upsertErr } = await supabase
          .from('item_plans')
          .upsert(
            { user_id: user.id, kind, entity_id: entityId, tasks: plan.tasks, updated_at: new Date().toISOString() },
            { onConflict: 'user_id,kind,entity_id' },
          );
        if (upsertErr) console.error('[items/plan] persist failed:', upsertErr.message);
      } catch (e) {
        console.error('[items/plan] persist threw:', e);
      }
    }

    return NextResponse.json({ tasks: plan.tasks });
  } catch (error) {
    console.error('[items/plan] POST error:', error);
    return NextResponse.json({ error: 'Could not build the plan.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { kind, entityId, taskId, done } = (await request.json()) as {
      kind: Kind; entityId: string; taskId: string; done: boolean;
    };
    if (!entityId || !VALID_KINDS.includes(kind) || !taskId) {
      return NextResponse.json({ error: 'kind, entityId and taskId are required' }, { status: 400 });
    }

    const { data: row } = await supabase
      .from('item_plans')
      .select('tasks')
      .eq('user_id', user.id).eq('kind', kind).eq('entity_id', entityId)
      .maybeSingle();
    if (!row || !Array.isArray(row.tasks)) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    // Toggle only a [You] task's done flag — system tasks aren't user-checkable here.
    const tasks = (row.tasks as ItemPlanTask[]).map((t) =>
      t.id === taskId && t.actor === 'you' ? { ...t, done: !!done } : t,
    );

    const { error } = await supabase
      .from('item_plans')
      .update({ tasks, updated_at: new Date().toISOString() })
      .eq('user_id', user.id).eq('kind', kind).eq('entity_id', entityId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ tasks });
  } catch (error) {
    console.error('[items/plan] PATCH error:', error);
    return NextResponse.json({ error: 'Could not update the task.' }, { status: 500 });
  }
}
