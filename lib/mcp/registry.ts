import { SupabaseClient } from '@supabase/supabase-js'
import { MCPTool } from './types'
import { listToolsForServers } from './client'

/**
 * Build the tool registry for a given user based on their active connections.
 * Called at plan time (messages route) and generation time (generate route).
 */
export async function buildToolRegistry(userId: string, supabase: SupabaseClient): Promise<MCPTool[]> {
  const serverIds = ['generators']

  const { data: connections } = await supabase
    .from('connections')
    .select('provider')
    .eq('user_id', userId)
    .eq('status', 'active')

  for (const conn of connections ?? []) {
    if (conn.provider === 'gmail') serverIds.push('gmail')
    if (conn.provider === 'outlook') serverIds.push('outlook')
  }

  // Drive/OneDrive available when corresponding email connection is active
  if (serverIds.includes('gmail')) serverIds.push('google_drive')
  if (serverIds.includes('outlook')) serverIds.push('onedrive')

  return listToolsForServers(serverIds)
}

/**
 * Format the tool registry for injection into the planning AI system prompt.
 * Generator tools get their full multi-line description; other tools get a one-liner.
 */
export function formatRegistryForPrompt(tools: MCPTool[]): string {
  return tools
    .map((t) => {
      const approval = t.requires_approval ? ' [requires user approval]' : ''
      return `- **${t.id}**${approval}: ${t.description}`
    })
    .join('\n\n')
}
