import { SupabaseClient } from '@supabase/supabase-js'
import { searchKnowledgeGrouped, type FileChunkGroup } from './search'
import { packContext } from '@/lib/utils/pack-context'

interface KBContextOptions {
  fileLimit?: number
  maxChunksPerFile?: number
  threshold?: number
  maxTotalChars?: number
  /** When set, search is scoped to these file IDs first; falls through to global if no results */
  scopeFileIds?: string[]
}

export interface KBContextResult {
  context: string
  filenames: string[]
  fileGroups: Array<{ fileId: string; filename: string }>
  /** ONE READ, TWO RENDERINGS (Wave 1, Sep 22 — the collection card): the RAW grouped hits this
   *  context was rendered from, so a caller that also wants to SHOW the documents builds its rows
   *  from the very same search — never a second query that could rank differently. Additive; every
   *  existing consumer reads `context`/`fileGroups` exactly as before. */
  groups: FileChunkGroup[]
  /** THE CONTEXT BUDGET (W2.7): the file ids whose text actually reached `context` (whole or
   *  clipped-and-declared). A caller that SHOWS documents shows these — a card must never list a
   *  file the model never saw. */
  packedFileIds: string[]
}

export async function buildKBContext(
  userId: string,
  query: string,
  adminClient: SupabaseClient,
  options: KBContextOptions = {}
): Promise<KBContextResult> {
  const {
    fileLimit = 4,
    maxChunksPerFile = 2,
    threshold = 0.2,
    maxTotalChars = 6000,
    scopeFileIds,
  } = options

  try {
    let groups = await searchKnowledgeGrouped(userId, query, fileLimit, adminClient, {
      maxChunksPerFile,
      threshold,
    })

    // If agent KB scope is set, filter to agent files first; fall through to global if empty
    if (scopeFileIds && scopeFileIds.length > 0) {
      const scoped = groups.filter((g) => scopeFileIds.includes(g.fileId))
      if (scoped.length > 0) groups = scoped
      // else: fall through to full global results (agent KB had no relevant hits)
    }

    if (groups.length === 0) return { context: '', filenames: [], fileGroups: [], groups: [], packedFileIds: [] }

    // PACKED BY FILE, in rank order (the best match survives longest) — a budget overrun clips or
    // drops whole files with a declared mark/line, never a raw slice through the middle of one.
    const packed = packContext(groups.map((g, i) => {
      const summaryLine = g.summary ? `Summary: ${g.summary}\n` : '';
      return { id: g.fileId, label: `[${g.filename}]`, text: `[${g.filename}]\n${summaryLine}${g.contextText}`, priority: groups.length - i, minChars: 300 }
    }), maxTotalChars)
    const filenames = groups.map((g) => g.filename)
    const fileGroups = groups.map((g) => ({ fileId: g.fileId, filename: g.filename }))

    return {
      context: `RELEVANT KNOWLEDGE BASE (from your indexed files — use this content when answering):\n\n${packed.text}`,
      filenames,
      fileGroups,
      groups,
      packedFileIds: groups.filter((g) => packed.report[g.fileId]?.status !== 'dropped').map((g) => g.fileId),
    }
  } catch {
    return { context: '', filenames: [], fileGroups: [], groups: [], packedFileIds: [] }
  }
}
