import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { readPlan } from '@/lib/store/item-plans';
import { generateReplyDraft } from '@/lib/inbox/draft-reply';
import { loadUserRules } from '@/lib/inbox/rules/load';
import { setInboxRules, shouldDraftReply } from '@/lib/inbox/classify-item';
import { loadPlanStepSummaries } from '@/lib/home/item-plan';
import { DRAFT_LAW_VERSION } from '@/lib/inbox/attachment-context';
import { stagedFilesOf } from '@/lib/prepare/email-card';

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
  // THE GROUND LAW: a stored draft whose ground moved (a newer inbound landed after it was
  // prepared) is SUPERSEDED — serving it would offer a dead plan in the composer. Both serve
  // points below fall through to regeneration instead.
  const { groundOf, groundMoved } = await import('@/lib/prepare/ground');
  const currentGround = await groundOf(supabase, user.id, { kind: 'inbox', id });
  // THE DRAFTER LAW VERSION: a draft written under an older drafting law is superseded the same way
  // a moved ground supersedes one. Without this, every draft that already claims "I did not receive
  // the attachment" would be served forever — the fix would ship and the lie would stand.
  const { draftLawStale } = await import('@/lib/inbox/attachment-context');
  // W9.1 · THE USER'S HAND WINS: a draft the user edited (the edit door's stamp still hashes to the
  // stored words) is NEVER superseded here — neither a moved ground nor an older drafting law
  // replaces their words. A moved ground MARKS it (`staleUnderEdit`: the card says "the thread moved
  // since you edited this"); only the user's own `?fresh=1` asks for a new version, and their words
  // file into the version chain first.
  const { isHandHeld, decideRegeneration } = await import('@/lib/prepare/hand');
  const handHeld = isHandHeld('reply_draft', sd.draft ?? null);
  const groundMovedUnder = !!sd.draft?.body && groundMoved(sd.draft?.prepared_from ?? null, currentGround);
  // W13.2 · NO SECOND DOOR FOR WORDS — the stored draft is served only through THE ONE READER's truth
  // stamp (lib/prepare/read preparedState → storedDraftWithdrawal): a draft the reader withdraws (it
  // rides the item's BASE as the answer, its words fail the one vet, it signs as another mailbox, it
  // greets the wrong person) is never served here either. The user's own edit is never judged (the
  // reader never withdraws a hand-held draft, and the hand wins below).
  let readerWithdrew: string | null = null;
  if (sd.draft?.body && !sd.draft?.sent_at && !handHeld) {
    try {
      const { preparedState, storedDraftWithdrawal } = await import('@/lib/prepare/read');
      readerWithdrew = storedDraftWithdrawal((await preparedState(supabase, user.id, { kind: 'inbox_item', id })).all);
    } catch { /* the reader unreadable is not a withdrawal — the gates above still hold */ }
  }
  // W9.1 · THE ONE DECISION (the pass's own): a moved ground, an older drafting law or a reader
  // withdrawal regenerates machine words; the user's hand is never regenerated over.
  const regen = decideRegeneration({
    exists: !!sd.draft?.body, sent: !!sd.draft?.sent_at, handHeld,
    groundMoved: groundMovedUnder, lawStale: !!sd.draft?.body && draftLawStale(sd.draft ?? null), nonLive: !!readerWithdrew,
  });
  const draftSuperseded = !!sd.draft?.body && !handHeld && regen.action === 'regenerate';
  const handFlags = handHeld ? { edited: true, ...(groundMovedUnder ? { staleUnderEdit: true } : {}) } : {};
  // W13 · A CLAIM RENDERS — the staged file the stored draft carries rides the answer, so the card
  // shows it as a chip and Send attaches exactly what the chip shows (KB-held bytes only).
  const storedFiles = stagedFilesOf(sd.draft?.attachment ?? null);
  const fileFlags = storedFiles.length ? { attachments: storedFiles } : {};
  if (!fresh && sd.draft?.body && !draftSuperseded) {
    const jrow = await readPlan(supabase, user.id, 'judgment', `inbox:${id}`);
    const cachedWork = ((jrow?.tasks ?? null) as { verdict?: { work?: string } } | null)?.verdict?.work;
    if (cachedWork === 'reply' || cachedWork === 'send_file') {
      return NextResponse.json({ draft: sd.draft.body as string, ...handFlags, ...fileFlags });
    }
    if (cachedWork && cachedWork !== 'reply' && cachedWork !== 'send_file') {
      return NextResponse.json({ draft: '', skipped: 'judged_none' });
    }
  }

  // THE ONE GATE (promise fix #1): drafting — even on-demand from the deep-dive — happens only
  // when THE judged verdict says the work is a reply. Cached on the item, so this costs a read.
  let artifactTruth: string | null = null;
  // W13: the KB file the resolver staged AS the deliverable rides the fresh draft (the pass's rule —
  // only KB-held bytes attach; a base is never here, it is not a HAVE).
  let freshAttachment: { fileId: string; filename: string; source?: string } | null = null;
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
        entityId: (linkRow?.entity_id as string) ?? null, requires: verdict.requires, work: verdict.work,
      });
      artifactTruth = reqs.artifactTruth || null;
      const kbHave = reqs.have.find((h) => h.file?.source === 'kb');
      if (kbHave?.file) freshAttachment = { fileId: kbHave.file.id, filename: kbHave.file.filename, source: kbHave.file.source };
    }
  } catch { /* judge unavailable → the gates above still hold */ }

  // Serve a previously-generated draft (sweep or earlier open) unless a fresh one is requested — only
  // reached for items that genuinely owe a reply (gated above).
  if (!fresh && sd.draft?.body && !draftSuperseded) return NextResponse.json({ draft: sd.draft.body as string, ...handFlags, ...fileFlags });

  try {
    // Fix 3 — draft ↔ plan coherence: pass the item's LIVE Identified-tasks step summaries so the reply
    // narrates one story with the plan (references an invite the plan sends; a "I'll send X" promise is
    // the same commitment as its task, not a duplicate). The inbox-item deep-dive plans under kind 'email'.
    const planSteps = await loadPlanStepSummaries(supabase, user.id, 'email', id).catch(() => []);
    // W13.2 · EVERY DRAFT PASSES THE SAME TRUTH at this door too: the fresh words go through the ONE
    // vet (lib/prepare/truth draftThroughVet — regenerated ONCE with the failure named, else NOT
    // served: the honest empty state with the withheld reason), against the item's own facts.
    const { draftThroughVet, withheldLine } = await import('@/lib/prepare/truth');
    const { inboxTruthFacts } = await import('@/lib/prepare/read');
    const vetted = await draftThroughVet(
      async (objection) => generateReplyDraft(user.id, sd, supabase,
        [artifactTruth ?? '', objection ? `REVIEWER'S OBJECTION — fix this: ${objection}` : ''].filter(Boolean).join('\n') || null, planSteps),
      { obligationOpen: inboxTruthFacts(sd)?.obligationOpen ?? false, staged: !!freshAttachment },
    );
    if (vetted.failed) return NextResponse.json({ draft: '', withheld: withheldLine(vetted.failed), ...(readerWithdrew ? { withdrawn: readerWithdrew } : {}) });
    const draft = vetted.body;
    if (!draft) return NextResponse.json({ draft: '' }); // nothing written — the next open retries
    // The user asked for a fresh version over their own edit: their words FILE first (version_of),
    // so nothing they wrote is lost — replace-in-place only as the user's own action (ruling 8).
    if (handHeld && sd.draft?.body) {
      const { fileHandVersion } = await import('@/lib/prepare/hand-store');
      await fileHandVersion(supabase, user.id, { poolKind: 'email', itemId: id, kind: 'reply_draft', content: String(sd.draft.body), editedAt: (sd.draft as { edited_by_user_at?: string }).edited_by_user_at ?? null });
    }
    await supabase.from('inbox_items')
      .update({ source_data: { ...sd, draft: { body: draft, generated_at: new Date().toISOString(), prepared_from: currentGround, law_version: DRAFT_LAW_VERSION, ...(freshAttachment ? { attachment: freshAttachment } : {}) } } })
      .eq('id', id).eq('user_id', user.id);
    const freshFiles = stagedFilesOf(freshAttachment);
    return NextResponse.json({ draft, ...(freshFiles.length ? { attachments: freshFiles } : {}) });
  } catch {
    return NextResponse.json({ error: 'Could not draft a reply.' }, { status: 500 });
  }
}
