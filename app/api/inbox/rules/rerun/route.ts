import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { EmailEnvelope } from '@/lib/ai/email-classifier-batch';

export const maxDuration = 60;

// POST /api/inbox/rules/rerun — re-evaluate the AI rules over the user's existing actionable
// inbox items within a chosen window and update their type. Rules normally apply as mail syncs
// (forward-looking); this lets a rule edit reclassify what's already there. DB-only (no inbox
// mutation). Window is capped (≤30 days) + 100 items to bound AI usage.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { days = 7, connection_id } = await request.json().catch(() => ({}));
  const windowDays = Math.min(Math.max(Number(days) || 7, 1), 30);
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  const { loadUserRules, loadInboxRules, activeAiRules } = await import('@/lib/inbox/rules/load');
  let rules;
  if (connection_id) {
    const { data: conn } = await supabase.from('connections').select('provider').eq('id', connection_id).eq('user_id', user.id).single();
    rules = await loadInboxRules(connection_id, conn?.provider ?? 'gmail', supabase);
  } else {
    rules = await loadUserRules(user.id, supabase);
  }
  const aiRules = activeAiRules(rules);
  if (!aiRules.length) return NextResponse.json({ reclassified: 0, scanned: 0 });

  let itemsQuery = supabase.from('inbox_items')
    .select('id, source_data')
    .eq('user_id', user.id).eq('status', 'pending')
    .in('work_state', ['work_prepared', 'decision_required', 'action_required'])
    .gte('created_at', since);
  if (connection_id) itemsQuery = itemsQuery.eq('connection_id', connection_id);
  const { data: items } = await itemsQuery.order('created_at', { ascending: false }).limit(100);

  const envelopes: EmailEnvelope[] = (items ?? []).map((it) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sd = (it.source_data ?? {}) as any;
    return {
      id: it.id,
      from: sd.from || sd.from_address || '',
      subject: sd.subject || '',
      snippet: sd.snippet || '',
      body_preview: (sd.body || '').slice(0, 500),
    };
  });
  if (!envelopes.length) return NextResponse.json({ reclassified: 0 });

  const { batchMatchRules } = await import('@/lib/inbox/rules/batch-match');
  const matched = await batchMatchRules(envelopes, aiRules, user.id, supabase);

  let reclassified = 0;
  for (const [id, label] of matched) {
    const { error: upErr } = await supabase.from('inbox_items')
      .update({ rule_type: label }).eq('id', id).eq('user_id', user.id);
    if (!upErr) reclassified++;
  }

  return NextResponse.json({ reclassified, scanned: envelopes.length });
}
