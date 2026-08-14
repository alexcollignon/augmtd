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
import type { TaskRoute } from '@/lib/prepare/route-suggestion';
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

const FRESH_HOURS = 24;   // a draft older than this (or older than new thread activity) re-prepares

// ── W2: THE BUDGETED WALK — fixed caps (TOP_N 8 / 5 nudges / DELEGATE_CAP 2) are gone. The pass
// works the judged backlog in ENTITY-PRIORITY order until the time budget is spent, and whatever is
// left behind is COUNTED and logged, never silently truncated (the no-silent-caps doctrine applied
// to the product: a team that quietly does eight things feels absent; one that says "I got through
// 14, 6 are queued for the next sweep" is honest). The cron route sizes the budget per user.
const BUDGET_MS = 90_000;

export type PrepareResult = { prepared: number; skipped: number; nudges: number; delegated: number; leftBehind: number };

// ════════════════════════════════════════════════════════════════════════════════════════════════
// prepareOneItem — THE ONE per-item engine (W4). Returns what it did (or the honest reason it
// didn't); never sends, never throws (branch failures → skipped).
// ════════════════════════════════════════════════════════════════════════════════════════════════

type WorkerRow = { id: string; name: string; worker_role: string | null; is_worker: boolean | null };
export type PrepareOneResult = {
  did: 'draft' | 'nudge' | 'delegated' | 'docsend' | 'invite' | 'forward' | 'decision' | 'none';
  worker?: string;   // the coworker's name when did === 'delegated'
  reason?: string;   // the honest why when did === 'none'
  why?: string;      // the JUDGE's reason a delegation happened (provenance for the room narration)
};

export async function prepareOneItem(
  admin: SupabaseClient, userId: string, w: WorkItem,
  opts?: { route?: TaskRoute },
): Promise<PrepareOneResult> {
  try {
    const done = (r: PrepareOneResult) => narratePrepare(admin, userId, w, r);
    // THE ONE GATE (promise fix #1): NOTHING is prepared except from THE judged verdict. The old
    // spine fast-paths (kind==='reply' → draft, waiting → nudge) BYPASSED the judge — which is how
    // a password-reset notification got a drafted reply. The judge is cached and carries the
    // structural floors (answered thread, ownership-none notice, automated sender); every branch
    // below flows through it.
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
    // FAILURE HONESTY (W2): a failed judgment prepares nothing and moves nothing — "could not
    // judge" is not "judged none". The verdict wasn't cached, so the next sweep/open retries.
    if (verdict.failed) return { did: 'none', reason: 'could not judge this yet — it will retry' };
    // THE VERDICT MOVES THE POSTURE (one consequence module): an expired/answered none RESOLVES
    // the item (logged, undoable, narrated); prepared artifacts that contradict the verdict strip.
    const { applyVerdictConsequences } = await import('@/lib/work/apply-verdict');
    const cons = await applyVerdictConsequences(admin, userId, { kind: w.id.startsWith('commit:') ? 'commitment' : 'inbox', id: w.entityId }, verdict);
    if (cons.resolved) return { did: 'none', reason: `resolved by the verdict (${verdict.resolution}): ${verdict.reason}` };
    if (verdict.work === 'send_file') return await done(await prepareDocSend(admin, userId, w, verdict));
    if (verdict.work === 'chase' && (w.who || w.blockedOn)) return await done(await prepareNudge(admin, userId, { ...w, blockedOn: w.blockedOn ?? w.who ?? null }));
    // ── W1: THE JUDGE'S NEW HANDS — schedule and forward were judged-but-never-prepared (the
    // registry mapped them, the pass fell through to none). Both prepare an EDITABLE artifact and
    // stop at the commit line: the invite books nothing, the forward sends nothing.
    if (verdict.work === 'schedule') return await done(await prepareInviteDraft(admin, userId, w));
    if (verdict.work === 'forward') return await done(await prepareForwardDraft(admin, userId, w, verdict));
    // ── THE DECISION BRIEF (trichotomy T2 — the judge's last silent verb): a `decide` verdict
    // used to fall to the generic none — "you must choose" judged, nothing prepared, nothing
    // asked (5 live instances found in the T1 trace). A decision's preparation IS the laid-out
    // choice: the question, the real options with trade-offs, and a grounded recommendation. ──
    if (verdict.work === 'decide') return await done(await prepareDecisionBrief(admin, userId, w, verdict));
    // A chase whose counterparty the spine could not name still has TWO honest deterministic
    // sources (T1: "Resolve demo timeout" + the "Waiting on Jean-Marie" pair sat silent because
    // who/blockedOn were both empty): the item's own sender, and the counterparty our OWN
    // extraction wrote into the title ("Waiting on <Name>: …"). Both dead → the nudge still
    // drafts from the item's words (the user addresses it) — a chase is never a silent none.
    if (verdict.work === 'chase') {
      let target: string | null = null;
      if (w.id.startsWith('inbox:')) {
        const { data: chIt } = await admin.from('inbox_items').select('source_data').eq('id', w.entityId).eq('user_id', userId).maybeSingle();
        target = String(((chIt?.source_data ?? {}) as { from?: string }).from ?? '').trim() || null;
      }
      target ??= /^waiting (?:on|for)\s+([^:]{2,40}):/i.exec(w.title)?.[1]?.trim() ?? null;
      return await done(await prepareNudge(admin, userId, { ...w, blockedOn: target ?? w.title.slice(0, 60) }));
    }
    if (verdict.work === 'produce') {
      // THE DELIVERABLE RESOLUTION on PRODUCED work — the class where "what does it take / what do
      // I have / what do I need from you" matters most (make-the-reports asks). Resolve the judged
      // inventory FIRST: found artifacts stage into the pool; missing ones land as the room's
      // input-checklist ASK. The truth then rides the delegation envelope (a coworker builds from
      // what's staged and never fabricates the rest), and a user-executor item is never silent —
      // the ask IS the preparation.
      let artifactTruth = '';
      let stagedKbFiles: Array<{ id: string; filename: string }> = [];
      if (verdict.requires?.length) {
        const { resolveRequirements } = await import('@/lib/prepare/requirements');
        const reqs = await resolveRequirements(admin, userId, {
          itemKind: w.id.startsWith('commit:') ? 'commitment' : 'inbox', itemId: w.entityId,
          itemTitle: w.title, entityId: w.entity?.id ?? null, requires: verdict.requires,
        });
        artifactTruth = reqs.artifactTruth;
        // W3: a PROCEEDED ask means the user already said "go ahead with what's available" — the
        // work continues around the gaps instead of waiting on the room.
        if (verdict.executor.kind !== 'coworker' && reqs.missing.length && !reqs.proceeded) {
          return { did: 'none', reason: `needs ${reqs.missing.length} input(s) from you — asked in the room` };
        }
        const { COMPUTABLE_EXT } = await import('@/lib/prepare/compute-produce');
        stagedKbFiles = reqs.have
          .filter((h) => h.file?.source === 'kb' && COMPUTABLE_EXT.test(h.file.filename))
          .map((h) => ({ id: h.file!.id, filename: h.file!.filename }));
      }
      // ── ARC 1 STAGE 3 — PRODUCE COMPUTES BEFORE IT WRITES (docs/one-surface-plan.md): with real
      // data files staged, the numbers are computed in the sandbox FIRST and ride the envelope as
      // COMPUTED FACTS — the writer writes from verified numbers, never asserts them. The codegen
      // may decline (a memo needs no sandbox); a failure returns the lane to the status quo. ──
      let computedStamp: string | undefined;
      if (stagedKbFiles.length) {
        const { computeForProduce } = await import('@/lib/prepare/compute-produce');
        const cf = await computeForProduce(admin, userId, {
          title: w.title, judgeReason: verdict.reason,
          requires: (verdict.requires ?? []).map((r) => r.label), files: stagedKbFiles,
          entityId: w.entity?.id ?? null,
        });
        if (cf) { artifactTruth = [artifactTruth, cf.facts].filter(Boolean).join('\n\n'); computedStamp = cf.stamp; }
      }
      if (verdict.executor.kind === 'coworker' && verdict.executor.id) {
        const dr = await delegatePrepare(admin, userId, w, { id: verdict.executor.id, name: verdict.executor.name ?? 'Coworker', worker_role: null, is_worker: true }, artifactTruth || undefined, computedStamp);
        return await done({ ...dr, why: verdict.reason });
      }
      // W1: a produce verdict WITHOUT a named coworker is no longer a silent none — the drafting
      // assistant prepares the starting point (same precedent as replies: executor "user" means the
      // user owns the commit, never that nothing may be prepared). Missing inputs were already asked
      // for above; with everything in hand the assistant builds from what's staged.
      const paProduce = await getDraftingAssistant(admin, userId);
      if (paProduce) {
        const dr = await delegatePrepare(admin, userId, w, { id: paProduce.id, name: paProduce.name, worker_role: 'personal_assistant', is_worker: true }, artifactTruth || undefined, computedStamp);
        return await done({ ...dr, why: verdict.reason });
      }
      return { did: 'none', reason: 'produced work needs a coworker and none is set up yet' };
    }
    if (verdict.work === 'reply') return await done(await prepareReplyDraft(admin, userId, w, verdict));
    return { did: 'none', reason: verdict.reason || 'this one needs you — no preparation applies' };
  } catch (e) { console.error('[prepareOneItem]', e); return { did: 'none', reason: 'preparation failed — try again' }; }
}

// ── R1 (one-room): THE ENGINE NARRATES — a successful ambient prepare writes a durable turn into
// the item's room, so opening it shows what happened while the user was away (a colleague's thread
// that moved, not a silent badge). Authored when a coworker did the work; deduped per item so
// repeated sweeps re-surface one line instead of stuttering. Non-fatal, zero AI. ──
// ── THE DECISION BRIEF (trichotomy T2): one grounded pass over the item's own words + the deal's
// state → {question, options with trade-offs, recommendation, why} — stored as a pool deliverable
// (the one reader serves it everywhere) and narrated into the room. Idempotent per item
// (task_id 'decision-brief'); the item's own material is the ONLY ground — never invented. ──
async function prepareDecisionBrief(
  admin: SupabaseClient, userId: string, w: WorkItem, verdict: { reason: string },
): Promise<PrepareOneResult> {
  const poolKind = w.id.startsWith('commit:') ? 'commitment' : 'email';
  const { data: prior } = await admin.from('item_deliverables').select('id, created_at, metadata')
    .eq('user_id', userId).eq('kind', poolKind).eq('entity_id', w.entityId)
    .eq('task_id', 'decision-brief').limit(1).maybeSingle();
  // THE GROUND LAW: the options laid out for a decision are only the options the newest message
  // left standing — a ground move re-lays the decision, however settled the prior brief looks.
  const { groundOf, groundMoved } = await import('@/lib/prepare/ground');
  const currentGround = await groundOf(admin, userId, { kind: poolKind === 'commitment' ? 'commitment' : 'inbox', id: w.entityId });
  const priorMeta = (prior?.metadata ?? {}) as { prepared_from?: { emailId?: string | null; receivedAt?: string | null } | null };
  const movedPast = !!prior && groundMoved(priorMeta.prepared_from ?? null, currentGround);
  if (prior && !movedPast) return { did: 'none', reason: 'the decision brief is already prepared' };

  // Ground: the item's own body + the judge's read + the deal's state. Clipped honestly.
  let body = '';
  try {
    if (poolKind === 'commitment') {
      // B4 (verb-lane sweep): a commitment's material is ITS OWN row — description, counterparty,
      // due date — never a phantom inbox lookup (the brief was being laid out from the clipped
      // title alone).
      const { data: c } = await admin.from('commitments').select('description, counterparty, due_date, source').eq('id', w.entityId).eq('user_id', userId).maybeSingle();
      if (c) body = [`THE COMMITMENT: ${String(c.description ?? '')}`, c.counterparty ? `Counterparty: ${String(c.counterparty)}` : null, c.due_date ? `Due: ${String(c.due_date)}` : null, c.source ? `Origin: ${String(c.source)}` : null].filter(Boolean).join('\n');
    } else {
      const { data: it } = await admin.from('inbox_items').select('source_data').eq('id', w.entityId).eq('user_id', userId).maybeSingle();
      const sd = (it?.source_data ?? {}) as { snippet?: string; body_text?: string; html_body?: string };
      const raw = sd.body_text || (sd.html_body ? String(sd.html_body).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') : '') || sd.snippet || '';
      const { clipForPrompt } = await import('@/lib/utils/clip-for-prompt');
      body = clipForPrompt(String(raw), 3500);
    }
  } catch { /* the judge's reason still grounds */ }
  let dealLine = '';
  if (w.entity?.id) {
    try {
      const { data: ent } = await admin.from('work_entities').select('name, state').eq('id', w.entity.id).eq('user_id', userId).maybeSingle();
      const st = (ent?.state ?? {}) as { summary?: string };
      if (st.summary) dealLine = `THE DEAL (${String(ent?.name)}): ${st.summary}`;
    } catch { /* optional */ }
  }
  const { EXCERPT_RULE } = await import('@/lib/utils/clip-for-prompt');
  const { TEAM_VOICE } = await import('@/lib/room/voice');
  const res = await aiCall<{ question?: string; options?: Array<{ label?: string; tradeoff?: string }>; recommendation?: string; why?: string }>({
    userId, supabase: admin, shape: { output: 'json' }, temperature: 0.2, maxTokens: 700, source: 'task_preparation',
    prompt:
      `A decision is waiting on the user. Lay it out for them — like a chief of staff who read everything.\n` +
      `${TEAM_VOICE}\n` +
      `THE ITEM: ${w.title}\nTHE JUDGE'S READ: ${verdict.reason}\n` +
      (dealLine ? `${dealLine}\n` : '') +
      (body ? `THE MATERIAL (the item's own words):\n${body}\n` : '') +
      `${EXCERPT_RULE}\n` +
      `Rules: the QUESTION is the one actually posed by the material (never invented); OPTIONS are the ` +
      `REAL choices on the table (2-4, each with its honest trade-off in one line — include "decline/do nothing" ` +
      `only when it is genuinely open); the RECOMMENDATION picks one; WHY is ONE short sentence (two at most, ≤35 words total) in the user's interest. ` +
      `Ground every claim in the material — a gap is named, never filled.\n` +
      `Return ONLY JSON: {"question":"…","options":[{"label":"…","tradeoff":"…"}],"recommendation":"<one option label>","why":"…"}`,
  }).catch(() => ({ json: null as { question?: string; options?: Array<{ label?: string; tradeoff?: string }>; recommendation?: string; why?: string } | null }));
  const d = res.json;
  const options = (Array.isArray(d?.options) ? d!.options! : []).filter((o) => o?.label).slice(0, 4);
  if (!d?.question || options.length < 2) return { did: 'none', reason: 'could not lay out the decision yet — it will retry' };
  // PLAIN TEXT — every consumer renders this raw (the stage card once showed literal `**`).
  const content = [
    `The decision: ${d.question}`,
    '',
    ...options.map((o, i) => `${i + 1}. ${o.label}${o.tradeoff ? ` — ${o.tradeoff}` : ''}`),
    '',
    d.recommendation ? `Recommendation: ${d.recommendation}${d.why ? ` — ${d.why}` : ''}` : null,
  ].filter((l) => l !== null).join('\n');
  const pa = await getDraftingAssistant(admin, userId);
  // The superseded brief FILES into the version chain (the reader skips `version_of` rows).
  if (movedPast && prior) {
    await admin.from('item_deliverables')
      .update({ metadata: { ...priorMeta, version_of: 'superseded:ground-move' } })
      .eq('id', prior.id).then(() => {}, () => {});
  }
  const { error } = await admin.from('item_deliverables').insert({
    user_id: userId, kind: poolKind, entity_id: w.entityId, task_id: 'decision-brief', type: 'document',
    title: `Decision — ${w.title}`.slice(0, 100), content, ref: null,
    metadata: { decisionBrief: true, options: options.map((o) => ({ label: o.label, tradeoff: o.tradeoff ?? null })), recommendation: d.recommendation ?? null, why: d.why ?? null, prepared_from: currentGround, ...(pa ? { agentName: pa.name } : {}) },
  });
  if (error) return { did: 'none', reason: 'could not store the decision brief — it will retry' };
  if (movedPast) await narrateGroundMove(admin, userId, w, currentGround);
  // The deck's ✦ badge reads source_data (the C3 surfacing seam) — a pool-only preparation is
  // invisible on the row without this stamp (the same one delegatePrepare writes).
  if (w.id.startsWith('inbox:') && pa) {
    try {
      const { data: it } = await admin.from('inbox_items').select('source_data').eq('id', w.entityId).maybeSingle();
      const sd = (it?.source_data ?? {}) as Record<string, unknown>;
      await admin.from('inbox_items').update({ source_data: { ...sd, prepared_by: { worker: pa.name, at: new Date().toISOString() } } }).eq('id', w.entityId);
    } catch { /* the deep-dive still serves the brief via getPrepared */ }
  }
  return { did: 'decision', worker: pa?.name };
}

async function narratePrepare(
  admin: SupabaseClient, userId: string, w: WorkItem, r: PrepareOneResult,
): Promise<PrepareOneResult> {
  if (r.did === 'none') return r;
  try {
    const { writeRoomTurn, roomKeyForItem, clip } = await import('@/lib/room/turns');
    const itemKind = w.id.startsWith('commit:') ? 'commitment' as const : 'inbox' as const;
    const roomKey = await roomKeyForItem(admin, userId, itemKind, w.entityId);
    const first = r.worker ? r.worker.split(' ')[0] : null;
    const title = clip(w.title, 80);
    const text =
      r.did === 'draft' ? `${first ?? 'I'} drafted the reply on "${title}" — it's ready to review.` :
      r.did === 'nudge' ? `${first ?? 'I'} drafted the follow-up nudge on "${title}".` :
      r.did === 'docsend' ? `${first ?? 'I'} found the file and drafted the send on "${title}".` :
      r.did === 'invite' ? `${first ?? 'I'} prepared the calendar invite for "${title}" — review it and approve to send.` :
      r.did === 'forward' ? `${first ?? 'I'} prepared the forward on "${title}" — nothing goes out until you approve it.` :
      r.did === 'decision' ? `${first ?? 'I'} laid out the decision on "${title}" — options, trade-offs, and a recommendation are ready.` :
      // PROVENANCE (promise fix): an ambient delegation says WHY it happened — a coworker showing
      // up in the room is never a surprise, and the commit line stays with the user.
      `${first ?? 'A coworker'} is on "${title}"${r.why ? ` — ${clip(r.why, 110)}` : ''}. Nothing goes out without you.`;
    await writeRoomTurn(admin, userId, roomKey, {
      role: 'system', text,
      // Promise fix #6b — a shared DEAL room hears about many items; every engine turn carries
      // ITS item's chip so the narration is never ambiguous ("about what?" reads as stale memory).
      refs: [{ label: w.title.slice(0, 60), href: itemKind === 'commitment' ? `/item/${w.entityId}?kind=commitment` : `/item/${w.entityId}` }],
      // THE ONE-NARRATOR LAW (UX arc): this text is the chief of staff narrating ("Clara drafted…",
      // "Max is on…") — NEVER authored as the coworker it talks about (a coworker bubble speaking
      // about itself in the third person was a real, jarring turn). Coworker attribution belongs
      // only to the coworker's own first-person speech (report-backs, asks — delegate.ts).
      author: null,
      dedupeKey: `prep:${w.id}`,
    });
  } catch { /* narration is an enhancement — the prepared work already landed */ }
  return r;
}

// ── The reply-draft branch (slice 1). ──
async function prepareReplyDraft(admin: SupabaseClient, userId: string, w: WorkItem, verdict?: import('@/lib/work/judge').WorkVerdict): Promise<PrepareOneResult> {
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
  // (the user's rules are authoritative; the kind only fills where they didn't speak). ONE
  // RESOLVER: the same full chain the label system uses (override → understanding → rule → header
  // signals) — reading understanding.mailKind alone left the header tier unguarded, and a
  // has_unsubscribe blast with no stored understanding got a drafted reply (the UMPI class).
  const { resolveKind } = await import('@/lib/inbox/rules/write-back');
  const kindNow = resolveKind(sd, (it.rule_type as string) ?? null);
  if (kindNow && ['receipt', 'newsletter', 'notification', 'cold_outreach', 'calendar'].includes(kindNow) && it.rule_type !== 'needs_reply') {
    return { did: 'none', reason: `${kindNow.replace('_', ' ')} — no reply expected` };
  }
  const existing = (sd.draft ?? null) as { body?: string; generated_at?: string; prepared_from?: { emailId?: string | null; receivedAt?: string | null } | null } | null;
  // THE GROUND LAW: the newest inbound RIGHT NOW — compared against what the draft was prepared
  // FROM. A ground move supersedes regardless of clock freshness (the counterparty's new message
  // is their supply; found live: a Monday reply offered as current after the plan moved to Thursday).
  const { groundOf, groundMoved } = await import('@/lib/prepare/ground');
  const currentGround = await groundOf(admin, userId, { kind: 'inbox', id: String(it.id) });
  const movedPast = !!existing?.body && groundMoved(existing.prepared_from ?? null, currentGround);
  const stale = !existing?.body
    || movedPast
    || (Date.now() - Date.parse(existing.generated_at || '0')) > FRESH_HOURS * 3_600_000
    || (!!it.last_activity_at && Date.parse(it.last_activity_at as string) > Date.parse(existing.generated_at || '0'));
  if (!stale) return { did: 'none', reason: 'a fresh draft is already on it' };
  // ── THE DELIVERABLE RESOLUTION (what's available / what's needed): the judge's inventory is
  // resolved BEFORE drafting — found artifacts stage into the pool (+ the first sendable one rides
  // the draft as its attachment), missing ones become the room's input-checklist ask, and the
  // drafter is constrained to the ARTIFACT TRUTH (it may only claim what's staged). ──
  let artifactTruth = '';
  let stagedAttachment: { fileId: string; filename: string; source?: string } | null = null;
  if (verdict?.requires?.length) {
    const { resolveRequirements } = await import('@/lib/prepare/requirements');
    const reqs = await resolveRequirements(admin, userId, {
      itemKind: 'inbox', itemId: String(it.id), itemTitle: w.title,
      entityId: w.entity?.id ?? null, requires: verdict.requires,
    });
    artifactTruth = reqs.artifactTruth;
    // Only KB-held bytes are attachable from the composer (the doc-send rule); drive-catalog and
    // pool-text haves stay staged context, never a phantom attachment.
    const kbHave = reqs.have.find((h) => h.file?.source === 'kb');
    if (kbHave?.file) stagedAttachment = { fileId: kbHave.file.id, filename: kbHave.file.filename, source: kbHave.file.source };
  }
  const truthInstruction = artifactTruth ? `\n${artifactTruth}` : null;
  const raw = await generateReplyDraft(userId, sd as Record<string, never>, admin, truthInstruction);
  if (!raw) return { did: 'none', reason: 'could not draft this' };
  // O4: the CoS review before it reaches the desk (one capped revision on a substantive objection).
  const sender = [String(sd.from_name || ''), sd.from_address ? `<${sd.from_address}>` : ''].filter(Boolean).join(' ') || String(sd.from || '') || null;
  const { body, review } = await reviewAndRevise(admin, userId,
    { body: raw, task: w.title, recipient: sender, entityId: w.entity?.id ?? null, kind: 'reply' },
    (objection) => generateReplyDraft(userId, sd as Record<string, never>, admin, `${truthInstruction ?? ''}\nREVIEWER'S OBJECTION — fix this in the reply: ${objection}`));
  // O3a: ambient work is ATTRIBUTED — the assistant coworker drafted this (her skills shaped it).
  const pa = await getDraftingAssistant(admin, userId);
  await admin.from('inbox_items')
    .update({ source_data: { ...sd, draft: { body, generated_at: new Date().toISOString(), prepared: 'pass', prepared_from: currentGround, ...(stagedAttachment ? { attachment: stagedAttachment } : {}), ...(review.verdict !== 'pass' ? { review } : {}) }, ...(pa ? { prepared_by: { worker: pa.name, at: new Date().toISOString() } } : {}) } })
    .eq('id', it.id);
  if (movedPast) await narrateGroundMove(admin, userId, w, currentGround);
  return { did: 'draft', worker: pa?.name };
}

// ── The nudge branch (slice 1) — inbox waits land on source_data, commitment waits in the pool. ──
async function prepareNudge(admin: SupabaseClient, userId: string, w: WorkItem): Promise<PrepareOneResult> {
  const ageDays = Math.max(0, Math.round((Date.now() - Date.parse(w.startAt)) / 86_400_000));
  if (w.id.startsWith('inbox:')) {
    const { data: it } = await admin.from('inbox_items').select('id, source_data, status').eq('id', w.entityId).eq('user_id', userId).maybeSingle();
    if (!it || it.status !== 'pending') return { did: 'none', reason: 'no longer open' };
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    const existing = (sd.nudge_draft ?? null) as { body?: string; generated_at?: string; prepared_from?: { emailId?: string | null; receivedAt?: string | null } | null } | null;
    // THE GROUND LAW: a newer inbound than the one this nudge was prepared FROM supersedes it —
    // regardless of clock freshness (chasing someone about a thing they already answered is the
    // exact failure the law ends). Unstamped/unresolvable ground is exempt.
    const { groundOf, groundMoved } = await import('@/lib/prepare/ground');
    const currentGround = await groundOf(admin, userId, { kind: 'inbox', id: String(it.id) });
    const movedPast = !!existing?.body && groundMoved(existing.prepared_from ?? null, currentGround);
    if (existing && !movedPast && (Date.now() - Date.parse(existing.generated_at || '0')) < FRESH_HOURS * 3_600_000) return { did: 'none', reason: 'a fresh nudge is already on it' };
    // THE LANGUAGE MIRROR: the counterparty's own words are the concrete signal.
    const mirrorText = String(sd.body || '').slice(0, 1200) || null;
    const raw = await generateNudgeDraft(userId, { counterparty: w.blockedOn, description: w.title, ageDays, mirrorText }, admin);
    if (!raw) return { did: 'none', reason: 'could not draft the nudge' };
    const { body, review } = await reviewAndRevise(admin, userId, // O4 review
      { body: raw, task: w.title, recipient: w.blockedOn, entityId: w.entity?.id ?? null, kind: 'nudge' },
      (objection) => generateNudgeDraft(userId, { counterparty: w.blockedOn, description: w.title, ageDays, mirrorText, instructions: `REVIEWER'S OBJECTION — fix this: ${objection}` }, admin));
    const pa = await getDraftingAssistant(admin, userId); // O3a attribution
    await admin.from('inbox_items')
      .update({ source_data: { ...sd, nudge_draft: { body, generated_at: new Date().toISOString(), prepared: 'pass', prepared_from: currentGround, ...(review.verdict !== 'pass' ? { review } : {}) }, ...(pa ? { prepared_by: { worker: pa.name, at: new Date().toISOString() } } : {}) } })
      .eq('id', it.id);
    if (movedPast) await narrateGroundMove(admin, userId, w, currentGround);
    return { did: 'nudge', worker: pa?.name };
  }
  if (w.id.startsWith('commit:')) {
    // Commitments have no source_data — the nudge lands in the item_deliverables pool (type 'draft'),
    // which the deep-dive + downstream steps already read.
    const { data: existing } = await admin.from('item_deliverables').select('id, created_at, metadata')
      .eq('user_id', userId).eq('kind', 'commitment').eq('entity_id', w.entityId).eq('type', 'draft')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    // THE GROUND LAW: the counterparty's newer message supersedes the prepared nudge — fresh by
    // clock is not fresh by ground.
    const { groundOf, groundMoved } = await import('@/lib/prepare/ground');
    const currentGround = await groundOf(admin, userId, { kind: 'commitment', id: w.entityId });
    const priorMeta = (existing?.metadata ?? {}) as { prepared_from?: { emailId?: string | null; receivedAt?: string | null } | null };
    const movedPast = !!existing && groundMoved(priorMeta.prepared_from ?? null, currentGround);
    if (existing && !movedPast && (Date.now() - Date.parse(existing.created_at as string)) < FRESH_HOURS * 3_600_000) return { did: 'none', reason: 'a fresh nudge is already on it' };
    // THE LANGUAGE MIRROR: the counterparty's last inbound message on the commitment's thread.
    let mirrorText: string | null = null;
    try {
      const { data: c } = await admin.from('commitments').select('thread_id').eq('id', w.entityId).maybeSingle();
      if (c?.thread_id) {
        const { data: last } = await admin.from('emails').select('body, received_at').eq('user_id', userId)
          .eq('thread_id', c.thread_id as string).eq('is_from_user', false)
          .order('received_at', { ascending: false }).limit(1).maybeSingle();
        mirrorText = String(last?.body || '').slice(0, 1200) || null;
      }
    } catch { /* non-fatal */ }
    const raw = await generateNudgeDraft(userId, { counterparty: w.blockedOn, description: w.title, ageDays, mirrorText }, admin);
    if (!raw) return { did: 'none', reason: 'could not draft the nudge' };
    const { body, review } = await reviewAndRevise(admin, userId, // O4 review
      { body: raw, task: w.title, recipient: w.blockedOn, entityId: w.entity?.id ?? null, kind: 'nudge' },
      (objection) => generateNudgeDraft(userId, { counterparty: w.blockedOn, description: w.title, ageDays, mirrorText, instructions: `REVIEWER'S OBJECTION — fix this: ${objection}` }, admin));
    const pa = await getDraftingAssistant(admin, userId); // O3a attribution
    // The superseded nudge FILES into the version chain (the reader skips `version_of` rows) —
    // the past folds, never deletes.
    if (movedPast && existing) {
      await admin.from('item_deliverables')
        .update({ metadata: { ...priorMeta, version_of: 'superseded:ground-move' } })
        .eq('id', existing.id).then(() => {}, () => {});
    }
    await admin.from('item_deliverables').insert({
      user_id: userId, kind: 'commitment', entity_id: w.entityId, type: 'draft',
      title: `Nudge — ${(w.blockedOn || '').split('<')[0].trim()}`.slice(0, 100), content: body, ref: null,
      metadata: { ...(pa ? { agentName: pa.name } : {}), prepared_from: currentGround, ...(review.verdict !== 'pass' ? { review } : {}) },
    }).then(() => {}, () => {});
    if (movedPast) await narrateGroundMove(admin, userId, w, currentGround);
    return { did: 'nudge', worker: pa?.name };
  }
  return { did: 'none', reason: 'not a preparable item' };
}

// ── W1 · the INVITE branch — a `schedule` verdict prepares a GROUNDED, editable calendar invite
// (title/time/attendees extracted from the item's own thread, never invented — the same grounded
// extractor the deep-dive's on-demand card uses). Stored as the item's prepared artifact; the card
// serves it instantly and the ONLY commit is the user's approve → /api/items/execute (gate `book`).
// Idempotent: a fresh prepared invite (newer than thread activity) is never regenerated. ──
async function prepareInviteDraft(admin: SupabaseClient, userId: string, w: WorkItem): Promise<PrepareOneResult> {
  const isCommit = w.id.startsWith('commit:');
  // THE GROUND LAW: the invite is the lane the law was found on — a counterparty who moves the day
  // supersedes the prepared time, and the clock says nothing about that.
  const { groundOf, groundMoved } = await import('@/lib/prepare/ground');
  const currentGround = await groundOf(admin, userId, { kind: isCommit ? 'commitment' : 'inbox', id: w.entityId });
  let movedPast = false;
  if (isCommit) {
    // A commitment's invite lands in the pool (commitments have no source_data), same as its nudges.
    const { data: prior } = await admin.from('item_deliverables').select('id, created_at, metadata')
      .eq('user_id', userId).eq('kind', 'commitment').eq('entity_id', w.entityId).eq('task_id', 'prepare-pass-invite')
      .limit(1).maybeSingle();
    const priorMeta = (prior?.metadata ?? {}) as { prepared_from?: { emailId?: string | null; receivedAt?: string | null } | null };
    movedPast = !!prior && groundMoved(priorMeta.prepared_from ?? null, currentGround);
    if (prior && !movedPast && (Date.now() - Date.parse(prior.created_at as string)) < FRESH_HOURS * 3_600_000) {
      return { did: 'none', reason: 'a fresh prepared invite is already on it' };
    }
  }
  const { buildItemContext } = await import('@/lib/home/item-context');
  const { prepareCalendarInvite } = await import('@/lib/home/prepare-action');
  const planKind = isCommit ? 'commitment' as const : 'email' as const;
  const ctx = await buildItemContext(admin, userId, planKind, w.entityId);
  if (!ctx) return { did: 'none', reason: 'could not ground the invite in the item' };
  const invite = await prepareCalendarInvite(admin, userId, planKind, ctx, w.title);
  // ── THE ALREADY-BOOKED FLOOR (pilot diagnosis, Aug 13 — found live: the lane prepared an
  // invite DUPLICATING a meeting the counterparty had already accepted on the real calendar,
  // at a conflicting time): when a calendar event with one of the invite's attendees already
  // sits within ±12h of the proposed time, there is nothing left to book — a second invite is
  // noise at best, a double-booking at worst. Structural, before any write. ──
  if (invite.startISO && Array.isArray(invite.attendees) && invite.attendees.length) {
    try {
      const t = Date.parse(invite.startISO);
      if (!isNaN(t)) {
        const lo = new Date(t - 12 * 3_600_000).toISOString();
        const hi = new Date(t + 12 * 3_600_000).toISOString();
        const { data: evs } = await admin.from('calendar_events').select('id, title, start_time, attendees')
          .eq('user_id', userId).gte('start_time', lo).lte('start_time', hi).limit(20);
        const want = new Set(invite.attendees.map((a) => String(a).toLowerCase().trim()).filter(Boolean));
        const booked = (evs ?? []).find((ev) => Array.isArray(ev.attendees)
          && (ev.attendees as Array<{ email?: string }>).some((a) => a?.email && want.has(String(a.email).toLowerCase())));
        if (booked) {
          // The honest consequence: an UNSENT prepared invite duplicating the booked event is a
          // dead plan standing behind an approve button — strip it (inbox half; the commit half's
          // writeDeliverable never runs on this return path, so its prior row simply ages out).
          if (!isCommit) {
            try {
              const { data: itStrip } = await admin.from('inbox_items').select('id, source_data').eq('id', w.entityId).eq('user_id', userId).maybeSingle();
              const sdStrip = (itStrip?.source_data ?? {}) as Record<string, unknown>;
              const pi = sdStrip.prepared_invite as { sent_at?: string } | undefined;
              if (itStrip && pi && !pi.sent_at) {
                const { prepared_invite: _drop, ...rest } = sdStrip;
                await admin.from('inbox_items').update({ source_data: rest }).eq('id', itStrip.id);
              }
            } catch { /* the stale artifact ages out via the ground check regardless */ }
          }
          return { did: 'none', reason: `already on the calendar — "${String(booked.title ?? 'meeting').slice(0, 60)}" at ${String(booked.start_time).slice(0, 16).replace('T', ' ')}` };
        }
      }
    } catch { /* the floor is a protection — an unreadable calendar never blocks the lane */ }
  }
  const pa = await getDraftingAssistant(admin, userId); // O3a attribution
  if (isCommit) {
    const { writeDeliverable } = await import('@/lib/home/deliverable-pool');
    await writeDeliverable(admin, userId, {
      kind: 'commitment', entityId: w.entityId, taskId: 'prepare-pass-invite', type: 'draft',
      title: `Invite — ${invite.title}`.slice(0, 100), content: invite.description || invite.title,
      gist: 'prepared calendar invite (approve to send)',
      metadata: { invite, ...(pa ? { agentName: pa.name } : {}), prepared_from: currentGround, provenance: { item: w.title.slice(0, 100) } },
    }).catch(() => {});
    if (movedPast) await narrateGroundMove(admin, userId, w, currentGround);
    return { did: 'invite', worker: pa?.name };
  }
  const { data: it } = await admin.from('inbox_items').select('id, source_data, status, last_activity_at').eq('id', w.entityId).eq('user_id', userId).maybeSingle();
  if (!it || it.status !== 'pending') return { did: 'none', reason: 'no longer open' };
  const sd = (it.source_data ?? {}) as Record<string, unknown>;
  const existing = (sd.prepared_invite ?? null) as { generated_at?: string; sent_at?: string; prepared_from?: { emailId?: string | null; receivedAt?: string | null } | null } | null;
  movedPast = !!existing && !existing.sent_at && groundMoved(existing.prepared_from ?? null, currentGround);
  const stale = !existing
    || movedPast
    || (Date.now() - Date.parse(existing.generated_at || '0')) > FRESH_HOURS * 3_600_000
    || (!!it.last_activity_at && Date.parse(it.last_activity_at as string) > Date.parse(existing.generated_at || '0'));
  if (existing?.sent_at) return { did: 'none', reason: 'the invite already went out' };
  if (!stale) return { did: 'none', reason: 'a fresh prepared invite is already on it' };
  await admin.from('inbox_items').update({
    source_data: { ...sd, prepared_invite: { ...invite, generated_at: new Date().toISOString(), prepared: 'pass', prepared_from: currentGround }, ...(pa ? { prepared_by: { worker: pa.name, at: new Date().toISOString() } } : {}) },
  }).eq('id', it.id);
  if (movedPast) await narrateGroundMove(admin, userId, w, currentGround);
  return { did: 'invite', worker: pa?.name };
}

// ── W1 · the FORWARD branch — a `forward` verdict prepares the pass-it-on: the item's REAL email as
// the forwarded content + recipients inferred ONLY from literal addresses in the item/verdict words
// (never invented — "to finance" leaves `to` empty for the user to fill). Nothing sends: the commit
// is the user's approve on the ForwardPreviewCard → /api/items/execute (gate `send`). ──
async function prepareForwardDraft(
  admin: SupabaseClient, userId: string, w: WorkItem, verdict: import('@/lib/work/judge').WorkVerdict,
): Promise<PrepareOneResult> {
  if (!w.id.startsWith('inbox:')) return { did: 'none', reason: 'only an email thread can be forwarded' };
  const { data: it } = await admin.from('inbox_items').select('id, source_data, status, last_activity_at').eq('id', w.entityId).eq('user_id', userId).maybeSingle();
  if (!it || it.status !== 'pending') return { did: 'none', reason: 'no longer open' };
  const sd = (it.source_data ?? {}) as Record<string, unknown>;
  const existing = (sd.prepared_forward ?? null) as { generated_at?: string; sent_at?: string; prepared_from?: { emailId?: string | null; receivedAt?: string | null } | null } | null;
  if (existing?.sent_at) return { did: 'none', reason: 'the forward already went out' };
  // THE GROUND LAW: what gets passed on must be the present thread — a newer inbound supersedes
  // the prepared forward however recent the clock says it is.
  const { groundOf, groundMoved } = await import('@/lib/prepare/ground');
  const currentGround = await groundOf(admin, userId, { kind: 'inbox', id: String(it.id) });
  const movedPast = !!existing && groundMoved(existing.prepared_from ?? null, currentGround);
  const stale = !existing
    || movedPast
    || (Date.now() - Date.parse(existing.generated_at || '0')) > FRESH_HOURS * 3_600_000
    || (!!it.last_activity_at && Date.parse(it.last_activity_at as string) > Date.parse(existing.generated_at || '0'));
  if (!stale) return { did: 'none', reason: 'a fresh prepared forward is already on it' };
  const { prepareForward } = await import('@/lib/home/prepare-action');
  // Recipient inference is literal-email-only; the item's body + the judge's reason are the only
  // words scanned (an address the counterparty actually wrote — never a guess).
  const fwd = await prepareForward(admin, userId, 'email', w.entityId,
    `${w.title} ${verdict.reason} ${String(sd.body || '').slice(0, 800)}`);
  const pa = await getDraftingAssistant(admin, userId); // O3a attribution
  // The forwarded BODY is not stored (it IS the item's own email — the serving edge re-grounds it);
  // the artifact is the judgment: who it goes to + the subject + the lead-in note.
  const { forwardedBody: _omit, ...fwdSlim } = fwd;
  await admin.from('inbox_items').update({
    source_data: { ...sd, prepared_forward: { ...fwdSlim, generated_at: new Date().toISOString(), prepared: 'pass', prepared_from: currentGround }, ...(pa ? { prepared_by: { worker: pa.name, at: new Date().toISOString() } } : {}) },
  }).eq('id', it.id);
  if (movedPast) await narrateGroundMove(admin, userId, w, currentGround);
  return { did: 'forward', worker: pa?.name };
}

// ── C2 · the COWORKER branch — judgment shapes are prepared by the right coworker, with the item's
// grounding + the deliverable pool (runDelegation reads+writes it). Idempotent per item. Nothing
// sends — prompt-level prepare-and-hand-back guardrail lives in buildDelegationPrompt. ──
async function delegatePrepare(admin: SupabaseClient, userId: string, w: WorkItem, worker: WorkerRow, artifactTruth?: string, computedStamp?: string): Promise<PrepareOneResult> {
  const poolKind = w.id.startsWith('commit:') ? 'commitment' : 'email';
  const { data: prior } = await admin.from('item_deliverables').select('id, created_at, metadata')
    .eq('user_id', userId).eq('kind', poolKind).eq('entity_id', w.entityId).eq('task_id', 'prepare-pass')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  // THE GROUND LAW: the same re-open mechanic as supply — an inbound message IS the counterparty's
  // supply, so a deliverable prepared from an older ground is superseded, not idempotent.
  const { groundOf, groundMoved } = await import('@/lib/prepare/ground');
  const currentGround = await groundOf(admin, userId, { kind: poolKind === 'commitment' ? 'commitment' : 'inbox', id: w.entityId });
  let movedPast = false;
  if (prior) {
    const priorMeta = (prior.metadata ?? {}) as { prepared_from?: { emailId?: string | null; receivedAt?: string | null } | null };
    movedPast = groundMoved(priorMeta.prepared_from ?? null, currentGround);
    // Ask-journey D3 (Aug 13): SUPPLY RE-OPENS THE WORK. The idempotence guard used to be
    // absolute — a user could attach the exact file the ask named and the [CONFIRM:]-shell
    // produced BEFORE it arrived stayed the permanent deliverable. A require:* stage newer than
    // the deliverable means the inputs changed after the work was done: the prior row becomes a
    // version (the reader skips it), and the delegation re-runs with the new pool in view —
    // the same way the ingest route already re-opens reply drafts by dropping generated_at.
    const { data: fresherSupply } = await admin.from('item_deliverables').select('id, created_at')
      .eq('user_id', userId).eq('kind', poolKind).eq('entity_id', w.entityId).like('task_id', 'require:%')
      .gt('created_at', prior.created_at as string).limit(1).maybeSingle();
    if (!fresherSupply && !movedPast) return { did: 'none', reason: `${worker.name.split(' ')[0]} already prepared this`, worker: worker.name };
    await admin.from('item_deliverables')
      .update({ metadata: { ...((prior.metadata ?? {}) as Record<string, unknown>), version_of: movedPast && !fresherSupply ? 'superseded:ground-move' : 'superseded:require-supply' } })
      .eq('id', prior.id).then(() => {}, () => {});
  }
  // FIX 3 — an OUTSTANDING ask blocks re-delegation: while the coworker's input checklist sits
  // unanswered in the room, re-running would only re-ask. The rail's ingest funnel CLEARS the
  // checklist turn when inputs land, which re-opens this path (with the new pool in view).
  // W3: a PROCEEDED ask re-opens it too — the user said go ahead; the envelope carries that
  // standing instruction so the coworker delivers the partial and never asks again.
  let goAhead = false;
  try {
    const { data: ask } = await admin.from('room_turns').select('id, component')
      .eq('user_id', userId).eq('dedupe_key', `delegate:${w.entityId}:prepare-pass`)
      .filter('component->>key', 'eq', 'input_checklist').is('archived_at', null).limit(1).maybeSingle();
    const proceeded = !!((ask?.component as { state?: { proceeded?: boolean } } | null)?.state?.proceeded);
    if (ask && !proceeded) return { did: 'none', reason: `${worker.name.split(' ')[0]} is waiting on input from you`, worker: worker.name };
    goAhead = proceeded;
  } catch { /* pre-migration or column absent — proceed */ }
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
  // THE ARTIFACT TRUTH rides the envelope: the coworker builds FROM what's staged in the pool (it
  // reads the pool as previousOutputs) and must never fabricate the missing pieces — the principal
  // has already been asked for those in the room.
  if (artifactTruth) brainContext = [brainContext, artifactTruth].filter(Boolean).join('\n\n');
  // W3: the principal's standing GO-AHEAD rides too — deliver the partial with honest gaps; a
  // second ask after "go ahead with what's available" would be insubordination, not diligence.
  if (goAhead) {
    brainContext = [brainContext,
      'THE PRINCIPAL HAS SAID: go ahead with what\'s available. Deliver the best partial deliverable from what you have, noting gaps honestly. Do NOT ask for the missing inputs again.',
    ].filter(Boolean).join('\n\n');
  }
  const prompt = buildDelegationPrompt({
    kind: poolKind,
    itemContext: `TASK: ${w.title}\n` + (w.who ? `Counterparty: ${w.who}\n` : '') +
      (w.entity ? `Body of work: ${w.entity.name}\n` : '') + (w.when.explicit ? `Due: ${w.when.explicit}\n` : ''),
    step: { text: w.title.slice(0, 120), detail: 'Produce the prepared deliverable your craft yields for this, ready for my review.' },
    brainContext: brainContext || undefined,
  });
  const dres = await runDelegation({
    supabase: admin, userId, worker, prompt, itemLabel: w.title.slice(0, 80),
    pool: { kind: poolKind, entityId: w.entityId, taskId: 'prepare-pass' },
    // THE GROUND LAW: the deliverable is stamped with the ground it was prepared FROM, so the one
    // reader can derive its staleness the moment the counterparty speaks again.
    preparedFrom: currentGround,
    // THE PROVENANCE CHIP (Arc 1 made visible): `computed` is a STRUCTURAL marker — set only when
    // the sandbox actually ran over the staged files (never text-matched from the deliverable) —
    // and the UI renders the "✓ numbers computed in code" chip from it, with the as-of stamp.
    provenance: { item: w.title.slice(0, 100), ...(w.entity ? { entity: w.entity.name } : {}), ...(w.who ? { who: w.who } : {}), ...(w.when.explicit ? { due: w.when.explicit } : {}), ...(computedStamp ? { computed: computedStamp } : {}) },
  });
  // FIX 3 — a needs_input outcome is an ASK, not prepared work: no "Prepared by" attribution (there
  // is nothing prepared), no activity claiming preparation. The ask already landed as a room
  // checklist turn inside runDelegation; the pass reports it honestly and moves on.
  if (dres.needsInput?.length) {
    await logActivity(admin, userId, {
      type: 'delegated_prepared', title: `${worker.name} needs input on: ${w.title.slice(0, 70)}`,
      entityType: w.id.startsWith('commit:') ? 'commitment' : 'inbox_item', entityId: w.entityId,
      metadata: { via: 'preparation_pass', worker: worker.name, role: worker.worker_role, needs_input: dres.needsInput },
    }).catch(() => {});
    return { did: 'none', reason: `${worker.name.split(' ')[0]} needs input from you: ${dres.needsInput.join('; ')}`, worker: worker.name };
  }
  // TRICHOTOMY T1 FIND — a delegation whose output the evaluator rejected left NOTHING in the pool
  // yet reported did:'delegated' (the item then read as prepared while holding no work). An empty
  // hand-back is an honest none: recorded, retried next pass, never a phantom "prepared" state.
  if (!dres.deliverable) {
    return { did: 'none', reason: `${worker.name.split(' ')[0]}'s attempt didn't pass review — it will retry`, worker: worker.name };
  }
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
  if (movedPast) await narrateGroundMove(admin, userId, w, currentGround);
  return { did: 'delegated', worker: worker.name };
}

// ── C3 · the DOC-SEND branch — a send-an-existing-file task gets the FILE RESOLVED (universal
// registry: pool → KB → drives) and a ready draft with the attachment reference. The approve-gate
// holds: nothing sends; the deep-dive leads with the prepared draft + file. ──

// ── B1 (verb-lane sweep, Aug 13): a send_file item whose file can't be found used to return a
// bare none — no artifact, no ask — leaving the machine in `preparing` FOREVER (the spec calls
// that state transient; here it was a lie). THE TRICHOTOMY LAW reaches this corner: the missing
// file becomes the room's input_checklist ask, and the state honestly reads awaiting_input. ──
// ── THE GROUND LAW's delta line (Aug 13): a ground-move re-preparation narrates EXACTLY ONCE,
// in the room's event grammar — who moved it, and that the prepared work follows. Deduped per
// (item, inbound) so a multi-lane re-prep or a re-run can never spam; lane-agnostic text so the
// keyed dedupe-update never drops a lane's mention. The brief (recomposed on the same ground
// move) speaks the specifics; this line is the record's one timestamped delta. ──
async function narrateGroundMove(admin: SupabaseClient, userId: string, w: WorkItem, current: { emailId: string | null; receivedAt: string | null }): Promise<void> {
  if (!current.emailId) return;
  try {
    const { data: em } = await admin.from('emails').select('from_name, from_address').eq('id', current.emailId).eq('user_id', userId).maybeSingle();
    const who = String(em?.from_name || em?.from_address || 'the counterparty').trim().split(/\s+/)[0];
    const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
    const itemKind = w.id.startsWith('commit:') ? 'commitment' as const : 'inbox' as const;
    const roomKey = await roomKeyForItem(admin, userId, itemKind, w.entityId);
    await writeRoomTurn(admin, userId, roomKey, {
      role: 'system',
      text: `New message from ${who} moved this — the prepared work is updated to match.`,
      refs: [{ label: w.title.slice(0, 60), href: itemKind === 'commitment' ? `/item/${w.entityId}?kind=commitment` : `/item/${w.entityId}` }],
      dedupeKey: `ground:${w.entityId}:${current.emailId}`,
    });
  } catch { /* the delta line is narration — never blocks the re-preparation itself */ }
}

async function askForFile(admin: SupabaseClient, userId: string, w: WorkItem, label: string): Promise<void> {
  try {
    const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
    const itemKind = w.id.startsWith('commit:') ? 'commitment' as const : 'inbox' as const;
    const roomKey = await roomKeyForItem(admin, userId, itemKind, w.entityId);
    await writeRoomTurn(admin, userId, roomKey, {
      role: 'system',
      text: `To send this I need the document itself — I couldn't find it anywhere. Attach below or tell me where to look.`,
      refs: [{ label: w.title.slice(0, 60), href: itemKind === 'commitment' ? `/item/${w.entityId}?kind=commitment` : `/item/${w.entityId}` }],
      component: { key: 'input_checklist', state: { items: [label.slice(0, 120)], taskId: null } },
      dedupeKey: `requires:${w.entityId}`,
    });
  } catch { /* the honest none still records via prep_outcome */ }
}

async function prepareDocSend(admin: SupabaseClient, userId: string, w: WorkItem, verdict?: import('@/lib/work/judge').WorkVerdict): Promise<PrepareOneResult> {
  if (w.id.startsWith('commit:')) {
    const { data: prior } = await admin.from('item_deliverables').select('id, metadata, created_at')
      .eq('user_id', userId).eq('kind', 'commitment').eq('entity_id', w.entityId).eq('type', 'draft')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if ((prior?.metadata as { attachment?: unknown } | null)?.attachment) return { did: 'none', reason: 'already prepared with the file' };
    const cCands = await resolveFileUniversal(admin, { userId, entityId: w.entity?.id ?? null }, w.title, 4).catch(() => []);
    const cTop = cCands.find((c) => c.source === 'kb');
    if (!cTop || cTop.score < 0.7) { await askForFile(admin, userId, w, `the document to send for: ${w.title.slice(0, 90)}`); return { did: 'none', reason: 'could not find the document — asked in the room' }; }
    // W6 — the ONE evidence-quoting verifier (cross-entity rejected structurally; the quote is
    // code-checked): a wrong attach is worse than none.
    const { verifyArtifactMatch: verifyC } = await import('@/lib/prepare/requirements');
    const cJudge = await verifyC(admin, userId, { task: w.title, candidate: cTop, entityId: w.entity?.id ?? null });
    if (!cJudge.match) { await askForFile(admin, userId, w, `the document to send for: ${w.title.slice(0, 90)}`); return { did: 'none', reason: 'no confident file match — asked in the room' }; }
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
  // ── THE DELIVERABLE RESOLUTION (multi-artifact sends — "share these three reports"): when the
  // judge's inventory names the artifacts, resolve THEM (not the item title): staged haves ride the
  // pool + the draft's attachment; missing ones become the room's input-checklist ask; the reply is
  // drafted under the ARTIFACT TRUTH so it never claims what isn't in hand. The single-file path
  // below stays for inventory-less sends. ──
  if (verdict?.requires?.length) {
    const { resolveRequirements } = await import('@/lib/prepare/requirements');
    const reqs = await resolveRequirements(admin, userId, {
      itemKind: 'inbox', itemId: String(it.id), itemTitle: w.title,
      entityId: w.entity?.id ?? null, requires: verdict.requires,
    });
    const kbHave = reqs.have.find((h) => h.file?.source === 'kb');
    const body2 = await generateReplyDraft(userId, sd as Record<string, never>, admin,
      `${reqs.artifactTruth || ''}\nThe reply responds to this request${kbHave ? `; the document "${kbHave.file!.filename}" will be attached` : ''}.`).catch(() => null);
    if (body2) {
      const { review } = await reviewAndRevise(admin, userId,
        { body: body2, task: w.title, recipient: (sd.from_name as string) ?? (sd.from_address as string) ?? null, entityId: w.entity?.id ?? null, kind: 'reply' },
        async () => body2);
      const pa2 = await getDraftingAssistant(admin, userId);
      await admin.from('inbox_items').update({
        source_data: { ...sd, draft: { body: body2, generated_at: new Date().toISOString(), prepared: 'pass', ...(kbHave?.file ? { attachment: { fileId: kbHave.file.id, filename: kbHave.file.filename, source: kbHave.file.source } } : {}), ...(review.verdict !== 'pass' ? { review } : {}) }, ...(pa2 ? { prepared_by: { worker: pa2.name, at: new Date().toISOString() } } : {}) },
      }).eq('id', it.id);
      return { did: reqs.have.length ? 'docsend' : 'draft', worker: pa2?.name };
    }
    // Could not draft — the checklist ask (written by resolveRequirements) still stands in the room.
    return { did: 'none', reason: reqs.missing.length ? `waiting on ${reqs.missing.length} artifact(s) from you` : 'could not draft the send' };
  }
  const cands = await resolveFileUniversal(admin, { userId, entityId: w.entity?.id ?? null }, w.title, 4).catch(() => []);
  // Only attach on a CONFIDENT KB hit (bytes we hold → previewable + attachable); drive-catalog
  // candidates surface in the deep-dive picker instead of silently auto-attaching.
  const top = cands.find((c) => c.source === 'kb');
  if (!top || top.score < 0.7) { await askForFile(admin, userId, w, `the document to send for: ${w.title.slice(0, 90)}`); return { did: 'none', reason: 'could not find the document — asked in the room' }; }
  // THE REASONED PICK (the S4 rule — a score is retrieval, not judgment), upgraded to the W6
  // evidence law: the verifier quotes the proving phrase (code-checked) and rejects cross-entity
  // candidates structurally. Reject → no auto-attach (the deep-dive's picker offers candidates
  // instead). A wrong attach is worse than none — trust is the product.
  const { verifyArtifactMatch } = await import('@/lib/prepare/requirements');
  const judge = await verifyArtifactMatch(admin, userId, {
    task: w.title, candidate: top, entityId: w.entity?.id ?? null,
    emailExcerpt: String(sd.body || '').slice(0, 400) || null,
  });
  if (!judge.match) return { did: 'none', reason: 'no confident file match' };
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

export async function runPreparationPass(
  admin: SupabaseClient, userId: string, opts?: { budgetMs?: number },
): Promise<PrepareResult> {
  // O1a: the user's SELF entity accumulates any newly-observed own-mail identity forms — idempotent,
  // one row at most, and it must land BEFORE the spine derives self-facts from it.
  const { ensureSelfEntity } = await import('@/lib/entities/self');
  await ensureSelfEntity(admin, userId);
  const deadline = Date.now() + (opts?.budgetMs ?? BUDGET_MS);
  const todayStr = new Date().toISOString().slice(0, 10);
  const items = await buildWorkItems(admin, userId, { todayStr, skipReconcile: true });
  const rep = partitionDailyReport(items, todayStr);
  // The master "Automatically draft replies" switch (formerly the legacy rule loop's gate) silences
  // the ambient REPLY lane only — nudges/invites/delegations aren't reply auto-drafts, and the
  // explicit prepare-now click always works.
  let autoDraft = true;
  try {
    const { data: prof } = await admin.from('profiles').select('email_settings').eq('id', userId).maybeSingle();
    autoDraft = ((prof?.email_settings ?? {}) as { auto_draft?: boolean }).auto_draft !== false;
  } catch { /* default ON */ }
  let prepared = 0, skipped = 0, nudges = 0, delegated = 0, leftBehind = 0;
  const tally = (r: PrepareOneResult) => {
    if (r.did === 'draft' || r.did === 'docsend' || r.did === 'invite' || r.did === 'forward' || r.did === 'decision') prepared++;
    else if (r.did === 'nudge') nudges++;
    else if (r.did === 'delegated') delegated++;
    else skipped++;
  };

  // ── W2: the ENTITY-PRIORITY order — the reasoned weight the brain already synthesizes is the
  // queue discipline (a hot deal's reply outranks a loose thread's), never a date heuristic.
  const weights = new Map<string, number>();
  try {
    const { data: ents } = await admin.from('work_entities').select('id, priority')
      .eq('user_id', userId).eq('status', 'active').limit(500);
    for (const e of (ents ?? []) as Array<{ id: string; priority: { weight?: number } | null }>) {
      weights.set(e.id, Number(e.priority?.weight ?? 0));
    }
  } catch { /* unweighted walk */ }
  const weightOf = (x: WorkItem) => (x.entity?.id ? weights.get(x.entity.id) ?? 0 : 0);
  // TRICHOTOMY T5 — NEVER-ATTEMPTED FIRST: under a tight budget, an item the pass has never
  // reached outranks one it already worked (fresh-work guards make re-visits cheap but they
  // still eat budget; the T1 trace found items silent purely because the walk never got there).
  // Within each tier, the entity-priority order stands.
  const attempted = new Set<string>();
  try {
    const { data: outs } = await admin.from('item_plans').select('entity_id')
      .eq('user_id', userId).eq('kind', 'prep_outcome').limit(1000);
    for (const o of outs ?? []) attempted.add(String(o.entity_id));
  } catch { /* unordered walk */ }
  const keyOf = (x: WorkItem) => (x.id.startsWith('commit:') ? `commitment:${x.entityId}` : `inbox:${x.entityId}`);
  const byPriority = (a: WorkItem, b: WorkItem) => {
    const aNew = attempted.has(keyOf(a)) ? 1 : 0, bNew = attempted.has(keyOf(b)) ? 1 : 0;
    if (aNew !== bNew) return aNew - bNew; // unattempted (0) first
    return weightOf(b) - weightOf(a);
  };

  // The three candidate lanes, each walked in priority order under ONE shared budget. Lane 3 is
  // judge-driven end to end (W1): the cached work judgment decides chase/produce/schedule/forward/
  // send_file + the executor — the second batch router is gone (one judge, not two).
  const lanes: WorkItem[][] = [
    autoDraft ? rep.needsYou.filter((x) => x.kind === 'reply' && x.id.startsWith('inbox:')).sort(byPriority) : [],
    rep.openQuestions.filter((x) => x.blockedOn).sort(byPriority),
    rep.needsYou.filter((w) => !w.automated && w.kind !== 'reply' && (w.id.startsWith('inbox:') || w.id.startsWith('commit:'))).sort(byPriority),
  ];
  // ── THE TRICHOTOMY LAW (plan AH): every candidate's outcome is RECORDED — `prep_outcome`
  // rows (item_plans, zero-migration) are the pass's observable ledger: what was prepared,
  // what was asked, what was skipped and WHY. Silence stops being unmeasurable. ──
  const recordOutcome = async (w: WorkItem, r: PrepareOneResult) => {
    try {
      const key = w.id.startsWith('commit:') ? `commitment:${w.entityId}` : `inbox:${w.entityId}`;
      await admin.from('item_plans').upsert({
        user_id: userId, kind: 'prep_outcome', entity_id: key,
        tasks: { did: r.did, reason: r.reason ?? null, worker: r.worker ?? null, at: new Date().toISOString() },
      }, { onConflict: 'user_id,kind,entity_id' });
    } catch { /* observability is an enhancement */ }
  };
  const seen = new Set<string>();
  for (const lane of lanes) {
    for (const w of lane) {
      if (seen.has(w.id)) continue; // one attempt per item per pass (lanes can overlap)
      seen.add(w.id);
      if (Date.now() > deadline) { leftBehind++; continue; }
      const r = await prepareOneItem(admin, userId, w);
      tally(r);
      await recordOutcome(w, r);
    }
  }
  if (leftBehind > 0) {
    console.log(`[prepare-pass] budget spent for user ${userId}: ${leftBehind} candidate(s) left for the next sweep`);
  }

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
        if (prepped >= PREP_CAP || Date.now() > deadline) break;
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
        const { error: prepErr } = await admin.from('item_deliverables').insert({
          user_id: userId, kind: 'entity', entity_id: entId, task_id: taskId, type: 'document',
          title: `Prep — ${String(ev.title || 'Meeting')}`.slice(0, 100), content: briefText, ref: null,
          metadata: { meetingPrep: true, meetingAt: ev.start_time, ...(pa ? { agentName: pa.name } : {}), ...(review.verdict !== 'pass' ? { review } : {}) },
        });
        if (!prepErr) {
          prepped++; prepared++;
          // W4 — THE ENGINE NARRATES the prep too (briefs live in the deal rooms by design; a brief
          // nobody is told about is a brief nobody reads). Keyed per meeting — one line, ever.
          try {
            const { writeRoomTurn } = await import('@/lib/room/turns');
            await writeRoomTurn(admin, userId, entId, {
              role: 'system',
              text: `${pa?.name?.split(' ')[0] ?? 'I'} prepared the brief for "${String(ev.title || 'the meeting').slice(0, 70)}" (${ev.start_time.slice(0, 10)}) — it's on the stage when you're ready.`,
              author: null, // one-narrator law: narration is the CoS voice, never a coworker bubble
              dedupeKey: `meeting-prep:${ev.id}`,
            });
          } catch { /* narration is an enhancement */ }
        }
      }
    }
  } catch { /* prep is an enhancement — the pass's core work already landed */ }

  return { prepared, skipped, nudges, delegated, leftBehind };
}
