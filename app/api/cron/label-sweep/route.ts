import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { writeBackLabels, GmailLabelCache } from '@/lib/inbox/rules/write-back';
import { augmtdLabelsOn } from '@/lib/inbox/rules/label-name';
import { hasBearer } from '@/lib/utils/bearer-auth';
import { activeUserIds, orderLeastRecentlyServed, stampServed } from '@/lib/work/sweep-users';

export const maxDuration = 300;

// SCHEDULE (vercel.json): `40 */2 * * *`

// Label-sweep. The sync's AUGMTD write-back is fire-and-forget and Gmail rate-limits during a batch,
// so some emails silently miss their label. This makes labeling eventually-consistent: for recent
// pending items not yet marked labeled, apply the label (SEQUENTIALLY — no rate-limit burst) and mark
// source_data.labeled=true so it's done once. Idempotent (Gmail add-label no-ops if already present).
//
// ── THE COVERAGE REPAIR, applied here too (stabilization W4.3 — the same class draft-sweep fixed
// Aug 14): this route used to walk `sb.from('profiles').select('*')` in whatever order Postgres
// handed rows back, up to 40 serial AI calls + 150 label writes + 60ms sleeps per user, with NO
// wall-clock guard — a large user base dies mid-loop and the tail never gets a pass. Now: active
// users only, least-recently-served first (ONE rotation shared with draft-sweep via
// lib/work/sweep-users — a separate marker kind, `label_sweep`, since this route's own work leaves
// no other item_plans trace to read a "last touched" signal off), a wall-clock guard that stops
// cleanly before the 300s kill, and an honest `usersLeftBehind` count.
//
// ── W9.5 THE CLOCKS — WHY THIS STAYS A BUDGETED SERIAL WALK, NOT A FAN-OUT LANE (the decision) ──
// The judgment/draft/evidence sweeps moved onto lib/work/sweep-fanout because each account's pass
// is minutes of AI work and reach was a function of how many OTHER accounts exist. This route is a
// BACKSTOP to the sync's own label write-back: most rows arrive labeled, the per-account work is
// seconds, and its writes are deliberately SERIAL (Gmail rate-limits bursts — the 60ms throttle).
// A fourth fan-out lane would add a claim kind, a per-user route lane and N concurrent Gmail
// writers for a job that already carries the rotation, the wall clock and `usersLeftBehind`. The
// smaller correct change is to close the two silent caps it still had INSIDE each account:
//   (1) the item read was an UNORDERED `.limit(150)` that included already-labeled rows and
//       filtered them in memory — an account with >150 recent rows could see the same labeled 150
//       every run while the rest never got a pass. It now excludes `labeled = true` in the query and
//       reads newest first, with an exact count;
//   (2) rows the cap or the per-user clock left are COUNTED (`itemsLeftBehind`) and reported.
// If label work ever grows into minutes per account, promote it to a fan-out lane then.
//
// ── W10 THE MAILBOX IS THE USER'S — the sweep now runs TWO passes, and only one touches a mailbox ──
//   (1) THE KIND COMPLETER — EVERY active account. `ensureMailKind` lands the reasoned
//       `understanding.mailKind` on fast-pathed mail that never got one. It stays because IN-APP
//       consumers read that raw kind: the held/deck notice floors (`rawMailKindOf` in
//       lib/inbox/notice-demotion.ts → lib/home/attention.ts, lib/home/deck-floors.ts), the judge's
//       kind floor (lib/work/judge.ts) and the not-judged lane (lib/work/judgment-sweep.ts). It no
//       longer feeds any mailbox label (kind labels are retired). Zero provider calls. A judged-none
//       row is stamped `kind_checked` so the paid call is never repeated.
//   (2) THE POSTURE LABELS — ONLY for an account that explicitly chose AUGMTD labels
//       (auto_label === true; unset is OFF). Posture only (Needs reply · To do · Waiting on → Done).
const ITEMS_PER_USER = 150;

export async function GET(request: NextRequest) {
  if (!hasBearer(request, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const users = await orderLeastRecentlyServed(sb, await activeUserIds(sb), 'label_sweep');
  const budgetMs = Math.min(60_000, Math.max(10_000, Math.floor(180_000 / Math.max(1, users.length))));
  const routeDeadline = Date.now() + 265_000; // stop cleanly before the 300s kill

  let labeled = 0, kindsCompleted = 0, usersTouched = 0, usersLeftBehind = 0, itemsLeftBehind = 0, kindsLeftBehind = 0, usersLabelsOff = 0;
  const KIND_COMPUTE_CAP = 40; // per user per sweep — the ambient kind-completer stays cheap

  for (const uid of users) {
    if (Date.now() + budgetMs > routeDeadline) { usersLeftBehind++; continue; }
    const userDeadline = Date.now() + budgetMs;
    let userLabeled = 0, userKinds = 0;
    try {
      const { data: prof, error: profErr } = await sb.from('profiles').select('email_settings').eq('id', uid).maybeSingle();
      if (profErr) console.warn(`[label-sweep] ${uid.slice(0, 8)} profile read failed: ${profErr.message}`);
      const labelsOn = augmtdLabelsOn((prof?.email_settings ?? null) as { auto_label?: unknown } | null);

      // ── (1) THE KIND COMPLETER — in-app, every account (no provider call) ──
      const { data: kindRows, count: kindCount, error: kindErr } = await sb.from('inbox_items')
        .select('id, source_data', { count: 'exact' })
        .eq('user_id', uid).eq('status', 'pending').eq('source', 'email')
        .gte('created_at', since)
        .is('source_data->understanding->>mailKind', null)
        .is('source_data->>kind_override', null)
        .is('source_data->>kind_checked', null)
        .order('created_at', { ascending: false })
        .limit(KIND_COMPUTE_CAP);
      if (kindErr) console.warn(`[label-sweep] ${uid.slice(0, 8)} kind read failed: ${kindErr.message}`);
      const kRows = kindRows ?? [];
      kindsLeftBehind += Math.max(0, (kindCount ?? kRows.length) - kRows.length);
      let addrs: string[] | null = null; // lazily resolved once per user
      for (let k = 0; k < kRows.length; k++) {
        if (Date.now() > userDeadline) { kindsLeftBehind += kRows.length - k; break; }
        const it = kRows[k];
        const sd = (it.source_data ?? {}) as Record<string, unknown>;
        const { ensureMailKind, userAddresses } = await import('@/lib/inbox/ensure-mail-kind');
        if (!addrs) addrs = await userAddresses(sb, uid);
        const kind = await ensureMailKind(sb, uid, { id: it.id as string, source_data: sd }, addrs);
        if (kind) { kindsCompleted++; userKinds++; }
        // Judged none → stamp it checked so the paid call is not repeated every sweep.
        else await sb.from('inbox_items').update({ source_data: { ...sd, kind_checked: true } }).eq('id', it.id).eq('user_id', uid);
      }

      // ── (2) THE POSTURE LABELS — only an account that CHOSE AUGMTD labels ──
      if (!labelsOn) { usersLabelsOff++; if (userKinds > 0) usersTouched++; await stampServed(sb, uid, 'label_sweep', { skipped: 'auto_label_off', kindsCompleted: userKinds }); continue; }

      const { data: conns } = await sb.from('connections').select('provider, metadata').eq('user_id', uid).eq('status', 'active');
      const tokensByProvider = new Map((conns ?? []).map((c) => [c.provider, c.metadata?.tokens]));
      if (!tokensByProvider.size) { await stampServed(sb, uid, 'label_sweep', { skipped: 'no_connection', kindsCompleted: userKinds }); continue; }
      const gmailTokens = tokensByProvider.get('gmail');
      const gmailCache = gmailTokens ? new GmailLabelCache(gmailTokens) : undefined;

      // Not-yet-final rows only (`labeled` absent or a pre-W10 'fallback'), newest first, counted
      // exactly — the cap is a stated per-run slice, and what it leaves is reported, never dropped.
      const { data: items, count: windowCount, error: itemsError } = await sb.from('inbox_items')
        .select('id, source_data, work_state, rule_type', { count: 'exact' })
        .eq('user_id', uid).eq('status', 'pending').eq('source', 'email')
        .gte('created_at', since)
        .or('source_data->>labeled.is.null,source_data->>labeled.neq.true')
        .order('created_at', { ascending: false })
        .limit(ITEMS_PER_USER);
      if (itemsError) console.warn(`[label-sweep] ${uid.slice(0, 8)} item read failed: ${itemsError.message}`);
      const rows = items ?? [];
      itemsLeftBehind += Math.max(0, (windowCount ?? rows.length) - rows.length);

      for (let idx = 0; idx < rows.length; idx++) {
        const it = rows[idx];
        if (Date.now() > userDeadline) { itemsLeftBehind += rows.length - idx; break; } // per-user budget — never let one account burn the route
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sd = (it.source_data ?? {}) as any;
        if (sd.labeled === true) continue;                 // already handled (final)
        if (!sd.thread_id && !sd.message_id) continue;
        const provider = sd.provider as string | undefined;
        const tokens = provider ? tokensByProvider.get(provider) : undefined;
        if (!tokens) continue;
        const ruleType = it.rule_type && it.rule_type !== 'none' ? (it.rule_type as string) : null;
        if (ruleType === 'done') continue;
        // THE POSTURE (W10 — posture only, never a kind): the live lifecycle label via the ONE resolver.
        const ok = await writeBackLabels({
          provider: provider as 'gmail' | 'outlook',
          encryptedTokens: tokens,
          sd,
          ruleType,
          workState: it.work_state as string | null,
          gmailThreadId: sd.thread_id,
          gmailCache,
          outlookMessageId: sd.outlook_id ?? sd.message_id,
        });
        // Bookkeeping by HONEST outcome: 'applied' → stamp. 'noop' (no live posture) → NOT stamped:
        // nothing to apply is never recorded as success, and a posture that goes live later is
        // labelled by a later sweep. 'failed' → retried.
        if (ok === 'applied') {
          await sb.from('inbox_items').update({ source_data: { ...sd, labeled: true } }).eq('id', it.id);
          labeled++; userLabeled++;
          await new Promise((r) => setTimeout(r, 60)); // gentle throttle — avoid Gmail rate-limit bursts
        }
      }
      if (userLabeled + userKinds > 0) usersTouched++;
    } catch { /* non-fatal per user */ }
    await stampServed(sb, uid, 'label_sweep', { labeled: userLabeled, kindsCompleted: userKinds });
  }

  if (usersLeftBehind > 0) console.log(`[label-sweep] route budget spent: ${usersLeftBehind} user(s) lead the next run (least-recently-served)`);
  if (itemsLeftBehind > 0) console.log(`[label-sweep] ${itemsLeftBehind} unlabeled row(s) beyond the per-user slice or clock — the next run reaches them`);
  if (kindsLeftBehind > 0) console.log(`[label-sweep] ${kindsLeftBehind} row(s) still without a reasoned kind beyond the per-user cap or clock — the next run reaches them`);
  return NextResponse.json({ labeled, kindsCompleted, usersTouched, usersLeftBehind, itemsLeftBehind, kindsLeftBehind, usersLabelsOff, itemsPerUser: ITEMS_PER_USER, kindCap: KIND_COMPUTE_CAP, budgetMs, activeUsers: users.length });
}
