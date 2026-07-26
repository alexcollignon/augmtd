// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PREPARATION ENGINE (Prepared-Work Phase C + work-loop W4, docs/work-loop-plan.md).
//
// ONE engine, two callers:
//   • runPreparationPass — the ambient cron walker (draft-sweep): picks the working set, trickles
//     through prepareOneItem under the caps.
//   • POST /api/items/prepare-now — the user's ON-DEMAND trigger ("Prepare this" / the CTA's
//     "Draft it now"): the SAME prepareOneItem for a single item, right now.
//
// prepareOneItem prepares by SHAPE — prepared-by-default, approved-at-the-commit-line (nothing ever
// sends): reply items get a voice draft; waiting-on-a-named-person gets a nudge; judgment shapes
// (prepare_document / research_analyze) route to the right COWORKER; send_document resolves the file
// + drafts the send. Idempotent everywhere: an existing fresh preparation is never re-generated.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkItem } from '@/lib/work-items/model';
import { buildWorkItems } from '@/lib/work-items/model';
import { partitionDailyReport } from '@/lib/work-items/report';
import { generateReplyDraft, generateNudgeDraft, getDraftingAssistant } from '@/lib/inbox/draft-reply';
import { routeTasks, type TaskRoute } from '@/lib/prepare/route-suggestion';
import { evaluateDeliverable, type EvalVerdict } from '@/lib/prepare/evaluate';
import { aiCall } from '@/lib/ai/call';

// ── O4: the CoS EVALUATOR wraps every generated draft — review, ONE capped revision on a substantive
// objection, and an honest stored verdict (a post-revision "revise" becomes a "flag": the work still
// surfaces, annotated, never silently discarded). ──
async function reviewAndRevise(
  admin: SupabaseClient, userId: string,
  args: { body: string; task: string; recipient: string | null; entityId: string | null; kind: 'reply' | 'nudge' | 'deliverable' },
  regenerate: (objection: string) => Promise<string | null>,
): Promise<{ body: string; review: EvalVerdict }> {
  let body = args.body;
  let review = await evaluateDeliverable(admin, userId, { content: body, task: args.task, recipient: args.recipient, entityId: args.entityId, kind: args.kind });
  if (review.verdict === 'revise' && review.objection) {
    const revised = await regenerate(review.objection).catch(() => null);
    if (revised) {
      body = revised;
      review = await evaluateDeliverable(admin, userId, { content: body, task: args.task, recipient: args.recipient, entityId: args.entityId, kind: args.kind });
    }
    if (review.verdict === 'revise') review = { verdict: 'flag', objection: review.objection }; // the cap: surface annotated
  }
  return { body, review };
}
import { resolveFileUniversal } from '@/lib/knowledge/resolve';
import { logActivity } from '@/lib/activity/log';

const TOP_N = 8;          // prepare the working set, not the inventory
const FRESH_HOURS = 24;   // a draft older than this (or older than new thread activity) re-prepares

export type PrepareResult = { prepared: number; skipped: number; nudges: number; delegated: number };

// ── O2: routing is THE ROSTER JUDGE (lib/prepare/route-suggestion.ts routeTasks) — one reasoned
// call with the user's actual roster in view. The old hardcoded shape→role map is deleted: a map is
// not a judgment, and it froze the roster (a new coworker/skill/vertical pack was invisible to routing).
const DELEGATE_CAP = 2; // coworker runs are the expensive preparation — trickle, don't burst

// ════════════════════════════════════════════════════════════════════════════════════════════════
// prepareOneItem — THE ONE per-item engine (W4). Returns what it did (or the honest reason it
// didn't); never sends, never throws (branch failures → skipped).
// ════════════════════════════════════════════════════════════════════════════════════════════════

type WorkerRow = { id: string; name: string; worker_role: string | null; is_worker: boolean | null };
export type PrepareOneResult = {
  did: 'draft' | 'nudge' | 'delegated' | 'docsend' | 'none';
  worker?: string;   // the coworker's name when did === 'delegated'
  reason?: string;   // the honest why when did === 'none'
};

export async function prepareOneItem(
  admin: SupabaseClient, userId: string, w: WorkItem,
  opts?: { route?: TaskRoute },
): Promise<PrepareOneResult> {
  try {
    const done = (r: PrepareOneResult) => narratePrepare(admin, userId, w, r);
    // A reply you owe → a voice draft on the thread.
    if (w.kind === 'reply' && w.id.startsWith('inbox:')) return await done(await prepareReplyDraft(admin, userId, w));
    // Waiting on a NAMED person → a nudge draft.
    if (w.state === 'waiting' && w.blockedOn) return await done(await prepareNudge(admin, userId, w));
    if (w.automated) return { did: 'none', reason: 'automated notice — nothing to prepare' };
    if (!w.id.startsWith('inbox:') && !w.id.startsWith('commit:')) return { did: 'none', reason: 'not a preparable item' };

    // J4 (judged room): the pass prepares FROM THE ONE WORK JUDGMENT — the same cached verdict the
    // surface mounts, so ambient work and the room can never disagree about what an item needs.
    // (opts.route remains a caller-supplied override for batch flows.)
    if (opts?.route) {
      if (opts.route.sendDoc) return await done(await prepareDocSend(admin, userId, w));
      if (!opts.route.worker) return { did: 'none', reason: 'this one needs you — no preparation applies' };
      return await done(await delegatePrepare(admin, userId, w, { id: opts.route.worker.id, name: opts.route.worker.name, worker_role: opts.route.worker.role, is_worker: true }));
    }
    const { judgeWork } = await import('@/lib/work/judge');
    const verdict = await judgeWork(admin, userId, { kind: w.id.startsWith('commit:') ? 'commitment' : 'inbox', id: w.entityId });
    if (verdict.work === 'send_file') return await done(await prepareDocSend(admin, userId, w));
    if (verdict.work === 'chase' && w.who) return await done(await prepareNudge(admin, userId, { ...w, blockedOn: w.blockedOn ?? w.who }));
    if (verdict.work === 'produce' && verdict.executor.kind === 'coworker' && verdict.executor.id) {
      return await done(await delegatePrepare(admin, userId, w, { id: verdict.executor.id, name: verdict.executor.name ?? 'Coworker', worker_role: null, is_worker: true }));
    }
    if (verdict.work === 'reply') return await done(await prepareReplyDraft(admin, userId, w));
    return { did: 'none', reason: verdict.reason || 'this one needs you — no preparation applies' };
  } catch { return { did: 'none', reason: 'preparation failed — try again' }; }
}

// ── R1 (one-room): THE ENGINE NARRATES — a successful ambient prepare writes a durable turn into
// the item's room, so opening it shows what happened while the user was away (a colleague's thread
// that moved, not a silent badge). Authored when a coworker did the work; deduped per item so
// repeated sweeps re-surface one line instead of stuttering. Non-fatal, zero AI. ──
async function narratePrepare(
  admin: SupabaseClient, userId: string, w: WorkItem, r: PrepareOneResult,
): Promise<PrepareOneResult> {
  if (r.did === 'none') return r;
  try {
    const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
    const itemKind = w.id.startsWith('commit:') ? 'commitment' as const : 'inbox' as const;
    const roomKey = await roomKeyForItem(admin, userId, itemKind, w.entityId);
    const first = r.worker ? r.worker.split(' ')[0] : null;
    const text =
      r.did === 'draft' ? `${first ?? 'I'} drafted the reply on "${w.title.slice(0, 80)}" — it's ready to review.` :
      r.did === 'nudge' ? `${first ?? 'I'} drafted the follow-up nudge on "${w.title.slice(0, 80)}".` :
      r.did === 'docsend' ? `${first ?? 'I'} found the file and drafted the send on "${w.title.slice(0, 80)}".` :
      `${first ?? 'A coworker'} is on "${w.title.slice(0, 80)}" — the work lands here when it's ready.`;
    await writeRoomTurn(admin, userId, roomKey, {
      role: 'system', text,
      author: r.worker ? { kind: 'coworker', name: r.worker } : null,
      dedupeKey: `prep:${w.id}`,
    });
  } catch { /* narration is an enhancement — the prepared work already landed */ }
  return r;
}

// ── The reply-draft branch (slice 1). ──
async function prepareReplyDraft(admin: SupabaseClient, userId: string, w: WorkItem): Promise<PrepareOneResult> {
  const { data: it } = await admin.from('inbox_items').select('id, source_data, last_activity_at, status, rule_type')
    .eq('id', w.entityId).eq('user_id', userId).maybeSingle();
  if (!it || it.status !== 'pending') return { did: 'none', reason: 'no longer open' };
  const sd = (it.source_data ?? {}) as Record<string, unknown>;
  // T3 (work-surface): NEVER draft a reply to an automated sender — the reply reaches no one
  // (the password-reset-got-a-draft bug). Structural, before any generation.
  const { isAutomatedSender } = await import('@/lib/inbox/automated');
  if (isAutomatedSender((sd.from_address as string) || null, (sd.from_name as string) || null, (sd.subject as string) || '')) {
    return { did: 'none', reason: 'automated sender — a reply would reach no one' };
  }
  // M2 (work-surface): the mailKind refines UNDER the rules — receipts/newsletters/notifications/
  // cold outreach never get an ambient draft UNLESS a rule explicitly classified this needs_reply
  // (the user's rules are authoritative; the kind only fills where they didn't speak).
  const { coerceUnderstanding } = await import('@/lib/inbox/item-understanding');
  const uKind = coerceUnderstanding(sd.understanding)?.mailKind;
  if (uKind && ['receipt', 'newsletter', 'notification', 'cold_outreach', 'calendar'].includes(uKind) && it.rule_type !== 'needs_reply') {
    return { did: 'none', reason: `${uKind.replace('_', ' ')} — no reply expected` };
  }
  const existing = (sd.draft ?? null) as { body?: string; generated_at?: string } | null;
  const stale = !existing?.body
    || (Date.now() - Date.parse(existing.generated_at || '0')) > FRESH_HOURS * 3_600_000
    || (!!it.last_activity_at && Date.parse(it.last_activity_at as string) > Date.parse(existing.generated_at || '0'));
  if (!stale) return { did: 'none', reason: 'a fresh draft is already on it' };
  const raw = await generateReplyDraft(userId, sd as Record<string, never>, admin, null);
  if (!raw) return { did: 'none', reason: 'could not draft this' };
  // O4: the CoS review before it reaches the desk (one capped revision on a substantive objection).
  const sender = [String(sd.from_name || ''), sd.from_address ? `<${sd.from_address}>` : ''].filter(Boolean).join(' ') || String(sd.from || '') || null;
  const { body, review } = await reviewAndRevise(admin, userId,
    { body: raw, task: w.title, recipient: sender, entityId: w.entity?.id ?? null, kind: 'reply' },
    (objection) => generateReplyDraft(userId, sd as Record<string, never>, admin, `REVIEWER'S OBJECTION — fix this in the reply: ${objection}`));
  // O3a: ambient work is ATTRIBUTED — the assistant coworker drafted this (her skills shaped it).
  const pa = await getDraftingAssistant(admin, userId);
  await admin.from('inbox_items')
    .update({ source_data: { ...sd, draft: { body, generated_at: new Date().toISOString(), prepared: 'pass', ...(review.verdict !== 'pass' ? { review } : {}) }, ...(pa ? { prepared_by: { worker: pa.name, at: new Date().toISOString() } } : {}) } })
    .eq('id', it.id);
  return { did: 'draft', worker: pa?.name };
}

// ── The nudge branch (slice 1) — inbox waits land on source_data, commitment waits in the pool. ──
async function prepareNudge(admin: SupabaseClient, userId: string, w: WorkItem): Promise<PrepareOneResult> {
  const ageDays = Math.max(0, Math.round((Date.now() - Date.parse(w.startAt)) / 86_400_000));
  if (w.id.startsWith('inbox:')) {
    const { data: it } = await admin.from('inbox_items').select('id, source_data, status').eq('id', w.entityId).eq('user_id', userId).maybeSingle();
    if (!it || it.status !== 'pending') return { did: 'none', reason: 'no longer open' };
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    const existing = (sd.nudge_draft ?? null) as { generated_at?: string } | null;
    if (existing && (Date.now() - Date.parse(existing.generated_at || '0')) < FRESH_HOURS * 3_600_000) return { did: 'none', reason: 'a fresh nudge is already on it' };
    const raw = await generateNudgeDraft(userId, { counterparty: w.blockedOn, description: w.title, ageDays }, admin);
    if (!raw) return { did: 'none', reason: 'could not draft the nudge' };
    const { body, review } = await reviewAndRevise(admin, userId, // O4 review
      { body: raw, task: w.title, recipient: w.blockedOn, entityId: w.entity?.id ?? null, kind: 'nudge' },
      (objection) => generateNudgeDraft(userId, { counterparty: w.blockedOn, description: w.title, ageDays, instructions: `REVIEWER'S OBJECTION — fix this: ${objection}` }, admin));
    const pa = await getDraftingAssistant(admin, userId); // O3a attribution
    await admin.from('inbox_items')
      .update({ source_data: { ...sd, nudge_draft: { body, generated_at: new Date().toISOString(), prepared: 'pass', ...(review.verdict !== 'pass' ? { review } : {}) }, ...(pa ? { prepared_by: { worker: pa.name, at: new Date().toISOString() } } : {}) } })
      .eq('id', it.id);
    return { did: 'nudge', worker: pa?.name };
  }
  if (w.id.startsWith('commit:')) {
    // Commitments have no source_data — the nudge lands in the item_deliverables pool (type 'draft'),
    // which the deep-dive + downstream steps already read.
    const { data: existing } = await admin.from('item_deliverables').select('id, created_at')
      .eq('user_id', userId).eq('kind', 'commitment').eq('entity_id', w.entityId).eq('type', 'draft')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (existing && (Date.now() - Date.parse(existing.created_at as string)) < FRESH_HOURS * 3_600_000) return { did: 'none', reason: 'a fresh nudge is already on it' };
    const raw = await generateNudgeDraft(userId, { counterparty: w.blockedOn, description: w.title, ageDays }, admin);
    if (!raw) return { did: 'none', reason: 'could not draft the nudge' };
    const { body, review } = await reviewAndRevise(admin, userId, // O4 review
      { body: raw, task: w.title, recipient: w.blockedOn, entityId: w.entity?.id ?? null, kind: 'nudge' },
      (objection) => generateNudgeDraft(userId, { counterparty: w.blockedOn, description: w.title, ageDays, instructions: `REVIEWER'S OBJECTION — fix this: ${objection}` }, admin));
    const pa = await getDraftingAssistant(admin, userId); // O3a attribution
    await admin.from('item_deliverables').insert({
      user_id: userId, kind: 'commitment', entity_id: w.entityId, type: 'draft',
      title: `Nudge — ${(w.blockedOn || '').split('<')[0].trim()}`.slice(0, 100), content: body, ref: null,
      metadata: { ...(pa ? { agentName: pa.name } : {}), ...(review.verdict !== 'pass' ? { review } : {}) },
    }).then(() => {}, () => {});
    return { did: 'nudge', worker: pa?.name };
  }
  return { did: 'none', reason: 'not a preparable item' };
}

// ── C2 · the COWORKER branch — judgment shapes are prepared by the right coworker, with the item's
// grounding + the deliverable pool (runDelegation reads+writes it). Idempotent per item. Nothing
// sends — prompt-level prepare-and-hand-back guardrail lives in buildDelegationPrompt. ──
async function delegatePrepare(admin: SupabaseClient, userId: string, w: WorkItem, worker: WorkerRow): Promise<PrepareOneResult> {
  const poolKind = w.id.startsWith('commit:') ? 'commitment' : 'email';
  const { data: prior } = await admin.from('item_deliverables').select('id')
    .eq('user_id', userId).eq('kind', poolKind).eq('entity_id', w.entityId).eq('task_id', 'prepare-pass').limit(1).maybeSingle();
  if (prior) return { did: 'none', reason: `${worker.name.split(' ')[0]} already prepared this`, worker: worker.name };
  const { buildDelegationPrompt, runDelegation } = await import('@/lib/home/delegate');
  // O3b: THE DELEGATION ENVELOPE — the brain briefs the coworker like a real chief of staff: the
  // deal's state + goals/rules AND the counterparty's person-brain ride every hand-off. Non-fatal.
  let brainContext = '';
  try {
    const bits: string[] = [];
    if (w.entity?.id) {
      const { data: ent } = await admin.from('work_entities').select('name, state, goals, rules')
        .eq('id', w.entity.id).eq('user_id', userId).maybeSingle();
      if (ent) {
        const st = (ent.state ?? {}) as { summary?: string };
        const goals = Array.isArray(ent.goals) ? (ent.goals as string[]).filter(Boolean) : [];
        const rules = Array.isArray(ent.rules) ? (ent.rules as string[]).filter(Boolean) : [];
        const lines = [`[THE BODY OF WORK — ${ent.name}]`];
        if (st.summary) lines.push(`Where it stands: ${st.summary}`);
        if (goals.length) lines.push(`Goals: ${goals.join(' · ')}`);
        if (rules.length) lines.push(`Rules to respect: ${rules.join(' · ')}`);
        if (lines.length > 1) bits.push(lines.join('\n'));
      }
    }
    if (w.who) {
      const { renderBrainContext } = await import('@/lib/context/brain-context');
      const { parseWho } = await import('@/lib/entities/people');
      const { email, name } = parseWho(w.who);
      const personBlock = await renderBrainContext(admin, userId, { personEmail: email, personName: name });
      if (personBlock) bits.push(personBlock);
    }
    brainContext = bits.join('\n\n');
  } catch { /* the envelope is an enhancement — the hand-off still carries the item context */ }
  const prompt = buildDelegationPrompt({
    kind: poolKind,
    itemContext: `TASK: ${w.title}\n` + (w.who ? `Counterparty: ${w.who}\n` : '') +
      (w.entity ? `Body of work: ${w.entity.name}\n` : '') + (w.when.explicit ? `Due: ${w.when.explicit}\n` : ''),
    step: { text: w.title.slice(0, 120), detail: 'Produce the prepared deliverable your craft yields for this, ready for my review.' },
    brainContext: brainContext || undefined,
  });
  await runDelegation({
    supabase: admin, userId, worker, prompt, itemLabel: w.title.slice(0, 80),
    pool: { kind: poolKind, entityId: w.entityId, taskId: 'prepare-pass' },
    provenance: { item: w.title.slice(0, 100), ...(w.entity ? { entity: w.entity.name } : {}), ...(w.who ? { who: w.who } : {}), ...(w.when.explicit ? { due: w.when.explicit } : {}) },
  });
  // ATTRIBUTION — the card/deep-dive reads who prepared it (the jaws-drop is arrival + attribution).
  if (w.id.startsWith('inbox:')) {
    const { data: it } = await admin.from('inbox_items').select('source_data').eq('id', w.entityId).maybeSingle();
    const sd = (it?.source_data ?? {}) as Record<string, unknown>;
    await admin.from('inbox_items').update({ source_data: { ...sd, prepared_by: { worker: worker.name, at: new Date().toISOString() } } }).eq('id', w.entityId).then(() => {}, () => {});
  }
  // O4: the CoS reviews the coworker's deliverable (annotate-only — a full delegation re-run is not
  // worth the cost; a non-pass verdict rides the deliverable's metadata so the desk sees the caution).
  try {
    const { data: del } = await admin.from('item_deliverables').select('id, content, metadata')
      .eq('user_id', userId).eq('kind', poolKind).eq('entity_id', w.entityId).eq('task_id', 'prepare-pass')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (del?.content) {
      const review = await evaluateDeliverable(admin, userId, {
        content: String(del.content), task: w.title, recipient: w.who ?? null, entityId: w.entity?.id ?? null, kind: 'deliverable',
      });
      if (review.verdict !== 'pass') {
        await admin.from('item_deliverables')
          .update({ metadata: { ...((del.metadata ?? {}) as Record<string, unknown>), review } }).eq('id', del.id);
      }
    }
  } catch { /* review is an enhancement */ }
  // The Activity TRAIL — pass-initiated delegations appear on the timeline like user-initiated ones.
  await logActivity(admin, userId, {
    type: 'delegated_prepared', title: `${worker.name} prepared: ${w.title.slice(0, 70)}`,
    entityType: w.id.startsWith('commit:') ? 'commitment' : 'inbox_item', entityId: w.entityId,
    metadata: { via: 'preparation_pass', worker: worker.name, role: worker.worker_role },
  }).catch(() => {});
  return { did: 'delegated', worker: worker.name };
}

// ── C3 · the DOC-SEND branch — a send-an-existing-file task gets the FILE RESOLVED (universal
// registry: pool → KB → drives) and a ready draft with the attachment reference. The approve-gate
// holds: nothing sends; the deep-dive leads with the prepared draft + file. ──
async function prepareDocSend(admin: SupabaseClient, userId: string, w: WorkItem): Promise<PrepareOneResult> {
  if (w.id.startsWith('commit:')) {
    const { data: prior } = await admin.from('item_deliverables').select('id, metadata, created_at')
      .eq('user_id', userId).eq('kind', 'commitment').eq('entity_id', w.entityId).eq('type', 'draft')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if ((prior?.metadata as { attachment?: unknown } | null)?.attachment) return { did: 'none', reason: 'already prepared with the file' };
    const cCands = await resolveFileUniversal(admin, { userId, entityId: w.entity?.id ?? null }, w.title, 4).catch(() => []);
    const cTop = cCands.find((c) => c.source === 'kb');
    if (!cTop || cTop.score < 0.7) return { did: 'none', reason: 'could not find the document to send' };
    const cJudge = await aiCall<{ match?: boolean }>({
      userId, supabase: admin, shape: { output: 'json' }, temperature: 0, maxTokens: 60, source: 'task_preparation',
      prompt: `TASK: ${w.title.slice(0, 140)}\nCANDIDATE FILE: "${cTop.filename}"\nSnippet: ${cTop.snippet.slice(0, 200)}\n\n` +
        `Is this file THE document the task asks to send/share (not merely related)? JSON only: {"match":true|false}`,
    }).catch(() => ({ json: { match: false } }));
    if (cJudge.json?.match !== true) return { did: 'none', reason: 'no confident file match' };
    const cBody = await generateNudgeDraft(userId, { counterparty: w.who ?? w.blockedOn ?? null, description: `${w.title} — the document "${cTop.filename}" will be attached.` }, admin).catch(() => null);
    if (!cBody) return { did: 'none', reason: 'could not draft the send' };
    const { writeDeliverable } = await import('@/lib/home/deliverable-pool');
    const paC = await getDraftingAssistant(admin, userId); // O3a attribution
    await writeDeliverable(admin, userId, {
      kind: 'commitment', entityId: w.entityId, taskId: 'prepare-pass-docsend', type: 'draft',
      title: `Send ${cTop.filename}`.slice(0, 100), content: cBody, gist: `send draft with ${cTop.filename}`,
      metadata: { source: 'preparation_pass', ...(paC ? { agentName: paC.name } : {}), attachment: { fileId: cTop.id, filename: cTop.filename, source: cTop.source }, provenance: { item: w.title.slice(0, 100), ...(w.entity ? { entity: w.entity.name } : {}) } },
    }).catch(() => {});
    return { did: 'docsend', worker: paC?.name };
  }
  if (!w.id.startsWith('inbox:')) return { did: 'none', reason: 'not a preparable item' };
  const { data: it } = await admin.from('inbox_items').select('id, source_data, status').eq('id', w.entityId).eq('user_id', userId).maybeSingle();
  if (!it || it.status !== 'pending') return { did: 'none', reason: 'no longer open' };
  const sd = (it.source_data ?? {}) as Record<string, unknown>;
  const existingDraft = (sd.draft ?? null) as { body?: string; attachment?: unknown } | null;
  if (existingDraft?.attachment) return { did: 'none', reason: 'already prepared with the file' };
  const cands = await resolveFileUniversal(admin, { userId, entityId: w.entity?.id ?? null }, w.title, 4).catch(() => []);
  // Only attach on a CONFIDENT KB hit (bytes we hold → previewable + attachable); drive-catalog
  // candidates surface in the deep-dive picker instead of silently auto-attaching.
  const top = cands.find((c) => c.source === 'kb');
  if (!top || top.score < 0.7) return { did: 'none', reason: 'could not find the document to send' };
  // THE REASONED PICK (the S4 rule — a score is retrieval, not judgment): one cheap yes/no on
  // whether this file IS what the task asks to send. Reject → no auto-attach (the deep-dive's
  // picker offers candidates instead). A wrong attach is worse than none — trust is the product.
  const judge = await aiCall<{ match?: boolean }>({
    userId, supabase: admin, shape: { output: 'json' }, temperature: 0, maxTokens: 60, source: 'task_preparation',
    prompt: `TASK: ${w.title.slice(0, 140)}\nCANDIDATE FILE: "${top.filename}"\nSnippet: ${top.snippet.slice(0, 200)}\n\n` +
      `Is this file THE document the task asks to send/share (not merely related)? JSON only: {"match":true|false}`,
  }).catch(() => ({ json: { match: false } }));
  if (judge.json?.match !== true) return { did: 'none', reason: 'no confident file match' };
  const body = existingDraft?.body
    || (await generateReplyDraft(userId, sd as Record<string, never>, admin, `The reply should send the document "${top.filename}" (it will be attached).`).catch(() => null));
  if (!body) return { did: 'none', reason: 'could not draft the send' };
  const pa = await getDraftingAssistant(admin, userId); // O3a attribution
  await admin.from('inbox_items').update({
    source_data: { ...sd, draft: { body, generated_at: new Date().toISOString(), prepared: 'pass', attachment: { fileId: top.id, filename: top.filename, source: top.source } }, ...(pa ? { prepared_by: { worker: pa.name, at: new Date().toISOString() } } : {}) },
  }).eq('id', it.id);
  return { did: 'docsend', worker: pa?.name };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// runPreparationPass — the ambient WALKER (cron). Candidate selection + caps live here; every
// per-item preparation goes through prepareOneItem (the one engine the prepare-now route shares).
// ════════════════════════════════════════════════════════════════════════════════════════════════

export async function runPreparationPass(admin: SupabaseClient, userId: string): Promise<PrepareResult> {
  // O1a: the user's SELF entity accumulates any newly-observed own-mail identity forms — idempotent,
  // one row at most, and it must land BEFORE the spine derives self-facts from it.
  const { ensureSelfEntity } = await import('@/lib/entities/self');
  await ensureSelfEntity(admin, userId);
  const todayStr = new Date().toISOString().slice(0, 10);
  const items = await buildWorkItems(admin, userId, { todayStr, skipReconcile: true });
  const rep = partitionDailyReport(items, todayStr);
  let prepared = 0, skipped = 0, nudges = 0, delegated = 0;
  const tally = (r: PrepareOneResult) => {
    if (r.did === 'draft' || r.did === 'docsend') prepared++;
    else if (r.did === 'nudge') nudges++;
    else if (r.did === 'delegated') delegated++;
    else skipped++;
  };

  // Reply drafts for the top needs-you items.
  for (const w of rep.needsYou.filter((x) => x.kind === 'reply' && x.id.startsWith('inbox:')).slice(0, TOP_N)) {
    tally(await prepareOneItem(admin, userId, w));
  }

  // Nudge drafts for waiting-on-a-NAMED-person (the open questions lane).
  for (const w of rep.openQuestions.filter((x) => x.blockedOn).slice(0, 5)) {
    tally(await prepareOneItem(admin, userId, w));
  }

  // The remaining top items — ONE batch pass of the ROSTER JUDGE (O2), then the engine (the route
  // passed through so the single-item path never re-judges what the batch already judged).
  try {
    const candidates = rep.needsYou
      .filter((w) => !w.automated && w.kind !== 'reply' && (w.id.startsWith('inbox:') || w.id.startsWith('commit:')))
      .slice(0, 5);
    if (candidates.length) {
      const routes = await routeTasks(admin, userId, candidates.map((w) => w.title));
      for (let i = 0; i < candidates.length; i++) {
        const route = routes[i] ?? { worker: null, sendDoc: false };
        if (route.worker && delegated >= DELEGATE_CAP) { skipped++; continue; }
        if (!route.worker && !route.sendDoc) { skipped++; continue; }
        tally(await prepareOneItem(admin, userId, candidates[i], { route }));
      }
    }
  } catch { /* routing is an enhancement — drafts/nudges already landed */ }

  // ── B3c · MEETING PREP (workbench) — an upcoming DEAL-LINKED meeting (next 14 days) gets a prep
  // brief prepared into the deal's pool: assembled facts (state, open tasks, goals/rules) + ONE
  // reasoned tightening pass, attributed to the assistant, evaluated like everything else.
  // Idempotent per meeting (task_id), capped per pass (trickle). Zero effect for unlinked meetings.
  const PREP_CAP = 2;
  try {
    const floorIso = new Date().toISOString();
    const ceilIso = new Date(Date.now() + 14 * 86_400_000).toISOString();
    const { data: evs } = await admin.from('calendar_events').select('id, title, start_time')
      .eq('user_id', userId).gte('start_time', floorIso).lte('start_time', ceilIso)
      .order('start_time', { ascending: true }).limit(20);
    const evRows = (evs ?? []) as Array<{ id: string; title: string | null; start_time: string }>;
    if (evRows.length) {
      const { data: links } = await admin.from('entity_links').select('item_id, entity_id')
        .eq('user_id', userId).eq('item_kind', 'calendar_event')
        .in('item_id', evRows.map((e) => e.id)).not('entity_id', 'is', null);
      const entByEv = new Map(((links ?? []) as Array<{ item_id: string; entity_id: string }>).map((l) => [l.item_id, l.entity_id]));
      let prepped = 0;
      for (const ev of evRows) {
        if (prepped >= PREP_CAP) break;
        const entId = entByEv.get(ev.id);
        if (!entId) continue;
        const taskId = `meeting-prep-${ev.id}`;
        const { data: prior } = await admin.from('item_deliverables').select('id')
          .eq('user_id', userId).eq('kind', 'entity').eq('entity_id', entId).eq('task_id', taskId).limit(1).maybeSingle();
        if (prior) continue; // already prepared for this meeting

        const { data: ent } = await admin.from('work_entities').select('name, state, next_move, goals, rules')
          .eq('id', entId).eq('user_id', userId).maybeSingle();
        if (!ent) continue;
        const st = (ent.state ?? {}) as { summary?: string; whoOwes?: { you?: string[]; them?: string[] } };
        const nm = (ent.next_move ?? null) as { title?: string } | null;
        const openTasks = items.filter((w) => w.entity?.id === entId && (w.state === 'todo' || w.state === 'waiting' || w.state === 'in_progress'))
          .slice(0, 8).map((w) => `- ${w.title.slice(0, 90)}${w.when.explicit ? ` (due ${w.when.explicit})` : ''}${w.blockedOn ? ` — waiting on ${w.blockedOn.split('<')[0].trim()}` : ''}`);
        const facts = [
          `MEETING: ${String(ev.title || 'Meeting')} · ${ev.start_time.slice(0, 16).replace('T', ' ')}`,
          `THE DEAL: ${ent.name}`,
          st.summary ? `Where it stands: ${st.summary}` : '',
          nm?.title ? `The next move: ${nm.title}` : '',
          (st.whoOwes?.you ?? []).length ? `You owe: ${(st.whoOwes!.you!).slice(0, 3).join(' · ')}` : '',
          openTasks.length ? `OPEN TASKS:\n${openTasks.join('\n')}` : '',
          Array.isArray(ent.goals) && (ent.goals as string[]).length ? `Goals: ${(ent.goals as string[]).join(' · ')}` : '',
          Array.isArray(ent.rules) && (ent.rules as string[]).length ? `Rules: ${(ent.rules as string[]).join(' · ')}` : '',
        ].filter(Boolean).join('\n');
        const res = await aiCall<{ brief?: string }>({
          userId, supabase: admin, shape: { output: 'json' }, temperature: 0.2, maxTokens: 500, source: 'task_preparation',
          prompt: `Turn these FACTS into a tight meeting-prep brief (5-8 short lines): where things stand, ` +
            `what to raise, what you owe them / they owe you, and the one outcome to walk out with. Use ONLY ` +
            `the facts given — never invent. Plain prose lines, no headers.\n\n${facts}\n\nJSON only: {"brief":"..."}`,
        }).catch(() => ({ json: null as { brief?: string } | null }));
        const briefText = res.json?.brief?.trim();
        if (!briefText) continue;
        const review = await evaluateDeliverable(admin, userId, { content: briefText, task: `Prep for ${String(ev.title || 'the meeting')}`, entityId: entId, kind: 'deliverable' });
        const pa = await getDraftingAssistant(admin, userId);
        await admin.from('item_deliverables').insert({
          user_id: userId, kind: 'entity', entity_id: entId, task_id: taskId, type: 'document',
          title: `Prep — ${String(ev.title || 'Meeting')}`.slice(0, 100), content: briefText, ref: null,
          metadata: { meetingPrep: true, meetingAt: ev.start_time, ...(pa ? { agentName: pa.name } : {}), ...(review.verdict !== 'pass' ? { review } : {}) },
        }).then(() => { prepped++; prepared++; }, () => {});
      }
    }
  } catch { /* prep is an enhancement — the pass's core work already landed */ }

  return { prepared, skipped, nudges, delegated };
}
