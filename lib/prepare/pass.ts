// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PREPARATION PASS (Prepared-Work Phase C, docs/prepared-work-plan.md) — the manager. The user's top
// deck items arrive with the work ALREADY PREPARED: this pass walks the ledger's curated working set and
// prepares each item by shape — prepared-by-default, approved-at-the-commit-line (nothing ever sends).
//
// Slice 1 (the audit's 46%): REPLY DRAFTS (any top reply item, not just rule-covered — widens the
// draft-sweep) + NUDGE DRAFTS for waiting-on-a-named-person items (were on-demand only → now ambient,
// stored on the commitment row's metadata-free path: the item's own source_data for inbox waits, and
// item_deliverables for commitment waits). Idempotent: an existing fresh draft is never re-generated;
// a thread that moved on (last_activity_at newer than the draft) re-prepares.
// Coworker routing (judgment shapes → roles) + doc-send preparation land in slice 2/3.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildWorkItems } from '@/lib/work-items/model';
import { partitionDailyReport } from '@/lib/work-items/report';
import { generateReplyDraft, generateNudgeDraft } from '@/lib/inbox/draft-reply';
import { aiCall } from '@/lib/ai/call';
import { resolveFileUniversal } from '@/lib/knowledge/resolve';
import { logActivity } from '@/lib/activity/log';

const TOP_N = 8;          // prepare the working set, not the inventory
const FRESH_HOURS = 24;   // a draft older than this (or older than new thread activity) re-prepares

export type PrepareResult = { prepared: number; skipped: number; nudges: number; delegated: number };

// ── C2: judgment shapes → the right COWORKER by role (the routing brain — one map, no bespoke code).
// Only shapes a coworker genuinely adds expertise to; everything else stays in-house or with the user.
const SHAPE_TO_ROLE: Record<string, string> = {
  prepare_document: 'content_manager',   // decks, proposals, reports, one-pagers — the writer
  research_analyze: 'research_analyst',  // research, analysis, monitoring — the analyst
};
const DELEGATE_CAP = 2; // coworker runs are the expensive preparation — trickle, don't burst

export async function runPreparationPass(admin: SupabaseClient, userId: string): Promise<PrepareResult> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const items = await buildWorkItems(admin, userId, { todayStr, skipReconcile: true });
  const rep = partitionDailyReport(items, todayStr);
  let prepared = 0, skipped = 0, nudges = 0;

  // ── Reply drafts for the top needs-you items (kind 'reply', inbox-backed). ──
  const topReplies = rep.needsYou.filter((w) => w.kind === 'reply' && w.id.startsWith('inbox:')).slice(0, TOP_N);
  for (const w of topReplies) {
    try {
      const { data: it } = await admin.from('inbox_items').select('id, source_data, last_activity_at, status')
        .eq('id', w.entityId).eq('user_id', userId).maybeSingle();
      if (!it || it.status !== 'pending') { skipped++; continue; }
      const sd = (it.source_data ?? {}) as Record<string, unknown>;
      const existing = (sd.draft ?? null) as { body?: string; generated_at?: string } | null;
      const stale = !existing?.body
        || (Date.now() - Date.parse(existing.generated_at || '0')) > FRESH_HOURS * 3_600_000
        || (!!it.last_activity_at && Date.parse(it.last_activity_at as string) > Date.parse(existing.generated_at || '0'));
      if (!stale) { skipped++; continue; }
      const body = await generateReplyDraft(userId, sd as Record<string, never>, admin, null);
      if (body) {
        await admin.from('inbox_items')
          .update({ source_data: { ...sd, draft: { body, generated_at: new Date().toISOString(), prepared: 'pass' } } })
          .eq('id', it.id);
        prepared++;
      } else skipped++;
    } catch { skipped++; }
  }

  // ── Nudge drafts for waiting-on-a-NAMED-person (the open questions lane). ──
  const topQuestions = rep.openQuestions.filter((w) => w.blockedOn).slice(0, 5);
  for (const w of topQuestions) {
    try {
      if (w.id.startsWith('inbox:')) {
        const { data: it } = await admin.from('inbox_items').select('id, source_data, status').eq('id', w.entityId).eq('user_id', userId).maybeSingle();
        if (!it || it.status !== 'pending') { skipped++; continue; }
        const sd = (it.source_data ?? {}) as Record<string, unknown>;
        const existing = (sd.nudge_draft ?? null) as { generated_at?: string } | null;
        if (existing && (Date.now() - Date.parse(existing.generated_at || '0')) < FRESH_HOURS * 3_600_000) { skipped++; continue; }
        const ageDays = Math.max(0, Math.round((Date.now() - Date.parse(w.startAt)) / 86_400_000));
        const body = await generateNudgeDraft(userId, { counterparty: w.blockedOn, description: w.title, ageDays }, admin);
        if (body) {
          await admin.from('inbox_items')
            .update({ source_data: { ...sd, nudge_draft: { body, generated_at: new Date().toISOString(), prepared: 'pass' } } })
            .eq('id', it.id);
          nudges++;
        }
      } else if (w.id.startsWith('commit:')) {
        // Commitments have no source_data — the nudge lands in the item_deliverables pool (type 'draft'),
        // which the deep-dive + downstream steps already read.
        const { data: existing } = await admin.from('item_deliverables').select('id, created_at')
          .eq('user_id', userId).eq('kind', 'commitment').eq('entity_id', w.entityId).eq('type', 'draft')
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (existing && (Date.now() - Date.parse(existing.created_at as string)) < FRESH_HOURS * 3_600_000) { skipped++; continue; }
        const ageDays = Math.max(0, Math.round((Date.now() - Date.parse(w.startAt)) / 86_400_000));
        const body = await generateNudgeDraft(userId, { counterparty: w.blockedOn, description: w.title, ageDays }, admin);
        if (body) {
          await admin.from('item_deliverables').insert({
            user_id: userId, kind: 'commitment', entity_id: w.entityId, type: 'draft',
            title: `Nudge — ${(w.blockedOn || '').split('<')[0].trim()}`.slice(0, 100), content: body, ref: null,
          }).then(() => {}, () => {});
          nudges++;
        }
      }
    } catch { skipped++; }
  }

  // ── C2 · COWORKER ROUTING — judgment-shaped top items are prepared by the right coworker, with the
  // item's grounding + the deliverable pool (runDelegation reads+writes it). Idempotent per item (a pool
  // deliverable with task_id 'prepare-pass' means it's already prepared). Nothing sends — prompt-level
  // prepare-and-hand-back guardrail lives in buildDelegationPrompt.
  let delegated = 0;
  try {
    const candidates = rep.needsYou
      .filter((w) => !w.automated && w.kind !== 'reply' && (w.id.startsWith('inbox:') || w.id.startsWith('commit:')))
      .slice(0, 5);
    if (candidates.length) {
      // ONE cheap reasoned pass: which candidates are judgment work a coworker should produce?
      const list = candidates.map((w, i) => `${i}. ${w.title.slice(0, 110)}`).join('\n');
      const res = await aiCall<{ shapes?: Record<string, string> }>({
        userId, supabase: admin, shape: { output: 'json' }, temperature: 0, maxTokens: 200, source: 'brain_synthesis',
        prompt: `For each task, classify what DOING it involves. Shapes:\n` +
          `- prepare_document: create a doc/deck/proposal/report/one-pager\n` +
          `- research_analyze: research/analyze/summarize/monitor something\n` +
          `- send_document: send/share/forward an EXISTING document or file to someone\n` +
          `- other: anything else (replying, admin, deciding)\n\nTASKS:\n${list}\n\n` +
          `JSON only: {"shapes":{"<index>":"<shape>"}}`,
      });
      const shapes = res.json?.shapes ?? {};
      const { data: workers } = await admin.from('custom_agents').select('id, name, worker_role, is_worker')
        .eq('user_id', userId).eq('is_worker', true);
      const byRole = new Map((workers ?? []).map((wk: Record<string, unknown>) => [String(wk.worker_role), wk]));
      for (let i = 0; i < candidates.length && delegated < DELEGATE_CAP; i++) {
        const shape = String(shapes[String(i)] ?? 'other');
        const role = SHAPE_TO_ROLE[shape];
        if (!role) continue;
        const worker = byRole.get(role) as { id: string; name: string; worker_role: string | null; is_worker: boolean | null } | undefined;
        if (!worker) continue;
        const w = candidates[i];
        const poolKind = w.id.startsWith('commit:') ? 'commitment' : 'email';
        // Idempotency: already prepared by a prior pass → skip.
        const { data: prior } = await admin.from('item_deliverables').select('id')
          .eq('user_id', userId).eq('kind', poolKind).eq('entity_id', w.entityId).eq('task_id', 'prepare-pass').limit(1).maybeSingle();
        if (prior) continue;
        const { buildDelegationPrompt, runDelegation } = await import('@/lib/home/delegate');
        const prompt = buildDelegationPrompt({
          kind: poolKind,
          itemContext: `TASK: ${w.title}\n` + (w.who ? `Counterparty: ${w.who}\n` : '') +
            (w.entity ? `Body of work: ${w.entity.name}\n` : '') + (w.when.explicit ? `Due: ${w.when.explicit}\n` : ''),
          step: { text: w.title.slice(0, 120), detail: shape === 'prepare_document' ? 'Produce the document/deck content, ready for my review.' : 'Produce the research/analysis, ready for my review.' },
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
        // The Activity TRAIL — pass-initiated delegations appear on the timeline like user-initiated ones.
        await logActivity(admin, userId, {
          type: 'delegated_prepared', title: `${worker.name} prepared: ${w.title.slice(0, 70)}`,
          entityType: w.id.startsWith('commit:') ? 'commitment' : 'inbox_item', entityId: w.entityId,
          metadata: { via: 'preparation_pass', worker: worker.name, shape },
        }).catch(() => {});
        delegated++;
      }
      // ── C3 · DOC-SEND PREP — a send-an-existing-file task gets the FILE RESOLVED (universal registry:
      // pool → KB → drives) and, for inbox-backed items, a ready draft with the attachment reference.
      // The approve-gate holds: nothing sends; the deep-dive leads with the prepared draft + file.
      for (let i = 0; i < candidates.length; i++) {
        if (String(shapes[String(i)] ?? '') !== 'send_document') continue;
        const w = candidates[i];
        // ── COMMITMENT doc-send: resolve the file + prepare a send-draft into the pool (the followup
        // deep-dive serves the newest pool draft instantly). Same two gates as inbox: score + reasoned. ──
        if (w.id.startsWith('commit:')) {
          const { data: prior } = await admin.from('item_deliverables').select('id, metadata, created_at')
            .eq('user_id', userId).eq('kind', 'commitment').eq('entity_id', w.entityId).eq('type', 'draft')
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
          if ((prior?.metadata as { attachment?: unknown } | null)?.attachment) continue; // already prepared with a file
          const cCands = await resolveFileUniversal(admin, { userId, entityId: w.entity?.id ?? null }, w.title, 4).catch(() => []);
          const cTop = cCands.find((c) => c.source === 'kb');
          if (!cTop || cTop.score < 0.7) continue;
          const cJudge = await aiCall<{ match?: boolean }>({
            userId, supabase: admin, shape: { output: 'json' }, temperature: 0, maxTokens: 60, source: 'brain_synthesis',
            prompt: `TASK: ${w.title.slice(0, 140)}\nCANDIDATE FILE: "${cTop.filename}"\nSnippet: ${cTop.snippet.slice(0, 200)}\n\n` +
              `Is this file THE document the task asks to send/share (not merely related)? JSON only: {"match":true|false}`,
          }).catch(() => ({ json: { match: false } }));
          if (cJudge.json?.match !== true) continue;
          const cBody = await generateNudgeDraft(userId, { counterparty: w.who ?? w.blockedOn ?? null, description: `${w.title} — the document "${cTop.filename}" will be attached.` }, admin).catch(() => null);
          if (!cBody) continue;
          const { writeDeliverable } = await import('@/lib/home/deliverable-pool');
          await writeDeliverable(admin, userId, {
            kind: 'commitment', entityId: w.entityId, taskId: 'prepare-pass-docsend', type: 'draft',
            title: `Send ${cTop.filename}`.slice(0, 100), content: cBody, gist: `send draft with ${cTop.filename}`,
            metadata: { source: 'preparation_pass', attachment: { fileId: cTop.id, filename: cTop.filename, source: cTop.source }, provenance: { item: w.title.slice(0, 100), ...(w.entity ? { entity: w.entity.name } : {}) } },
          }).catch(() => {});
          prepared++;
          continue;
        }
        if (!w.id.startsWith('inbox:')) continue;
        const { data: it } = await admin.from('inbox_items').select('id, source_data, status').eq('id', w.entityId).eq('user_id', userId).maybeSingle();
        if (!it || it.status !== 'pending') continue;
        const sd = (it.source_data ?? {}) as Record<string, unknown>;
        const existingDraft = (sd.draft ?? null) as { attachment?: unknown } | null;
        if (existingDraft?.attachment) continue; // already prepared with a file
        const cands = await resolveFileUniversal(admin, { userId, entityId: w.entity?.id ?? null }, w.title, 4).catch(() => []);
        // Only attach on a CONFIDENT KB hit (bytes we hold → previewable + attachable); drive-catalog
        // candidates surface in the deep-dive picker instead of silently auto-attaching.
        const top = cands.find((c) => c.source === 'kb');
        if (!top || top.score < 0.7) continue;
        // THE REASONED PICK (the S4 rule — a score is retrieval, not judgment): one cheap yes/no on
        // whether this file IS what the task asks to send. Reject → no auto-attach (the deep-dive's
        // picker offers candidates instead). A wrong attach is worse than none — trust is the product.
        const judge = await aiCall<{ match?: boolean }>({
          userId, supabase: admin, shape: { output: 'json' }, temperature: 0, maxTokens: 60, source: 'brain_synthesis',
          prompt: `TASK: ${w.title.slice(0, 140)}\nCANDIDATE FILE: "${top.filename}"\nSnippet: ${top.snippet.slice(0, 200)}\n\n` +
            `Is this file THE document the task asks to send/share (not merely related)? JSON only: {"match":true|false}`,
        }).catch(() => ({ json: { match: false } }));
        if (judge.json?.match !== true) continue;
        const body = (existingDraft as { body?: string } | null)?.body
          || (await generateReplyDraft(userId, sd as Record<string, never>, admin, `The reply should send the document "${top.filename}" (it will be attached).`).catch(() => null));
        if (!body) continue;
        await admin.from('inbox_items').update({
          source_data: { ...sd, draft: { body, generated_at: new Date().toISOString(), prepared: 'pass', attachment: { fileId: top.id, filename: top.filename, source: top.source } } },
        }).eq('id', it.id);
        prepared++;
      }
    }
  } catch { /* routing is an enhancement — drafts/nudges already landed */ }

  return { prepared, skipped, nudges, delegated };
}
