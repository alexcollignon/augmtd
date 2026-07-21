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

const TOP_N = 8;          // prepare the working set, not the inventory
const FRESH_HOURS = 24;   // a draft older than this (or older than new thread activity) re-prepares

export type PrepareResult = { prepared: number; skipped: number; nudges: number };

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

  return { prepared, skipped, nudges };
}
