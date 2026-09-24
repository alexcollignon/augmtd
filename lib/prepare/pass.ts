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
import { DRAFT_LAW_VERSION as DRAFT_LAW_VERSION_C } from '@/lib/inbox/attachment-context';
import type { TaskRoute } from '@/lib/prepare/route-suggestion';
import type { PreparedKind } from '@/lib/prepare/read';
import { evaluateDeliverable, type EvalVerdict } from '@/lib/prepare/evaluate';
import { chaseInvertsObligation, CHASE_INVERSION_REFUSAL } from '@/lib/prepare/truth';
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
  // W11.1 · THE ATTACHMENT FLOOR's fact: a NUDGE never carries a file (the nudge lanes stage none),
  // so its words may never say "attached". Other kinds state nothing here (the floor stays silent).
  const staged = args.kind === 'nudge' ? { staged: false } : {};
  let review = await evaluateDeliverable(admin, userId, { content: body, task: args.task, recipient: args.recipient, entityId: args.entityId, kind: args.kind, ...staged });
  if (review.verdict === 'revise' && review.objection) {
    const revised = await regenerate(review.objection).catch(() => null);
    if (revised) {
      body = revised;
      review = await evaluateDeliverable(admin, userId, { content: body, task: args.task, recipient: args.recipient, entityId: args.entityId, kind: args.kind, ...staged });
    }
    if (review.verdict === 'revise') review = { verdict: 'flag', objection: review.objection }; // the cap: surface annotated
  }
  return { body, review };
}
import { resolveFileUniversal } from '@/lib/knowledge/resolve';
import { logActivity } from '@/lib/activity/log';
import { orderForPreparation, type NominatorItem, type JudgmentAge } from '@/lib/work/judgment-nominator';
import { readPlans, upsertPlan } from '@/lib/store/item-plans';

// ── W9.1 · DRAFTS CHANGE ONLY WHEN THE GROUND MOVES. The 24h freshness clock is GONE: every lane
// asks lib/prepare/hand.ts `decideRegeneration` — a pure, clock-free decision over the ground's own
// signals (a newer inbound than prepared_from, thread activity past it, supply that landed after
// it, an older drafting law, a reader withdrawal). An unchanged ground keeps the prepared version
// however old it is — a re-draft at the conversation tier + the evaluator on a quiet thread bought
// nothing. And THE USER'S HAND WINS: an artifact the user edited (stamped by the edit door) is never
// overwritten; its moved ground MARKS it (`staleUnderEdit` at THE ONE READER) and is narrated once. ──
import { decideRegeneration, isHandHeld, isPoolRowHandHeld, activityMovedPast, STALE_UNDER_EDIT_LINE, type HandKind } from '@/lib/prepare/hand';

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
  did: 'draft' | 'nudge' | 'delegated' | 'docsend' | 'invite' | 'forward' | 'decision' | 'paste_pack' | 'none';
  worker?: string;   // the coworker's name when did === 'delegated'
  reason?: string;   // the honest why when did === 'none'
  why?: string;      // the JUDGE's reason a delegation happened (provenance for the room narration)
};

export async function prepareOneItem(
  admin: SupabaseClient, userId: string, w: WorkItem,
  opts?: {
    route?: TaskRoute;
    /** W13.2 · the pass's shared re-verify budget (items with stale staging it may re-verify this
     *  run). Absent → this one item may (a single on-demand prepare). */
    reverify?: { left: number; deferred: number };
  },
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

    // ── THE NOISE FLOOR (census fix #3, Sep 13): NOISE IS NEVER PREPARED. ──────────────────────
    // The pass builds its candidates from the SPINE (buildWorkItems → partitionDailyReport), which
    // never passes through `classifyItem` — so every floor LAW 5 installed at the posture seam was
    // asked somewhere this lane does not look, and the engine went on drafting replies to the
    // user's own outbound campaign coming back (35 of 135 live prep narrations on the reference
    // account; three standing drafts; five re-judged that same day).
    //
    // This sits ABOVE the judge deliberately and it is NOT a judgment override — the judge is not
    // wrong about these rows, it is merely ASKED about them. The floor is the same shape as the
    // intake poverty gate: a cost/noise refusal taken BEFORE any AI call, on deterministic facts,
    // that resolves nothing, hides nothing and re-postures nothing. Judgment stays the judge's;
    // this only declines to work on a row the posture seam, the notice law and the deck have all
    // already put in the awareness lane. A human `type_override` still outranks it (inside the
    // floor), and the refusal is SPOKEN — it lands in the prep_outcome ledger as its own reason.
    if (w.id.startsWith('inbox:')) {
      const { itemIsNoise } = await import('@/lib/prepare/noise-floor');
      const n = await itemIsNoise(admin, userId, w.entityId);
      if (n.noise) return { did: 'none', reason: n.reason ?? 'noise — nothing to prepare' };
    }

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
    // ── W13.2 · THE STAGING LAW HEALS ITSELF, before any lane reads the pool: a `require:` row staged
    // under an OLDER staging law re-verifies through THE ONE RESOLVER (lib/prepare/requirements
    // `reverifyStaleStaging` — one read when nothing is stale, zero AI). The lanes below may never
    // reach the resolver (a kept reply draft, a doc-send "already prepared with the file"), so the pass
    // asks here, bounded per run; an item past the budget is counted and left for the next sweep. A
    // demoted row re-stages its file as the BASE, and THE ONE READER (next block) then withdraws any
    // draft riding it — the lanes re-prepare it in this same pass. ──
    if (verdict.requires?.length && (verdict.work === 'reply' || verdict.work === 'send_file')) {
      const budget = opts?.reverify ?? { left: 1, deferred: 0 };
      const { reverifyStaleStaging, standingRequireRows, stagingLawStale } = await import('@/lib/prepare/requirements');
      const itemKind = w.id.startsWith('commit:') ? 'commitment' as const : 'inbox' as const;
      if (budget.left > 0) {
        const rv = await reverifyStaleStaging(admin, userId, {
          itemKind, itemId: w.entityId, itemTitle: w.title, entityId: w.entity?.id ?? null, requires: verdict.requires, work: verdict.work,
        }).catch(() => ({ stale: 0, ran: false }));
        if (rv.ran) budget.left--;
      } else {
        const rows = await standingRequireRows(admin, userId, { itemKind, itemId: w.entityId, labels: verdict.requires.map((r) => r.label) }).catch(() => []);
        if (rows.some((r) => stagingLawStale(r.metadata))) budget.deferred++;
      }
    }
    // ── W5c · A HIDDEN ARTIFACT IS NEVER FRESH: THE ONE READER's non-live kinds (outside the stated
    // window · a false completion claim · a passed time · superseded) are handed to every lane below,
    // whose freshness guard would otherwise read a young-but-untrue row as "already on it" — the
    // on-open trip fired, the lane no-op'd, and the room stood with nothing true to show (Sep 23). ──
    let nonLive: Set<PreparedKind> = new Set();
    try {
      const { preparedState, nonLiveKindsOf } = await import('@/lib/prepare/read');
      nonLive = nonLiveKindsOf(await preparedState(admin, userId, { kind: w.id.startsWith('commit:') ? 'commitment' : 'inbox_item', id: w.entityId }));
    } catch { /* the lanes' own guards stand */ }
    // ── Q8b · THE PASTE PACK (attention-plan PART III): BEFORE the commit-door lanes, ask whether
    // this account/item HAS the door they end at. When it does not — an email-off workspace, or a
    // `reply` verdict on a commitment (the reply lane is mail-only by construction and its first
    // query simply misses; measured: 4 standing reply commitments, all preparing nothing) — the
    // deed is out of reach but the WORDS are not. The pack is the preparation; the user pastes it
    // where the work actually lives. Deterministic eligibility, zero AI before the decision. ──
    {
      const { pastePackEligibility } = await import('@/lib/prepare/paste-pack');
      const itemKind = w.id.startsWith('commit:') ? 'commitment' as const : 'inbox' as const;
      let features: Record<string, boolean> | null = null;
      try {
        const { getWorkspaceFeatures } = await import('@/lib/workspace/features');
        features = (await getWorkspaceFeatures(userId, admin)) as unknown as Record<string, boolean>;
      } catch { /* unknown features never pack — the ordinary lanes stand */ }
      const elig = pastePackEligibility({ work: verdict.work, itemKind, features });
      if (elig.eligible && elig.reason) {
        const { preparePastePack } = await import('@/lib/prepare/paste-pack');
        let material: string | null = null;
        if (itemKind === 'inbox') {
          const { data: mIt } = await admin.from('inbox_items').select('source_data').eq('id', w.entityId).eq('user_id', userId).maybeSingle();
          material = String(((mIt?.source_data ?? {}) as { body?: string }).body ?? '').slice(0, 1200) || null;
        }
        // TRUE ADDRESSEES (W7.3): a commitment's words are addressed by THE ONE LADDER (stamped);
        // an inbox item's are addressed to the spine's party as before.
        let packAddr: import('@/lib/prepare/addressee').AddresseeResolution | null = null;
        if (itemKind === 'commitment') {
          const { resolveCommitmentAddressee } = await import('@/lib/prepare/addressee');
          packAddr = await resolveCommitmentAddressee(admin, userId, w.entityId);
        }
        const { recipientsLabel: packLabel } = await import('@/lib/prepare/addressee');
        const pack = await preparePastePack(admin, userId, {
          itemKind, itemId: w.entityId, title: w.title,
          counterparty: packAddr ? packLabel(packAddr.recipients) : (w.who ?? w.blockedOn ?? null), reason: elig.reason, material,
          ...(packAddr ? { addressee: packAddr.addressee } : {}),
          // A chase is the only one of these verbs where the OTHER side owes; everything else is
          // the user's own obligation, and the drafter is told which.
          userOwes: verdict.work !== 'chase',
          supersede: nonLive.has('paste_pack'),
        });
        if (pack.status === 'written') return await done({ did: 'paste_pack', worker: pack.by ?? undefined, why: elig.why });
        return { did: 'none', reason: pack.status === 'fresh'
          ? 'the words for this are already prepared'
          : 'could not write the words for this yet — it will retry' };
      }
    }
    if (verdict.work === 'send_file') return await done(await prepareDocSend(admin, userId, w, verdict, nonLive));
    // ── W11.1 · THE DIRECTION FLOOR, at the lane (belt to the judge's own floor): a chase on work the
    // USER owes is refused here, never written — a hand-routed or pre-floor verdict cannot reach the
    // nudge drafter. prepareNudge re-asks the same predicate on its own facts. ──
    if (verdict.work === 'chase' && await chaseInvertedFor(admin, userId, w)) return { did: 'none', reason: CHASE_INVERSION_REFUSAL };
    if (verdict.work === 'chase' && (w.who || w.blockedOn)) return await done(await prepareNudge(admin, userId, { ...w, blockedOn: w.blockedOn ?? w.who ?? null }, nonLive));
    // ── W1: THE JUDGE'S NEW HANDS — schedule and forward were judged-but-never-prepared (the
    // registry mapped them, the pass fell through to none). Both prepare an EDITABLE artifact and
    // stop at the commit line: the invite books nothing, the forward sends nothing.
    if (verdict.work === 'schedule') return await done(await prepareInviteDraft(admin, userId, w, nonLive));
    if (verdict.work === 'forward') return await done(await prepareForwardDraft(admin, userId, w, verdict));
    // ── THE DECISION BRIEF (trichotomy T2 — the judge's last silent verb): a `decide` verdict
    // used to fall to the generic none — "you must choose" judged, nothing prepared, nothing
    // asked (5 live instances found in the T1 trace). A decision's preparation IS the laid-out
    // choice: the question, the real options with trade-offs, and a grounded recommendation. ──
    if (verdict.work === 'decide') return await done(await prepareDecisionBrief(admin, userId, w, verdict));
    // A chase whose counterparty the spine could not name still has TWO honest deterministic
    // sources (T1: "Resolve demo timeout" + the "Waiting on Sam" pair sat silent because
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
      return await done(await prepareNudge(admin, userId, { ...w, blockedOn: target ?? w.title.slice(0, 60) }, nonLive));
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
          itemTitle: w.title, entityId: w.entity?.id ?? null, requires: verdict.requires, work: verdict.work,
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
        const dr = await delegatePrepare(admin, userId, w, { id: verdict.executor.id, name: verdict.executor.name ?? 'Coworker', worker_role: null, is_worker: true }, artifactTruth || undefined, computedStamp, nonLive.has('deliverable'));
        return await done({ ...dr, why: verdict.reason });
      }
      // W1: a produce verdict WITHOUT a named coworker is no longer a silent none — the drafting
      // assistant prepares the starting point (same precedent as replies: executor "user" means the
      // user owns the commit, never that nothing may be prepared). Missing inputs were already asked
      // for above; with everything in hand the assistant builds from what's staged.
      const paProduce = await getDraftingAssistant(admin, userId);
      if (paProduce) {
        const dr = await delegatePrepare(admin, userId, w, { id: paProduce.id, name: paProduce.name, worker_role: 'personal_assistant', is_worker: true }, artifactTruth || undefined, computedStamp, nonLive.has('deliverable'));
        return await done({ ...dr, why: verdict.reason });
      }
      return { did: 'none', reason: 'produced work needs a coworker and none is set up yet' };
    }
    if (verdict.work === 'reply') return await done(await prepareReplyDraft(admin, userId, w, verdict, nonLive));
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
  const { data: prior } = await admin.from('item_deliverables').select('id, created_at, content, metadata')
    .eq('user_id', userId).eq('kind', poolKind).eq('entity_id', w.entityId)
    .eq('task_id', 'decision-brief').filter('metadata->>version_of', 'is', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  // THE GROUND LAW: the options laid out for a decision are only the options the newest message
  // left standing — a ground move re-lays the decision, however settled the prior brief looks.
  const { groundOf, groundMoved } = await import('@/lib/prepare/ground');
  const currentGround = await groundOf(admin, userId, { kind: poolKind === 'commitment' ? 'commitment' : 'inbox', id: w.entityId });
  const priorMeta = (prior?.metadata ?? {}) as { prepared_from?: { emailId?: string | null; receivedAt?: string | null } | null };
  const movedPast = !!prior && groundMoved(priorMeta.prepared_from ?? null, currentGround);
  const briefDecision = decideRegeneration({ exists: !!prior, handHeld: isPoolRowHandHeld('deliverable', prior), groundMoved: movedPast });
  if (briefDecision.action === 'mark_stale_under_edit') return await markStaleUnderEdit(admin, userId, w, currentGround, 'deliverable', briefDecision.reason);
  if (briefDecision.action === 'keep') return { did: 'none', reason: prior && !isPoolRowHandHeld('deliverable', prior) ? 'the decision brief is already prepared' : briefDecision.reason };

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
  if (movedPast) await narrateGroundMove(admin, userId, w, currentGround, 'deliverable', (prior?.created_at as string | undefined) ?? null);
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
      // Q8 · THE PASTE PACK: the words exist, and the line says plainly that the sending does not
      // happen here — a narration may claim only what is true beside it.
      r.did === 'paste_pack' ? `${first ?? 'I'} wrote the words for "${title}" — copy them wherever this lives; nothing goes out from here.` :
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
async function prepareReplyDraft(admin: SupabaseClient, userId: string, w: WorkItem, verdict?: import('@/lib/work/judge').WorkVerdict, nonLive?: Set<PreparedKind>): Promise<PrepareOneResult> {
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
  const existing = (sd.draft ?? null) as { body?: string; generated_at?: string; law_version?: number; sent_at?: string; prepared_from?: { emailId?: string | null; receivedAt?: string | null } | null } | null;
  // THE GROUND LAW: the newest inbound RIGHT NOW — compared against what the draft was prepared
  // FROM. A ground move supersedes regardless of clock freshness (the counterparty's new message
  // is their supply; found live: a Monday reply offered as current after the plan moved to Thursday).
  const { groundOf, groundMoved } = await import('@/lib/prepare/ground');
  const currentGround = await groundOf(admin, userId, { kind: 'inbox', id: String(it.id) });
  const movedPast = !!existing?.body && groundMoved(existing.prepared_from ?? null, currentGround);
  // THE DRAFTER LAW VERSION: a draft written under an older drafting law is stale on its own — the
  // attachment-blind drafts that told counterparties their document never arrived must be rewritten,
  // not aged out.
  const { draftLawStale, DRAFT_LAW_VERSION } = await import('@/lib/inbox/attachment-context');
  // W9.1: THE ONE DECISION — no clock. Supply that landed after the draft drops its generated_at
  // (lib/prepare/supply.ts reopenAfterSupply) — that is the supply signal, read as one.
  const decision = decideRegeneration({
    exists: !!existing?.body, sent: !!existing?.sent_at, handHeld: isHandHeld('reply_draft', existing),
    groundMoved: movedPast,
    activityMoved: !!existing?.body && activityMovedPast(it.last_activity_at as string | null, existing.prepared_from ?? null, existing.generated_at ?? null),
    supplyMoved: !!existing?.body && !existing.generated_at,
    lawStale: !!existing?.body && draftLawStale(existing),
    nonLive: !!nonLive?.has('reply_draft'),   // W5c: a hidden (untrue) draft is never fresh
  });
  if (decision.action === 'mark_stale_under_edit') return await markStaleUnderEdit(admin, userId, w, currentGround, 'reply_draft', decision.reason);
  if (decision.action === 'keep') return { did: 'none', reason: decision.reason };
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
      entityId: w.entity?.id ?? null, requires: verdict.requires, work: verdict.work,
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
    .update({ source_data: { ...sd, draft: { body, generated_at: new Date().toISOString(), prepared: 'pass', prepared_from: currentGround, law_version: DRAFT_LAW_VERSION,
      // TRUE ADDRESSEES (W7.3): a reply is addressed to the thread's sender — stamped, so the reader
      // can refuse one that greets the user (their own sent mail as the item).
      ...(sd.from_address || sd.from_name ? { addressee: { name: (sd.from_name as string | undefined) ?? null, email: (sd.from_address as string | undefined) ?? null, via: 'sender' } } : {}),
      ...(stagedAttachment ? { attachment: stagedAttachment } : {}), ...(review.verdict !== 'pass' ? { review } : {}) }, ...(pa ? { prepared_by: { worker: pa.name, at: new Date().toISOString() } } : {}) } })
    .eq('id', it.id);
  if (movedPast) await narrateGroundMove(admin, userId, w, currentGround, 'reply_draft', existing?.generated_at ?? null);
  return { did: 'draft', worker: pa?.name };
}

// ── W11.1 · WHO OWES, read for the lane (the ONE predicate: lib/prepare/truth chaseInvertsObligation).
// A commitment's direction · an inbox item's understanding ownership. Unreadable → false (the judge's
// floor already stood; this is the belt). ──
async function chaseInvertedFor(admin: SupabaseClient, userId: string, w: WorkItem): Promise<boolean> {
  try {
    if (w.id.startsWith('commit:')) {
      const { data } = await admin.from('commitments').select('direction').eq('id', w.entityId).eq('user_id', userId).maybeSingle();
      return chaseInvertsObligation({ direction: (data?.direction as string | null) ?? null });
    }
    const { data } = await admin.from('inbox_items').select('source_data->understanding').eq('id', w.entityId).eq('user_id', userId).maybeSingle();
    const u = ((data as { understanding?: { ownership?: string } } | null)?.understanding) ?? null;
    return chaseInvertsObligation({ ownership: u?.ownership ?? null });
  } catch { return false; }
}

// ── The nudge branch (slice 1) — inbox waits land on source_data, commitment waits in the pool. ──
async function prepareNudge(admin: SupabaseClient, userId: string, w: WorkItem, nonLive?: Set<PreparedKind>): Promise<PrepareOneResult> {
  // W11.1 · A NUDGE IS FOR WHAT THEY OWE — refuse, never write, on work the user owes.
  if (await chaseInvertedFor(admin, userId, w)) return { did: 'none', reason: CHASE_INVERSION_REFUSAL };
  // W5c: an untrue nudge/draft (a false completion claim, a superseded ground) is never "fresh".
  const untrueNudge = !!nonLive && (nonLive.has('nudge_draft') || nonLive.has('reply_draft'));
  const ageDays = Math.max(0, Math.round((Date.now() - Date.parse(w.startAt)) / 86_400_000));
  if (w.id.startsWith('inbox:')) {
    const { data: it } = await admin.from('inbox_items').select('id, source_data, status').eq('id', w.entityId).eq('user_id', userId).maybeSingle();
    if (!it || it.status !== 'pending') return { did: 'none', reason: 'no longer open' };
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    const existing = (sd.nudge_draft ?? null) as { body?: string; generated_at?: string; sent_at?: string; prepared_from?: { emailId?: string | null; receivedAt?: string | null } | null } | null;
    // THE GROUND LAW: a newer inbound than the one this nudge was prepared FROM supersedes it —
    // regardless of clock freshness (chasing someone about a thing they already answered is the
    // exact failure the law ends). Unstamped/unresolvable ground is exempt.
    const { groundOf, groundMoved } = await import('@/lib/prepare/ground');
    const currentGround = await groundOf(admin, userId, { kind: 'inbox', id: String(it.id) });
    const movedPast = !!existing?.body && groundMoved(existing.prepared_from ?? null, currentGround);
    const decision = decideRegeneration({
      exists: !!existing?.body, sent: !!existing?.sent_at, handHeld: isHandHeld('nudge_draft', existing),
      groundMoved: movedPast, nonLive: untrueNudge,
    });
    if (decision.action === 'mark_stale_under_edit') return await markStaleUnderEdit(admin, userId, w, currentGround, 'nudge_draft', decision.reason);
    if (decision.action === 'keep') return { did: 'none', reason: decision.reason };
    // THE LANGUAGE MIRROR: the counterparty's own words are the concrete signal.
    const mirrorText = String(sd.body || '').slice(0, 1200) || null;
    // TRUE ADDRESSEES (W7.3): the nudge is stamped with who it greets — the one the chase is on.
    const { parseWho } = await import('@/lib/entities/people');
    const pw = parseWho(w.blockedOn);
    const inboxAddressee = (pw.name || pw.email) ? { name: pw.name, email: pw.email, via: 'counterparty' as const } : null;
    const nudgeThread = (sd.thread_id as string | null | undefined) ?? null; // W11.1: the mailbox scope
    const raw = await generateNudgeDraft(userId, { counterparty: w.blockedOn, description: w.title, ageDays, mirrorText, threadId: nudgeThread }, admin);
    if (!raw) return { did: 'none', reason: 'could not draft the nudge' };
    const { body, review } = await reviewAndRevise(admin, userId, // O4 review
      { body: raw, task: w.title, recipient: w.blockedOn, entityId: w.entity?.id ?? null, kind: 'nudge' },
      (objection) => generateNudgeDraft(userId, { counterparty: w.blockedOn, description: w.title, ageDays, mirrorText, threadId: nudgeThread, instructions: `REVIEWER'S OBJECTION — fix this: ${objection}` }, admin));
    const pa = await getDraftingAssistant(admin, userId); // O3a attribution
    await admin.from('inbox_items')
      .update({ source_data: { ...sd, nudge_draft: { body, generated_at: new Date().toISOString(), prepared: 'pass', prepared_from: currentGround, ...(inboxAddressee ? { addressee: inboxAddressee } : {}), ...(review.verdict !== 'pass' ? { review } : {}) }, ...(pa ? { prepared_by: { worker: pa.name, at: new Date().toISOString() } } : {}) } })
      .eq('id', it.id);
    if (movedPast) await narrateGroundMove(admin, userId, w, currentGround, 'nudge_draft', existing?.generated_at ?? null);
    return { did: 'nudge', worker: pa?.name };
  }
  if (w.id.startsWith('commit:')) {
    // Commitments have no source_data — the nudge lands in the item_deliverables pool (type 'draft'),
    // which the deep-dive + downstream steps already read.
    // W9.1: the ledger's `version_of` rows (a kept edit, a superseded nudge) are never "the" draft.
    const { data: existing } = await admin.from('item_deliverables').select('id, created_at, content, metadata')
      .eq('user_id', userId).eq('kind', 'commitment').eq('entity_id', w.entityId).eq('type', 'draft')
      .filter('metadata->>version_of', 'is', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    // THE GROUND LAW: the counterparty's newer message supersedes the prepared nudge — fresh by
    // clock is not fresh by ground.
    const { groundOf, groundMoved } = await import('@/lib/prepare/ground');
    const currentGround = await groundOf(admin, userId, { kind: 'commitment', id: w.entityId });
    const priorMeta = (existing?.metadata ?? {}) as { prepared_from?: { emailId?: string | null; receivedAt?: string | null } | null };
    const movedPast = !!existing && groundMoved(priorMeta.prepared_from ?? null, currentGround);
    const decision = decideRegeneration({
      exists: !!existing, sent: !!(existing?.metadata as { sent_at?: string } | null)?.sent_at,
      handHeld: isPoolRowHandHeld('nudge_draft', existing), groundMoved: movedPast, nonLive: untrueNudge,
    });
    if (decision.action === 'mark_stale_under_edit') return await markStaleUnderEdit(admin, userId, w, currentGround, 'nudge_draft', decision.reason);
    if (decision.action === 'keep') return { did: 'none', reason: decision.reason };
    // THE LANGUAGE MIRROR: the counterparty's last inbound message on the commitment's thread.
    let mirrorText: string | null = null;
    let commitThreadId: string | null = null; // W11.1: the conversation's MAILBOX scopes voice + signature
    try {
      const { data: c } = await admin.from('commitments').select('thread_id').eq('id', w.entityId).maybeSingle();
      commitThreadId = (c?.thread_id as string | null) ?? null;
      if (c?.thread_id) {
        const { data: last } = await admin.from('emails').select('body, received_at').eq('user_id', userId)
          .eq('thread_id', c.thread_id as string).eq('is_from_user', false)
          .order('received_at', { ascending: false }).limit(1).maybeSingle();
        mirrorText = String(last?.body || '').slice(0, 1200) || null;
      }
    } catch { /* non-fatal */ }
    // ── TRUE ADDRESSEES (W7.3): WHO this nudge greets comes from THE ONE LADDER (counterparty →
    // the source email's other party → the meeting's attendees minus the user → the project's one
    // external person) — never the spine's `blockedOn`, which carried the USER's own name before the
    // self-party repair ("Nudge — <user>", "Dear <user>…", To empty — found live). Nothing resolves ⇒
    // the words greet no one by name and the card ASKS who it goes to. The OWED DIRECTION rides too:
    // a message about the user's own obligation is never written as a chase. ──
    const { resolveCommitmentAddressee, recipientsLabel, addresseeStamp } = await import('@/lib/prepare/addressee');
    const addr = await resolveCommitmentAddressee(admin, userId, w.entityId);
    const greet = recipientsLabel(addr.recipients);
    const { data: dirRow } = await admin.from('commitments').select('direction').eq('id', w.entityId).eq('user_id', userId).maybeSingle();
    const direction: 'you' | 'them' = dirRow?.direction === 'you_owe' ? 'you' : 'them';
    const raw = await generateNudgeDraft(userId, { counterparty: greet, description: w.title, ageDays, mirrorText, direction, threadId: commitThreadId }, admin);
    if (!raw) return { did: 'none', reason: 'could not draft the nudge' };
    const { body, review } = await reviewAndRevise(admin, userId, // O4 review
      { body: raw, task: w.title, recipient: greet, entityId: w.entity?.id ?? null, kind: 'nudge' },
      (objection) => generateNudgeDraft(userId, { counterparty: greet, description: w.title, ageDays, mirrorText, direction, threadId: commitThreadId, instructions: `REVIEWER'S OBJECTION — fix this: ${objection}` }, admin));
    const pa = await getDraftingAssistant(admin, userId); // O3a attribution
    // The superseded nudge FILES into the version chain (the reader skips `version_of` rows) —
    // the past folds, never deletes.
    if ((movedPast || untrueNudge) && existing) {
      await admin.from('item_deliverables')
        .update({ metadata: { ...priorMeta, version_of: movedPast ? 'superseded:ground-move' : 'superseded:truth' } })
        .eq('id', existing.id).then(() => {}, () => {});
    }
    await admin.from('item_deliverables').insert({
      user_id: userId, kind: 'commitment', entity_id: w.entityId, type: 'draft',
      title: `Nudge — ${greet ? greet.split('<')[0].trim() : 'recipient to confirm'}`.slice(0, 100), content: body, ref: null,
      metadata: { ...(pa ? { agentName: pa.name } : {}), prepared_from: currentGround, ...addresseeStamp(addr), ...(review.verdict !== 'pass' ? { review } : {}) },
    }).then(() => {}, () => {});
    if (movedPast) await narrateGroundMove(admin, userId, w, currentGround, 'nudge_draft', (existing?.created_at as string | undefined) ?? null);
    return { did: 'nudge', worker: pa?.name };
  }
  return { did: 'none', reason: 'not a preparable item' };
}

// ── W1 · the INVITE branch — a `schedule` verdict prepares a GROUNDED, editable calendar invite
// (title/time/attendees extracted from the item's own thread, never invented — the same grounded
// extractor the deep-dive's on-demand card uses). Stored as the item's prepared artifact; the card
// serves it instantly and the ONLY commit is the user's approve → /api/items/execute (gate `book`).
// Idempotent: a fresh prepared invite (newer than thread activity) is never regenerated. ──
async function prepareInviteDraft(admin: SupabaseClient, userId: string, w: WorkItem, nonLive?: Set<PreparedKind>): Promise<PrepareOneResult> {
  const isCommit = w.id.startsWith('commit:');
  // W5c: an invite THE ONE READER hides (outside the stated window · its time passed · superseded)
  // is never "a fresh prepared invite already on it" — the clock is not the truth.
  const untrueInvite = !!nonLive?.has('invite');
  // THE GROUND LAW: the invite is the lane the law was found on — a counterparty who moves the day
  // supersedes the prepared time, and the clock says nothing about that.
  const { groundOf, groundMoved } = await import('@/lib/prepare/ground');
  const currentGround = await groundOf(admin, userId, { kind: isCommit ? 'commitment' : 'inbox', id: w.entityId });
  let movedPast = false;
  if (isCommit) {
    // A commitment's invite lands in the pool (commitments have no source_data), same as its nudges.
    const { data: prior } = await admin.from('item_deliverables').select('id, created_at, content, metadata')
      .eq('user_id', userId).eq('kind', 'commitment').eq('entity_id', w.entityId).eq('task_id', 'prepare-pass-invite')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    const priorMeta = (prior?.metadata ?? {}) as { prepared_from?: { emailId?: string | null; receivedAt?: string | null } | null; sent_at?: string };
    movedPast = !!prior && groundMoved(priorMeta.prepared_from ?? null, currentGround);
    // W9.1: no clock. writeDeliverable REPLACES the task's row — a hand-held invite never reaches it.
    const decision = decideRegeneration({
      exists: !!prior, sent: !!priorMeta.sent_at, handHeld: isPoolRowHandHeld('invite', prior),
      groundMoved: movedPast, nonLive: untrueInvite,
    });
    if (decision.action === 'mark_stale_under_edit') return await markStaleUnderEdit(admin, userId, w, currentGround, 'invite', decision.reason);
    if (decision.action === 'keep') return { did: 'none', reason: decision.reason === 'nothing moved under it — the prepared version stands' ? 'a prepared invite is already on it — nothing moved under it' : decision.reason };
  }
  const { buildItemContext } = await import('@/lib/home/item-context');
  const { prepareCalendarInvite } = await import('@/lib/home/prepare-action');
  const planKind = isCommit ? 'commitment' as const : 'email' as const;
  const ctx = await buildItemContext(admin, userId, planKind, w.entityId);
  if (!ctx) return { did: 'none', reason: 'could not ground the invite in the item' };
  const invite = await prepareCalendarInvite(admin, userId, planKind, ctx, w.title);
  // ── TIME TRUTH (W5a, owner walk Sep 23): THE STATED WINDOW IS A FACT ABOUT THE THREAD. The item's
  // own words ("September 30 or October 1") are parsed by the ONE window parser (code-verified, never
  // guessed); a proposal — the model's or the calendar's — that lands outside it is not "inside what
  // they stated", and a slot behind the clock is not a proposal at all. Both are dropped BEFORE the
  // card can ever render them. The item's own title/description is read first (narrow); the wider
  // grounding text only when the title states nothing. ──
  // W5c: ONE implementation (lib/prepare/truth confineInviteToStatedWindow) — the card's on-demand
  // build runs the very same confinement, so the two builders can never disagree about the window.
  const { confineInviteToStatedWindow } = await import('@/lib/prepare/truth');
  const windowAnchor = w.startAt || null;
  const statedWin = confineInviteToStatedWindow(invite, { narrow: w.title, wide: ctx.text }, windowAnchor);
  // ── Q8c · THE PROPOSE TIER'S LAST MILE (attention-plan PART III; measured: 11 standing schedule
  // verdicts, 9 with no invite at all and 2 with no time — the scheduling asks sat CTA-only). The
  // grounding pass may only propose INSIDE a day or window the item itself states, which is right:
  // a time nobody mentioned is not a fact about the thread. So when the thread states no day, the
  // proposal comes from the OTHER authority — the user's own calendar, in code, zero AI. The card
  // already says `proposed`, and approve-before-commit is untouched: nothing books.
  // W5a: when the item DOES state a window, the calendar search is CONFINED to it (fromDayStr /
  // toDayStr — the picker already honored them for chat; this caller ignored them), and the slot's
  // provenance is stamped so the card's label can only claim what code verified. ──
  if (!invite.startISO) {
    try {
      const { userTimezone, localNow } = await import('@/lib/utils/user-time');
      const { proposeFreeSlots } = await import('@/lib/prepare/free-slots');
      const tz = invite.timezone && invite.timezone !== 'UTC' ? invite.timezone : await userTimezone(admin, userId);
      const slots = await proposeFreeSlots(admin, userId, {
        tz, todayStr: localNow(tz).dateStr, count: 3,
        ...(statedWin ? { fromDayStr: statedWin.start, toDayStr: statedWin.end } : {}),
      });
      if (slots.length) {
        invite.startISO = slots[0].startISO;
        invite.endISO = slots[0].endISO;
        invite.proposed = true;      // OURS, not theirs — the card says so in the user's own words
        invite.proposedFrom = statedWin ? 'stated_window' : 'calendar';
        invite.timezone = tz;
        // The other two ride as the card's alternatives. Their note states their ONLY evidence:
        // the user's calendar is free then (inside the stated window when there is one).
        invite.alternatives = slots.slice(1, 3).map((s) => ({ ...s, note: 'free on your calendar' }));
      }
    } catch { /* a calendar we cannot read proposes nothing — the card still asks for a time */ }
  }
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
                // THE ONE ENGINE STRIP (W9.1b): an invite the user edited is FILED (version chain +
                // one narration with their words), never deleted; a failed filing keeps it.
                const { stripSourceArtifacts } = await import('@/lib/prepare/hand-store');
                const strip = await stripSourceArtifacts(admin, userId, { itemId: String(itStrip.id), sd: sdStrip, fields: ['prepared_invite'], why: 'booked' });
                await admin.from('inbox_items').update({ source_data: strip.sd }).eq('id', itStrip.id);
                // THE OUTCOME LEDGER (W3.2): the meeting is already on the calendar — the user booked
                // it outside our door while our invite waited. done_elsewhere: the work was real.
                const { logPreparedOutcome } = await import('@/lib/prepare/outcome');
                await logPreparedOutcome(admin, userId, {
                  outcome: 'done_elsewhere', artifact: 'invite', itemKind: 'inbox', itemId: String(itStrip.id),
                  door: 'booked_floor', source: sdStrip,
                  preparedAt: typeof (pi as { generated_at?: unknown }).generated_at === 'string' ? (pi as { generated_at: string }).generated_at : null,
                });
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
    if (movedPast) await narrateGroundMove(admin, userId, w, currentGround, 'invite', null);
    return { did: 'invite', worker: pa?.name };
  }
  const { data: it } = await admin.from('inbox_items').select('id, source_data, status, last_activity_at').eq('id', w.entityId).eq('user_id', userId).maybeSingle();
  if (!it || it.status !== 'pending') return { did: 'none', reason: 'no longer open' };
  const sd = (it.source_data ?? {}) as Record<string, unknown>;
  const existing = (sd.prepared_invite ?? null) as { generated_at?: string; sent_at?: string; prepared_from?: { emailId?: string | null; receivedAt?: string | null } | null } | null;
  movedPast = !!existing && !existing.sent_at && groundMoved(existing.prepared_from ?? null, currentGround);
  if (existing?.sent_at) return { did: 'none', reason: 'the invite already went out' };
  const decision = decideRegeneration({
    exists: !!existing, handHeld: isHandHeld('invite', existing), groundMoved: movedPast, nonLive: untrueInvite,
    activityMoved: !!existing && activityMovedPast(it.last_activity_at as string | null, existing.prepared_from ?? null, existing.generated_at ?? null),
  });
  if (decision.action === 'mark_stale_under_edit') return await markStaleUnderEdit(admin, userId, w, currentGround, 'invite', decision.reason);
  if (decision.action === 'keep') return { did: 'none', reason: decision.reason };
  await admin.from('inbox_items').update({
    source_data: { ...sd, prepared_invite: { ...invite, generated_at: new Date().toISOString(), prepared: 'pass', prepared_from: currentGround }, ...(pa ? { prepared_by: { worker: pa.name, at: new Date().toISOString() } } : {}) },
  }).eq('id', it.id);
  if (movedPast) await narrateGroundMove(admin, userId, w, currentGround, 'invite', existing?.generated_at ?? null);
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
  const decision = decideRegeneration({
    exists: !!existing, handHeld: isHandHeld('forward', existing), groundMoved: movedPast,
    activityMoved: !!existing && activityMovedPast(it.last_activity_at as string | null, existing.prepared_from ?? null, existing.generated_at ?? null),
  });
  if (decision.action === 'mark_stale_under_edit') return await markStaleUnderEdit(admin, userId, w, currentGround, 'forward', decision.reason);
  if (decision.action === 'keep') return { did: 'none', reason: decision.reason };
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
  if (movedPast) await narrateGroundMove(admin, userId, w, currentGround, 'forward', existing?.generated_at ?? null);
  return { did: 'forward', worker: pa?.name };
}

// ── C2 · the COWORKER branch — judgment shapes are prepared by the right coworker, with the item's
// grounding + the deliverable pool (runDelegation reads+writes it). Idempotent per item. Nothing
// sends — prompt-level prepare-and-hand-back guardrail lives in buildDelegationPrompt. ──
async function delegatePrepare(admin: SupabaseClient, userId: string, w: WorkItem, worker: WorkerRow, artifactTruth?: string, computedStamp?: string, untrueDeliverable?: boolean): Promise<PrepareOneResult> {
  const poolKind = w.id.startsWith('commit:') ? 'commitment' : 'email';
  const { data: prior } = await admin.from('item_deliverables').select('id, created_at, content, metadata')
    .eq('user_id', userId).eq('kind', poolKind).eq('entity_id', w.entityId).eq('task_id', 'prepare-pass')
    .filter('metadata->>version_of', 'is', null)
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
    // W9.1: THE ONE DECISION (clock-free; this lane never had a clock) — and a deliverable the user
    // edited is never re-delegated over: a moved ground or fresher supply MARKS it.
    const delDecision = decideRegeneration({
      exists: true, handHeld: isPoolRowHandHeld('deliverable', prior),
      groundMoved: movedPast, supplyMoved: !!fresherSupply, nonLive: !!untrueDeliverable,
    });
    if (delDecision.action === 'mark_stale_under_edit') return await markStaleUnderEdit(admin, userId, w, currentGround, 'deliverable', delDecision.reason);
    if (delDecision.action === 'keep') {
      return isPoolRowHandHeld('deliverable', prior)
        ? { did: 'none', reason: delDecision.reason }
        : { did: 'none', reason: `${worker.name.split(' ')[0]} already prepared this`, worker: worker.name };
    }
    await admin.from('item_deliverables')
      .update({ metadata: { ...((prior.metadata ?? {}) as Record<string, unknown>), version_of: fresherSupply ? 'superseded:require-supply' : movedPast ? 'superseded:ground-move' : 'superseded:truth' } })
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
  if (movedPast) await narrateGroundMove(admin, userId, w, currentGround, 'deliverable', (prior?.created_at as string | undefined) ?? null);
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
async function narrateGroundMove(
  admin: SupabaseClient, userId: string, w: WorkItem, current: { emailId: string | null; receivedAt: string | null },
  artifact: import('@/lib/prepare/outcome').PreparedArtifactKind, preparedAt: string | null,
): Promise<void> {
  // THE OUTCOME LEDGER (W3.2): the artifact the ground move overtook was SUPERSEDED — a timing fact,
  // never a user verdict (the facts report it and never count it). One row per re-prepared lane.
  try {
    const { logPreparedOutcome } = await import('@/lib/prepare/outcome');
    await logPreparedOutcome(admin, userId, {
      outcome: 'superseded', artifact, itemKind: w.id.startsWith('commit:') ? 'commitment' : 'inbox',
      itemId: w.entityId, door: 'ground_move', senderClass: 'unknown', preparedAt,
    });
  } catch { /* the ledger never blocks the re-preparation */ }
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

// ── W9.1 · THE USER'S HAND WINS — the ground moved under an artifact the user EDITED. The engine
// does not replace it (nothing is written to the artifact; `staleUnderEdit` is DERIVED at THE ONE
// READER from the same ground stamp), it says so ONCE in the room — deduped per (item, inbound) — and
// the user picks a fresh version from the card (redraft tabs / steer / ?fresh=1), which files their
// words into the version chain first. Zero AI. The outcome ledger records nothing: the artifact
// was neither superseded nor discarded — it stands. ──
async function markStaleUnderEdit(
  admin: SupabaseClient, userId: string, w: WorkItem, current: { emailId: string | null; receivedAt: string | null },
  artifact: HandKind, reason: string,
): Promise<PrepareOneResult> {
  try {
    const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
    const itemKind = w.id.startsWith('commit:') ? 'commitment' as const : 'inbox' as const;
    const roomKey = await roomKeyForItem(admin, userId, itemKind, w.entityId);
    await writeRoomTurn(admin, userId, roomKey, {
      role: 'system', text: STALE_UNDER_EDIT_LINE,
      refs: [{ label: w.title.slice(0, 60), href: itemKind === 'commitment' ? `/item/${w.entityId}?kind=commitment` : `/item/${w.entityId}` }],
      dedupeKey: `hand-stale:${w.entityId}:${artifact}:${current.emailId ?? current.receivedAt ?? 'moved'}`,
    });
  } catch { /* the mark is derived at the reader regardless — narration is an enhancement */ }
  return { did: 'none', reason };
}

/** W13.6 · THE ASK NAMES THE VERDICT'S OWN REQUIREMENT (found live: the doc-send lane asked for
 *  "the document itself" while the verdict required "slides 7&8 details …" — the moot-ask rule read
 *  the generic label as one the verdict no longer lists and the room hid the ask, while the brief
 *  still spoke it). The lane asks for the judged inventory's labels whenever the verdict states them;
 *  only an inventory-less send falls back to the generic label. Pure. */
export function docSendAskLabels(verdict: { requires?: Array<{ label?: string | null } | string> | null } | null | undefined): string[] {
  const labels = (verdict?.requires ?? [])
    .map((r) => (typeof r === 'string' ? r : String(r?.label ?? '')).replace(/\s+/g, ' ').trim().slice(0, 120))
    .filter(Boolean).slice(0, 5);
  return labels.length ? labels : ['the document itself'];
}

async function askForFile(admin: SupabaseClient, userId: string, w: WorkItem, labels: string[], base?: string[] | null): Promise<void> {
  try {
    const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
    const { composeAskSpeech, reusableAskText, baseLine } = await import('@/lib/prepare/requirements');
    const itemKind = w.id.startsWith('commit:') ? 'commitment' as const : 'inbox' as const;
    const roomKey = await roomKeyForItem(admin, userId, itemKind, w.entityId);
    const dedupeKey = `requires:${w.entityId}`;
    const bases = (base ?? []).filter(Boolean).slice(0, 2);
    const tail = bases.length ? ` ${baseLine(bases)}` : '';
    // THE ASK SPEAKS CONSEQUENCE (law 4) — the SAME reasoned composer every ask-authoring seam uses,
    // COMPOSED ONCE: a standing ask for this same gap re-states its words, it never re-buys them.
    // W13.6: only a LIVE ask's TRUE words are re-stated (`reusableAskText` — never an archived turn's,
    // never words that claim readiness); the base sentence rides as the tail.
    const { data: standing } = await admin.from('room_turns').select('text, component, archived_at')
      .eq('user_id', userId).eq('room_key', roomKey).eq('dedupe_key', dedupeKey).maybeSingle();
    const reused = reusableAskText(standing, labels, { tail: tail.trim(), base: bases });
    const speech = reused ?? await composeAskSpeech(admin, userId, {
      labels, itemTitle: w.title, work: 'send_file',
    });
    await writeRoomTurn(admin, userId, roomKey, {
      role: 'system',
      text: `${speech}${tail}`,
      refs: [{ label: w.title.slice(0, 60), href: itemKind === 'commitment' ? `/item/${w.entityId}?kind=commitment` : `/item/${w.entityId}` }],
      component: { key: 'input_checklist', state: { items: labels.map((l) => l.slice(0, 120)), taskId: null, ...(bases.length ? { base: bases } : {}) } },
      dedupeKey,
    });
  } catch { /* the honest none still records via prep_outcome */ }
}

// ── W13 · THE BASE IS NOT THE SEND — the doc-send lanes found the file the ask is ABOUT, but the ask
// is for new work on it (it predates the request). The file is staged as the BASE (context, through
// THE ONE unstage writer), and the new work is asked for in the room — the honest none, never a send
// of the old file dressed as the answer. W13.6: under the verdict's own requirement label (the base
// row, the ask's rows and the card's "Current version (to update)" line all name the same thing). ──
async function offerBase(
  admin: SupabaseClient, userId: string, w: WorkItem, itemKind: 'inbox' | 'commitment',
  file: { id: string; filename: string; source: string; fileAt?: string | null; snippet?: string }, requestAt: string | null,
  verdict?: import('@/lib/work/judge').WorkVerdict,
): Promise<PrepareOneResult> {
  const { unstageRequirement } = await import('@/lib/prepare/requirements');
  const labels = verdict?.requires?.length ? docSendAskLabels(verdict) : [`the updated version of "${file.filename}"`.slice(0, 120)];
  await unstageRequirement(admin, userId, {
    itemKind, itemId: w.entityId, label: labels[0], reason: 'the file predates a request for new work — it is the base, not the deliverable',
    base: { fileId: file.id, filename: file.filename, source: file.source, fileAt: file.fileAt ?? null, snippet: file.snippet ?? null },
    requestAt, onlyResolverRows: true,
  });
  await askForFile(admin, userId, w, labels, [file.filename]);
  return { did: 'none', reason: 'the file found is the version to update, not the new work — asked in the room' };
}

async function prepareDocSend(admin: SupabaseClient, userId: string, w: WorkItem, verdict?: import('@/lib/work/judge').WorkVerdict, nonLive?: Set<PreparedKind>): Promise<PrepareOneResult> {
  // W13.2 · A WITHDRAWN SEND IS NEVER "ALREADY PREPARED": THE ONE READER withdrew the draft (it rides
  // the item's BASE, or its words fail the vet) — the file guard below must not keep it standing.
  const sendWithdrawn = !!(nonLive?.has('reply_draft') || nonLive?.has('nudge_draft'));
  if (w.id.startsWith('commit:')) {
    const { data: prior } = await admin.from('item_deliverables').select('id, content, metadata, created_at')
      .eq('user_id', userId).eq('kind', 'commitment').eq('entity_id', w.entityId).eq('type', 'draft')
      .filter('metadata->>version_of', 'is', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if ((prior?.metadata as { attachment?: unknown } | null)?.attachment && !sendWithdrawn) return { did: 'none', reason: 'already prepared with the file' };
    // W9.1 THE USER'S HAND WINS: a send drafted beside the user's own message would SHADOW it (the
    // reader serves the newest commitment draft) — their words stand; the file is theirs to attach.
    if (isPoolRowHandHeld('reply_draft', prior)) return { did: 'none', reason: 'your edit stands — the engine never overwrites your words' };
    // ── W13.5 · A WITHDRAWN SEND IS RETIRED WHEN THE LANE LANDS ELSEWHERE: THE ONE READER withdrew the
    // machine doc-send (a file matched under an older staging law, riding the base, words that fail
    // the vet) and today's verifier did NOT re-prove a send — it asked, or offered the base. The
    // withdrawn draft is filed into the version chain through THE ONE superseding writer (never
    // deleted; the user's hand and a sent row are never touched), so the reader stops holding a
    // non-live artifact and the on-open trip is not due again on every open. A re-proven send
    // replaces it in place (writeDeliverable dedupes on task_id). ──
    const retireWithdrawn = async (reason: string): Promise<void> => {
      if (!sendWithdrawn) return;
      try {
        // The machine doc-send itself (not merely the newest draft — a nudge may sit above it).
        const { data: sendRow, error: sendErr } = await admin.from('item_deliverables').select('metadata')
          .eq('user_id', userId).eq('kind', 'commitment').eq('entity_id', w.entityId).eq('task_id', 'prepare-pass-docsend')
          .filter('metadata->>version_of', 'is', null).limit(1).maybeSingle();
        const fid = ((sendRow?.metadata ?? {}) as { attachment?: { fileId?: unknown } }).attachment?.fileId;
        const { supersedeDraftsRiding, supersedeWithdrawnDrafts } = await import('@/lib/prepare/requirements');
        if (!sendErr && typeof fid === 'string') await supersedeDraftsRiding(admin, userId, 'commitment', w.entityId, [fid], reason);
        // W13.6 · every other MACHINE draft THE ONE READER withdrew on this item (an inverted chase, a
        // false claim) is retired with it — the lane landed elsewhere, so none of them is coming back.
        await supersedeWithdrawnDrafts(admin, userId, { kind: 'commitment', id: w.entityId }, reason);
      } catch { /* non-fatal — the reader still withholds it */ }
    };
    const cCands = await resolveFileUniversal(admin, { userId, entityId: w.entity?.id ?? null }, w.title, 4).catch(() => []);
    const cTop = cCands.find((c) => c.source === 'kb');
    if (!cTop || cTop.score < 0.7) { await retireWithdrawn('withdrawn send — no file found for it now'); await askForFile(admin, userId, w, docSendAskLabels(verdict)); return { did: 'none', reason: 'could not find the document — asked in the room' }; }
    // W6 — the ONE evidence-quoting verifier (cross-entity rejected structurally; the quote is
    // code-checked): a wrong attach is worse than none.
    // W13 · A STAGED FILE IS THE DELIVERABLE, OR IT ISN'T STAGED: the request's own date + words ride
    // the verifier — a file that predates an ask for NEW work is its base, never the send.
    const { verifyArtifactMatch: verifyC, requestFactsOf: reqFactsC } = await import('@/lib/prepare/requirements');
    const reqC = await reqFactsC(admin, userId, { kind: 'commitment', id: w.entityId });
    const cJudge = await verifyC(admin, userId, { task: w.title, candidate: cTop, entityId: w.entity?.id ?? null, emailExcerpt: reqC.excerpt, requestAt: reqC.requestAt, requestText: reqC.requestText });
    if (!cJudge.match && cJudge.role === 'base') { await retireWithdrawn('withdrawn send — the file is the base of new work, not the deliverable'); return await offerBase(admin, userId, w, 'commitment', cTop, reqC.requestAt, verdict); }
    if (!cJudge.match) { await retireWithdrawn('withdrawn send — its file is not proven to be the deliverable'); await askForFile(admin, userId, w, docSendAskLabels(verdict)); return { did: 'none', reason: 'no confident file match — asked in the room' }; }
    // TRUE ADDRESSEES (W7.3): the send is addressed by THE ONE LADDER and stamped with it.
    const { resolveCommitmentAddressee: resolveC, recipientsLabel: labelC, addresseeStamp: stampC } = await import('@/lib/prepare/addressee');
    const cAddr = await resolveC(admin, userId, w.entityId);
    const cBody = await generateNudgeDraft(userId, { counterparty: labelC(cAddr.recipients), description: `${w.title} — the document "${cTop.filename}" will be attached.`, direction: 'you', threadId: cAddr.row?.thread_id ?? null }, admin).catch(() => null);
    if (!cBody) return { did: 'none', reason: 'could not draft the send' };
    const { writeDeliverable } = await import('@/lib/home/deliverable-pool');
    const paC = await getDraftingAssistant(admin, userId); // O3a attribution
    await writeDeliverable(admin, userId, {
      kind: 'commitment', entityId: w.entityId, taskId: 'prepare-pass-docsend', type: 'draft',
      title: `Send ${cTop.filename}`.slice(0, 100), content: cBody, gist: `send draft with ${cTop.filename}`,
      metadata: { source: 'preparation_pass', ...(paC ? { agentName: paC.name } : {}), ...stampC(cAddr), attachment: { fileId: cTop.id, filename: cTop.filename, source: cTop.source }, ...(await import('@/lib/prepare/requirements')).stagingStamp(), provenance: { item: w.title.slice(0, 100), ...(w.entity ? { entity: w.entity.name } : {}) } },
    }).catch(() => {});
    return { did: 'docsend', worker: paC?.name };
  }
  if (!w.id.startsWith('inbox:')) return { did: 'none', reason: 'not a preparable item' };
  const { data: it } = await admin.from('inbox_items').select('id, source_data, status').eq('id', w.entityId).eq('user_id', userId).maybeSingle();
  if (!it || it.status !== 'pending') return { did: 'none', reason: 'no longer open' };
  const sd = (it.source_data ?? {}) as Record<string, unknown>;
  const existingDraft = (sd.draft ?? null) as { body?: string; attachment?: unknown } | null;
  if (existingDraft?.attachment && !sendWithdrawn) return { did: 'none', reason: 'already prepared with the file' };
  // W9.1 THE USER'S HAND WINS: both writes below replace `source_data.draft` — never over their words.
  if (isHandHeld('reply_draft', existingDraft)) return { did: 'none', reason: 'your edit stands — the engine never overwrites your words' };
  // ── THE DELIVERABLE RESOLUTION (multi-artifact sends — "share these three reports"): when the
  // judge's inventory names the artifacts, resolve THEM (not the item title): staged haves ride the
  // pool + the draft's attachment; missing ones become the room's input-checklist ask; the reply is
  // drafted under the ARTIFACT TRUTH so it never claims what isn't in hand. The single-file path
  // below stays for inventory-less sends. ──
  if (verdict?.requires?.length) {
    const { resolveRequirements } = await import('@/lib/prepare/requirements');
    const reqs = await resolveRequirements(admin, userId, {
      itemKind: 'inbox', itemId: String(it.id), itemTitle: w.title,
      entityId: w.entity?.id ?? null, requires: verdict.requires, work: verdict.work,
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
        // W14.1 · the inbox doc-send's file match carries the staging law it was verified under (the
        // one reader re-proves an unstamped machine attachment — lib/prepare/read.ts draftStagingStale).
        source_data: { ...sd, draft: { body: body2, generated_at: new Date().toISOString(), prepared: 'pass', law_version: DRAFT_LAW_VERSION_C, ...(kbHave?.file ? { attachment: { fileId: kbHave.file.id, filename: kbHave.file.filename, source: kbHave.file.source }, ...(await import('@/lib/prepare/requirements')).stagingStamp() } : {}), ...(review.verdict !== 'pass' ? { review } : {}) }, ...(pa2 ? { prepared_by: { worker: pa2.name, at: new Date().toISOString() } } : {}) },
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
  if (!top || top.score < 0.7) { await askForFile(admin, userId, w, docSendAskLabels(verdict)); return { did: 'none', reason: 'could not find the document — asked in the room' }; }
  // THE REASONED PICK (the S4 rule — a score is retrieval, not judgment), upgraded to the W6
  // evidence law: the verifier quotes the proving phrase (code-checked) and rejects cross-entity
  // candidates structurally. Reject → no auto-attach (the deep-dive's picker offers candidates
  // instead). A wrong attach is worse than none — trust is the product.
  const { verifyArtifactMatch, requestFactsOf } = await import('@/lib/prepare/requirements');
  const reqI = await requestFactsOf(admin, userId, { kind: 'inbox', id: String(it.id) });
  const judge = await verifyArtifactMatch(admin, userId, {
    task: w.title, candidate: top, entityId: w.entity?.id ?? null,
    emailExcerpt: String(sd.body || '').slice(0, 400) || null,
    requestAt: reqI.requestAt, requestText: reqI.requestText,
  });
  // W13: the verified file predates an ask for new work — the base, never the send.
  if (!judge.match && judge.role === 'base') return await offerBase(admin, userId, w, 'inbox', top, reqI.requestAt, verdict);
  if (!judge.match) return { did: 'none', reason: 'no confident file match' };
  // W13.2: a withdrawn draft's words are never reused as the send's body.
  const reusedDraft = !!existingDraft?.body && !sendWithdrawn;
  const body = (reusedDraft ? existingDraft?.body : null)
    || (await generateReplyDraft(userId, sd as Record<string, never>, admin, `The reply should send the document "${top.filename}" (it will be attached).`).catch(() => null));
  if (!body) return { did: 'none', reason: 'could not draft the send' };
  // Stamp the drafting law ONLY on words this run actually authored — a reused body keeps whatever
  // law it was written under, so a stale one is still caught by the serve gates.
  const lawStamp = reusedDraft
    ? ((existingDraft as { law_version?: number } | null)?.law_version !== undefined
        ? { law_version: (existingDraft as { law_version?: number }).law_version } : {})
    : { law_version: DRAFT_LAW_VERSION_C };
  const pa = await getDraftingAssistant(admin, userId); // O3a attribution
  await admin.from('inbox_items').update({
    // W14.1 · stamped with the staging law this match was just verified under (see above).
    source_data: { ...sd, draft: { body, generated_at: new Date().toISOString(), prepared: 'pass', ...lawStamp, attachment: { fileId: top.id, filename: top.filename, source: top.source }, ...(await import('@/lib/prepare/requirements')).stagingStamp() }, ...(pa ? { prepared_by: { worker: pa.name, at: new Date().toISOString() } } : {}) },
  }).eq('id', it.id);
  return { did: 'docsend', worker: pa?.name };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CANDIDATE DERIVATION — ONE definition of "an item the engine may work on", shared by the
// preparation walker below and the JUDGMENT SWEEP (proactive-reach LAW 1). The sweep judges the
// whole set; the pass prepares its three lanes out of it. Forking this is how reach and
// preparation would come to disagree about what counts as actionable.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Preparable + open + not an automated notice — the engine's working universe for one user. */
export function isPreparableCandidate(w: WorkItem): boolean {
  return !w.automated
    && (w.id.startsWith('inbox:') || w.id.startsWith('commit:'))
    && (w.state === 'todo' || w.state === 'waiting' || w.state === 'in_progress');
}

/** Every actionable item the judge must be able to reach (LAW 1: no item beyond its reach). */
export function judgmentCandidates(items: WorkItem[]): WorkItem[] {
  return items.filter(isPreparableCandidate);
}

/** The judgment cache key for an item — `inbox:<id>` | `commitment:<id>` (item_plans.entity_id). */
export function judgmentKeyOf(w: WorkItem): string {
  return w.id.startsWith('commit:') ? `commitment:${w.entityId}` : `inbox:${w.entityId}`;
}

/** THE JUDGMENT AGES — when each of this user's items was last judged (item_plans kind 'judgment').
 *  PAGED (the repo's oldest lesson: PostgREST silently caps a single read at 1000 rows, and a
 *  truncated read would make judged items look never-judged and re-burn the backlog every sweep). */
export async function readJudgmentAges(admin: SupabaseClient, userId: string): Promise<JudgmentAge[]> {
  try {
    const rows = await readPlans(admin, userId, 'judgment', { withTasks: false });
    return rows.map((r) => ({ key: r.key, judgedAt: r.updated_at ?? null }));
  } catch { return []; }
}

/** Project a spine item into the nominator's shape: its own code-verifiable anchor + activity. */
export function toNominatorItem(w: WorkItem, meetingPassedAt?: string | null): NominatorItem {
  return {
    key: judgmentKeyOf(w),
    anchor: w.when.explicit,          // understanding.deadline (inbox) / due_date (commitment)
    activityAt: w.at || null,
    meetingPassedAt: meetingPassedAt ?? null,
    title: w.title,
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// W3.3 REACH — THE PREPARATION LEDGER'S ONE WRITER + THE COMMITMENT LANE.
//
// Measured (Sep 22): 45 of 915 open commitments had EVER received a prep_outcome — the pass barely
// reached them. Commitments competed inside lanes 2-4 with the whole inbox under one shared clock, and
// the `attempted` read that ranks never-prepared work first was an UNPAGED `.limit(1000)` (invariant
// 10: past 1000 outcomes, prepared items silently read as never-attempted and re-burned the budget).
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The verdict verbs the pass can prepare FOR — every WORK_VERBS verb (lib/work/surface-registry)
 *  except `none`. The commitment lane's membership test. */
export const isPreparableVerdict = (work: string | null | undefined): boolean => !!work && work !== 'none';

/** Which lane reached an item — carried on its prep_outcome row so the ledger says WHO prepared it. */
export type PrepLane = 'reply' | 'open_question' | 'needs_you' | 'triage' | 'commitment' | 'proof_of_life' | 'anticipation';

/** THE PREP OUTCOME LEDGER — every attempt's did/reason, paged (NO SILENT CAPS): key → last `at`. */
export async function readPrepOutcomes(admin: SupabaseClient, userId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const rows = await readPlans(admin, userId, 'prep_outcome');
    for (const r of rows) out.set(r.key, String(r.tasks?.at ?? r.updated_at ?? ''));
  } catch { /* an unordered walk is still a walk */ }
  return out;
}

/** An attempt that failed HONESTLY and says so ("… it will retry") — a caller keeping an
 *  exactly-once fire record must leave the moment open for it (anticipation's retry). */
export const isRetryableOutcome = (r: PrepareOneResult): boolean => r.did === 'none' && /will retry/i.test(r.reason ?? '');

/** THE ONE WRITER of a prep_outcome row (the trichotomy ledger) — the pass, anticipation and the
 *  re-queue lane all record through here, so "did anything prepare this?" has one answer. */
export async function recordPrepOutcome(
  admin: SupabaseClient, userId: string, key: string, r: PrepareOneResult, lane: PrepLane,
): Promise<void> {
  try {
    await upsertPlan(admin, userId, 'prep_outcome', key,
      { did: r.did, reason: r.reason ?? null, worker: r.worker ?? null, lane, at: new Date().toISOString() });
  } catch { /* observability is an enhancement */ }
}

/**
 * THE COMMITMENT LANE (pure, zero-AI, total and stable): open, non-stale commitments whose STANDING
 * verdict is actionable, ordered ENTITY PRIORITY first (a hot deal's debt outranks a loose one), then
 * LEAST-RECENTLY-PREPARED (never-prepared first, then the oldest attempt), then key. This is the
 * lane's internal reach order only — what its floor cannot reach falls to the pass's overflow, which
 * walks the ONE nominated order like every other deferred item.
 */
export function commitmentLane(
  candidates: WorkItem[],
  facts: { verdictOf: (key: string) => string | null | undefined; lastPreparedAt: (key: string) => string | null | undefined; weightOf: (w: WorkItem) => number; excluded?: (key: string) => boolean },
): WorkItem[] {
  const lane = candidates.filter((w) => w.id.startsWith('commit:') && isPreparableCandidate(w)
    && !(facts.excluded?.(judgmentKeyOf(w)))
    && isPreparableVerdict(facts.verdictOf(judgmentKeyOf(w))));
  return lane.sort((a, b) => {
    const dw = facts.weightOf(b) - facts.weightOf(a);
    if (dw) return dw;
    const pa = facts.lastPreparedAt(judgmentKeyOf(a)) || '';
    const pb = facts.lastPreparedAt(judgmentKeyOf(b)) || '';
    if (pa !== pb) return pa.localeCompare(pb); // '' (never prepared) sorts first
    return judgmentKeyOf(a).localeCompare(judgmentKeyOf(b));
  });
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
    if (r.did === 'draft' || r.did === 'docsend' || r.did === 'invite' || r.did === 'forward' || r.did === 'decision' || r.did === 'paste_pack') prepared++;
    else if (r.did === 'nudge') nudges++;
    else if (r.did === 'delegated') delegated++;
    else skipped++;
  };

  // ── W2: the ENTITY-PRIORITY order — the reasoned weight the brain already synthesizes is the
  // queue discipline (a hot deal's reply outranks a loose thread's), never a date heuristic.
  // REACH LEADS IT (proactive-reach LAW 1): the ordering is now the ONE nominator's
  // `orderForPreparation` — anchor-passed first (preparing a reply to a meeting that already
  // happened is the exact cost the arc ends), then this never-attempted/weight discipline. There is
  // no second ordering in the codebase: the judgment sweep calls the same module.
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
  // W3.3 · PAGED (invariant 10): the old `.limit(1000)` read silently stopped at 1000 outcomes.
  const lastPrepared = await readPrepOutcomes(admin, userId);
  const attempted = new Set<string>(lastPrepared.keys());
  const keyOf = judgmentKeyOf;

  // ── THE CANDIDATE LANES, each walked in ONE nominated order under ONE shared budget. Lane 3 is
  // judge-driven end to end (W1): the cached work judgment decides chase/produce/schedule/forward/
  // send_file + the executor — the second batch router is gone (one judge, not two).
  //
  // Q8a · NEW & UNSORTED IS A LANE (attention-plan PART III). The audit's headline — 8 of the 40
  // NEWEST actionable items had anything staged — had a structural half nobody had looked at: the
  // spine's report routes a FRESH, undated item to `triage`, and the pass only ever read `needsYou`
  // and `openQuestions`. So the newest work on the desk was, by construction, the work the engine
  // never prepared. Measured on the reference account: 7 triage items, every one judged actionable
  // by the sweep and prepared by nobody.
  //
  // The `stale` lane stays OUT, deliberately: a month-overdue, long-untouched item is the QUIET
  // TAIL, and Q7's proof-of-life lane — not a drafting budget — is what decides whether it is still
  // live. Preparing 74 items nothing has moved in two months would spend the desk's budget on the
  // ledger's population. (Measured: 74 stale candidates on the reference account.)
  //
  // W3.3 REACH adds two lanes, each with its own floor under THE SHARE below:
  //   · PROOF-OF-LIFE RE-QUEUE (first): items Q7 just re-affirmed as still owed. They usually sit in
  //     the quiet tail this pass excludes, so without the marker a proven-live item was never
  //     prepared. Read from the queue (lib/prepare/requeue), never from the stale lane itself.
  //   · THE COMMITMENT LANE (last): open, non-stale commitments whose standing verdict is actionable,
  //     in entity-priority → least-recently-prepared order (commitmentLane). Measured: 5% of open
  //     commitments had ever been reached; they competed with the whole inbox inside lanes 2-4.
  const { readStandingVerdicts } = await import('@/lib/work/proof-of-life');
  const { readPrepRequeue, clearPrepRequeue } = await import('@/lib/prepare/requeue');
  const [standing, requeue] = await Promise.all([readStandingVerdicts(admin, userId), readPrepRequeue(admin, userId)]);
  const staleKeys = new Set(rep.stale.map(keyOf));
  const requeueLane = items.filter((w) => requeue.has(keyOf(w)) && isPreparableCandidate(w));
  const commitLane = commitmentLane(items, {
    verdictOf: (k) => standing.get(k),
    lastPreparedAt: (k) => lastPrepared.get(k),
    weightOf,
    excluded: (k) => staleKeys.has(k),
  });
  const lanes: WorkItem[][] = [
    requeueLane,
    autoDraft ? rep.needsYou.filter((x) => x.kind === 'reply' && x.id.startsWith('inbox:')) : [],
    rep.openQuestions.filter((x) => x.blockedOn),
    rep.needsYou.filter((w) => !w.automated && w.kind !== 'reply' && (w.id.startsWith('inbox:') || w.id.startsWith('commit:'))),
    rep.triage.filter((w) => !w.automated && (w.id.startsWith('inbox:') || w.id.startsWith('commit:'))),
    commitLane, // keeps its OWN order (the nominated sort below skips it); its overflow walks the nominated one
  ];
  const laneNames: PrepLane[] = ['proof_of_life', 'reply', 'open_question', 'needs_you', 'triage', 'commitment'];
  // A queued key whose item is no longer open (settled, dismissed) is served by being gone.
  for (const k of requeue.keys()) {
    if (!requeueLane.some((w) => keyOf(w) === k)) await clearPrepRequeue(admin, userId, k);
  }
  // THE ONE ORDERING (proactive-reach LAW 1): computed once over the union of the lanes and applied
  // to each — the judgment ages come from the same cache the judge writes, so "least recently
  // judged" is a fact, never an estimate.
  const laneUnion = new Map<string, WorkItem>();
  for (const lane of lanes) for (const w of lane) laneUnion.set(keyOf(w), w);
  const ages = await readJudgmentAges(admin, userId);
  // THE USER'S CLOCK (T-class) owns the anchor test: "has this date passed" is answered in the
  // user's own day boundary, never the server's — the same day the judge reasons in.
  const { userTimezone, localNow } = await import('@/lib/utils/user-time');
  const anchorDay = localNow(await userTimezone(admin, userId)).dateStr;
  const nominated = orderForPreparation(
    [...laneUnion.values()].map((w) => toNominatorItem(w)), ages,
    { todayStr: anchorDay, attempted: (k) => attempted.has(k), weightOf: (k) => { const w = laneUnion.get(k); return w ? weightOf(w) : 0; } },
  );
  const rankOf = new Map(nominated.map((n) => [n.item.key, n.rank]));
  for (const lane of lanes) {
    if (lane === commitLane) continue;
    lane.sort((a, b) => (rankOf.get(keyOf(a)) ?? Number.MAX_SAFE_INTEGER) - (rankOf.get(keyOf(b)) ?? Number.MAX_SAFE_INTEGER));
  }
  // ── THE TRICHOTOMY LAW (plan AH): every candidate's outcome is RECORDED — `prep_outcome`
  // rows (item_plans, zero-migration) are the pass's observable ledger: what was prepared,
  // what was asked, what was skipped and WHY. Silence stops being unmeasurable. ──
  const recordOutcome = (w: WorkItem, r: PrepareOneResult, lane: PrepLane) => recordPrepOutcome(admin, userId, keyOf(w), r, lane);
  const laneOf = new Map<string, PrepLane>();
  lanes.forEach((lane, i) => { for (const w of lane) if (!laneOf.has(w.id)) laneOf.set(w.id, laneNames[i]); });
  const seen = new Set<string>();
  // W13.2 · THE STAGING RE-VERIFY BUDGET — shared by every item this run (lib/prepare/requirements
  // REVERIFY_PER_PASS); what it leaves behind is counted and said, never silent (invariant 10).
  const { REVERIFY_PER_PASS } = await import('@/lib/prepare/requirements');
  const reverify = { left: REVERIFY_PER_PASS, deferred: 0 };
  // The ledger names the lane that ACTUALLY reached the item (the overflow keeps the item's first lane).
  const work = async (w: WorkItem, lane: PrepLane) => {
    seen.add(w.id);
    const r = await prepareOneItem(admin, userId, w, { reverify });
    tally(r);
    await recordOutcome(w, r, lane);
    // A re-queued item is SERVED once the pass reached it (its outcome is now on the ledger).
    if (requeue.has(keyOf(w))) await clearPrepRequeue(admin, userId, keyOf(w));
  };

  // ── Q8a · THE LANE FLOORS (attention-plan PART III — the STARVATION class, measured). ──────────
  // The walk used to spend the single budget lane by lane, in order: lane 1 (80 reply items on the
  // reference account) ate it, and lanes 2-4 were reached only by whatever survived. The pass's own
  // ledger says what that cost — `(never attempted)` was the standing outcome for 6 of 11 schedule
  // verdicts and 8 of 16 send_file verdicts, items the engine had literally never once looked at.
  // A late lane must get its slice.
  //
  // THE SHARE, the graduation lane's idiom applied inside one pass: at each lane, the REMAINING
  // wall clock is divided by the lanes still unserved. A lane that finishes early hands its
  // remainder to the next (nothing is reserved for a lane with nothing in it); a lane that runs long
  // stops at its own floor and its rest goes to the overflow below. Then — and only then — whatever
  // budget is left is spent on everything deferred, in the ONE nominated order, so a genuinely quiet
  // day still drains the backlog exactly as it did before.
  const deferred: WorkItem[] = [];
  const deferredIds = new Set<string>(); // lanes overlap — an item deferred twice is ONE item left behind
  for (let i = 0; i < lanes.length; i++) {
    const lanesLeft = lanes.length - i;
    const laneDeadline = Math.min(deadline, Date.now() + Math.max(0, deadline - Date.now()) / lanesLeft);
    for (const w of lanes[i]) {
      if (seen.has(w.id)) continue;       // one attempt per item per pass (lanes can overlap)
      if (Date.now() > laneDeadline) { if (!deferredIds.has(w.id)) { deferredIds.add(w.id); deferred.push(w); } continue; }
      await work(w, laneNames[i]);
    }
  }
  // THE OVERFLOW — the deferred items in the one nominated order (never lane order: a lane's floor
  // decides who is REACHED FIRST, never who matters more).
  deferred.sort((a, b) => (rankOf.get(keyOf(a)) ?? Number.MAX_SAFE_INTEGER) - (rankOf.get(keyOf(b)) ?? Number.MAX_SAFE_INTEGER));
  for (const w of deferred) {
    if (seen.has(w.id)) continue;
    if (Date.now() > deadline) { leftBehind++; continue; }
    await work(w, laneOf.get(w.id) ?? 'needs_you');
  }
  if (leftBehind > 0) {
    console.log(`[prepare-pass] budget spent for user ${userId}: ${leftBehind} candidate(s) left for the next sweep`);
  }
  if (reverify.deferred > 0) {
    console.log(`[prepare-pass] staging re-verify budget spent for user ${userId}: ${reverify.deferred} item(s) with older-law staging left for the next sweep`);
  }

  // ── B3c · MEETING PREP RETIRED HERE (owner call, Sep 17 — attention-plan PART III, law Q8) ─────
  // This pass used to prepare a brief for every deal-linked meeting in the next 14 days, out of the
  // SAME budget as the item lanes and always after them: a 118-candidate backlog behind a walk that
  // rarely reached its own third lane, i.e. structurally unreachable. Meanwhile THE ANTICIPATION
  // PASS (lib/home/anticipation.ts) prepares the same meetings on its own 6h clock, with the room's
  // full grounding, one resolved clock, the ground-evidence rule and an explicit NOTHING sentinel —
  // strictly the better preparation, already narrated into the room where the work lives.
  //
  // ONE PREP MECHANISM. Two lanes writing meeting briefs is how two surfaces come to disagree about
  // what was prepared, and the weaker one was the one starving the item lanes. The anticipation lane
  // is THE PREP SEAT; the workbench gate B3c asserts the decision (no meeting-prep block here) and
  // the coverage (anticipation's fire records + the room turn), and smoke-compute's AN1 gates the
  // surface. Nothing was lost but the duplicate.

  return { prepared, skipped, nudges, delegated, leftBehind };
}
