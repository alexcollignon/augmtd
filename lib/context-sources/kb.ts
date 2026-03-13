import { SupabaseClient } from '@supabase/supabase-js'
import { ContextSource, ContextResult } from './types'
import { searchKnowledgeGrouped } from '@/lib/knowledge/search'

// Max chars injected per file into generation context.
// 3 chunks × ~3200 chars = ~9600 chars max per file, capped here for safety.
const MAX_CONTEXT_CHARS = 10000

export const kbContextSource: ContextSource = {
  type: 'kb',
  label: 'Knowledge Base',

  async search(userId: string, query: string, limit: number, adminClient: SupabaseClient): Promise<ContextResult[]> {
    const groups = await searchKnowledgeGrouped(userId, query, limit, adminClient, {
      maxChunksPerFile: 3,
      threshold: 0.1,
    })

    return groups.map((g) => ({
      id: g.fileId,
      filename: g.filename,
      // Snippet: best chunk content truncated — shown to LLM for assignment
      snippet: g.chunks[0]?.content.slice(0, 400).replace(/\n+/g, ' ').trim() ?? '',
      similarity: g.similarity,
      sourceType: 'kb',
      sourceLabel: 'Knowledge Base',
      // extractedText: top chunks joined (not full file) — injected into generation
      extractedText: g.contextText.slice(0, MAX_CONTEXT_CHARS),
    }))
  },
}
