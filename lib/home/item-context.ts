import type { SupabaseClient } from '@supabase/supabase-js';
import type { ItemPlanKind } from './item-plan';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ITEM CONTEXT — the SINGLE grounding-context builder for a Home item, reused by:
//   • `POST /api/items/plan`      (generate/re-classify the task breakdown)
//   • `POST /api/items/prepare`   (extract the prepared action — e.g. a calendar invite — grounded)
// Pulls the same shapes the compose drafter reads, so a breakdown / prepared action is specific to the
// REAL item (recipient names, next step, what to fetch). Non-fatal: any failure → null.
//
// `buildItemContext` returns a prose blob for the AI. `getItemParticipants` additionally returns the
// structured sender/attendee emails a prepared action grounds attendees on (never invented).
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type ItemParticipant = { email?: string | null; name?: string | null };

export interface ItemContext {
  text: string;                       // the prose context the planner / extractor reasons over
  participants: ItemParticipant[];    // real people evidenced in the item (for grounding attendees)
  itemDateISO: string | null;         // the item's own timestamp (received_at / meeting start / due) — anchors relative times
}

const EMAIL_RE = /[^\s<>"]+@[^\s<>"]+\.[^\s<>"]+/;
const extractEmail = (s?: string | null): string | null => (s ? (s.match(EMAIL_RE)?.[0] ?? null) : null);

// INITIATIVE CONTEXT (S5b) — the wider initiative this item belongs to, from the durable Initiative Brain
// state (where it stands · whoOwes · stage). Read-only, cheap (a keyed lookup, no AI). Lets the planner reason
// about the item AGAINST THE WHOLE INITIATIVE — e.g. "you owe them the pricing offer; met Jun 23" — instead
// of the isolated message. Empty when the item has no initiative or no synthesized state yet.
async function initiativeStateBlock(
  supabase: SupabaseClient, userId: string, initiative: string | null | undefined,
  // ONE BRAIN: resolve the wider work through the item's OWN entity link first (the memory already
  // decided what this item is about); the initiative label lookup is the fallback for unlinked items.
  link?: { kind: 'inbox_item' | 'meeting' | 'commitment'; id: string },
): Promise<string> {
  const render = (label: string, s: { summary?: string; whoOwes?: { you?: string[]; them?: string[] }; stage?: string | null }, nextMove?: { title?: string; reason?: string } | null): string => {
    const parts = [`Where it stands: ${s.summary}`];
    if (s.whoOwes?.you?.length) parts.push(`You owe on this: ${s.whoOwes.you.join('; ')}`);
    if (s.whoOwes?.them?.length) parts.push(`They owe: ${s.whoOwes.them.join('; ')}`);
    if (s.stage) parts.push(`Stage: ${s.stage}`);
    // THE one next move — the plan should be a PROJECTION of it onto this item, not a fresh guess.
    if (nextMove?.title) parts.push(`THE ONE NEXT MOVE for this body of work: "${nextMove.title}"${nextMove.reason ? ` (${nextMove.reason})` : ''} — if THIS item is the vehicle for that move, the breakdown must LEAD with it; steps that don't advance this body of work don't belong.`);
    return `\n\n[THE WIDER WORK — ${label} — plan against the WHOLE body of work, not just this one message]\n${parts.join('\n')}`;
  };
  try {
    if (link) {
      const { data: el } = await supabase.from('entity_links').select('entity_id')
        .eq('user_id', userId).eq('item_kind', link.kind).eq('item_id', link.id).not('entity_id', 'is', null).maybeSingle();
      if (el?.entity_id) {
        const { data: ent } = await supabase.from('work_entities')
          .select('name, state, next_move').eq('id', el.entity_id).eq('user_id', userId).maybeSingle();
        const s = (ent?.state ?? null) as { summary?: string } | null;
        if (s?.summary) return render((ent as { name?: string })?.name || 'this work', s as never, (ent?.next_move ?? null) as never);
      }
    }
  } catch { /* fall through */ }
  return ''; // no entity link → no wider-work block (the label-era initiative_state path is gone)
}

/**
 * buildItemContext — the shared context builder. Returns { text, participants, itemDateISO } or null.
 * The prose `text` mirrors what `/api/items/plan`'s local buildContext produced (kept behaviourally
 * identical) so the classifier is unchanged; `participants` + `itemDateISO` are the extra grounding
 * a prepared action needs.
 */
export async function buildItemContext(
  supabase: SupabaseClient,
  userId: string,
  kind: ItemPlanKind,
  entityId: string,
): Promise<ItemContext | null> {
  try {
    if (kind === 'meeting') {
      const { data: tr } = await supabase
        .from('meeting_transcripts')
        .select('id, title, summary, suggested_next_step, calendar_event_id, decisions, risks, initiative')
        .eq('id', entityId).eq('user_id', userId).maybeSingle();
      if (!tr) return null;
      let title = (tr.title as string) || 'Meeting';
      const participants: ItemParticipant[] = [];
      let itemDateISO: string | null = null;
      if (tr.calendar_event_id) {
        const { data: ev } = await supabase
          .from('calendar_events')
          .select('title, attendees, start_time')
          .eq('id', tr.calendar_event_id).eq('user_id', userId).maybeSingle();
        if (ev?.title) title = ev.title as string;
        if (ev?.start_time) itemDateISO = ev.start_time as string;
        const att = (ev?.attendees ?? []) as Array<{ email?: string; name?: string; displayName?: string }>;
        for (const a of att) participants.push({ email: a.email ?? null, name: a.name || a.displayName || null });
      }
      const attendeeNames = participants.map((a) => a.name || a.email || '').filter(Boolean).slice(0, 12);
      const decisions = Array.isArray(tr.decisions)
        ? (tr.decisions as unknown[]).map((d) => (typeof d === 'string' ? d : (d as { text?: string })?.text || '')).filter(Boolean).slice(0, 8)
        : [];
      const text = [
        `Meeting: ${title}`,
        attendeeNames.length ? `Attendees: ${attendeeNames.join(', ')}` : '',
        (tr.summary as string) ? `Summary:\n${(tr.summary as string).slice(0, 2000)}` : '',
        (tr.suggested_next_step as string) ? `Suggested next step: ${tr.suggested_next_step}` : '',
        decisions.length ? `Decisions:\n- ${decisions.join('\n- ')}` : '',
      ].filter(Boolean).join('\n\n') + await initiativeStateBlock(supabase, userId, tr.initiative as string, { kind: 'meeting', id: entityId });
      return { text, participants, itemDateISO };
    }

    if (kind === 'commitment') {
      const { data: c } = await supabase
        .from('commitments')
        .select('id, description, counterparty, direction, source, source_id, due_date, initiative, thread_id')
        .eq('id', entityId).eq('user_id', userId).maybeSingle();
      if (!c) return null;
      let sourceSubject: string | null = null;
      let sourceBody: string | null = null;
      let itemDateISO: string | null = (c.due_date as string) || null;
      const participants: ItemParticipant[] = [];
      const cpEmail = extractEmail(c.counterparty as string | null);
      if (cpEmail) participants.push({ email: cpEmail, name: (c.counterparty as string | null) ?? null });
      if (c.source === 'email' && c.source_id) {
        const { data: e } = await supabase
          .from('emails').select('subject, body, from_name, from_address, received_at').eq('id', c.source_id).eq('user_id', userId).maybeSingle();
        if (e) {
          sourceSubject = (e.subject as string) || null;
          sourceBody = typeof e.body === 'string' ? (e.body as string).replace(/\s+/g, ' ').trim().slice(0, 1500) : null;
          if (!itemDateISO && e.received_at) itemDateISO = e.received_at as string;
          const em = extractEmail(e.from_address as string | null);
          if (em && !participants.some((p) => p.email === em)) participants.push({ email: em, name: (e.from_name as string) || null });
        }
      } else if (c.source === 'meeting' && c.source_id) {
        const { data: m } = await supabase
          .from('meeting_transcripts').select('title, summary').eq('id', c.source_id).eq('user_id', userId).maybeSingle();
        if (m) {
          sourceSubject = (m.title as string) || null;
          sourceBody = typeof m.summary === 'string' ? (m.summary as string).replace(/\s+/g, ' ').trim().slice(0, 1500) : null;
        }
      }
      const text = [
        `Commitment: ${c.description ?? ''}`,
        c.direction === 'awaiting' ? `You are WAITING ON ${c.counterparty || 'someone'} for this.` : `This is on YOUR plate${c.counterparty ? ` — owed to ${c.counterparty}` : ''}.`,
        (c.due_date as string) ? `Due: ${c.due_date}` : '',
        (c.initiative as string) ? `Initiative: ${c.initiative}` : '',
        sourceSubject ? `From: ${sourceSubject}` : '',
        sourceBody ? `Original context:\n${sourceBody}` : '',
      ].filter(Boolean).join('\n\n') + await initiativeStateBlock(supabase, userId, c.initiative as string, { kind: 'commitment', id: entityId });
      return { text, participants, itemDateISO };
    }

    // email | awareness | followup — the entity is an inbox item; ground on subject/sender/body.
    const { data: item } = await supabase
      .from('inbox_items')
      .select('id, work_title, source_data')
      .eq('id', entityId).eq('user_id', userId).maybeSingle();
    if (!item) return null;
    const sd = (item.source_data ?? {}) as Record<string, unknown>;
    const subj = String(sd.subject || item.work_title || '');
    const fromName = String(sd.from_name || '');
    const fromRaw = String(sd.from || sd.from_address || '');
    const fromEmail = extractEmail(fromRaw);
    const receivedAt = typeof sd.received_at === 'string' ? (sd.received_at as string) : null;
    const signals = sd.signals && typeof sd.signals === 'object' ? sd.signals as Record<string, unknown> : {};
    const understanding = sd.understanding && typeof sd.understanding === 'object' ? sd.understanding as Record<string, unknown> : {};
    const contextFacts = [
      receivedAt ? `Received: ${receivedAt}` : '',
      typeof signals.explicitDeadline === 'string' ? `Explicit deadline: ${signals.explicitDeadline}` : '',
      signals.isTimebound === true ? 'Time-bound: yes' : '',
      signals.isFollowUp === true ? 'Follow-up/reminder: yes' : '',
      signals.hasPreviousCommitment === true ? 'References a previous commitment: yes' : '',
      signals.impliedUrgency === 'immediate' || signals.impliedUrgency === 'soon' ? `Urgency: ${signals.impliedUrgency}` : '',
      typeof understanding.initiative === 'string' ? `Initiative: ${understanding.initiative}` : '',
      typeof sd.thread_id === 'string' ? `Thread: ${sd.thread_id}` : '',
    ].filter(Boolean);
    const participants: ItemParticipant[] = [];
    if (fromEmail) participants.push({ email: fromEmail, name: fromName || null });
    const text = [
      subj ? `Subject: ${subj}` : '',
      (fromName || fromRaw) ? `From: ${fromName || fromRaw}` : '',
      typeof sd.body === 'string' ? `Message:\n${(sd.body as string).slice(0, 2500)}` : '',
      contextFacts.length ? `Grounded context:\n- ${contextFacts.join('\n- ')}` : '',
    ].filter(Boolean).join('\n\n') + await initiativeStateBlock(supabase, userId, typeof understanding.initiative === 'string' ? understanding.initiative as string : null, { kind: 'inbox_item', id: entityId });
    return { text, participants, itemDateISO: receivedAt };
  } catch (e) {
    console.error('[item-context] build failed:', e);
    return null;
  }
}
