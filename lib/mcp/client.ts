import { MCPServer, MCPTool, MCPToolResult, MCPCredentials } from './types'
import { generatorsServer } from './servers/generators'

// Inbox actions (Gmail, Outlook, Drive, OneDrive) use direct API routes — not MCP dispatch.
// MCP is for AI-planned workflow steps. Future third-party integrations will be added here.
// Knowledge Base is a context source (lib/context-sources/), not an MCP action server.
const LOCAL_SERVERS: Record<string, MCPServer> = {
  generators: generatorsServer,
}

/**
 * Route a tool invocation to the appropriate local server module.
 * toolId format: '<serverId>__<toolName>' (e.g. 'gmail__send_reply')
 */
export async function invokeTool(
  toolId: string,
  params: Record<string, unknown>,
  credentials: MCPCredentials
): Promise<MCPToolResult> {
  const [serverId] = toolId.split('__')
  const server = LOCAL_SERVERS[serverId]
  if (!server) return { success: false, error: `Unknown MCP server: ${serverId}` }
  return server.invoke(toolId, params, credentials)
}

/**
 * List all tools available from the given set of server IDs.
 */
export function listToolsForServers(serverIds: string[]): MCPTool[] {
  return serverIds.flatMap((id) => LOCAL_SERVERS[id]?.listTools() ?? [])
}
