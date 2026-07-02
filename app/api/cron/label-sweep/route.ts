import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { writeBackLabel, GmailLabelCache, mapWorkStateToLabel } from '@/lib/inbox/rules/write-back';

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const labelFor = (it: any): string => {
    if (it.rule_type && it.rule_type !== 'none') return it.rule_type;
    const sd = it.source_data ?? {};
    if ((sd.gmail_labels ?? []).includes('CATEGORY_PROMOTIONS') || sd.has_unsubscribe) return 'marketing';
    if (it.work_state === 'noise') return 'notifications';
    if (it.work_state === 'noted') return 'fyi';
    return mapWorkStateToLabel(it.work_state) || 'fyi';
  };

  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const { data: profs } = await sb.from('profiles').select('id, email_settings');
  let labeled = 0;

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

    for (const it of items ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sd = (it.source_data ?? {}) as any;
      if (sd.labeled === true) continue;                 // already handled
      if (!sd.thread_id && !sd.message_id) continue;
      const provider = sd.provider as string | undefined;
      const tokens = provider ? tokensByProvider.get(provider) : undefined;
      if (!tokens) continue;
      const label = labelFor(it);
      if (label === 'done') continue;
      const ok = await writeBackLabel({
        provider: provider as 'gmail' | 'outlook',
        encryptedTokens: tokens,
        label: label as never,
        gmailThreadId: sd.thread_id,
        gmailCache,
        outlookMessageId: sd.outlook_id ?? sd.message_id,
      });
      // Only record "labeled" when it ACTUALLY landed — a transient failure stays unmarked and is
      // retried next sweep (the old code marked labeled even when the apply silently failed).
      if (ok) {
        await sb.from('inbox_items').update({ source_data: { ...sd, labeled: true } }).eq('id', it.id);
        labeled++;
      }
      await new Promise((r) => setTimeout(r, 60)); // gentle throttle — avoid Gmail rate-limit bursts
    }
  }

  return NextResponse.json({ labeled });
}
