import { SupabaseClient } from '@supabase/supabase-js'

export interface InboxSnapshot {
  id: string
  fromName: string
  subject: string
  snippet: string
  visualSection: string
  status: string
  createdAt: string
  hasDraft: boolean
  attachmentCount: number
}

export async function buildInboxSnapshot(
  userId: string,
  query: string | null,
  supabase: SupabaseClient
): Promise<InboxSnapshot[]> {
  const { data } = await supabase
    .from('inbox_items')
    .select('id, source_data, visual_section, status, created_at')
    .eq('user_id', userId)
    .neq('status', 'dismissed')
    .order('created_at', { ascending: false })
    .limit(80)

  const items: InboxSnapshot[] = (data ?? []).map((item: any) => ({
    id: item.id,
    fromName: item.source_data?.from_name || item.source_data?.from || 'Unknown',
    subject: item.source_data?.subject || '(no subject)',
    snippet: (item.source_data?.snippet || item.source_data?.body || '').slice(0, 200),
    visualSection: item.visual_section || 'noted',
    status: item.status,
    createdAt: item.created_at,
    hasDraft: !!(item.source_data?.draft),
    attachmentCount: Array.isArray(item.source_data?.attachments) ? item.source_data.attachments.length : 0,
  }))

  if (!query?.trim()) return items

  const q = query.toLowerCase()
  const matched = items.filter(i =>
    i.fromName.toLowerCase().includes(q) ||
    i.subject.toLowerCase().includes(q) ||
    i.snippet.toLowerCase().includes(q)
  )
  const rest = items.filter(i => !matched.some(m => m.id === i.id))
  return [...matched, ...rest].slice(0, 60)
}

export function formatSnapshotForPrompt(items: InboxSnapshot[]): string {
  return items
    .slice(0, 40)
    .map(i => {
      const section =
        i.visualSection === 'prepared' ? 'prepared'
        : i.visualSection === 'suggested' ? 'needs-review'
        : 'noted'
      const date = new Date(i.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      const flags = [
        i.hasDraft ? 'has-draft' : null,
        i.attachmentCount > 0 ? `has-attachments(${i.attachmentCount})` : null,
      ].filter(Boolean).join(' ')
      return `[${i.id}] From: ${i.fromName} | Subject: ${i.subject} | ${section}${flags ? ` ${flags}` : ''} | ${date}${i.snippet ? ` | "${i.snippet.slice(0, 100)}"` : ''}`
    })
    .join('\n')
}
