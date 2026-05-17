// ─── GET /api/workflows/[id]/suggestions ──────────────────────────────────────
// Returns 2-3 AI-generated improvement suggestions based on run history.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAIClient } from '@/lib/ai/factory';
import { requireFeature, handleWorkspaceError } from '@/lib/workspace/require-feature';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

  // Fetch workflow + last 5 runs
  const [{ data: workflow }, { data: runs }] = await Promise.all([
    supabase.from('workflows').select('id, name, description, steps, trigger').eq('id', id).single(),
    supabase.from('workflow_runs').select('status, step_outputs, error, started_at, completed_at')
      .eq('workflow_id', id).order('created_at', { ascending: false }).limit(5),
  ]);

  if (!workflow) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!runs || runs.length === 0) {
    return NextResponse.json({ suggestions: [], runs_count: 0 });
  }

  const runSummary = (runs as Array<{
    status: string; error: string | null;
    step_outputs: Array<{ label: string; step_type: string; error?: string }> | null;
  }>).map(r => ({
    status: r.status,
    error: r.error,
    failed_steps: (r.step_outputs ?? []).filter(s => s.error).map(s => ({ label: s.label, error: s.error })),
  }));

  const successRate = runs.filter(r => r.status === 'succeeded').length / runs.length;
  const stepCount = Array.isArray(workflow.steps) ? workflow.steps.length : 0;

  const systemPrompt = `You are an expert workflow optimization assistant. Analyze this AI automation workflow and its run history to generate exactly 2-3 actionable improvement suggestions.

Return a JSON array with this exact structure (no markdown, no wrapper):
[
  {"category": "quality|coverage|timing", "title": "Short title (max 8 words)", "reason": "One sentence explaining the improvement (max 20 words)"}
]

Categories:
- quality: improve output reliability, accuracy, or relevance
- coverage: add missing data sources or expand scope
- timing: adjust schedule, frequency, or run order`;

  const userPrompt = `Workflow: "${workflow.name}"
Description: ${workflow.description ?? 'none'}
Steps: ${stepCount} steps
Trigger: ${JSON.stringify(workflow.trigger)}

Run history (last ${runs.length} runs):
- Success rate: ${Math.round(successRate * 100)}%
- Runs: ${JSON.stringify(runSummary)}

Generate 2-3 improvement suggestions.`;

  try {
    const { client, model } = await getAIClient(user.id, 'generation', supabase);
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 400,
    });

    const raw = response.choices[0]?.message?.content ?? '[]';
    let suggestions: unknown[] = [];
    try {
      const parsed = JSON.parse(raw.trim());
      if (Array.isArray(parsed)) suggestions = parsed.slice(0, 3);
    } catch { /* return empty if parse fails */ }

    return NextResponse.json({ suggestions, runs_count: runs.length });
  } catch {
    return NextResponse.json({ suggestions: [], runs_count: runs.length });
  }
}
