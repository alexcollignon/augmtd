import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateReplyDraft } from '@/lib/inbox/draft-reply';
import { loadUserRules } from '@/lib/inbox/rules/load';
import { setInboxRules, shouldDraftReply } from '@/lib/inbox/classify-item';
import { loadPlanStepSummaries } from '@/lib/home/item-plan';

export const maxDuration = 30;

// POST /api/inbox/[id]/draft — a voice-grounded reply draft for one inbox item. Returns the
// auto-draft if the sweep already produced one (instant, "ready to review"); otherwise generates
// on demand and caches it on the item so the next open is instant. ?fresh=1 forces regeneration.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fresh = new URL(req.url).searchParams.get('fresh') === '1';
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: item } = await supabase.from('inbox_items')
    .select('source_data, work_state, rule_type, type_override, status, source')
    .eq('id', id).eq('user_id', user.id).single();
  if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sd = (item.source_data ?? {}) as Record<string, any>;

  // Only draft when the item GENUINELY owes a reply — never for FYI/`noted` mail or a CC-only
  // bystander thread (a newsletter, or a thread you're only CC'd on, must never get a reply draft,
  // even opened in the deep-dive). Gate on the item's own classification (work_state + classifyItem),
  // never sender/subject keywords. Load the user's rules so classifyItem uses their edited
  // deterministic tier, not just the seeds. This gate runs BEFORE serving any stored draft so a stale
  // draft (e.g. a pre-A2 Portuguese draft left on a `noted` item) is never returned.
  try {
    const rules = await loadUserRules(user.id, supabase);
    setInboxRules(rules);
  } catch { /* fall back to default rules */ }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!shouldDraftReply(item as any)) {
    return NextResponse.json({ draft: '', skipped: 'not_a_reply' });
  }

  // Serve a previously-generated draft (sweep or earlier open) unless a fresh one is requested — only
  // reached for items that genuinely owe a reply (gated above).
  if (!fresh && sd.draft?.body) return NextResponse.json({ draft: sd.draft.body as string });

  try {
    // Fix 3 — draft ↔ plan coherence: pass the item's LIVE Identified-tasks step summaries so the reply
    // narrates one story with the plan (references an invite the plan sends; a "I'll send X" promise is
    // the same commitment as its task, not a duplicate). The inbox-item deep-dive plans under kind 'email'.
    const planSteps = await loadPlanStepSummaries(supabase, user.id, 'email', id).catch(() => []);
    const draft = await generateReplyDraft(user.id, sd, supabase, null, planSteps);
    await supabase.from('inbox_items')
      .update({ source_data: { ...sd, draft: { body: draft, generated_at: new Date().toISOString() } } })
      .eq('id', id).eq('user_id', user.id);
    return NextResponse.json({ draft });
  } catch {
    return NextResponse.json({ error: 'Could not draft a reply.' }, { status: 500 });
  }
}
