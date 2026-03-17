/**
 * Inbox Item Types
 *
 * Supporting the new UX with:
 * - Visual sections (Prepared / Suggested / Awareness)
 * - User confirmations
 * - Learning signals
 */

export type VisualSection = 'prepared' | 'suggested' | 'awareness'; // @deprecated

export type ItemType = 'reply' | 'decision' | 'meeting' | 'review' | 'fyi' | 'notification';

/** Item types shown in Smart view (require action from user) */
export const SMART_VIEW_TYPES: ItemType[] = ['reply', 'decision', 'meeting', 'review'];

/** Is this item shown in Smart view? */
export function isActionItem(item: InboxItem): boolean {
  return item.item_type != null && SMART_VIEW_TYPES.includes(item.item_type as ItemType);
}

export type ConfirmationStatus = 'pending' | 'confirmed' | 'rejected';

export type ConfirmationAction = 'confirm_as_mine' | 'not_my_task';

export type ExecutionStatus = 'queued' | 'preparing' | 'ready' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';

export type DeliverableType = 'report' | 'presentation' | 'document' | 'email' | 'analysis' | 'spreadsheet';

export type ArtifactType = 'excel' | 'powerpoint' | 'word' | 'pdf' | 'email_draft';

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface UserConfirmation {
  status: ConfirmationStatus | null;
  confirmedAt?: string; // ISO timestamp
  confirmedAction?: ConfirmationAction;
  previousSuggestionLevel?: string; // For learning: what was suggested before confirmation
  notes?: string; // Optional user notes
}

export interface WorkflowInput {
  id: string;
  name: string;
  type: 'file' | 'data_source' | 'document' | 'context' | 'approval' | 'meeting_notes' | 'user_input';
  description: string;
  required: boolean;
  examples?: string[];
  status?: 'provided' | 'pending';
  // Derived source type — never set by AI, always assigned server-side
  source_type?: 'provided' | 'kb_found' | 'user_upload';
  providedFilename?: string;
  providedFilenames?: string[]; // multiple files on one input (e.g. all email attachments grouped)
  fromKB?: true;    // accepted KB file (named input or global) — used by generation pipeline
  fromContext?: true; // manual KB search addition → goes to "additional context" section
  kbFileId?: string; // knowledge_files.id (UUID)
  kbSuggestions?: { fileId: string; filename: string }[]; // pending KB suggestions for this input slot
  kbAccepted?: { fileId: string; filename: string }[];   // accepted KB files not yet confirmed
  dismissedKbFileIds?: string[]; // fileIds user dismissed — KB enrichment won't re-suggest these
}

export interface WorkflowOutput {
  id: string;
  name: string;
  type: 'draft' | 'final_document' | 'data_export' | 'visualization' | 'summary' | 'decision' | 'notification';
  description: string;
  deliverableType?: DeliverableType;
}

export interface ExecutionStep {
  number: number;
  action: string; // Human-readable description of what this step does
  description?: string; // More detailed explanation
  inputs?: string[]; // IDs of inputs needed for this step
  outputs?: string[]; // IDs of outputs produced by this step
  estimatedTime?: string; // Per-step time estimate
  toolsNeeded?: string[]; // Tools/systems required
  skill?: string; // Legacy — backward compat with existing plans
  tool?: string; // MCP tool ID e.g. 'generators__word', 'gmail__send_reply'
  tool_parameters?: Record<string, unknown>; // Tool-specific parameters set by planning AI
  requires_approval?: boolean; // Pause execution at this step and wait for user confirmation
  approval_message?: string; // Plain-language description: "About to send reply to john@client.com"
  options?: Record<string, unknown>; // Skill-specific configuration populated by planning AI
  status: StepStatus;
  error?: string; // Error message if step failed
  started_at?: string;
  completed_at?: string;
}

export interface ExecutionPlan {
  deliverable_type: DeliverableType;
  deliverable_types?: DeliverableType[]; // Optional: multiple output formats to generate simultaneously
  deliverable_description: string; // What will be created (e.g., "Q1 Revenue Excel report with charts")
  deadline?: string; // ISO timestamp if there's a deadline
  estimated_time?: string; // Human-readable estimate (e.g., "5 minutes")
  inputs?: WorkflowInput[]; // What's needed to execute this workflow
  outputs?: WorkflowOutput[]; // What gets produced
  steps: ExecutionStep[];
}

/**
 * Slim seed stored on inbox items for executable work.
 * Contains just enough to show in the detail panel and seed the workflow chat.
 * The full plan is generated live by the workflow AI when the user opens it.
 */
export interface WorkflowSeed {
  deliverable_type: DeliverableType;
  deliverable_description: string;
  deadline?: string; // ISO timestamp if mentioned in the email
  workflow_prompt: string; // Natural language description that becomes the first user message
}

export interface Artifact {
  type: ArtifactType;
  name: string; // File name (e.g., "Q1_Revenue_Report.xlsx")
  url: string; // Storage URL or path
  size: number; // File size in bytes
  created_at: string; // ISO timestamp
  preview_url?: string; // Optional preview/thumbnail URL
}

export interface DocSection {
  heading: string;
  level: 1 | 2;
  paragraphs: string[];
}

export interface DocContent {
  title: string;
  subtitle?: string;
  sections: DocSection[];
}

export interface PptxSlide {
  title: string;
  layout: 'title' | 'content';
  bullets?: string[];
  notes?: string;
}
export interface PptxContent {
  title: string;
  subtitle?: string;
  slides: PptxSlide[];
}

export interface XlsxSheet {
  name: string;
  headers: string[];
  rows: (string | number | null)[][];
  summary?: string;
}
export interface XlsxContent {
  title: string;
  sheets: XlsxSheet[];
}

export interface EmailContent {
  to: string;       // empty string if unknown
  cc?: string;
  subject: string;
  body: string;     // plain prose, \n\n for paragraph breaks
}

export type ArtifactContent = DocContent | PptxContent | XlsxContent | EmailContent;

export type QAIssueType = 'missing_section' | 'fabricated_data' | 'structural' | 'requirement_gap' | 'other';
export type QASeverity = 'error' | 'warning';

export interface QAIssue {
  section?: string;
  type: QAIssueType;
  description: string;
  severity: QASeverity;
}

export interface QAReport {
  issues: QAIssue[];
  score: number;    // 0–100; deduct 20 per error, 5 per warning
  summary: string;  // 1–2 sentence plain-language verdict
}

export interface DocumentArtifact {
  id?: string; // UUID generated at creation time; optional for backward compat with legacy artifacts
  title: string;
  type: DeliverableType;
  generated_at: string; // ISO timestamp
  storage_path?: string; // Path within work-artifacts bucket: "{userId}/{threadId}/{artifactId}.ext" (new) or "{userId}/{threadId}.ext" (legacy). Absent for email artifacts.
  content?: ArtifactContent; // Full document content for in-panel preview
  source_data?: unknown; // Raw source material from automated skills (e.g. InvoiceData[]) — used as context in Ask/Edit
  sent_at?: string; // ISO timestamp set when this email artifact was sent
  sent_to?: string; // Recipient address(es) at send time
  qa_report?: QAReport; // Post-generation QA review — present when skill has skillReview brief
}

export interface InboxItem {
  id: string;
  user_id: string;
  source: string;
  source_id: string;

  // Work-state model
  work_state: string;
  work_title: string;
  what_i_prepared: string | null;
  why_matters: string | null;

  // Semantic type for Smart view filtering and display
  item_type: ItemType | null;

  // @deprecated — kept for DB compat, no longer written
  visual_section: VisualSection | null;

  // @deprecated — kept for DB compat, no longer written
  user_confirmation: UserConfirmation | null;

  // Recipient context
  recipient_context: {
    detectedRole: string;
    position: string;
    wasExplicitlyMentioned: boolean;
    workSignals: any;
    inferredWorkState: string;
    responsibilityConfidence: number;
    confidenceBreakdown: any;
    reasoning: string;
    otherRecipients: string[];
    senderEmail: string;
    senderRelationship: string;
    // NEW: Suggestion level
    suggestionLevel?: string;
    suggestionLabel?: string;
  } | null;

  // Source data
  source_data: any;

  // Execution fields (for AI-executable work)
  is_executable?: boolean;
  execution_plan?: WorkflowSeed;
  execution_status?: ExecutionStatus;
  current_step?: number;
  artifacts?: Artifact[];

  // Legacy fields
  ai_suggestion_type: string | null;
  ai_suggestion_content: string | null;
  ai_suggestion_reasoning: string | null;
  confidence_score: number | null;
  priority: number;
  status: string;
  needs_review: boolean;

  // Linked work thread (set when user opens item in Workflows)
  work_thread_id?: string | null;

  // Timestamps
  created_at: string;
  updated_at: string;
}

/**
 * Helper: Determine visual section from suggestion level
 */
export function getVisualSection(suggestionLevel: string): VisualSection {
  switch (suggestionLevel) {
    case 'assigned':
      return 'prepared';
    case 'suggested':
      return 'suggested';
    case 'review':
    case 'fyi':
      return 'awareness';
    default:
      return 'awareness';
  }
}

/**
 * Helper: Get section display name
 */
export function getSectionDisplayName(section: VisualSection): string {
  const names: Record<VisualSection, string> = {
    prepared: 'Prepared Work',
    suggested: 'Suggested for You',
    awareness: 'For Your Awareness',
  };
  return names[section];
}

/**
 * Helper: Check if item needs user confirmation
 */
export function needsConfirmation(item: InboxItem): boolean {
  return (
    item.visual_section === 'suggested' &&
    (!item.user_confirmation || item.user_confirmation.status === 'pending')
  );
}

/**
 * Helper: Check if item was confirmed by user
 */
export function isUserConfirmed(item: InboxItem): boolean {
  return item.user_confirmation?.status === 'confirmed';
}

/**
 * Helper: Check if item was rejected by user
 */
export function isUserRejected(item: InboxItem): boolean {
  return item.user_confirmation?.status === 'rejected';
}

/**
 * Helper: Check if item is executable work (has execution plan)
 */
export function isExecutable(item: InboxItem): boolean {
  return item.is_executable === true && !!item.execution_plan;
}

/**
 * Helper: Check if execution is in progress
 */
export function isExecutionInProgress(item: InboxItem): boolean {
  return item.execution_status === 'running';
}

/**
 * Helper: Check if execution is awaiting user approval
 */
export function isAwaitingApproval(item: InboxItem): boolean {
  return item.execution_status === 'awaiting_approval';
}

/**
 * Helper: Check if execution is completed
 */
export function isExecutionCompleted(item: InboxItem): boolean {
  return item.execution_status === 'completed';
}

/**
 * Helper: Get execution progress percentage
 * @deprecated Steps are no longer stored on inbox items — progress lives on work_threads.
 */
export function getExecutionProgress(_item: InboxItem): number {
  return 0;
}
