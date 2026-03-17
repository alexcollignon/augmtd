import { MCPServer, MCPTool, MCPToolResult, MCPCredentials } from '../types'

const TOOLS: MCPTool[] = [
  {
    id: 'generators__grant_proposal',
    name: 'Grant Proposal Generator',
    description: `Grant proposals and funding applications. Use for: Horizon Europe, ERC, MSCA, FCT, EIT, DFG, ANR, private foundations, or any call for proposals.
Use whenever a user uploads or pastes a call for proposals and asks to write, draft, structure, or develop a grant proposal, funding application, research bid, or project submission.
Triggers: "help me apply for this grant", "turn this call into a proposal", "draft a proposal based on this CFP", "write a funding application", "help me respond to this call".
Works with PDF, Word, or pasted text of the call. Always use this over generators__word when grant/funding context is present.
Action text: describe the funder and call reference if identifiable, and any specific focus areas the user has mentioned.
Examples:
  User uploads a Horizon Europe call: "Write a grant proposal for ERC-2025-StG call on urban climate resilience"
  User pastes FCT call text: "Draft a funding application for FCT research grant on machine learning for diagnostics"
Recommended plan structure — always use 4-5 intermediate steps before this generator step:
  Step 1 — Extract all call requirements: funder identity, call ID, deadline, page limits, eligible entities, mandatory sections, evaluation criteria and weightings, KPI targets, budget ceiling
  Step 2 — Identify the funder template and map requirements to the correct structural pattern (Horizon Part B, ERC synopsis, EIT Knowledge Triangle, FCT, private foundation)
  Step 3 — Build a section-by-section outline with key arguments, content bullets, and evaluation criterion mapping for each mandatory section
  Step 4 — Draft substantive content for each section using the outline and source material, with specific data, methodology justification, and impact narrative
  Step 5 — this generator tool (final assembly into formatted proposal)
Do NOT collapse steps 1-4 into a single analysis step. Each step builds context the next step depends on. A 2-step plan (1 analysis + generator) produces a generic template, not a real proposal.`,
    params: [
      { name: 'action', type: 'string', description: 'Funder, call reference, and proposal focus', required: true },
    ],
    requires_approval: false,
  },
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
        skillGeneration: params.skillGeneration as string | undefined,
        pageSize: params.pageSize as 'letter' | 'a4' | undefined,
        maxGenerationTokens: params.maxGenerationTokens as number | undefined,
        maxStepOutputsChars: params.maxStepOutputsChars as number | undefined,
        maxJsonChars: params.maxJsonChars as number | undefined,
        requirementsContext: params.requirementsContext as string | undefined,
        skillReview: params.skillReview as string | undefined,
      })
      return { success: true, data: artifact }
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) }
    }
  },
}
