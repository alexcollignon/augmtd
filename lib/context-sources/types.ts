import { SupabaseClient } from '@supabase/supabase-js'

export interface ContextResult {
  id: string              // source-local unique ID (for KB: knowledge_files.id UUID)
  filename: string        // display name shown to the user
  snippet: string         // ~400 char preview used for LLM assignment
  similarity: number      // 0–1 relevance score from the source's search
  sourceType: string      // 'kb' | 'notion' | 'slack' | 'salesforce' | etc.
  sourceLabel: string     // human-readable: 'Knowledge Base' | 'Notion' | etc.
  extractedText?: string | null  // full text injected into generation context
}

/**
 * Standard interface every context source must implement.
 * KB is the first — Notion, Slack, CRM sources implement the same shape.
 */
export interface ContextSource {
  type: string    // unique identifier e.g. 'kb', 'notion', 'slack'
  label: string   // human-readable label

  /**
   * Semantic search across this source for content relevant to the query.
   * Returns results sorted by relevance descending, already filtered by threshold.
   */
  search(
    userId: string,
    query: string,
    limit: number,
    adminClient: SupabaseClient
  ): Promise<ContextResult[]>
}
