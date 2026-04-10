import { SupabaseClient } from '@supabase/supabase-js'
import { getAIClient, aiCreate } from '@/lib/ai/factory'

export type IntentClass = 'conversational' | 'search' | 'document'
export type SourceHint = 'kb' | 'email' | 'calendar'

export interface ClassifiedIntent {
  intent: IntentClass
  sources: SourceHint[]
  /** Computed locally — not from AI. false = no named subject detected → ask before searching */
  specific: boolean
}

const FALLBACK: ClassifiedIntent = { intent: 'document', sources: ['kb', 'email', 'calendar'], specific: true }

const CLASSIFIER_SYSTEM = `You classify messages for an AI work assistant. Return ONLY a JSON object — no explanation, no markdown.

Shape: {"intent":"conversational","sources":[]}

intent values:
- "conversational" — answerable from context already available (the user's name/role, what was just discussed, general knowledge, casual chat). No files, emails, document creation needed.
- "search" — user wants to look something up from their files, emails, or calendar. No document creation.
- "document" — user wants to create, write, draft, or generate any document (report, email, spreadsheet, presentation, memo, proposal, summary, analysis, etc.)

sources (include for search/document, always empty [] for conversational):
- "kb" — knowledge base / Drive / indexed files
- "email" — inbox / emails
- "calendar" — meetings / schedule

Examples:
"what's my name" → {"intent":"conversational","sources":[]}
"how are you" → {"intent":"conversational","sources":[]}
"what did we just discuss" → {"intent":"conversational","sources":[]}
"today's date" → {"intent":"conversational","sources":[]}
"create a pricing summary for the AI Readiness Hub" → {"intent":"document","sources":["kb"]}
"draft an email to John about the Q2 proposal" → {"intent":"document","sources":["email"]}
"write a presentation for tomorrow's board meeting" → {"intent":"document","sources":["kb","calendar"]}
"make a budget spreadsheet for the Q3 campaign" → {"intent":"document","sources":["kb"]}
"write a follow-up for the Acme proposal" → {"intent":"document","sources":["email"]}
"i need to create a pricing document" → {"intent":"document","sources":["kb"]}
"write a follow-up email" → {"intent":"document","sources":["email"]}
"draft a report" → {"intent":"document","sources":["kb"]}
"do I have any emails about the Q2 proposal" → {"intent":"search","sources":["email"]}
"what's in my knowledge base about pricing" → {"intent":"search","sources":["kb"]}
"when is my next meeting" → {"intent":"search","sources":["calendar"]}
"summarise my recent emails" → {"intent":"search","sources":["email"]}
"what am I working on" → {"intent":"search","sources":["email","calendar"]}
"what's urgent" → {"intent":"search","sources":["email"]}`

export async function classifyIntent(
  message: string,
  history: Array<{ role: string; content: string }>,
  userId: string,
  supabase: SupabaseClient
): Promise<ClassifiedIntent> {
  // Hard bypass: clarification confirmed always generates a document
  if (message.startsWith('[CLARIFICATION CONFIRMED]')) {
    return { intent: 'document', sources: [], specific: true }
  }

  try {
    const { client, model } = await getAIClient(userId, 'planning', supabase)

    // Last 4 history entries (2 turns) give enough context for follow-up detection
    const recentHistory = history.slice(-4)
    const historySnippet = recentHistory.length > 0
      ? recentHistory.map(m => `${m.role}: ${(m.content || '').slice(0, 120)}`).join('\n')
      : ''

    const userContent = historySnippet
      ? `Recent context:\n${historySnippet}\n\nClassify: "${message.slice(0, 300)}"`
      : `Classify: "${message.slice(0, 300)}"`

    const res = await aiCreate(client, {
      model,
      max_tokens: 60,
      temperature: 0,
      messages: [
        { role: 'system', content: CLASSIFIER_SYSTEM },
        { role: 'user', content: userContent },
      ],
    })

    const raw = (res.choices[0]?.message?.content ?? '').trim()
    // Extract JSON — model may wrap it in ```json blocks or add extra text
    const jsonMatch = raw.match(/\{[^}]+\}/)
    if (!jsonMatch) return FALLBACK

    const parsed = JSON.parse(jsonMatch[0])
    const intent: IntentClass = (['conversational', 'search', 'document'] as const).includes(parsed.intent)
      ? parsed.intent as IntentClass
      : FALLBACK.intent

    const sources: SourceHint[] = Array.isArray(parsed.sources)
      ? (parsed.sources as string[]).filter((s): s is SourceHint => ['kb', 'email', 'calendar'].includes(s))
      : FALLBACK.sources

    // specific is computed locally in the route — not trusted from AI
    return { intent, sources, specific: true }
  } catch {
    return FALLBACK
  }
}
