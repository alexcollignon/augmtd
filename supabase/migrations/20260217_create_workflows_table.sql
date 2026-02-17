-- Create user_workflows table for storing reusable workflows
CREATE TABLE user_workflows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Basic info
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL, -- 'reporting', 'planning', 'communication', etc.

  -- Workflow structure (stored as JSONB)
  inputs JSONB DEFAULT '[]', -- Array of WorkflowInput objects
  steps JSONB NOT NULL,      -- Array of WorkflowStep objects
  outputs JSONB DEFAULT '[]', -- Array of WorkflowOutput objects

  -- Metadata
  estimated_time TEXT,
  frequency TEXT,
  department TEXT,

  -- Source tracking
  source_type TEXT NOT NULL DEFAULT 'user_created', -- 'template', 'user_created', 'ai_generated'
  template_id TEXT, -- Reference to blueprint ID if derived from template

  -- Usage tracking
  usage_count INTEGER DEFAULT 0,
  last_used TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create workflow_executions table for tracking workflow runs
CREATE TABLE workflow_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id UUID REFERENCES user_workflows(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Input values provided for this execution
  input_values JSONB DEFAULT '{}',

  -- Execution state
  status TEXT DEFAULT 'pending', -- 'pending', 'in_progress', 'completed', 'failed'
  current_step INTEGER DEFAULT 1,

  -- Results
  artifacts JSONB DEFAULT '{}', -- output_id -> artifact data

  -- Timestamps
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  CONSTRAINT valid_status CHECK (status IN ('pending', 'in_progress', 'completed', 'failed'))
);

-- Indexes for performance
CREATE INDEX idx_user_workflows_user ON user_workflows(user_id);
CREATE INDEX idx_user_workflows_category ON user_workflows(category);
CREATE INDEX idx_user_workflows_department ON user_workflows(department);
CREATE INDEX idx_user_workflows_source_type ON user_workflows(source_type);

CREATE INDEX idx_workflow_executions_workflow ON workflow_executions(workflow_id);
CREATE INDEX idx_workflow_executions_user ON workflow_executions(user_id);
CREATE INDEX idx_workflow_executions_status ON workflow_executions(status);

-- RLS Policies
ALTER TABLE user_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_executions ENABLE ROW LEVEL SECURITY;

-- Users can view their own workflows
CREATE POLICY "Users can view own workflows"
  ON user_workflows FOR SELECT
  USING (auth.uid() = user_id);

-- Users can create workflows
CREATE POLICY "Users can create workflows"
  ON user_workflows FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own workflows
CREATE POLICY "Users can update own workflows"
  ON user_workflows FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own workflows
CREATE POLICY "Users can delete own workflows"
  ON user_workflows FOR DELETE
  USING (auth.uid() = user_id);

-- Users can view their own workflow executions
CREATE POLICY "Users can view own executions"
  ON workflow_executions FOR SELECT
  USING (auth.uid() = user_id);

-- Users can create workflow executions
CREATE POLICY "Users can create executions"
  ON workflow_executions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own executions
CREATE POLICY "Users can update own executions"
  ON workflow_executions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER update_user_workflows_updated_at
  BEFORE UPDATE ON user_workflows
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE user_workflows IS 'User-created and saved workflows with inputs, steps, and outputs';
COMMENT ON TABLE workflow_executions IS 'Instances of workflow executions with input values and results';
COMMENT ON COLUMN user_workflows.inputs IS 'Array of input requirements (data sources, documents, context needed)';
COMMENT ON COLUMN user_workflows.steps IS 'Ordered array of workflow steps with actions and dependencies';
COMMENT ON COLUMN user_workflows.outputs IS 'Array of outputs/artifacts produced by the workflow';
COMMENT ON COLUMN user_workflows.source_type IS 'Origin of workflow: template (from library), user_created (manual), or ai_generated';
COMMENT ON COLUMN workflow_executions.input_values IS 'User-provided values for workflow inputs (JSON object)';
COMMENT ON COLUMN workflow_executions.artifacts IS 'Generated artifacts/outputs from workflow execution (JSON object)';
