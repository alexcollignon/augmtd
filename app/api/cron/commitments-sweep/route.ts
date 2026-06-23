import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 120;

// Aging sweep for commitments (Slice 4 of inbox-intelligence). For every open commitment:
//  1. Auto-close it if the thread shows it was handled (you replied / they replied) — no nagware.
//  2. If it's overdue or has gone stale, surface it once as an inbox item so it can't be dropped.
// The Day Brief (Slice 5) reads the same commitments; this makes them actionable in the inbox now.

const STALE_DAYS = 4;   // you_owe with no due date
const AWAIT_DAYS = 5;   // awaiting a reply

export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: open, error } = await sb.from('commitments').select('*').eq('status', 'open');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!open?.length) return NextResponse.json({ open: 0, closed: 0, surfaced: 0 });

  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  let closed = 0, surfaced = 0;

  for (const c of open) {
    // ── 1. Auto-close via thread activity (email commitments only) ─────────────
    if (c.thread_id) {
      const isUser = c.direction === 'you_owe'; // you fulfil → you send; they fulfil → they reply
      const { data: activity } = await sb.from('emails')
        .select('id').eq('user_id', c.user_id).eq('thread_id', c.thread_id)
        .eq('is_from_user', isUser).gt('received_at', c.created_at).limit(1);
      if (activity?.length) {
        await sb.from('commitments').update({ status: 'done', updated_at: new Date().toISOString() }).eq('id', c.id);
        // Remove any inbox item we surfaced for it — it's handled now.
        await sb.from('inbox_items').delete().eq('user_id', c.user_id).eq('source', 'commitment').eq('source_id', c.id);
        closed++;
        continue;
      }
    }

    // ── 2. Aging? ──────────────────────────────────────────────────────────────
    const ageDays = (now - new Date(c.created_at).getTime()) / 86_400_000;
    const overdue = c.due_date && c.due_date < today;
    const stale = !c.due_date && c.direction === 'you_owe' && ageDays >= STALE_DAYS;
    const awaitingStale = c.direction === 'awaiting' && ageDays >= AWAIT_DAYS;
    if (!overdue && !stale && !awaitingStale) continue;

    // ── 3. Surface once as an inbox item ───────────────────────────────────────
    const { data: existingItem } = await sb.from('inbox_items')
      .select('id').eq('user_id', c.user_id).eq('source', 'commitment').eq('source_id', c.id).limit(1).maybeSingle();
    if (!existingItem) {
      const label = c.direction === 'awaiting'
        ? `Waiting on ${c.counterparty || 'them'}: ${c.description}`
        : overdue ? `Overdue: ${c.description}` : `Follow up: ${c.description}`;
      await sb.from('inbox_items').insert({
        user_id: c.user_id,
        source: 'commitment',
        source_id: c.id,
        work_state: 'action_required',
        work_title: label.slice(0, 200),
        item_type: 'review',
        source_data: {
          kind: 'commitment', commitment_id: c.id, direction: c.direction,
          due_date: c.due_date, counterparty: c.counterparty, description: c.description, thread_id: c.thread_id,
        },
        status: 'pending',
        auto_generated: true,
      });
      surfaced++;
    }
    await sb.from('commitments').update({ last_nudged_at: new Date().toISOString() }).eq('id', c.id);
  }

  return NextResponse.json({ open: open.length, closed, surfaced });
}
