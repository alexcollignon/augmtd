import { MCPServer, MCPTool, MCPToolResult, MCPCredentials } from '../types'

const TOOLS: MCPTool[] = [
  {
    id: 'generators__word',
    name: 'Word Document Generator',
    description: `Writing and drafting. Use for: reports, memos, summaries, analysis narratives, proposals, contracts, briefs, meeting recaps.
Action text: describe what the document should cover and the angle — key sections, level of detail, intended reader. Be specific about what findings or insights to highlight.
Examples:
  User wants expense analysis: "Write an executive summary covering total spend, top vendors by amount, month-over-month trend, and any anomalies worth flagging to management"
  User wants contract review: "Write a risk analysis memo covering key obligations for each party, payment terms, termination clauses, and recommended actions before signing"
Always derive the action from the user's goal — do not write a generic description like "write a document about the data"`,
    params: [
      { name: 'action', type: 'string', description: 'Concrete description of what to write', required: true },
      { name: 'deliverable_type', type: 'string', description: 'report | document | analysis', required: false },
    ],
    requires_approval: false,
  },
  {
    id: 'generators__xlsx',
    name: 'Excel Spreadsheet Generator',
    description: `Structured data and calculations. Use for: tables, trackers, budgets, schedules, data organisation, financial models.
Action text: describe the structure precisely — what each row represents, column names, any groupings or totals needed.
Examples:
  User wants invoice tracker: "Create a tracker with columns: Vendor, Invoice Number, Date, Amount, Currency, Expense Category — one row per invoice, sorted by date"
  User wants budget overview: "Build a monthly budget sheet with columns: Category, Budgeted Amount, Actual Amount, Variance — one row per category, totals row at the bottom"
Always derive the action from the user's goal — do not write a generic description like "create a spreadsheet"`,
    params: [
      { name: 'action', type: 'string', description: 'Concrete description of what to build', required: true },
    ],
    requires_approval: false,
  },
  {
    id: 'generators__pptx',
    name: 'PowerPoint Presentation Generator',
    description: `Slide content. Use for: presentations, decks, board updates, visual summaries.
Action text: describe the narrative arc and key messages — what story the deck tells, the intended audience, how many slides and what each covers.
Examples:
  User wants expense deck: "Build a 6-slide deck for finance review: title, total spend overview, top vendors, month-over-month trend, anomalies flagged, and recommended actions"
  User wants project update: "Create a 5-slide stakeholder update: project status, milestones achieved, risks, next steps, and asks from leadership"
Always derive the action from the user's goal — do not write a generic description like "create a presentation"`,
    params: [
      { name: 'action', type: 'string', description: 'Concrete description of the deck structure and narrative', required: true },
    ],
    requires_approval: false,
  },
  {
    id: 'generators__email_draft',
    name: 'Email Drafter',
    description: `Email composition. Use for: replies, outreach, follow-ups, announcements, client communications.
Action text: describe the tone, key message, and desired action — what the email needs to accomplish and any specific points to include or avoid.
Options: when recipient and subject can be inferred from context (email thread, conversation, attachment content), populate { "to": "email@example.com", "subject": "Re: Invoice #1234" }. Leave empty if unknown — the user fills in before sending.
Examples:
  User wants invoice follow-up: "Draft a polite but firm payment reminder: reference the specific invoice number and due date, ask for an ETA, keep tone professional and non-confrontational"
  User wants project update email: "Write a concise project status email to the client: highlight milestone reached, flag one open item needing their input, set expectation for next check-in"
Always derive the action from the user's goal — do not write a generic description like "draft an email"`,
    params: [
      { name: 'action', type: 'string', description: 'What the email should accomplish', required: true },
      { name: 'to', type: 'string', description: 'Recipient email address if known', required: false },
      { name: 'subject', type: 'string', description: 'Email subject if known', required: false },
    ],
    requires_approval: false,
  },
]

export const generatorsServer: MCPServer = {
  id: 'generators',

  listTools(): MCPTool[] {
    return TOOLS
  },

  async invoke(toolId: string, params: Record<string, unknown>, _credentials: MCPCredentials): Promise<MCPToolResult> {
    const tool = TOOLS.find((t) => t.id === toolId)
    if (!tool) return { success: false, error: `Unknown tool: ${toolId}` }

    try {
      // Dynamic import breaks the circular dependency:
      // generate-pipeline → mcp/client → generators → generate-pipeline
      const { assembleArtifactFromSteps } = await import('@/lib/work/generate-pipeline')
      const artifact = await assembleArtifactFromSteps({
        userId: params.userId as string,
        threadId: params.threadId as string,
        type: params.type as import('@/lib/types/inbox').DeliverableType,
        plan: params.plan,
        stepOutputs: params.stepOutputs as import('@/lib/work/generate-pipeline').StepOutput[],
        attachmentContext: params.attachmentContext as string,
        conversationContext: params.conversationContext as string,
        userContext: params.userContext as string,
        adminClient: params.adminClient as import('@supabase/supabase-js').SupabaseClient,
        stepAction: params.stepAction as string | undefined,
      })
      return { success: true, data: artifact }
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) }
    }
  },
}
