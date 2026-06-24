import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { EmailEnvelope } from '@/lib/ai/email-classifier-batch';

export const maxDuration = 60;

// POST /api/inbox/rules/rerun — re-evaluate the AI rules over the user's existing actionable
// inbox items and update their type. Rules normally apply as mail syncs (forward-looking); this
// lets a rule edit reclassify what's already there. DB-only (no inbox mutation).
export async function POST() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { loadUserRules, activeAiRules } = await import('@/lib/inbox/rules/load');
  const aiRules = activeAiRules(await loadUserRules(user.id, supabase));
  if (!aiRules.length) return NextResponse.json({ reclassified: 0 });

  const { data: items } = await supabase.from('inbox_items')
    .select('id, source_data')
    .eq('user_id', user.id).eq('status', 'pending')
    .in('work_state', ['work_prepared', 'decision_required', 'action_required'])
    .order('created_at', { ascending: false }).limit(100);

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
