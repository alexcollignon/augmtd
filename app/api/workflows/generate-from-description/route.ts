import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateWorkflowConfig } from '@/lib/workflows/generate-config';

// 300s: since the entity edge, generation assembles room grounding + the existing-tasks read
// before the model call — 30s starved real accounts (found live: a silent 504 read as
// "Draft it does nothing"), and 60s starved them again when a pilot pasted a ~450-word
// OPERATING RUBRIC into the door (the authoring call reads it, derives the machine around it and
// may take a judged shape read first). The house budget class for long-running authored work is
// 300 (the Hetzner callbacks; execute/route.ts runs 800 on Pro + Fluid) — a draft the user is
// watching a spinner for must be allowed to finish rather than die silently at a minute.
export const maxDuration = 300;

// POST /api/workflows/generate-from-description
// Accepts a plain-language description, returns a full Workflow config (no id/timestamps).
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { description, agent_id: agentId, worker_instructions: workerInstructions } = await request.json() as { description?: string; agent_id?: string; worker_instructions?: string | null };
  if (!description?.trim()) return NextResponse.json({ error: 'description is required' }, { status: 400 });

  // Lightweight context: company name
  const companyResult = await supabase
    .from('company_members')
    .select('companies(name)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single();
  const companyRaw = companyResult.data?.companies;
  const companyName = companyRaw
    ? (Array.isArray(companyRaw) ? companyRaw[0]?.name : (companyRaw as { name?: string })?.name) ?? null
    : null;

  // Fetch worker context if this task is being created for a specific worker
  let workerContext: { name: string; description: string | null; instructions: string | null } | null = null;
  if (agentId) {
    const { data: agent } = await supabase
      .from('custom_agents')
      .select('name, description, instructions')
      .eq('id', agentId)
      .single();
    if (agent) workerContext = agent as { name: string; description: string | null; instructions: string | null };
  }

  const generated = await generateWorkflowConfig(description, user.id, supabase, {
    companyName,
    workerContext,
    workerInstructions: workerInstructions ?? null,
  });

  if (!generated) {
    return NextResponse.json({ error: 'Could not generate a workflow from that description. Try rephrasing.' }, { status: 422 });
  }

  return NextResponse.json({ workflow: { ...generated, status: 'draft' as const } });
}
