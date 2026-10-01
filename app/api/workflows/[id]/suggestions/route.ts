// ─── GET /api/workflows/[id]/suggestions ──────────────────────────────────────
// Returns 2-3 AI-generated improvement suggestions based on run history.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { parseModelJSON } from '@/lib/ai/parse-json';
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
  // THE HEALTH LINE IS CODE'S (W37: on an all-green history the model invented "slow feeds" and
  // "missing coverage"): which steps failed, how often — or that nothing did.
  const failCounts = new Map<string, number>();
  for (const r of runSummary) for (const f of r.failed_steps) failCounts.set(String(f.label), (failCounts.get(String(f.label)) ?? 0) + 1);
  const healthLine = failCounts.size
    ? [...failCounts.entries()].map(([l, n]) => `step "${l}" failed in ${n} of ${runs.length} runs`).join('; ') + '. Address the most frequent failure first.'
    : `all ${runs.length} runs succeeded and no step failed — say so in the first suggestion's reason; every suggestion is an optional improvement, never a fix for a problem, and none is a timing or step-order change (nothing in the history shows one is needed).`;
  const stepCount = Array.isArray(workflow.steps) ? workflow.steps.length : 0;
  // W37 — THE STEPS THEMSELVES (found by the build.suggestions eval: the model saw only "3 steps", so a
  // suggestion could never name the feed that 404s or the research step that times out). One line per
  // step: its type, label, tool and the config keys that decide its behaviour (sources, queries, caps).
  const stepLines = (Array.isArray(workflow.steps) ? workflow.steps as Array<Record<string, unknown>> : []).map((s, i) => {
    const cfg = (s.config && typeof s.config === 'object') ? JSON.stringify(s.config).slice(0, 240) : '';
    return `${i + 1}. [${String(s.type ?? '?')}${s.tool ? `:${String(s.tool)}` : ''}] ${String(s.label ?? '')}${cfg && cfg !== '{}' ? ` — config ${cfg}` : ''}`;
  });

  const systemPrompt = `You are an expert workflow optimization assistant. Analyze this AI automation workflow and its run history to generate exactly 2-3 actionable improvement suggestions.

Ground every suggestion in THIS workflow's real steps and THIS run history: the most important problem first (a failure that recurs beats polish), name the step it concerns, and never claim a failure, timeout or slowness the history does not show — when every run succeeded, say so through modest, specific improvements. Phrase an addition as an addition ("Add EUR-Lex as a second source"), never as a diagnosis the data does not show ("the current sources miss X"); propose a timing or order change only when the history shows a timing or order problem.

Return a JSON array with this exact structure (no markdown, no wrapper):
[
  {"category": "quality|coverage|timing", "title": "Short title (max 8 words)", "reason": "One sentence on what the change ADDS (max 20 words) — a problem is named only when the run history above shows it"}
]

Categories:
- quality: improve output reliability, accuracy, or relevance
- coverage: add missing data sources or expand scope
- timing: adjust schedule, frequency, or run order`;

  const userPrompt = `Workflow: "${workflow.name}"
Description: ${workflow.description ?? 'none'}
Steps (${stepCount}):
${stepLines.join('\n')}
Trigger: ${JSON.stringify(workflow.trigger)}

Run health (counted in code): ${healthLine}

Run history (last ${runs.length} runs):
- Success rate: ${Math.round(successRate * 100)}%
- Runs: ${JSON.stringify(runSummary)}

Generate 2-3 improvement suggestions.`;

  try {
    const { client, model } = await getAIClient(user.id, 'generation', supabase);
    const response = await aiCreate(client, {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 600,
    });

    const raw = response.choices[0]?.message?.content ?? '[]';
    // Tolerant parse (a fenced array is the common Bedrock/Anthropic shape — the strict JSON.parse here
    // served an EMPTY panel on every such answer).
    const parsed = parseModelJSON<unknown>(raw, null);
    const arr = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { suggestions?: unknown }).suggestions) ? (parsed as { suggestions: unknown[] }).suggestions : []);
    const suggestions: unknown[] = arr.slice(0, 3);
    // THE HEALTH IS SAID BY CODE (W37: on an all-green history the panel never said the runs were fine,
    // so every optional idea read as a fix). The first suggestion's reason carries the counted fact.
    const first = suggestions[0] as { reason?: unknown } | undefined;
    if (!failCounts.size && first && typeof first.reason === 'string' && !/succe|fine|healthy|no (errors|failures)/i.test(first.reason)) {
      first.reason = `All ${runs.length} recent runs succeeded. ${first.reason}`;
    }

    return NextResponse.json({ suggestions, runs_count: runs.length });
  } catch {
    return NextResponse.json({ suggestions: [], runs_count: runs.length });
  }
}
