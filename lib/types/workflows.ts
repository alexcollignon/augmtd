/**
 * Workflow Types
 *
 * Proper workflow structure with inputs, outputs, and artifacts
 * for execution and reusability
 */

export type WorkflowCategory =
  | 'reporting'
  | 'planning'
  | 'communication'
  | 'analysis'
  | 'review'
  | 'coordination'
  | 'operations'
  | 'custom';

export type DeliverableType =
  | 'report'
  | 'presentation'
  | 'document'
  | 'email'
  | 'analysis'
  | 'spreadsheet'
  | 'dashboard'
  | 'plan';

export type InputType =
  | 'data_source'      // Database, API, file
  | 'document'         // Existing document/file
  | 'context'          // Information/details needed
  | 'approval'         // Approval or decision needed
  | 'meeting_notes'    // Notes from a meeting
  | 'user_input';      // Manual input required

export type ArtifactType =
  | 'draft'            // Draft document/email
  | 'final_document'   // Final version
  | 'data_export'      // Exported data
  | 'visualization'    // Chart, graph, dashboard
  | 'summary'          // Summary or report
  | 'decision'         // Decision or approval
  | 'notification';    // Email or message sent

/**
 * Input required for workflow execution
 */
export interface WorkflowInput {
  id: string;
  name: string;
  type: InputType;
  description: string;
  required: boolean;
  examples?: string[];  // Example values to guide user
}

/**
 * Output/artifact produced by workflow
 */
export interface WorkflowOutput {
  id: string;
  name: string;
  type: ArtifactType;
  description: string;
  deliverableType?: DeliverableType;
}

/**
 * Individual step in workflow
 */
export interface WorkflowStep {
  number: number;
  action: string;
  description?: string;
  inputs?: string[];     // IDs of inputs needed for this step
  outputs?: string[];    // IDs of outputs produced by this step
  estimatedTime?: string; // e.g., "15 minutes"
  toolsNeeded?: string[]; // Tools/systems required
  notes?: string;
}

/**
 * Complete workflow definition
 */
export interface Workflow {
  id: string;
  userId?: string;        // null for template workflows

  // Basic info
  name: string;
  description: string;
  category: WorkflowCategory;

  // Workflow structure
  inputs: WorkflowInput[];
  steps: WorkflowStep[];
  outputs: WorkflowOutput[];

  // Metadata
  estimatedTime?: string;
  frequency?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'ad-hoc';
  department?: string;

  // Source tracking
  sourceType: 'template' | 'user_created' | 'ai_generated';
  templateId?: string;    // If derived from a template

  // Timestamps
  createdAt: string;
  updatedAt: string;

  // Usage tracking
  usageCount?: number;
  lastUsed?: string;
}

/**
 * Data sent to AI for workflow generation
 */
export interface WorkflowGenerationRequest {
  description: string;
  userContext?: {
    role?: string;
    department?: string;
    responsibilities?: string[];
  };
  deadline?: string;
  templateId?: string;  // If starting from a template
}

/**
 * Workflow execution instance
 */
export interface WorkflowExecution {
  id: string;
  workflowId: string;
  userId: string;

  // Input values provided
  inputValues: Record<string, any>; // input_id -> value

  // Execution state
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  currentStep: number;

  // Results
  artifacts: Record<string, any>; // output_id -> artifact data

  // Timestamps
  startedAt: string;
  completedAt?: string;
}
