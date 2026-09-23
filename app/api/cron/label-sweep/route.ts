import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { writeBackLabels, GmailLabelCache } from '@/lib/inbox/rules/write-back';
import { hasBearer } from '@/lib/utils/bearer-auth';
import { activeUserIds, orderLeastRecentlyServed, stampServed } from '@/lib/work/sweep-users';

export const maxDuration = 300;

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

  let labeled = 0, kindsCompleted = 0, usersTouched = 0, usersLeftBehind = 0;
  const KIND_COMPUTE_CAP = 40; // per user per sweep — the ambient kind-completer stays cheap

  for (const uid of users) {
    if (Date.now() + budgetMs > routeDeadline) { usersLeftBehind++; continue; }
    const userDeadline = Date.now() + budgetMs;
    let userLabeled = 0, userKinds = 0;
    try {
      const { data: prof } = await sb.from('profiles').select('email_settings').eq('id', uid).maybeSingle();
      const settings = (prof?.email_settings ?? {}) as { auto_label?: boolean };
      if (settings.auto_label === false) { await stampServed(sb, uid, 'label_sweep', { skipped: 'auto_label_off' }); continue; }

      const { data: conns } = await sb.from('connections').select('provider, metadata').eq('user_id', uid).eq('status', 'active');
      const tokensByProvider = new Map((conns ?? []).map((c) => [c.provider, c.metadata?.tokens]));
      if (!tokensByProvider.size) { await stampServed(sb, uid, 'label_sweep', { skipped: 'no_connection' }); continue; }
      const gmailTokens = tokensByProvider.get('gmail');
      const gmailCache = gmailTokens ? new GmailLabelCache(gmailTokens) : undefined;

      const { data: items } = await sb.from('inbox_items')
        .select('id, source_data, work_state, rule_type')
        .eq('user_id', uid).eq('status', 'pending').eq('source', 'email')
        .gte('created_at', since).limit(150);

      let kindBudget = KIND_COMPUTE_CAP;
      let addrs: string[] | null = null; // lazily resolved once per user
      for (const it of items ?? []) {
        if (Date.now() > userDeadline) break; // per-user budget — never let one account burn the route
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sd = (it.source_data ?? {}) as any;
        if (sd.labeled === true) continue;                 // already handled (final)
        // THE UPGRADE LAW (July 31): 'fallback' = a structural placeholder awaiting the reasoned
        // kind. Work it ONLY when the completer has budget to actually reason (else the re-apply
        // would just re-stamp the same guess as final) — next sweep picks it up otherwise.
        const needsReasonedKind = !sd.understanding?.mailKind && !sd.kind_override;
        if (sd.labeled === 'fallback' && needsReasonedKind && kindBudget <= 0) continue;
        if (!sd.thread_id && !sd.message_id) continue;
        const provider = sd.provider as string | undefined;
        const tokens = provider ? tokensByProvider.get(provider) : undefined;
        if (!tokens) continue;
        // THE LABEL FLIP: the pair (kind + posture) via the ONE resolver. The sweep runs with the
        // FULL source_data, so it's the completeness backstop — the reasoned kind lands here even
        // when the sync fast-path only had header signals.
        const ruleType = it.rule_type && it.rule_type !== 'none' ? (it.rule_type as string) : null;
        if (ruleType === 'done') continue;
        // THE KIND COMPLETER (the cause-fix for permanently-unlabeled mail): fast-pathed
        // transactional mail has NO understanding and NO bulk headers — nothing for resolveKind.
        // The sweep MAKES the reasoned kind land (merge-only-mailKind, routing-inert) before
        // applying, instead of waiting for an understanding nothing else computes.
        let kindComputed = false;
        if (needsReasonedKind && kindBudget > 0) {
          kindBudget--;
          const { ensureMailKind, userAddresses } = await import('@/lib/inbox/ensure-mail-kind');
          if (!addrs) addrs = await userAddresses(sb, uid);
          const kind = await ensureMailKind(sb, uid, { id: it.id as string, source_data: sd }, addrs);
          kindComputed = true;
          if (kind) { kindsCompleted++; userKinds++; }
        }
        const bulk = ((sd.gmail_labels ?? []) as string[]).includes('CATEGORY_PROMOTIONS') || sd.has_unsubscribe === true;
        const ok = await writeBackLabels({
          provider: provider as 'gmail' | 'outlook',
          encryptedTokens: tokens,
          sd,
          ruleType,
          workState: it.work_state as string | null,
          hints: { bulk, noise: it.work_state === 'noise' },
          gmailThreadId: sd.thread_id,
          gmailCache,
          outlookMessageId: sd.outlook_id ?? sd.message_id,
        });
        // Bookkeeping by HONEST outcome: 'applied' → stamp. 'noop' AFTER a kind compute → stamp too
        // (the reasoned kind was judged and still nothing to label — final, stop revisiting).
        // 'noop' without a compute (budget exhausted) → left for the next sweep. 'failed' → retry.
        if (ok === 'applied' || (ok === 'noop' && kindComputed)) {
          await sb.from('inbox_items').update({ source_data: { ...sd, labeled: true } }).eq('id', it.id);
          if (ok === 'applied') { labeled++; userLabeled++; }
        }
        await new Promise((r) => setTimeout(r, 60)); // gentle throttle — avoid Gmail rate-limit bursts
      }
      if (userLabeled + userKinds > 0) usersTouched++;
    } catch { /* non-fatal per user */ }
    await stampServed(sb, uid, 'label_sweep', { labeled: userLabeled, kindsCompleted: userKinds });
  }

  if (usersLeftBehind > 0) console.log(`[label-sweep] route budget spent: ${usersLeftBehind} user(s) lead the next run (least-recently-served)`);
  return NextResponse.json({ labeled, kindsCompleted, usersTouched, usersLeftBehind, budgetMs, activeUsers: users.length });
}
