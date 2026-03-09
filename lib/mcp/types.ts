export interface MCPToolParam {
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  description: string
  required: boolean
}

export interface MCPTool {
  id: string                         // e.g. 'generators__word', 'gmail__send_reply'
  name: string                       // human-readable
  description: string                // when/how to use this tool
  params: MCPToolParam[]
  requires_approval: boolean         // true for write/send/irreversible actions
  approval_message_template?: string // e.g. 'About to send reply to {to}'
}

export interface MCPToolResult {
  success: boolean
  data?: unknown
  error?: string
}

export interface MCPCredentials {
  encryptedTokens?: string
  apiKey?: string
}

export interface MCPServer {
  id: string
  listTools(): MCPTool[]
  invoke(toolId: string, params: Record<string, unknown>, credentials: MCPCredentials): Promise<MCPToolResult>
}
