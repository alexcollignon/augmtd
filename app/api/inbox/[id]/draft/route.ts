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
    .select('source_data, work_title, work_state, rule_type, type_override, status, source')
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
  // T3 (work-surface): an AUTOMATED sender can never receive a reply — refuse before any
  // generation AND never serve a stale pre-T3 draft for one.
  const { isAutomatedSender } = await import('@/lib/inbox/automated');
  if (isAutomatedSender((sd.from_address as string) || null, (sd.from_name as string) || null, (sd.subject as string) || '')) {
    return NextResponse.json({ draft: '', skipped: 'automated_sender' });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!shouldDraftReply(item as any)) {
    return NextResponse.json({ draft: '', skipped: 'not_a_reply' });
  }
  // THE INSTANT SERVE (Aug 7, found live — the card said "drafted by Clara", the stage said
  // "drafting…" for seconds): a STORED prepared draft serves on the CACHED judgment alone —
  // ONE read, no re-judge, no resolution pass. The P2 gate holds: a cached non-reply verdict
  // refuses here exactly as the full gate would (apply-verdict strips contradicted artifacts
  // anyway); an ABSENT cache falls through to the full judge below — never a gate bypass.
  if (!fresh && sd.draft?.body) {
    const { data: jrow } = await supabase.from('item_plans').select('tasks')
      .eq('user_id', user.id).eq('kind', 'judgment').eq('entity_id', `inbox:${id}`).maybeSingle();
    const cachedWork = ((jrow?.tasks ?? null) as { verdict?: { work?: string } } | null)?.verdict?.work;
    if (cachedWork === 'reply' || cachedWork === 'send_file') {
      return NextResponse.json({ draft: sd.draft.body as string });
    }
    if (cachedWork && cachedWork !== 'reply' && cachedWork !== 'send_file') {
      return NextResponse.json({ draft: '', skipped: 'judged_none' });
    }
  }

  // THE ONE GATE (promise fix #1): drafting — even on-demand from the deep-dive — happens only
  // when THE judged verdict says the work is a reply. Cached on the item, so this costs a read.
  let artifactTruth: string | null = null;
  try {
    const { judgeWork } = await import('@/lib/work/judge');
    const verdict = await judgeWork(supabase, user.id, { kind: 'inbox', id });
    if (verdict.work !== 'reply' && verdict.work !== 'send_file') {
      return NextResponse.json({ draft: '', skipped: 'judged_none' });
    }
    // THE DELIVERABLE RESOLUTION (one law, every drafting door): a verdict carrying an artifact
    // inventory resolves it first — found items stage, missing ones become the room's ask, and the
    // fresh draft below is constrained to the ARTIFACT TRUTH (never claims what isn't in hand).
    if (verdict.requires?.length) {
      const { resolveRequirements } = await import('@/lib/prepare/requirements');
      const { data: linkRow } = await supabase.from('entity_links').select('entity_id')
        .eq('user_id', user.id).eq('item_kind', 'inbox_item').eq('item_id', id).not('entity_id', 'is', null).maybeSingle();
      const reqs = await resolveRequirements(supabase, user.id, {
        itemKind: 'inbox', itemId: id, itemTitle: String(item.work_title ?? sd.subject ?? ''),
        entityId: (linkRow?.entity_id as string) ?? null, requires: verdict.requires,
      });
      artifactTruth = reqs.artifactTruth || null;
    }
  } catch { /* judge unavailable → the gates above still hold */ }

  // Serve a previously-generated draft (sweep or earlier open) unless a fresh one is requested — only
  // reached for items that genuinely owe a reply (gated above).
  if (!fresh && sd.draft?.body) return NextResponse.json({ draft: sd.draft.body as string });

  try {
    // Fix 3 — draft ↔ plan coherence: pass the item's LIVE Identified-tasks step summaries so the reply
    // narrates one story with the plan (references an invite the plan sends; a "I'll send X" promise is
    // the same commitment as its task, not a duplicate). The inbox-item deep-dive plans under kind 'email'.
    const planSteps = await loadPlanStepSummaries(supabase, user.id, 'email', id).catch(() => []);
    const draft = await generateReplyDraft(user.id, sd, supabase, artifactTruth, planSteps);
    await supabase.from('inbox_items')
      .update({ source_data: { ...sd, draft: { body: draft, generated_at: new Date().toISOString() } } })
      .eq('id', id).eq('user_id', user.id);
    return NextResponse.json({ draft });
  } catch {
    return NextResponse.json({ error: 'Could not draft a reply.' }, { status: 500 });
  }
}
