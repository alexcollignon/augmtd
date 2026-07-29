// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE OUTCOME LOG (proactive-team R1) — collect NOW, synthesize LATER. Every prepared artifact's
// fate is stamped at its resolution moment: the user sent it untouched (accepted), sent it changed
// (edited), or resolved the item without using it (discarded). This is the raw evidence the future
// learning arc and the autonomy ladder both need and cannot backfill — a signal write, nothing more.
// Reuses learning_signals (signal_type 'action_taken', the curation-era channel) — no migration.
// Non-fatal by construction: an outcome that fails to log never touches the action that produced it.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';

export type PreparedOutcome = 'accepted' | 'edited' | 'discarded';
export type PreparedArtifactKind = 'reply_draft' | 'nudge_draft' | 'invite' | 'forward' | 'deliverable';

export async function logPreparedOutcome(
  client: SupabaseClient, userId: string,
  args: {
    outcome: PreparedOutcome;
    artifact: PreparedArtifactKind;
    itemKind: 'inbox' | 'commitment';
    itemId: string;
    /** 0–1 rough share of the artifact the user changed (edited only; cheap token-level estimate). */
    editShare?: number;
  },
): Promise<void> {
  try {
    await client.from('learning_signals').insert({
      user_id: userId,
      signal_type: 'action_taken',
      inbox_item_id: args.itemKind === 'inbox' ? args.itemId : null,
      signal_data: {
        action: `prepared_${args.outcome}`,
        artifact: args.artifact,
        item_kind: args.itemKind,
        item_id: args.itemId,
        ...(typeof args.editShare === 'number' ? { edit_share: Math.round(args.editShare * 100) / 100 } : {}),
      },
    });
  } catch { /* the outcome log never breaks the action it observes */ }
}

/** A cheap symmetric-difference estimate of how much of the prepared text the user changed —
 *  token overlap, no AI. 0 = sent verbatim, 1 = fully rewritten. */
export function estimateEditShare(prepared: string, sent: string): number {
  const tok = (s: string) => new Set(s.toLowerCase().replace(/<[^>]*>/g, ' ').split(/\s+/).filter((t) => t.length > 2));
  const a = tok(prepared), b = tok(sent);
  if (!a.size && !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : Math.min(1, Math.max(0, 1 - shared / union));
}
