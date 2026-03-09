import { SupabaseClient } from '@supabase/supabase-js'
import { ContextSource, ContextResult } from './types'
import { searchKnowledge } from '@/lib/knowledge/indexer'

const SNIPPET_LENGTH = 400

export const kbContextSource: ContextSource = {
  type: 'kb',
  label: 'Knowledge Base',

  async search(userId: string, query: string, limit: number, adminClient: SupabaseClient): Promise<ContextResult[]> {
    const files = await searchKnowledge(userId, query, limit, adminClient)
    return files.map((f) => ({
      id: f.id,
      filename: f.filename,
      snippet: (f.extracted_text ?? '').slice(0, SNIPPET_LENGTH).replace(/\n+/g, ' ').trim(),
      similarity: f.similarity ?? 0,
      sourceType: 'kb',
      sourceLabel: 'Knowledge Base',
      extractedText: f.extracted_text,
    }))
  },
}
