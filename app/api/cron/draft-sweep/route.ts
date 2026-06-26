import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { loadUserRules } from '@/lib/inbox/rules/load';
import { setInboxRules, classifyItem, type ItemType } from '@/lib/inbox/classify-item';
import { LABEL_TO_TYPE } from '@/lib/inbox/rules/types';
import { generateReplyDraft } from '@/lib/inbox/draft-reply';

export const maxDuration = 300;

// Auto-draft sweep. For every user whose master "Automatically draft replies" is ON, pre-generate a
// voice-grounded reply for each pending item that a rule with auto_draft enabled covers — and that
// doesn't already have a draft. The result is stored on source_data.draft so the inbox/Home show it
// "ready to review" (and /api/inbox/[id]/draft serves it instantly). Gating: master AND rule.
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: profs } = await sb.from('profiles').select('id, email_settings');
  let drafted = 0, usersTouched = 0;

  for (const p of profs ?? []) {
    const settings = (p.email_settings ?? {}) as { auto_draft?: boolean };
    if (settings.auto_draft === false) continue; // master OFF (default ON)

    const rules = await loadUserRules(p.id, sb);
    // Which item TYPES should be drafted = the set_types of rules that have auto_draft enabled.
    const draftTypes = new Set<ItemType>(
      rules.filter(r => r.enabled && r.outcome?.auto_draft?.enabled && r.outcome.set_type)
        .map(r => LABEL_TO_TYPE[r.outcome.set_type!]).filter(Boolean),
    );
    if (!draftTypes.size) continue;
    const instructions = rules.find(r => r.enabled && r.outcome?.auto_draft?.enabled)?.outcome.auto_draft?.instructions ?? null;

    setInboxRules(rules); // so classifyItem uses this user's rules
    // Fetch the actionable candidates, not just the most recent — needs_reply items can sit well
    // below a wall of newsletters. rule_type set OR an action work_state covers them; classifyItem
    // makes the final call. (Plain fyi/noise are excluded by both conditions.)
    const { data: items } = await sb.from('inbox_items')
      .select('id, source_data, work_state, rule_type, type_override, status, source')
      .eq('user_id', p.id).eq('status', 'pending')
      .or('rule_type.not.is.null,work_state.in.(work_prepared,decision_required,action_required)')
      .order('created_at', { ascending: false }).limit(200);

    let any = false;
    for (const it of items ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sd = (it.source_data ?? {}) as Record<string, any>;
      if (sd.draft?.body) continue;                       // already drafted
      if (!sd.from && !sd.from_address) continue;          // not a real email item
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!draftTypes.has(classifyItem(it as any))) continue;
      try {
        const body = await generateReplyDraft(p.id, sd, sb, instructions);
        if (body) {
          await sb.from('inbox_items')
            .update({ source_data: { ...sd, draft: { body, generated_at: new Date().toISOString() } } })
            .eq('id', it.id);
          drafted++; any = true;
        }
      } catch { /* skip this item */ }
    }
    if (any) usersTouched++;
  }

  return NextResponse.json({ drafted, usersTouched });
}
