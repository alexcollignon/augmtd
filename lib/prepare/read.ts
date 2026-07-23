// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE PREPARED-WORK READER (single-source consolidation #1). Prepared artifacts live in three
// physical places — `source_data.draft` (reply drafts), `source_data.nudge_draft` (waiting-on nudges),
// and `item_deliverables` (coworker/pass deliverables, commitment drafts). Consumers must NEVER know
// that: they call getPrepared()/preparedFromSourceData() and get one normalized shape. Storage may stay
// plural; the knowledge of where things live is singular, here.
// Consumers: /api/items/view (deep-dive prepared/byline) · commitments nudge route · brief route (✦ tokens) · smokes.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';

export type PreparedArtifact = {
  kind: 'reply_draft' | 'nudge_draft' | 'deliverable';
  title: string | null;
  content: string;
  by: string | null;           // coworker name (attributed) or null (in-house)
  at: string | null;
  attachment: { fileId: string; filename: string; source?: string } | null;
  provenance: Record<string, string> | null;
};

type SourceData = {
  draft?: { body?: string; generated_at?: string; attachment?: { fileId: string; filename: string; source?: string } } | null;
  nudge_draft?: { body?: string; generated_at?: string } | null;
  prepared_by?: { worker?: string; at?: string } | null;
} | null | undefined;

/** The pure half — prepared artifacts already present ON an inbox row's source_data (no queries).
 *  The brief route uses this over rows it already holds; getPrepared uses it after fetching. */
export function preparedFromSourceData(sd: SourceData): PreparedArtifact[] {
  const out: PreparedArtifact[] = [];
  if (sd?.draft?.body) {
    out.push({
      kind: 'reply_draft', title: null, content: sd.draft.body,
      by: sd.prepared_by?.worker ?? null, at: sd.draft.generated_at ?? null,
      attachment: sd.draft.attachment ?? null, provenance: null,
    });
  }
  if (sd?.nudge_draft?.body) {
    out.push({ kind: 'nudge_draft', title: null, content: sd.nudge_draft.body, by: null, at: sd.nudge_draft.generated_at ?? null, attachment: null, provenance: null });
  }
  return out;
}

/** A single ✦ badge for an inbox row — 'draft' (in-house) or the coworker's name. The brief's tokens. */
export function preparedBadge(sd: SourceData): string | null {
  if (sd?.prepared_by?.worker) return String(sd.prepared_by.worker);
  if (sd?.draft?.body || sd?.nudge_draft?.body) return 'draft';
  return null;
}

/** Everything prepared for ONE item, newest first — across all storage places. */
export async function getPrepared(
  client: SupabaseClient, userId: string,
  item: { kind: 'inbox_item' | 'commitment'; id: string },
): Promise<PreparedArtifact[]> {
  const out: PreparedArtifact[] = [];
  try {
    if (item.kind === 'inbox_item') {
      const { data } = await client.from('inbox_items').select('source_data').eq('id', item.id).eq('user_id', userId).maybeSingle();
      out.push(...preparedFromSourceData(data?.source_data as SourceData));
    }
    // Deliverables hang off items under the plan-kind key ('email' for inbox-backed, 'commitment' for commitments).
    const poolKind = item.kind === 'inbox_item' ? 'email' : 'commitment';
    const { data: dels } = await client.from('item_deliverables')
      .select('type, title, content, metadata, created_at')
      .eq('user_id', userId).eq('kind', poolKind).eq('entity_id', item.id)
      .order('created_at', { ascending: false }).limit(8);
    for (const d of (dels ?? []) as Array<Record<string, unknown>>) {
      if (!d.content) continue;
      const meta = (d.metadata ?? {}) as { agentName?: string; worker?: string; attachment?: { fileId: string; filename: string; source?: string }; provenance?: Record<string, string> };
      out.push({
        kind: 'deliverable', title: (d.title as string) ?? null, content: String(d.content),
        by: meta.agentName ?? meta.worker ?? null, at: (d.created_at as string) ?? null,
        attachment: meta.attachment ?? null, provenance: meta.provenance ?? null,
      });
    }
  } catch { /* non-fatal — prepared work is an enhancement */ }
  return out.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
}
