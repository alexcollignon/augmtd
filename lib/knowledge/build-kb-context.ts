import { SupabaseClient } from '@supabase/supabase-js'
import { searchKnowledgeGrouped } from './search'

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

    if (groups.length === 0) return { context: '', filenames: [], fileGroups: [] }

    const sections = groups.map((g) => {
      const summaryLine = g.summary ? `Summary: ${g.summary}\n` : '';
      return `[${g.filename}]\n${summaryLine}${g.contextText}`;
    })
    const joined = sections.join('\n\n')
    const filenames = groups.map((g) => g.filename)
    const fileGroups = groups.map((g) => ({ fileId: g.fileId, filename: g.filename }))

    return {
      context: `RELEVANT KNOWLEDGE BASE (from your indexed files — use this content when answering):\n\n${joined.slice(0, maxTotalChars)}`,
      filenames,
      fileGroups,
    }
  } catch {
    return { context: '', filenames: [], fileGroups: [] }
  }
}
