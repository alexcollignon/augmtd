import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { userTimezone, localNow } from '@/lib/utils/user-time';
import { isPastDue, judgeCommitmentExpiry, applyExpiryVerdict } from '@/lib/commitments/expiry';
import { hasBearer } from '@/lib/utils/bearer-auth';
import { fetchAllRows } from '@/lib/utils/fetch-all';

export const maxDuration = 120;

// Aging sweep for commitments (Slice 4 of inbox-intelligence). For every open commitment:
//  1. Auto-close it if the thread shows it was handled (you replied / they replied) — no nagware.
//  2. LAW 2 · THE EXPIRY LAW (proactive-reach arc, Sep 13): past-due with no fulfilling reply is
//     NOMINATED (deterministic) to one cheap reasoned verdict — did its moment pass, or is it a
//     debt that survives its date? Only `expired` closes, undoably.
//  3. (retired W2.3) It no longer surfaces a commitment as an inbox item — the deck, spine, judge and
//     prepare pass read commitments DIRECTLY; a mirror row was a second home for one fact.

const EXPIRY_JUDGMENTS_PER_SWEEP = 25; // bounded reasoned spend; the rest ride the next run (counted)
const EVIDENCE_COMMITMENT_JUDGMENTS_PER_SWEEP = 40; // W3.1 — bounded reasoned spend per pass (cache hits are free); the rest ride the next run
const EVIDENCE_INBOX_JUDGMENTS_PER_SWEEP = 15; // W3.1 inbox lane — the hooks are the heartbeat; this is the backstop

export async function GET(request: NextRequest) {
  if (!hasBearer(request, 'CRON_SECRET')) {
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
  // NO SILENT CAPS (W1.6): a plain unpaged select silently caps at PostgREST's 1000-row page — 915
  // open platform-wide is under that today, but a read with no `.range()` is a landmine the moment
  // it isn't. Paged via fetchAllRows on the SAME stable order so the sweep never quietly drops rows.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let open: any[];
  try {
    open = await fetchAllRows<any>((from, to) => // eslint-disable-line @typescript-eslint/no-explicit-any
      sb.from('commitments').select('*').eq('status', 'open')
        .order('updated_at', { ascending: false, nullsFirst: false }).range(from, to), { maxRows: 20000 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'fetch failed' }, { status: 500 });
  }
  if (!open?.length) return NextResponse.json({ open: 0, closed: 0 });

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
  let closed = 0, leftBehind = 0, expired = 0, expiryJudged = 0, expiryLeftBehind = 0;
  let evidenceNominated = 0, evidenceJudged = 0, evidenceLeftBehind = 0;

  // ── EVIDENCE SETTLES (W3.1): ONE evidence pool per user — the user's sent mail on ANY thread,
  // the counterparty's inbound, calendar events (held/booked), transcripts — loaded once from the
  // user's oldest open commitment onward and reused across their rows. The old path read ONE
  // newest email per row (`.limit(1)`) and never saw a meeting; the nominator hands the judge the
  // whole set (top 3 per type) and the judge names which piece delivered. ──
  const { settleCommitmentByEvidence, userEvidenceContext } = await import('@/lib/work/evidence-settle');
  const oldestByUser = new Map<string, string>();
  for (const c of open) {
    const prev = oldestByUser.get(c.user_id);
    if (!prev || String(c.created_at) < prev) oldestByUser.set(c.user_id, String(c.created_at));
  }
  const ctxByUser = new Map<string, Awaited<ReturnType<typeof userEvidenceContext>>>();
  const evidenceCtx = async (userId: string) => {
    const hit = ctxByUser.get(userId);
    if (hit) return hit;
    const ctx = await userEvidenceContext(sb, userId, oldestByUser.get(userId) ?? new Date(0).toISOString(), open.filter((r) => r.user_id === userId));
    ctxByUser.set(userId, ctx);
    return ctx;
  };

  for (const c of open) {
    if (Date.now() - now > BUDGET_MS) { leftBehind++; continue; } // counted, never silent
    // ── 1. Auto-close — CROSS-SOURCE, EVERY SOURCE: resolved by the right move ANYWHERE, not just
    // the original thread. You fulfil a you_owe by SENDING to the counterparty (any thread) or by
    // MEETING them (a held/booked slot settles a scheduling obligation); an awaiting resolves when
    // THEY write back (any thread). THE FULFILLMENT LAW (July 30): the nomination is structural,
    // the disposition is judged from the evidence's own words/facts — only `delivered` closes; a
    // re-promise with a stated new date re-anchors due_date; unclear/AI-failure leaves it open.
    // The close stamps resolved_reason 'evidence:<type>' at the EVIDENCE'S OWN TIME (the Day-
    // cleared ring counts by resolved_at), logs an undoable activity row and narrates once.
    if (evidenceJudged >= EVIDENCE_COMMITMENT_JUDGMENTS_PER_SWEEP) {
      evidenceLeftBehind++; // counted, never silent — the verdict cache makes the next run cheap
    } else {
      try {
        const r = await settleCommitmentByEvidence(sb, c, await evidenceCtx(c.user_id));
        if (r.nominated) evidenceNominated++;
        if (r.judged) evidenceJudged++;
        if (r.closed) { closed++; continue; }
      } catch { /* never close on an error path — the row rides the next pass */ }
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

    // ── 3. (RETIRED, W2.3 — ONE FACT ONE HOME) The aging branch used to mint an `inbox_items`
    // MIRROR (`source='commitment'`) for every overdue/stale commitment so it could be SEEN on
    // surfaces that, in June, only rendered inbox rows. Every surface now reads commitments
    // directly (the spine's commitment lane, the deck's commitment lane, judgeWork's commitment
    // branch, the prepare pass's commitment lane), so the mirror had become a second home for one
    // fact — judged twice, drafted on with no thread, outliving its commitment. No row is written
    // here any more; `lib/inbox/commitment-mirrors.ts` is the one exclusion every listing read
    // wears, and `scripts/sweep-retire-mirrors.ts` archives the historical rows (owner-gated).
  }

  // ── 5. EVIDENCE SETTLES — THE INBOX LANE (W3.1). Actionable inbox items get the same reasoned
  // door under a small cap (the event hooks are the heartbeat; this is the standing backstop for
  // anything the hooks missed). Same pool per user, same judge, same undoable close. Bounded
  // spend, budget-guarded, leftBehind counted. ──
  let inboxNominated = 0, inboxJudged = 0, inboxClosed = 0, inboxLeftBehind = 0;
  try {
    const { settleInboxItemByEvidence } = await import('@/lib/work/evidence-settle');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = await fetchAllRows<any>((from, to) => // eslint-disable-line @typescript-eslint/no-explicit-any
      sb.from('inbox_items').select('id, user_id, work_title, created_at, last_activity_at, source_data, type_override')
        .eq('status', 'pending').eq('source', 'email')
        .or('work_state.in.(work_prepared,decision_required,action_required),rule_type.eq.needs_reply')
        .order('last_activity_at', { ascending: false, nullsFirst: false }).range(from, to), { maxRows: 5000 });
    for (const it of items) {
      if (it.type_override === 'waiting_on' || it.type_override === 'fyi') continue;
      if (Date.now() - now > BUDGET_MS) { inboxLeftBehind++; continue; }
      if (inboxJudged >= EVIDENCE_INBOX_JUDGMENTS_PER_SWEEP) { inboxLeftBehind++; continue; }
      const after = String(it.last_activity_at ?? it.created_at);
      let ctx = ctxByUser.get(it.user_id);
      // the pool must reach back to THIS item's own moment (a pool cut at the oldest commitment may be later)
      if (!ctx || after < ctx.sinceISO) { ctx = await userEvidenceContext(sb, it.user_id, after, open.filter((r) => r.user_id === it.user_id)); ctxByUser.set(it.user_id, ctx); }
      const r = await settleInboxItemByEvidence(sb, it, ctx);
      if (r.nominated) inboxNominated++;
      if (r.judged) inboxJudged++;
      if (r.closed) inboxClosed++;
    }
  } catch (e) { console.error('[commitments-sweep] inbox evidence lane non-fatal:', e instanceof Error ? e.message : e); }

  if (leftBehind) console.log(`[commitments-sweep] budget spent — ${leftBehind} candidate(s) left for the next run`);
  if (expiryLeftBehind) console.log(`[commitments-sweep] expiry cap reached — ${expiryLeftBehind} past-due candidate(s) left for the next run`);
  if (evidenceLeftBehind) console.log(`[commitments-sweep] evidence cap reached — ${evidenceLeftBehind} commitment(s) left for the next run`);
  if (inboxLeftBehind) console.log(`[commitments-sweep] inbox evidence lane — ${inboxLeftBehind} item(s) left for the next run`);
  return NextResponse.json({
    open: open.length, closed, expired, leftBehind, expiryLeftBehind,
    evidence: { commitments: { nominated: evidenceNominated, judged: evidenceJudged, leftBehind: evidenceLeftBehind }, inbox: { nominated: inboxNominated, judged: inboxJudged, closed: inboxClosed, leftBehind: inboxLeftBehind } },
  });
}
