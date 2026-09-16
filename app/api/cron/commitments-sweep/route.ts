import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { userTimezone, localNow } from '@/lib/utils/user-time';
import { isPastDue, judgeCommitmentExpiry, applyExpiryVerdict } from '@/lib/commitments/expiry';

export const maxDuration = 120;

// Aging sweep for commitments (Slice 4 of inbox-intelligence). For every open commitment:
//  1. Auto-close it if the thread shows it was handled (you replied / they replied) — no nagware.
//  2. LAW 2 · THE EXPIRY LAW (proactive-reach arc, Sep 13): past-due with no fulfilling reply is
//     NOMINATED (deterministic) to one cheap reasoned verdict — did its moment pass, or is it a
//     debt that survives its date? Only `expired` closes, undoably. This runs BEFORE the aging
//     branch by construction: a lapsed obligation must never mint a fresh deck row in the same
//     breath it should die.
//  3. If it's still owed and overdue or stale, surface it once as an inbox item so it can't be
//     dropped — and LAW 1's commitment clause: that row is JUDGED before it can lead the deck.
// The Day Brief (Slice 5) reads the same commitments; this makes them actionable in the inbox now.

const STALE_DAYS = 4;   // you_owe with no due date
const AWAIT_DAYS = 5;   // awaiting a reply
const EXPIRY_JUDGMENTS_PER_SWEEP = 25; // bounded reasoned spend; the rest ride the next run (counted)

export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // THE HONEST BUDGET (Aug 2 — the W2 sweep law applied here): the fulfillment judge added an AI
  // call per structurally-resolved candidate, and an unbudgeted full-table walk died at
  // maxDuration mid-list — SILENTLY, leaving arbitrary rows unjudged forever (the Fidelidade
  // dashboard commitment was never reached). Recency-first order + an explicit time budget +
  // leftBehind counted and logged; the verdict cache makes continuation cheap next run.
  const { data: open, error } = await sb.from('commitments').select('*').eq('status', 'open')
    .order('updated_at', { ascending: false, nullsFirst: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!open?.length) return NextResponse.json({ open: 0, closed: 0, surfaced: 0 });

  const now = Date.now();
  const BUDGET_MS = 95_000; // leave headroom under maxDuration=120
  // THE USER'S CLOCK (T-class): "past due" is decided in the OWNER'S day, never the server's in
  // disguise — a Lisbon obligation is not overdue because it is already tomorrow in UTC.
  const todayByUser = new Map<string, string>();
  const userToday = async (userId: string): Promise<string> => {
    const hit = todayByUser.get(userId);
    if (hit) return hit;
    const d = localNow(await userTimezone(sb, userId)).dateStr;
    todayByUser.set(userId, d);
    return d;
  };
  let closed = 0, surfaced = 0, leftBehind = 0, expired = 0, expiryJudged = 0, expiryLeftBehind = 0;

  for (const c of open) {
    if (Date.now() - now > BUDGET_MS) { leftBehind++; continue; } // counted, never silent
    // ── 1. Auto-close — CROSS-SOURCE: resolved by the right move in ANY thread, not just the
    // original one. You fulfil a you_owe by SENDING to the counterparty (new email, reply, anywhere);
    // an awaiting resolves when THEY write back (any thread). This also makes follow-up timing
    // context-aware — progressing items close here, so only genuinely-stalled ones survive to aging.
    const youFulfil = c.direction === 'you_owe'; // you fulfil → you send; they fulfil → they reply
    // Resolve the counterparty's email so we can match across threads. Counterparty is often stored
    // as "Name <email>" — extract the address (or a bare email); a name-only value stays null.
    const cpRaw = c.counterparty ? String(c.counterparty) : '';
    let cpEmail: string | null = (cpRaw.match(/<\s*([^>\s]+@[^>\s]+)\s*>/)?.[1] || cpRaw.match(/[^\s<>]+@[^\s<>]+/)?.[0] || null);
    if (cpEmail) cpEmail = cpEmail.toLowerCase();
    if (!cpEmail && c.thread_id) {
      const { data: inc } = await sb.from('emails').select('from_address')
        .eq('user_id', c.user_id).eq('thread_id', c.thread_id).eq('is_from_user', false).limit(1).maybeSingle();
      cpEmail = inc?.from_address ? String(inc.from_address).toLowerCase() : null;
    }
    // Meeting commitment (no thread, name-based counterparty) — resolve the counterparty's email
    // from the meeting's attendees, so meeting commitments also auto-resolve cross-source.
    if (!cpEmail && c.source === 'meeting' && c.source_id && c.counterparty) {
      const { data: t } = await sb.from('meeting_transcripts').select('calendar_event_id').eq('id', c.source_id).maybeSingle();
      if (t?.calendar_event_id) {
        const { data: ev } = await sb.from('calendar_events').select('attendees').eq('id', t.calendar_event_id).maybeSingle();
        const cp = String(c.counterparty).toLowerCase().trim();
        const first = cp.split(/\s+/)[0];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const att = ((ev?.attendees as any[]) || []).find((a) => {
          const name = String(a?.name || '').toLowerCase();
          const email = String(a?.email || '').toLowerCase();
          return email && (name === cp || (first.length > 2 && (name.includes(first) || email.split('@')[0].includes(first))) || (name && cp.includes(name)));
        });
        cpEmail = att?.email ? String(att.email).toLowerCase() : null;
      }
    }
    let resolved = false;
    // Capture the fulfilling email's received_at as the HONEST resolution moment. The Day-cleared
    // ring counts by resolved_at, so stamping `now` here would passively fill the ring when the sweep
    // processes a fulfillment that actually happened days ago. Use the email time; fall back to now.
    let resolvedAt: string | null = null;
    let fulfillingEmailId: string | null = null;
    if (c.thread_id) {
      const { data } = await sb.from('emails').select('id, received_at')
        .eq('user_id', c.user_id).eq('thread_id', c.thread_id).eq('is_from_user', youFulfil)
        .gt('received_at', c.created_at).order('received_at', { ascending: false }).limit(1);
      if (data?.length) { resolved = true; resolvedAt = (data[0].received_at as string) ?? null; fulfillingEmailId = (data[0].id as string) ?? null; }
    }
    if (!resolved && cpEmail) {
      const base = sb.from('emails').select('id, received_at').eq('user_id', c.user_id).eq('is_from_user', youFulfil).gt('received_at', c.created_at);
      const { data } = youFulfil
        ? await base.contains('to_addresses', [cpEmail]).order('received_at', { ascending: false }).limit(1)   // you sent to them, any thread
        : await base.ilike('from_address', cpEmail).order('received_at', { ascending: false }).limit(1);        // they wrote back, any thread
      if (data?.length) { resolved = true; resolvedAt = (data[0].received_at as string) ?? null; fulfillingEmailId = (data[0].id as string) ?? null; }
    }
    // THE FULFILLMENT LAW (July 30): the structural signal only NOMINATES a candidate — whether the
    // message actually fulfilled the commitment (vs merely promising/acknowledging it) is judged
    // from the message's own words, both directions. Only `delivered` closes; a re-promise with a
    // stated new date re-anchors due_date; unclear/AI-failure leaves it open for the next pass.
    if (resolved && fulfillingEmailId) {
      try {
        const { data: em } = await sb.from('emails').select('body, metadata').eq('id', fulfillingEmailId).maybeSingle();
        const { judgeCommitmentFulfillment, applyFulfillmentVerdict } = await import('@/lib/commitments/fulfillment');
        const meta = (em?.metadata ?? {}) as { attachments?: unknown[] };
        const fv = await judgeCommitmentFulfillment(sb, c.user_id, c,
          { id: fulfillingEmailId, body: String(em?.body ?? ''), attachmentCount: Array.isArray(meta.attachments) ? meta.attachments.length : null }, youFulfil);
        const closes = await applyFulfillmentVerdict(sb, c.user_id, c, fv, async () => true);
        if (!closes) resolved = false; // promised/unclear — stays open (a re-anchor already landed)
      } catch { resolved = false; } // never close on an error path
    }
    if (resolved) {
      const nowIso = new Date().toISOString();
      const stampAt = resolvedAt || nowIso;
      // Column-aware update (resolved_at/resolved_reason from 20260705d); retry status-only on older schemas.
      let err;
      ({ error: err } = await sb.from('commitments')
        .update({ status: 'done', resolved_at: stampAt, resolved_reason: 'fulfilled', updated_at: nowIso }).eq('id', c.id));
      if (err) await sb.from('commitments').update({ status: 'done', updated_at: nowIso }).eq('id', c.id);
      // Remove any inbox item we surfaced for it — it's handled now.
      await sb.from('inbox_items').delete().eq('user_id', c.user_id).eq('source', 'commitment').eq('source_id', c.id);
      import('@/lib/room/turns').then(({ settleAsksForItem }) => settleAsksForItem(sb, c.user_id, 'commitment', c.id)).catch(() => {});
      closed++;
      continue;
    }

    // ── 2. LAW 2 · THE EXPIRY LAW — the lane's missing third outcome. ──────────
    // THE NOMINATION IS DETERMINISTIC (zero AI): open + past due on the USER'S clock + nothing
    // fulfilling found above. THE DISPOSITION IS JUDGED: "past due" is not proof of mootness (an
    // unpaid invoice survives its date; an ended meeting does not). Only `expired` closes —
    // still_owed / unclear / an AI failure change NOTHING (the fulfillment-law asymmetry).
    const today = await userToday(c.user_id);
    if (isPastDue(c, today)) {
      if (expiryJudged >= EXPIRY_JUDGMENTS_PER_SWEEP) {
        expiryLeftBehind++; // counted, never silent — the cache makes the next run cheap
      } else {
        expiryJudged++;
        const ev = await judgeCommitmentExpiry(sb, c.user_id, c, today);
        if (await applyExpiryVerdict(sb, c.user_id, c, ev)) { expired++; continue; }
      }
    }

    // ── 3. Aging? ──────────────────────────────────────────────────────────────
    const ageDays = (now - new Date(c.created_at).getTime()) / 86_400_000;
    const overdue = c.due_date && c.due_date < today;
    const stale = !c.due_date && c.direction === 'you_owe' && ageDays >= STALE_DAYS;
    const awaitingStale = c.direction === 'awaiting' && ageDays >= AWAIT_DAYS;
    if (!overdue && !stale && !awaitingStale) continue;

    // ── 4. Surface once as an inbox item ───────────────────────────────────────
    const { data: existingItem } = await sb.from('inbox_items')
      .select('id').eq('user_id', c.user_id).eq('source', 'commitment').eq('source_id', c.id).limit(1).maybeSingle();
    if (!existingItem) {
      const label = c.direction === 'awaiting'
        ? `Waiting on ${c.counterparty || 'them'}: ${c.description}`
        : overdue ? `Overdue: ${c.description}` : `Follow up: ${c.description}`;
      // LAW 1's commitment clause (THE REACH LAW): this lane used to mint a hand-built
      // `action_required` row NO JUDGE HAD EVER SEEN — an unjudged row LEADING the deck. The
      // judgment runs on the COMMITMENT ITSELF (its true subject: description, direction, due
      // date, its entity neighbourhood and prepared pool — judgeWork's own commitment branch),
      // never on the bare label a title-only inbox judgment would have to guess from. Its verdict
      // decides the row's posture: real work leads the deck; a `none` verdict enters as awareness
      // ('noted' — the unjudged/quiet tail classifyItem already demotes), never as an action.
      // An unjudged row may exist; an unjudged row leading the deck may not.
      let judgedWork = 'unjudged', judgedReason = '';
      try {
        const { judgeWork } = await import('@/lib/work/judge');
        const v = await judgeWork(sb, c.user_id, { kind: 'commitment', id: c.id });
        if (!v.failed) { judgedWork = v.work; judgedReason = v.reason; }
      } catch { /* a judge outage never blocks the surface — it only withholds the lead seat */ }
      await sb.from('inbox_items').insert({
        user_id: c.user_id,
        source: 'commitment',
        source_id: c.id,
        work_state: judgedWork !== 'unjudged' && judgedWork !== 'none' ? 'action_required' : 'noted',
        work_title: label.slice(0, 200),
        item_type: 'review',
        source_data: {
          kind: 'commitment', commitment_id: c.id, direction: c.direction,
          due_date: c.due_date, counterparty: c.counterparty, description: c.description, thread_id: c.thread_id,
          judged: { work: judgedWork, reason: judgedReason.slice(0, 200), at: new Date().toISOString() },
        },
        status: 'pending',
        auto_generated: true,
      });
      surfaced++;
    }
    await sb.from('commitments').update({ last_nudged_at: new Date().toISOString() }).eq('id', c.id);
  }

  if (leftBehind) console.log(`[commitments-sweep] budget spent — ${leftBehind} candidate(s) left for the next run`);
  if (expiryLeftBehind) console.log(`[commitments-sweep] expiry cap reached — ${expiryLeftBehind} past-due candidate(s) left for the next run`);
  return NextResponse.json({ open: open.length, closed, expired, surfaced, leftBehind, expiryLeftBehind });
}
