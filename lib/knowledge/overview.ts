// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE KNOWLEDGE OVERVIEW — the ONE read behind the Knowledge panel, and the ONE place the numbers
// are computed. Two laws it exists to keep:
//
//   HONEST NUMBERS. The old route read `.limit(400)` and reported `rows.length` as the inventory —
//   a user with 1,046 files was told "400 indexed". Every number here comes from a real COUNT
//   query (`head: true`), never from the length of a capped list. `indexed` is the count of files
//   that actually have chunks (an inner join on knowledge_chunks — proven equal to the
//   chunk_index=0 count on the two live 1,000-file accounts).
//
//   FOLDERS SHOW. A folder is a user-facing product concept now (the seed kit lands packs of them;
//   `read_kb_folder` / `match_to_profiles` point at one BY NAME). So the overview always returns
//   the whole folder list with true per-folder counts — INCLUDING empty folders, because a seeded
//   empty folder that renders nowhere is the bug this surface was built to end. Folder FILES are
//   fetched on expand (`listKbFiles`), never eagerly: a folder section is born collapsed, so
//   loading 50 rows × N folders up front would be paying for what nobody looked at.
//
// The folder list is the SAME source `/api/drive/folders` serves the Studio picker — a folder made
// here is pickable in a workflow step on the next read, by construction.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';

export type KbKind = 'meeting' | 'attachment' | 'upload' | 'generated';
export type KindFilter = 'all' | KbKind;

export type KbFile = {
  id: string;
  filename: string;
  kind: KbKind;
  sizeBytes: number | null;
  indexedAt: string | null;
  chunks: number;
  indexed: boolean;
  project: string | null;
  folderId: string | null;
  folder: string | null;
  deletable: boolean;
};

export type KbFolder = { id: string; name: string; count: number; isSystem: boolean };

export type KnowledgeOverview = {
  counts: {
    meeting: number; attachment: number; upload: number; generated: number;
    total: number; indexed: number; pending: number;
  };
  folders: KbFolder[];
  /** Files with no folder — the section that renders EXPANDED (meetings, attachments and
   *  generated work land here, so it is where a fresh account's whole inventory lives). */
  loose: { count: number; files: KbFile[]; hasMore: boolean };
  mail: Array<{ provider: string; email: string }>;
};

export const KB_PAGE = 50;

const FILE_COLS =
  'id, filename, size_bytes, indexed_at, provider_file_id, source_id, entity_id, folder_id, knowledge_chunks(count)';

type Row = {
  id: string; filename: string | null; size_bytes: number | null; indexed_at: string | null;
  provider_file_id: string | null; source_id: string | null; entity_id: string | null;
  folder_id: string | null; knowledge_chunks: Array<{ count: number }> | null;
};

/** THE STRUCTURAL KIND — derived from the row itself (provider_file_id prefixes + the augmtd
 *  source), never from a stored label. Kept identical to the SQL filters below. */
export function kindOfRow(r: { provider_file_id: string | null; source_id: string | null }, augmtdSourceIds: string[]): KbKind {
  const p = String(r.provider_file_id ?? '');
  if (p.startsWith('transcript::')) return 'meeting';
  if (p.startsWith('email_attachment::')) return 'attachment';
  if (r.source_id && augmtdSourceIds.includes(r.source_id)) return 'generated';
  return 'upload';
}

// PostgREST filter builders are structurally identical across select/head-count queries but their
// generated types are not interchangeable; the shared filter helpers below take the builder loosely
// on purpose so ONE definition of "what a kind is" serves both the counts and the listings.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Q = any;

// A row is NEVER two kinds. `kindOfRow` is a precedence LADDER (transcript → attachment → augmtd
// source → upload), so the SQL half must carry the SAME exclusions or the four kinds stop
// partitioning the base. THE BUG THIS ENCODES (found on the owner's walk): `generated` was
// `source_id = augmtd` with no prefix exclusion, so 5 meeting transcripts that also hang off the
// augmtd source were counted TWICE — once as meeting, once as generated. `upload` was then derived
// by SUBTRACTION (total − the other three), so the double-count showed up as an Uploads tab reading
// 997 over a folder holding 1,002. One overlap, two lying numbers.
const NOT_MEETING = (q: Q): Q => q.not('provider_file_id', 'like', 'transcript::%');
const NOT_ATTACHMENT = (q: Q): Q => q.not('provider_file_id', 'like', 'email_attachment::%');
/** An id set that cannot match anything — an impossible filter beats a wrong count. */
const IMPOSSIBLE = (q: Q): Q => q.eq('id', '00000000-0000-0000-0000-000000000000');

/** The SQL half of `kindOfRow` — the same four definitions with the same precedence, expressed as
 *  filters so a count can be exact without listing a single row. Forking these two, or letting two
 *  branches overlap, is how a count starts lying. */
function applyKind(q: Q, kind: KindFilter, augmtdSourceIds: string[]): Q {
  switch (kind) {
    case 'meeting': return q.like('provider_file_id', 'transcript::%');
    case 'attachment': return NOT_MEETING(q).like('provider_file_id', 'email_attachment::%');
    case 'generated':
      return augmtdSourceIds.length
        ? NOT_ATTACHMENT(NOT_MEETING(q)).in('source_id', augmtdSourceIds)
        : IMPOSSIBLE(q);
    case 'upload': {
      const out = NOT_ATTACHMENT(NOT_MEETING(q));
      // `not.in` — the mirror of the generated branch, so the two can never both claim a row.
      return augmtdSourceIds.length ? out.not('source_id', 'in', `(${augmtdSourceIds.join(',')})`) : out;
    }
    default: return q;
  }
}

/** ALL of the user's augmtd sources. `maybeSingle()` was wrong twice over: a user with two augmtd
 *  rows (they exist in the live DB) made it ERROR to null, silently reclassifying every generated
 *  document as an upload. */
async function getAugmtdSourceIds(sb: SupabaseClient, userId: string): Promise<string[]> {
  const { data } = await sb.from('knowledge_sources').select('id')
    .eq('user_id', userId).eq('provider', 'augmtd');
  return ((data ?? []) as Array<{ id: string }>).map((s) => s.id);
}

const countFiles = async (sb: SupabaseClient, userId: string, shape: (q: Q) => Q): Promise<number> => {
  const base = sb.from('knowledge_files').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  const { count, error } = await shape(base);
  if (error) throw new Error(error.message);
  return count ?? 0;
};

/** Map raw rows → served files. `folderNames`/`entityNames` are resolved by the caller so a page
 *  of rows costs at most two extra reads regardless of how many rows it holds. */
function toFiles(rows: Row[], augmtdSourceIds: string[], folderNames: Map<string, string>, entityNames: Map<string, string>): KbFile[] {
  return rows.map((r) => {
    const kind = kindOfRow(r, augmtdSourceIds);
    const chunks = r.knowledge_chunks?.[0]?.count ?? 0;
    return {
      id: r.id,
      filename: r.filename ?? 'Untitled',
      kind,
      sizeBytes: r.size_bytes ?? null,
      indexedAt: r.indexed_at ?? null,
      chunks,
      indexed: chunks > 0,
      project: r.entity_id ? entityNames.get(r.entity_id) ?? null : null,
      folderId: r.folder_id ?? null,
      folder: r.folder_id ? folderNames.get(r.folder_id) ?? null : null,
      // A meeting note lives with its meeting — it leaves the KB from there, never here.
      deletable: kind !== 'meeting',
    };
  });
}

async function decorate(sb: SupabaseClient, userId: string, rows: Row[], folderNames: Map<string, string>, augmtdSourceIds: string[]): Promise<KbFile[]> {
  const entIds = [...new Set(rows.map((r) => r.entity_id).filter((x): x is string => !!x))];
  const entityNames = new Map<string, string>();
  if (entIds.length) {
    const { data } = await sb.from('work_entities').select('id, name').in('id', entIds).eq('user_id', userId);
    for (const e of (data ?? []) as Array<{ id: string; name: string }>) entityNames.set(e.id, e.name);
  }
  return toFiles(rows, augmtdSourceIds, folderNames, entityNames);
}

export async function buildKnowledgeOverview(
  sb: SupabaseClient, userId: string, opts?: { kind?: KindFilter },
): Promise<KnowledgeOverview> {
  const kind = opts?.kind ?? 'all';
  const augmtdSourceIds = await getAugmtdSourceIds(sb, userId);

  // EVERY tab count is its own COUNT under the SAME predicate the folder counts use. `upload` was
  // derived by subtraction (total − the other three), which turned one overlap between two
  // predicates into a tab that disagreed with the rows underneath it — the sum law, broken.
  const [total, meeting, attachment, generated, upload, indexed, foldersRes, mailRes] = await Promise.all([
    countFiles(sb, userId, (q) => q),
    countFiles(sb, userId, (q) => applyKind(q, 'meeting', augmtdSourceIds)),
    countFiles(sb, userId, (q) => applyKind(q, 'attachment', augmtdSourceIds)),
    countFiles(sb, userId, (q) => applyKind(q, 'generated', augmtdSourceIds)),
    countFiles(sb, userId, (q) => applyKind(q, 'upload', augmtdSourceIds)),
    // Files that ACTUALLY have chunks — the honest "indexed" number. `!inner` turns the embed
    // into a semi-join, so the count stays a count of FILES (verified against the chunk_index=0
    // count on two live 1,000-file accounts: exact agreement).
    (async () => {
      const { count } = await sb.from('knowledge_files')
        .select('id, knowledge_chunks!inner(id)', { count: 'exact', head: true }).eq('user_id', userId);
      return count ?? 0;
    })(),
    sb.from('drive_folders').select('id, name, is_system').eq('user_id', userId)
      .order('name', { ascending: true }),
    sb.from('connections').select('provider, metadata').eq('user_id', userId)
      .eq('status', 'active').in('provider', ['gmail', 'outlook']),
  ]);

  const folderRows = (foldersRes.data ?? []) as Array<{ id: string; name: string; is_system: boolean }>;
  const folderNames = new Map(folderRows.map((f) => [f.id, f.name]));

  // Per-folder counts + the loose count, all under the active kind filter. One head query each —
  // folders are few (a seed kit is a handful) and every one of them must speak a TRUE number.
  const [folderCounts, looseCount] = await Promise.all([
    Promise.all(folderRows.map((f) =>
      countFiles(sb, userId, (q) => applyKind(q.eq('folder_id', f.id), kind, augmtdSourceIds)))),
    countFiles(sb, userId, (q) => applyKind(q.is('folder_id', null), kind, augmtdSourceIds)),
  ]);

  const { data: looseRows } = await applyKind(
    sb.from('knowledge_files').select(FILE_COLS).eq('user_id', userId).is('folder_id', null),
    kind, augmtdSourceIds,
  ).order('indexed_at', { ascending: false }).limit(KB_PAGE);

  const loose = await decorate(sb, userId, (looseRows ?? []) as unknown as Row[], folderNames, augmtdSourceIds);

  return {
    counts: { total, meeting, attachment, generated, upload, indexed, pending: Math.max(0, total - indexed) },
    // An EMPTY folder still renders — a seeded folder nobody has filled yet must not be invisible.
    folders: folderRows.map((f, i) => ({ id: f.id, name: f.name, count: folderCounts[i], isSystem: !!f.is_system })),
    loose: { count: looseCount, files: loose, hasMore: looseCount > loose.length },
    mail: ((mailRes.data ?? []) as Array<{ provider: string; metadata: { email?: string } | null }>)
      .map((c) => ({ provider: c.provider, email: c.metadata?.email ?? '' })),
  };
}

/** One page of files — a folder section on expand, "Show all N", a name search, or an explicit id
 *  set (how the panel folds the semantic search hits in beside the name matches). */
export async function listKbFiles(
  sb: SupabaseClient, userId: string,
  opts: { folderId?: string | null; kind?: KindFilter; q?: string; ids?: string[]; offset?: number; limit?: number },
): Promise<{ files: KbFile[]; count: number; hasMore: boolean }> {
  const kind = opts.kind ?? 'all';
  const limit = Math.min(200, Math.max(1, opts.limit ?? KB_PAGE));
  const offset = Math.max(0, opts.offset ?? 0);
  const augmtdSourceIds = await getAugmtdSourceIds(sb, userId);

  const shape = (q: Q): Q => {
    let cur = q;
    if (opts.folderId !== undefined) cur = opts.folderId === null ? cur.is('folder_id', null) : cur.eq('folder_id', opts.folderId);
    const needle = opts.q?.trim() ?? '';
    if (needle.length >= 2) cur = cur.ilike('filename', `%${needle.replace(/[%_\\]/g, '')}%`);
    if (opts.ids?.length) cur = cur.in('id', opts.ids.slice(0, 200));
    return applyKind(cur, kind, augmtdSourceIds);
  };

  const { count } = await shape(
    sb.from('knowledge_files').select('id', { count: 'exact', head: true }).eq('user_id', userId),
  );

  const { data, error } = await shape(
    sb.from('knowledge_files').select(FILE_COLS).eq('user_id', userId),
  ).order('indexed_at', { ascending: false }).range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as Row[];
  const folderIds = [...new Set(rows.map((r) => r.folder_id).filter((x): x is string => !!x))];
  const folderNames = new Map<string, string>();
  if (folderIds.length) {
    const { data: fs } = await sb.from('drive_folders').select('id, name').in('id', folderIds).eq('user_id', userId);
    for (const f of (fs ?? []) as Array<{ id: string; name: string }>) folderNames.set(f.id, f.name);
  }

  const files = await decorate(sb, userId, rows, folderNames, augmtdSourceIds);
  return { files, count: count ?? files.length, hasMore: offset + files.length < (count ?? 0) };
}
