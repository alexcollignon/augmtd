export type ProcessStatus = 'draft' | 'active' | 'completed' | 'archived';
export type ProcessStepStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'skipped';
export type StepType = 'human' | 'generator';
export type HumanInputType = 'text' | 'approval' | 'file' | 'number' | 'range';

// Stored in processes.plan JSONB (AI-generated)
export interface ProcessPlanStep {
  step_index: number;
  title: string;
  description?: string;
  step_type: StepType;
  // Human steps
  input_type?: HumanInputType;
  input_label?: string;
  cta_label?: string;
  // Generator steps
  tool?: string;
  tool_parameters?: Record<string, unknown>;
  // Assignment
  assignee_id?: string;
  department?: string;
  estimated_days?: number;
}

export interface ProcessPlan {
  description: string;
  steps: ProcessPlanStep[];
  estimated_total_days?: number;
  expected_outcomes?: { type: 'risk' | 'suggestion'; text: string }[];
}

// DB rows
export interface Process {
  id: string;
  company_id: string;
  owner_id: string;
  title: string;
  description?: string;
  status: ProcessStatus;
  plan: ProcessPlan | null;
  current_step: number;
  due_date?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
  files?: Array<{
    filename: string;
    content_base64: string;
    mime_type: string;
    size_bytes: number;
    uploaded_at: string;
  }>;
}

export interface ProcessStepRecord {
  id: string;
  process_id: string;
  step_index: number;
  title: string;
  description?: string;
  step_type: StepType;
  assignee_id?: string;
  department?: string;
  status: ProcessStepStatus;
  input_type?: HumanInputType;
  input_label?: string;
  cta_label?: string;
  input_data?: unknown;
  artifact?: unknown;
  tool?: string;
  estimated_days?: number;
  due_date?: string;
  started_at?: string;
  completed_at?: string;
  completed_by?: string;
  created_at: string;
  updated_at: string;
}

export interface ProcessComment {
  id: string;
  process_id: string;
  step_index?: number;
  user_id: string;
  content: string;
  created_at: string;
  full_name?: string;
}

// For the list page
export interface ProcessListItem {
  id: string;
  title: string;
  status: ProcessStatus;
  current_step: number;
  total_steps: number;
  owner_id: string;
  owner_name?: string;
  due_date?: string;
  on_desk_of_me: boolean;
  current_step_title?: string;
  current_step_assignee_name?: string;
  created_at: string;
  updated_at: string;
}

// Detail view
export interface ProcessDetail extends Process {
  steps: ProcessStepRecord[];
  comments: ProcessComment[];
  owner_name?: string;
}
