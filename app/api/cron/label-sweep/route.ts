import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { writeBackLabels, GmailLabelCache } from '@/lib/inbox/rules/write-back';

export const maxDuration = 300;

// Label-sweep. The sync's AUGMTD write-back is fire-and-forget and Gmail rate-limits during a batch,
// so some emails silently miss their label. This makes labeling eventually-consistent: for recent
// pending items not yet marked labeled, apply the label (SEQUENTIALLY — no rate-limit burst) and mark
// source_data.labeled=true so it's done once. Idempotent (Gmail add-label no-ops if already present).
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const { data: profs } = await sb.from('profiles').select('id, email_settings');
  let labeled = 0, kindsCompleted = 0;
  const KIND_COMPUTE_CAP = 40; // per user per sweep — the ambient kind-completer stays cheap

  for (const p of profs ?? []) {
    const settings = (p.email_settings ?? {}) as { auto_label?: boolean };
    if (settings.auto_label === false) continue; // default on

    const { data: conns } = await sb.from('connections').select('provider, metadata').eq('user_id', p.id).eq('status', 'active');
    const tokensByProvider = new Map((conns ?? []).map((c) => [c.provider, c.metadata?.tokens]));
    if (!tokensByProvider.size) continue;
    const gmailTokens = tokensByProvider.get('gmail');
    const gmailCache = gmailTokens ? new GmailLabelCache(gmailTokens) : undefined;

    const { data: items } = await sb.from('inbox_items')
      .select('id, source_data, work_state, rule_type')
      .eq('user_id', p.id).eq('status', 'pending').eq('source', 'email')
      .gte('created_at', since).limit(150);

    let kindBudget = KIND_COMPUTE_CAP;
    let addrs: string[] | null = null; // lazily resolved once per user
    for (const it of items ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sd = (it.source_data ?? {}) as any;
      if (sd.labeled === true) continue;                 // already handled
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
      if (!sd.understanding?.mailKind && !sd.kind_override && kindBudget > 0) {
        kindBudget--;
        const { ensureMailKind, userAddresses } = await import('@/lib/inbox/ensure-mail-kind');
        if (!addrs) addrs = await userAddresses(sb, p.id);
        const kind = await ensureMailKind(sb, p.id, { id: it.id as string, source_data: sd }, addrs);
        kindComputed = true;
        if (kind) kindsCompleted++;
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
        if (ok === 'applied') labeled++;
      }
      await new Promise((r) => setTimeout(r, 60)); // gentle throttle — avoid Gmail rate-limit bursts
    }
  }

  return NextResponse.json({ labeled, kindsCompleted });
}
