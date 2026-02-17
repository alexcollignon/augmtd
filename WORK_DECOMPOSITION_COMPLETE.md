# Work Decomposition - Complete Structure

## Overview

Work decomposition now generates **complete, executable workflows** with inputs, steps, outputs, and skills. Everything needed for future execution engine is included.

---

## AI-Generated Workflow Structure

When a user describes work, the AI generates:

```json
{
  "deliverable_type": "report",
  "deliverable_description": "Q1 Sales Summary Report",
  "estimated_time": "2 hours",
  "deadline": "2024-03-31T17:00:00Z",

  "inputs": [
    {
      "id": "input_1",
      "name": "Q1 Sales Data",
      "type": "data_source",
      "description": "Sales database export for Q1 2024",
      "required": true,
      "examples": ["CSV from Salesforce", "Excel export from CRM"]
    }
  ],

  "steps": [
    {
      "number": 1,
      "action": "Pull Q1 sales data from database",
      "description": "Extract all sales records from Q1 2024",
      "inputs": ["input_1"],
      "outputs": ["output_1"],
      "estimatedTime": "15 minutes",
      "toolsNeeded": ["Salesforce", "Excel"],
      "skill": "data_pull",
      "status": "pending"
    },
    {
      "number": 2,
      "action": "Analyze sales trends and identify key metrics",
      "description": "Calculate growth rates, top products, regional performance",
      "inputs": ["output_1"],
      "outputs": ["output_2"],
      "estimatedTime": "30 minutes",
      "toolsNeeded": ["Excel", "Python"],
      "skill": "data_analyzer",
      "status": "pending"
    },
    {
      "number": 3,
      "action": "Create visualizations and charts",
      "description": "Generate bar charts, line graphs, and pivot tables",
      "inputs": ["output_2"],
      "outputs": ["output_3"],
      "estimatedTime": "20 minutes",
      "toolsNeeded": ["Excel"],
      "skill": "chart_generator",
      "status": "pending"
    },
    {
      "number": 4,
      "action": "Format and finalize report",
      "description": "Apply branding, add executive summary, format for presentation",
      "inputs": ["output_3"],
      "outputs": ["output_4"],
      "estimatedTime": "30 minutes",
      "toolsNeeded": ["Excel"],
      "skill": "excel_generator",
      "status": "pending"
    }
  ],

  "outputs": [
    {
      "id": "output_1",
      "name": "Raw Sales Data",
      "type": "data_export",
      "description": "Extracted Q1 sales records"
    },
    {
      "id": "output_2",
      "name": "Sales Analysis",
      "type": "summary",
      "description": "Analyzed metrics and insights"
    },
    {
      "id": "output_3",
      "name": "Charts and Visualizations",
      "type": "visualization",
      "description": "Generated charts and graphs"
    },
    {
      "id": "output_4",
      "name": "Q1 Sales Report",
      "type": "final_document",
      "description": "Complete Excel report with charts and insights",
      "deliverableType": "spreadsheet"
    }
  ]
}
```

---

## Work Page UI

Users see the complete workflow structure on `/work`:

### 1. Required Inputs Section (Blue)
- Name and description of each input
- Type: `data_source`, `document`, `context`, `approval`, `meeting_notes`, `user_input`
- Required vs optional indicator
- Example values to guide users

### 2. Execution Steps Section (Gray)
- Sequential numbered steps
- Action description
- Tools needed (Excel, Salesforce, etc.)
- Estimated time per step
- Skill required (which AI capability executes it)
- Drag-and-drop reordering
- Edit mode for modifications

### 3. Expected Outputs Section (Green)
- Name and description of each output
- Type: `draft`, `final_document`, `data_export`, `visualization`, `summary`, `decision`, `notification`
- Deliverable type (report, spreadsheet, etc.)

### 4. Workflow Actions
- **Save as Workflow** - Checkbox to save for reuse
- **Add to Inbox** - Create work item for execution

---

## Type System

### Input Types (`lib/types/inbox.ts`)

```typescript
interface WorkflowInput {
  id: string;
  name: string;
  type: 'data_source' | 'document' | 'context' | 'approval' | 'meeting_notes' | 'user_input';
  description: string;
  required: boolean;
  examples?: string[];
}
```

**Type Meanings:**
- `data_source` - Database, API endpoint, or data file
- `document` - Existing document or file
- `context` - Background information or details
- `approval` - Decision or approval needed
- `meeting_notes` - Notes from a meeting
- `user_input` - Manual input from user

### Output Types

```typescript
interface WorkflowOutput {
  id: string;
  name: string;
  type: 'draft' | 'final_document' | 'data_export' | 'visualization' | 'summary' | 'decision' | 'notification';
  description: string;
  deliverableType?: DeliverableType;
}
```

**Type Meanings:**
- `draft` - Draft version of document/email
- `final_document` - Finalized document
- `data_export` - Exported data (CSV, JSON, etc.)
- `visualization` - Chart, graph, dashboard
- `summary` - Summary or report
- `decision` - Decision record or approval
- `notification` - Email or message sent

### Step Types

```typescript
interface ExecutionStep {
  number: number;
  action: string;
  description?: string;
  inputs?: string[];        // Input IDs needed
  outputs?: string[];       // Output IDs produced
  estimatedTime?: string;
  toolsNeeded?: string[];   // Excel, Salesforce, etc.
  skill?: string;           // AI capability
  status: StepStatus;
}
```

---

## AI Skills Available

Skills that can be assigned to steps for future execution:

- `data_pull` - Retrieve data from databases/APIs
- `excel_generator` - Create Excel spreadsheets with formatting
- `powerpoint_generator` - Create PowerPoint presentations
- `word_generator` - Create Word documents
- `email_drafter` - Draft professional emails
- `data_analyzer` - Analyze data and generate insights
- `chart_generator` - Create visualizations and charts

---

## Database Schema

### user_workflows table
Stores reusable workflows that users save:

```sql
CREATE TABLE user_workflows (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,

  -- Complete workflow structure
  inputs JSONB DEFAULT '[]',      -- WorkflowInput[]
  steps JSONB NOT NULL,            -- ExecutionStep[]
  outputs JSONB DEFAULT '[]',      -- WorkflowOutput[]

  -- Metadata
  estimated_time TEXT,
  frequency TEXT,
  department TEXT,
  source_type TEXT,               -- 'template', 'user_created', 'ai_generated'
  template_id TEXT,

  -- Usage tracking
  usage_count INTEGER DEFAULT 0,
  last_used TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### workflow_executions table
Tracks each time a workflow is executed:

```sql
CREATE TABLE workflow_executions (
  id UUID PRIMARY KEY,
  workflow_id UUID REFERENCES user_workflows(id),
  user_id UUID REFERENCES auth.users(id),

  -- Execution data
  input_values JSONB DEFAULT '{}',  -- User-provided input values
  artifacts JSONB DEFAULT '{}',      -- Generated outputs/artifacts

  -- Status tracking
  status TEXT DEFAULT 'pending',    -- 'pending', 'in_progress', 'completed', 'failed'
  current_step INTEGER DEFAULT 1,

  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
```

---

## Why This Makes Execution Possible

### 1. **Inputs Define Requirements**
- AI knows exactly what data/context is needed BEFORE starting
- Users can provide input values when executing
- Validation of required inputs before execution

### 2. **Steps Define Execution Flow**
- Each step knows what it consumes (`inputs`) and produces (`outputs`)
- Clear dependency chain between steps
- Tools and skills needed are explicit
- Time estimates for scheduling/prioritization

### 3. **Outputs Define Success**
- Clear definition of what gets created
- Type system for artifact validation
- Linkage to steps that produce them

### 4. **Skills Enable Automation**
- Each step tagged with AI capability needed
- Future execution engine can route to appropriate skill
- Skills can be implemented as separate modules

---

## Current Implementation Status

### ✅ Complete
- AI generates inputs, steps, outputs with full metadata
- Work page displays all three sections
- Type system defined for inputs/outputs/steps
- Database tables for storing workflows and executions
- Workflow saving with "Save as workflow" checkbox
- Blueprint templates (without defaultSteps)

### ⏳ Not Built Yet
- Execution engine to actually run workflows
- Skill implementations (data_pull, excel_generator, etc.)
- Input collection UI when executing saved workflows
- Artifact generation and storage
- Progress tracking during execution
- Workflow library UI (intentionally excluded for now)

---

## File References

**Core Logic:**
- `lib/execution/work-decomposition.ts` - AI prompt and workflow generation
- `lib/types/inbox.ts` - WorkflowInput, WorkflowOutput, ExecutionStep types
- `lib/types/workflows.ts` - Complete Workflow type definitions
- `lib/types/work-blueprints.ts` - Blueprint templates (simplified)

**UI:**
- `app/work/work-page-client.tsx` - Work creation with inputs/outputs display
- `app/work/page.tsx` - Server component for work page

**Database:**
- `supabase/migrations/20260217_create_workflows_table.sql` - Schema for workflows and executions

**API:**
- `app/api/work/create/route.ts` - Work decomposition and workflow saving

---

## User Flow Example

**User:** "Create Q4 board presentation"

**AI Generates:**
1. **Inputs:**
   - Q4 metrics data (data_source, required)
   - Product updates (context, required)
   - Previous presentation template (document, optional)

2. **Steps:**
   - Pull Q4 data from analytics → `data_pull`
   - Analyze key metrics and trends → `data_analyzer`
   - Create charts and visualizations → `chart_generator`
   - Build presentation slides → `powerpoint_generator`

3. **Outputs:**
   - Q4 data export (data_export)
   - Analysis summary (summary)
   - Charts and graphs (visualization)
   - Board presentation (final_document - presentation)

**User can:**
- Review and edit steps
- Check "Save as workflow" to reuse
- Click "Add to Inbox" to create work item

---

## Next Steps for Execution Engine

When building the execution engine:

1. **Input Collection:**
   - UI to gather required input values from user
   - Validation of required fields
   - File upload for document inputs

2. **Step Execution:**
   - Router to dispatch steps to appropriate skills
   - Handle step dependencies (inputs/outputs)
   - Error handling and retries

3. **Skill Implementation:**
   - Build each skill module (data_pull, excel_generator, etc.)
   - Standard interface for skills
   - Artifact storage and retrieval

4. **Progress Tracking:**
   - Real-time status updates
   - Step completion tracking
   - Artifact availability notification

5. **Artifact Management:**
   - Storage for generated files
   - Preview/download functionality
   - Version control for iterations
