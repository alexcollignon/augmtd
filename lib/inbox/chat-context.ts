import { SupabaseClient } from '@supabase/supabase-js'

export interface InboxSnapshot {
  id: string
  fromName: string
  fromEmail: string
  subject: string
  snippet: string
  visualSection: string
  status: string
  createdAt: string
  hasDraft: boolean
  attachmentCount: number
  isRead: boolean
  isFlagged?: boolean
}

export async function buildInboxSnapshot(
  userId: string,
  query: string | null,
  supabase: SupabaseClient,
  connectionId?: string | null,
  limit = 80,
): Promise<InboxSnapshot[]> {
  let q = supabase
    .from('inbox_items')
    .select('id, source_data, visual_section, status, created_at, is_read, is_flagged')
    .eq('user_id', userId)
    .neq('status', 'dismissed')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (connectionId) q = q.eq('connection_id', connectionId)

  const { data } = await q

  const items: InboxSnapshot[] = (data ?? []).map((item: any) => ({
    id: item.id,
    fromName: item.source_data?.from_name || item.source_data?.from || 'Unknown',
    fromEmail: item.source_data?.from_address || '',
    subject: item.source_data?.subject || '(no subject)',
    snippet: (item.source_data?.snippet || item.source_data?.body || '').slice(0, 200),
    visualSection: item.visual_section || 'noted',
    status: item.status,
    createdAt: item.created_at,
    hasDraft: !!(item.source_data?.draft),
    attachmentCount: Array.isArray(item.source_data?.attachments) ? item.source_data.attachments.length : 0,
    isRead: item.is_read !== false,
    isFlagged: item.is_flagged === true,
  }))

  if (!query?.trim()) return items

  const queryLower = query.toLowerCase()
  const matched = items.filter(i =>
    i.fromName.toLowerCase().includes(queryLower) ||
    i.subject.toLowerCase().includes(queryLower) ||
    i.snippet.toLowerCase().includes(queryLower)
  )
  const rest = items.filter(i => !matched.some(m => m.id === i.id))
  return [...matched, ...rest].slice(0, 60)
}

export function formatSnapshotForPrompt(items: InboxSnapshot[]): string {
  return items
    .slice(0, 60)
    .map(i => {
      const section =
        i.visualSection === 'prepared' ? 'prepared'
        : i.visualSection === 'suggested' ? 'needs-review'
        : 'noted'
      const date = new Date(i.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      const flags = [
        !i.isRead ? 'unread' : null,
        i.isFlagged ? 'flagged' : null,
        i.hasDraft ? 'has-draft' : null,
        i.attachmentCount > 0 ? `has-attachments(${i.attachmentCount})` : null,
      ].filter(Boolean).join(' ')
      const fromField = i.fromEmail ? `${i.fromName} <${i.fromEmail}>` : i.fromName
      return `[${i.id}] From: ${fromField} | Subject: ${i.subject} | ${section}${flags ? ` ${flags}` : ''} | ${date}${i.snippet ? ` | "${i.snippet}"` : ''}`
    })
    .join('\n')
}
