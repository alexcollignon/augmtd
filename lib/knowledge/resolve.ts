// ════════════════════════════════════════════════════════════════════════════════════════════════
// UNIVERSAL FILE RESOLUTION (Prepared-Work Phase B, docs/prepared-work-plan.md) — ONE resolver over a
// pluggable SOURCE REGISTRY. "Find the deck" must look wherever files live: the item's deliverable pool,
// the KB (which now includes email attachments, chat uploads, transcripts, generated docs — Phase A), and
// connected drives (GDrive/Dropbox = future registry entries; Tier-0 catalog search, JIT extraction).
//
// Contract (the cost/quality deal): each source returns cheap CANDIDATES (name + snippet + affinity);
// candidates are merged + ranked (entity affinity boosts a file that BELONGS to the same body of work —
// the brain tie); one reasoned pick happens in the CALLER's existing engine (the preparation pass) or the
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
  source: 'pool' | 'kb' | 'gdrive' | 'onedrive' | 'dropbox';
  id: string;                 // source-scoped id (knowledge_files.id / deliverable id / provider file id)
  filename: string;
  snippet: string;            // what ranking + the reasoned pick see
  entityId?: string | null;   // the file's own entity link (Phase A) — affinity signal
  originKind?: string | null; // provenance for the pick's reasoning + the preview
  score: number;              // source-local relevance, normalized 0..1
  /** W13 · THE FILE'S OWN DATE — when these bytes came to exist as far as we can tell (an email
   *  attachment: the message's date; a KB/drive file: its modified/indexed time; a pool row: the date
   *  its writer stamped, else the row's own). null = unknown. The staging law code-checks it against
   *  the REQUEST's date: a file that predates an ask for NEW work can only be that work's base. */
  fileAt?: string | null;
};

export type FileSource = {
  key: 'pool' | 'kb' | 'gdrive' | 'onedrive' | 'dropbox';
  enabled: (admin: SupabaseClient, ctx: ResolveCtx) => Promise<boolean> | boolean;
  search: (admin: SupabaseClient, ctx: ResolveCtx, query: string, limit: number) => Promise<UniversalCandidate[]>;
};

// ── The registry. Adding a provider = one entry here (the locked agnostic invariant). ──
const SOURCES: FileSource[] = [
  {
    key: 'pool',
    enabled: () => true,
    search: async (admin, ctx, query, limit) => {
      // Caller-supplied candidates (a step's own pool read) rank first, verbatim.
      if (ctx.poolCandidates?.length) return ctx.poolCandidates.map((c) => ({ ...c, score: 1 }));
      // Otherwise the pool is a REAL source: files/documents the user (or the rail's 📎 funnel)
      // dropped into item_deliverables — matched by title/gist token overlap, recency-bounded.
      try {
        const { data } = await admin.from('item_deliverables')
          .select('id, title, content, metadata, created_at')
          .eq('user_id', ctx.userId).in('type', ['file', 'document'])
          .order('created_at', { ascending: false }).limit(60);
        const qTokens = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
        if (!qTokens.length) return [];
        return ((data ?? []) as Array<Record<string, unknown>>)
          // W13 · a BASE row (the pre-existing version an ask wants new work added to) is context for
          // its own item, never a candidate for anything — it must not come back as "the pool has it".
          .filter((r) => (r.metadata as { role?: string } | null)?.role !== 'base')
          .map((r) => {
            const hay = `${String(r.title ?? '')} ${String((r.metadata as { gist?: string } | null)?.gist ?? '')}`.toLowerCase();
            const hits = qTokens.filter((t) => hay.includes(t)).length;
            return { r, overlap: hits / qTokens.length };
          })
          .filter((x) => x.overlap >= 0.5)
          .slice(0, limit)
          .map(({ r }) => ({
            source: 'pool' as const, id: r.id as string, filename: String(r.title ?? 'file'),
            snippet: String(r.content ?? '').replace(/\s+/g, ' ').slice(0, 200),
            entityId: null, score: 1, fileAt: poolFileAt(r),
          }));
      } catch { return []; }
    },
  },
  {
    key: 'kb',
    enabled: () => true,
    search: async (admin, ctx, query, limit) => {
      const groups = await searchKnowledgeGrouped(ctx.userId, query, limit, admin).catch(() => []);
      if (!groups.length) return [];
      // Join the Phase-A provenance (entity link + origin) for affinity + the pick's reasoning.
      const ids = groups.map((g) => g.fileId);
      const meta = new Map<string, { entity_id: string | null; origin: { kind?: string; ref?: string } | null; last_modified_at?: string | null; indexed_at?: string | null }>();
      try {
        // W13 · the file's own dates ride the same read (a failed select — the silent-column trap —
        // retries without them, so affinity never dies for the sake of a date).
        const dated = await admin.from('knowledge_files').select('id, entity_id, origin, last_modified_at, indexed_at').in('id', ids);
        const rows: unknown[] | null = dated.error
          ? (await admin.from('knowledge_files').select('id, entity_id, origin').in('id', ids)).data
          : dated.data;
        for (const r of (rows ?? []) as Array<Record<string, unknown>>) meta.set(r.id as string, {
          entity_id: (r.entity_id as string) ?? null, origin: (r.origin as { kind?: string; ref?: string }) ?? null,
          last_modified_at: (r.last_modified_at as string | null) ?? null, indexed_at: (r.indexed_at as string | null) ?? null,
        });
      } catch { /* pre-migration — no affinity */ }
      const attachedAt = await emailAttachmentDates(admin, ctx.userId, [...meta.values()]);
      return groups.map((g, i) => {
        const m = meta.get(g.fileId);
        return {
          source: 'kb' as const, id: g.fileId, filename: g.filename,
          snippet: (g.summary || g.contextText || '').slice(0, 300),
          entityId: m?.entity_id ?? null,
          originKind: m?.origin?.kind ?? null,
          score: Math.max(0.1, 1 - i * 0.15),
          fileAt: kbFileAt(m, attachedAt),
        };
      });
    },
  },
  // ── Connected drives (Phase B3) — TIER-0 catalog over the NATIVE clients (the mailbox connection's
  // token already carries the Drive scope; no new OAuth rail). v1 is a SHALLOW catalog (root + first-level
  // listings, name-ranked) — honest and cheap; the full catalog sweep + delta cursors are the follow-up.
  // JIT content extraction (readDriveFile/readOneDriveFile → ingestFile) happens only when a candidate is
  // actually USED (Tier 2, cached by content hash).
  {
    key: 'gdrive',
    enabled: async (admin, ctx) => !!(await driveTokens(admin, ctx.userId, 'gmail')),
    search: async (admin, ctx, query, limit) => {
      const tokens = await driveTokens(admin, ctx.userId, 'gmail');
      if (!tokens) return [];
      const { listDriveContents } = await import('./google-drive');
      const items = await listDriveContents(tokens).catch(() => []);
      return nameRank(items.filter((i: { mimeType?: string }) => !String(i.mimeType || '').includes('folder'))
        .map((i: { id: string; name: string; modifiedTime?: string | null }) => ({ id: i.id, name: i.name, at: i.modifiedTime ?? null })), query, 'gdrive', limit);
    },
  },
  {
    key: 'onedrive',
    enabled: async (admin, ctx) => !!(await driveTokens(admin, ctx.userId, 'outlook')),
    search: async (admin, ctx, query, limit) => {
      const tokens = await driveTokens(admin, ctx.userId, 'outlook');
      if (!tokens) return [];
      const { listOneDriveContents } = await import('./onedrive');
      const items = await listOneDriveContents(tokens).catch(() => []);
      return nameRank(items.filter((i: { type?: string; mimeType?: string }) => (i as { type?: string }).type !== 'folder')
        .map((i: { id: string; name: string; lastModifiedDateTime?: string | null }) => ({ id: i.id, name: i.name, at: i.lastModifiedDateTime ?? null })), query, 'onedrive', limit);
    },
  },
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


// ── W13 · THE FILE'S OWN DATE (pure where it can be) ─────────────────────────────────────────────
/** A pool row's file date: the date its writer stamped (`metadata.fileAt` — a staged KB pointer
 *  carries its FILE's date, never the row's), else — for a row that merely POINTS at a file
 *  (`metadata.attachment`) with no stamp — unknown, else the row's own birth (a file the user dropped
 *  in IS born when it lands). Pure. */
export function poolFileAt(r: { created_at?: unknown; metadata?: unknown }): string | null {
  const m = (r.metadata ?? {}) as { fileAt?: unknown; attachment?: unknown };
  if (typeof m.fileAt === 'string' && m.fileAt) return m.fileAt;
  if (m.attachment) return null;
  return typeof r.created_at === 'string' ? r.created_at : null;
}

/** A KB row's file date. Every date we hold is an UPPER bound on when the file came to exist — its
 *  modified time, when we indexed it, and (an email attachment) the date its conversation's item
 *  carries — so the file is at least as old as the EARLIEST of them. Pure. */
export function kbFileAt(
  m: { origin?: { kind?: string; ref?: string } | null; last_modified_at?: string | null; indexed_at?: string | null } | undefined,
  attachedAt: Map<string, string>,
): string | null {
  if (!m) return null;
  const ref = m.origin?.kind === 'email_attachment' ? m.origin.ref : null;
  const ts = [ref ? attachedAt.get(ref) : null, m.last_modified_at, m.indexed_at]
    .map((d) => Date.parse(String(d ?? ''))).filter((t) => Number.isFinite(t));
  return ts.length ? new Date(Math.min(...ts)).toISOString() : null;
}

/** The dates of the inbox items email-attachment KB rows came from — one bounded read. */
export async function emailAttachmentDates(
  admin: SupabaseClient, userId: string,
  rows: Array<{ origin?: { kind?: string; ref?: string } | null }>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const refs = [...new Set(rows.filter((r) => r.origin?.kind === 'email_attachment' && r.origin.ref).map((r) => String(r.origin!.ref)))];
  if (!refs.length) return out;
  try {
    const { data, error } = await admin.from('inbox_items').select('id, created_at, received_at:source_data->>received_at')
      .eq('user_id', userId).in('id', refs.slice(0, 50));
    if (error) return out;
    for (const r of (data ?? []) as Array<{ id: string; created_at?: string | null; received_at?: string | null }>) {
      const at = r.received_at || r.created_at;
      if (at) out.set(String(r.id), String(at));
    }
  } catch { /* unknown dates stay unknown — the staging law fails safe on them */ }
  return out;
}

// ── Drive helpers (B3) ───────────────────────────────────────────────────────────────────────────
async function driveTokens(admin: SupabaseClient, userId: string, provider: 'gmail' | 'outlook'): Promise<string | null> {
  try {
    const { data } = await admin.from('connections').select('metadata')
      .eq('user_id', userId).eq('provider', provider).eq('status', 'active').limit(1).maybeSingle();
    return ((data?.metadata as { tokens?: string } | null)?.tokens) ?? null;
  } catch { return null; }
}

/** Cheap Tier-0 ranking: query-word overlap against the filename (catalog has no content yet). */
function nameRank(items: Array<{ id: string; name: string; at?: string | null }>, query: string, source: UniversalCandidate['source'], limit: number): UniversalCandidate[] {
  const qw = query.toLowerCase().split(/\W+/).filter((w) => w.length >= 3); // >=3: acronyms (client codes) are prime signals
  return items
    .map((i) => {
      const name = i.name.toLowerCase();
      const hits = qw.filter((w) => name.includes(w)).length;
      return { source, id: i.id, filename: i.name, snippet: `(drive catalog: ${i.name})`, score: hits ? Math.min(0.9, 0.3 + hits * 0.2) : 0, fileAt: i.at ?? null };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(3, limit)); // catalog is a supplement, never floods the KB results
}

/** A one-line drive supplement for KB-search consumers (coworker tools): catalog hits from the connected
 *  drives for this query, as plain text — '' when none. ONE source; call sites stay one-liners. */
export async function driveSupplementLine(admin: SupabaseClient, userId: string, query: string): Promise<string> {
  try {
    const cands = await resolveFileUniversal(admin, { userId }, query, 6);
    const drive = cands.filter((c) => c.source === 'gdrive' || c.source === 'onedrive');
    if (!drive.length) return '';
    return `\n\nAlso in connected drives (not yet indexed — name matches): ${drive.map((c) => `"${c.filename}" (${c.source === 'gdrive' ? 'Google Drive' : 'OneDrive'})`).join(', ')}. Mention these to the user if relevant.`;
  } catch { return ''; }
}
