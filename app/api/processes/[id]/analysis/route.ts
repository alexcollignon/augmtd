import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { parseModelJSON } from '@/lib/ai/parse-json';

// GET /api/processes/[id]/analysis — AI health analysis: attention + expected outcomes
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: proc } = await supabase
    .from('processes')
    .select('id, title, status, current_step, due_date, started_at')
    .eq('id', id)
    .single();

  if (!proc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: steps } = await supabase
    .from('process_steps')
    .select('step_index, title, status, department, assignee_id, description, started_at, completed_at, estimated_days')
    .eq('process_id', id)
    .order('step_index');

  const stepList = (steps ?? []);
  const total = stepList.length;
  const completed = stepList.filter((s: any) => s.status === 'completed').length;
  const inProgress = stepList.find((s: any) => s.status === 'in_progress');
  const blocked = stepList.filter((s: any) => s.status === 'blocked');

  const stepSummary = stepList.map((s: any) =>
    `  Step ${s.step_index + 1}: ${s.title} [${s.status}]${s.department ? ` (${s.department})` : ''}${s.estimated_days ? ` ~${s.estimated_days}d` : ''}`
  ).join('\n');

  const progressNote = total > 0
    ? `Progress: ${completed}/${total} steps completed`
    : 'No steps defined';

  const dueNote = proc.due_date
    ? `Due: ${new Date(proc.due_date).toLocaleDateString()}`
    : 'No due date set';

  const contextBlock = [
    `PROCESS: ${proc.title}`,
    `STATUS: ${proc.status}`,
    dueNote,
    progressNote,
    inProgress ? `CURRENT STEP: Step ${inProgress.step_index + 1} — ${inProgress.title}` : '',
    blocked.length > 0 ? `BLOCKED STEPS: ${blocked.map((s: any) => s.title).join(', ')}` : '',
    `\nSTEPS:\n${stepSummary}`,
  ].filter(Boolean).join('\n');

  const systemPrompt = `You are a process health analyst for a professional team workflow system. Analyze the given process and return a JSON object.

Return ONLY valid JSON with this exact shape:
{
  "attention": {
    "title": "Short title for what needs immediate attention (max 8 words)",
    "blocker": "One sentence: what the specific issue or delay is",
    "action": "One sentence: what the assignee should do right now",
    "cta": "Short action label (2-4 words, starts with verb) e.g. 'Review & approve', 'Submit budget'"
  } | null,
  "outcomes": [
    { "type": "risk", "text": "Specific potential risk for this process" },
    { "type": "suggestion", "text": "Actionable optimization suggestion" }
  ]
}

Set attention to null if the process is progressing normally with no blockers or delays.
Include 3-4 outcomes mixing risks and suggestions relevant to this specific process type.`;

  try {
    const { createClient: createAdminClient } = await import('@supabase/supabase-js');
    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const resolved = await getAIClient(user.id, 'conversation', adminClient as any);

    const response = await aiCreate(resolved.client, {
      model: resolved.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: contextBlock },
      ],
      max_tokens: 600,
      temperature: 0.3,
    });

    const text = response.choices[0]?.message?.content ?? '{}';
    const result = parseModelJSON<{ attention: unknown; outcomes: unknown[] }>(text, { attention: null, outcomes: [] });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ attention: null, outcomes: [] });
  }
}
