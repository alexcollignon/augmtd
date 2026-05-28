import { SupabaseClient } from '@supabase/supabase-js'
import { InboxSnapshot } from './chat-context'

const STOPWORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','by','from','is','are','was','were',
  'have','has','had','do','does','did','will','would','could','should','can','may','might','shall',
  'this','that','these','those','it','its','my','your','his','her','our','their','we','i','you','he','she','they',
  'what','when','where','how','why','who','about','any','all','some','me','him','us','them',
  'email','emails','message','messages','send','sent','reply','replied','forward','subject','re','fwd',
  'show','find','get','tell','give','list','look','see','check','know','need','want','like','just',
  'please','thanks','thank','hi','hello','dear',
])

interface ExtractedEntities {
  senderNames: string[]
  domains: string[]
  keywords: string[]
  phrases: string[]
}

function extractEntities(message: string): ExtractedEntities {
  const senderNames: string[] = []
  const domains: string[] = []
  const keywords: string[] = []
  const phrases: string[] = []

  // Extract quoted phrases: "exact phrase"
  const quoteMatches = message.match(/"([^"]{2,50})"/g)
  if (quoteMatches) {
    phrases.push(...quoteMatches.map(q => q.slice(1, -1)))
  }

  // Extract domains: @domain.com or domain.com patterns
  const domainMatches = message.match(/@([\w.-]+\.[a-z]{2,})/gi)
  if (domainMatches) {
    domains.push(...domainMatches.map(d => d.replace('@', '')))
  }
  const baredomainMatches = message.match(/\b([\w-]+\.[a-z]{2,4})\b/gi)
  if (baredomainMatches) {
    domains.push(...baredomainMatches.filter(d => !d.match(/^\d/) && d.includes('.')))
  }

  // Extract sender name patterns: "from Name", "by Name", "Name's", "Name sent"
  const fromPatterns = [
    /\bfrom\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g,
    /\bby\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)'s\b/g,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+sent\b/g,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+emailed?\b/g,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+wrote\b/g,
  ]
  for (const pattern of fromPatterns) {
    let m
    while ((m = pattern.exec(message)) !== null) {
      const name = m[1].trim()
      if (name.length > 2 && !STOPWORDS.has(name.toLowerCase())) {
        senderNames.push(name)
      }
    }
  }

  // Extract capitalized proper noun pairs not at sentence starts.
  // Push to keywords (not senderNames) — topic concepts like "Personal Assistant",
  // "Marketing Director", "Job Application" should be searched in subject/snippet,
  // not in from_name/from_address where they'll never match.
  const properNouns = message.match(/(?<![.!?]\s)(?<!\n)\b([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20})+)\b/g)
  if (properNouns) {
    for (const noun of properNouns) {
      const words = noun.split(' ')
      if (words.every(w => !STOPWORDS.has(w.toLowerCase()))) {
        keywords.push(noun)
      }
    }
  }

  // Extract significant keywords (non-stop, length >= 4, not already captured)
  const allCaptured = new Set([...senderNames, ...phrases].map(s => s.toLowerCase()))
  const wordTokens = message
    .replace(/"[^"]*"/g, '')
    .replace(/@[\w.-]+/g, '')
    .split(/\s+/)
    .map(w => w.replace(/[^a-zA-ZÀ-ÿ0-9]/g, ''))
    .filter(w => w.length >= 4 && !STOPWORDS.has(w.toLowerCase()) && !allCaptured.has(w.toLowerCase()))

  keywords.push(...[...new Set(wordTokens)].slice(0, 5))

  return {
    senderNames: [...new Set(senderNames)],
    domains: [...new Set(domains)],
    keywords: [...new Set(keywords)],
    phrases,
  }
}

function mapToSnapshot(item: any): InboxSnapshot {
  return {
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
  }
}

export async function searchInboxForContext(
  message: string,
  userId: string,
  activeConnectionId: string | null | undefined,
  supabase: SupabaseClient
): Promise<InboxSnapshot[]> {
  const entities = extractEntities(message)
  const hasEntities =
    entities.senderNames.length > 0 ||
    entities.domains.length > 0 ||
    entities.phrases.length > 0 ||
    entities.keywords.length > 0

  if (!hasEntities) return []

  const seenIds = new Set<string>()
  const results: InboxSnapshot[] = []

  const baseQuery = () => {
    let q = supabase
      .from('inbox_items')
      .select('id, source_data, visual_section, status, created_at, is_read, is_flagged')
      .eq('user_id', userId)
      .neq('status', 'dismissed')
      .order('created_at', { ascending: false })
      .limit(20)
    if (activeConnectionId) q = q.eq('connection_id', activeConnectionId)
    return q
  }

  const addResults = (items: any[]) => {
    for (const item of items ?? []) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id)
        results.push(mapToSnapshot(item))
      }
    }
  }

  const queries: PromiseLike<any>[] = []

  // Search by sender name — query from_name and from_address
  for (const name of entities.senderNames.slice(0, 3)) {
    const parts = name.split(' ')
    // Try each part separately to increase recall for names like "João Bacalhau"
    for (const part of parts) {
      if (part.length < 3) continue
      queries.push(
        baseQuery()
          .or(`source_data->>from_name.ilike.%${part}%,source_data->>from_address.ilike.%${part}%,source_data->>from.ilike.%${part}%`)
          .then(r => r.data)
      )
    }
  }

  // Search by domain
  for (const domain of entities.domains.slice(0, 2)) {
    queries.push(
      baseQuery()
        .filter('source_data->>from_address', 'ilike', `%${domain}%`)
        .then(r => r.data)
    )
  }

  // Search by exact phrase (subject or snippet)
  for (const phrase of entities.phrases.slice(0, 2)) {
    queries.push(
      baseQuery()
        .or(`source_data->>subject.ilike.%${phrase}%,source_data->>snippet.ilike.%${phrase}%`)
        .then(r => r.data)
    )
  }

  // Search by keyword in subject or snippet
  for (const kw of entities.keywords.slice(0, 5)) {
    queries.push(
      baseQuery()
        .or(`source_data->>subject.ilike.%${kw}%,source_data->>snippet.ilike.%${kw}%`)
        .then(r => r.data)
    )
  }

  const allResults = await Promise.all(queries)
  for (const batch of allResults) {
    addResults(batch)
  }

  return results.slice(0, 25)
}

export function formatSearchResultsForPrompt(items: InboxSnapshot[]): string {
  if (items.length === 0) return ''
  return items
    .map(i => {
      const date = new Date(i.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      const flags = [
        !i.isRead ? 'unread' : null,
        i.isFlagged ? 'flagged' : null,
        i.hasDraft ? 'has-draft' : null,
        i.attachmentCount > 0 ? `has-attachments(${i.attachmentCount})` : null,
      ].filter(Boolean).join(' ')
      const fromField = i.fromEmail ? `${i.fromName} <${i.fromEmail}>` : i.fromName
      return `[${i.id}] From: ${fromField} | Subject: ${i.subject} | ${i.visualSection}${flags ? ` ${flags}` : ''} | ${date}${i.snippet ? ` | "${i.snippet}"` : ''}`
    })
    .join('\n')
}
