// ════════════════════════════════════════════════════════════════════════════════════════════════
// UNIVERSAL FILE RESOLUTION (Prepared-Work Phase B, docs/prepared-work-plan.md) — ONE resolver over a
// pluggable SOURCE REGISTRY. "Find the deck" must look wherever files live: the item's deliverable pool,
// the KB (which now includes email attachments, chat uploads, transcripts, generated docs — Phase A), and
// connected drives (GDrive/Dropbox = future registry entries; Tier-0 catalog search, JIT extraction).
//
// Contract (the cost/quality deal): each source returns cheap CANDIDATES (name + snippet + affinity);
// candidates are merged + ranked (entity affinity boosts a file that BELONGS to the same body of work —
// the brain tie); one reasoned pick happens in the CALLER's existing engine (resolve-file-step) or the
// preparation pass. Adding Dropbox = one `FileSource` entry — never a bespoke path. NO eager deep
// indexing: Tier-2 extraction happens just-in-time for hot candidates only, cached by content hash.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { searchKnowledgeGrouped } from './search';

export type ResolveCtx = {
  userId: string;
  /** The entity (body of work) the asking item belongs to — boosts files linked to the same deal. */
  entityId?: string | null;
  /** Optional pool candidates the caller already has (deliverable pool) — always ranked first. */
  poolCandidates?: UniversalCandidate[];
};

export type UniversalCandidate = {
  source: 'pool' | 'kb' | 'gdrive' | 'dropbox';
  id: string;                 // source-scoped id (knowledge_files.id / deliverable id / provider file id)
  filename: string;
  snippet: string;            // what ranking + the reasoned pick see
  entityId?: string | null;   // the file's own entity link (Phase A) — affinity signal
  originKind?: string | null; // provenance for the pick's reasoning + the preview
  score: number;              // source-local relevance, normalized 0..1
};

export type FileSource = {
  key: 'pool' | 'kb' | 'gdrive' | 'dropbox';
  enabled: (admin: SupabaseClient, ctx: ResolveCtx) => Promise<boolean> | boolean;
  search: (admin: SupabaseClient, ctx: ResolveCtx, query: string, limit: number) => Promise<UniversalCandidate[]>;
};

// ── The registry. Adding a provider = one entry here (the locked agnostic invariant). ──
const SOURCES: FileSource[] = [
  {
    key: 'pool',
    enabled: (_a, ctx) => !!ctx.poolCandidates?.length,
    search: async (_a, ctx) => (ctx.poolCandidates ?? []).map((c) => ({ ...c, score: 1 })), // pool = already in-context, top rank
  },
  {
    key: 'kb',
    enabled: () => true,
    search: async (admin, ctx, query, limit) => {
      const groups = await searchKnowledgeGrouped(ctx.userId, query, limit, admin).catch(() => []);
      if (!groups.length) return [];
      // Join the Phase-A provenance (entity link + origin) for affinity + the pick's reasoning.
      const ids = groups.map((g) => g.fileId);
      const meta = new Map<string, { entity_id: string | null; origin: { kind?: string } | null }>();
      try {
        const { data } = await admin.from('knowledge_files').select('id, entity_id, origin').in('id', ids);
        for (const r of (data ?? []) as Array<Record<string, unknown>>) meta.set(r.id as string, { entity_id: (r.entity_id as string) ?? null, origin: (r.origin as { kind?: string }) ?? null });
      } catch { /* pre-migration — no affinity */ }
      return groups.map((g, i) => ({
        source: 'kb' as const, id: g.fileId, filename: g.filename,
        snippet: (g.summary || g.contextText || '').slice(0, 300),
        entityId: meta.get(g.fileId)?.entity_id ?? null,
        originKind: meta.get(g.fileId)?.origin?.kind ?? null,
        score: Math.max(0.1, 1 - i * 0.15),
      }));
    },
  },
  // gdrive / dropbox: Tier-0 catalog search entries land here with the Nango connect rail (Phase B3).
];

/** Search all enabled sources, merge, and rank — ENTITY AFFINITY first among close scores (a file that
 *  belongs to the same deal beats a topically-similar stranger — the same identity-over-topic lesson
 *  recognition learned). Returns the ranked candidates; the caller runs its one reasoned pick. */
export async function resolveFileUniversal(
  admin: SupabaseClient, ctx: ResolveCtx, query: string, limit = 6,
): Promise<UniversalCandidate[]> {
  const all: UniversalCandidate[] = [];
  for (const src of SOURCES) {
    try {
      if (!(await src.enabled(admin, ctx))) continue;
      all.push(...(await src.search(admin, ctx, query, limit)));
    } catch { /* a failing source never breaks resolution */ }
  }
  // Dedupe by filename+source-id; rank: pool first, then (score + entity-affinity boost).
  const seen = new Set<string>();
  return all
    .filter((c) => { const k = `${c.source}:${c.id}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map((c) => ({ ...c, score: c.source === 'pool' ? 2 : c.score + (ctx.entityId && c.entityId === ctx.entityId ? 0.35 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
