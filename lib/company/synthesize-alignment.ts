// Company Strategy — the "Alignment" drift-detection pass. Reads admin-set goals + the
// already-computed AIOperationsSummary (top tasks/tools per coworker, aggregate volumes —
// no new querying) and judges where actual team activity reinforces or drifts from stated
// intent. Admin-only output — see supabase/migrations/20260708c_company_goals.sql for the
// hard invariant that this never reaches any employee-facing coworker context.
//
// Cheap, non-reasoning tier by design (mirrors lib/home/synthesize-brief.ts) — a reasoning-tier
// model burns its budget in the reasoning channel on judgment-shaped prompts like this one
// (the lesson documented in lib/home/item-plan.ts).

import { aiCreate, getSystemClient } from '@/lib/ai/factory';
import { logAIUsage } from '@/lib/ai/log-usage';
import { parseModelJSON } from '@/lib/ai/parse-json';
import type { AIOperationsSummary } from './ai-operations-metrics';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface CompanyGoal {
  id: string;
  kind: 'north_star' | 'goal';
  title: string;
  description: string | null;
}

export interface AlignmentObservation {
  goalId: string;
  tone: 'aligned' | 'drift';
  text: string;
}

export interface AlignmentResult {
  observations: AlignmentObservation[];
}

export async function synthesizeAlignment(
  goals: CompanyGoal[],
  summary: AIOperationsSummary,
  // Attributed to the admin who triggered this rollup — there's no single "owner" user for a
  // company-wide synthesis, so cost is pragmatically billed to whoever viewed the Strategy tab.
  logCtx?: { userId: string; supabase: SupabaseClient },
): Promise<AlignmentResult> {
  if (goals.length === 0) return { observations: [] };

  const { client, model, endpoint, tier } = getSystemClient('summarization');

  const goalsStr = goals
    .map(g => `[${g.id}] (${g.kind}) ${g.title}${g.description ? ` — ${g.description}` : ''}`)
    .join('\n');

  const activityStr = summary.agentWork
    .map(row => {
      const tasks = row.topTasks
        .map(t => `${t.name} ×${t.count}${t.grounded ? '' : ' (insight/generative, not automation)'}`)
        .join('; ') || 'none';
      const tools = row.topTools.map(t => `${t.name} ×${t.count}`).join('; ') || 'none';
      return `- ${row.name}: ${row.runs} runs, ${row.messages} chat messages — tasks: ${tasks} — tools: ${tools}`;
    })
    .join('\n');

  // Compact spend-concentration line — a dollar-weighted signal distinct from the task/tool
  // counts above (e.g. "heavy spend on X with no clear goal mapping" is itself a drift
  // signal). Deliberately terse: top 5 sources only, no raw event dump, to keep this
  // judgment-shaped call cheap.
  const costStr = summary.costBySource.length > 0
    ? summary.costBySource.slice(0, 5).map(s => `${s.label} (€${s.costEur.toFixed(2)})`).join(', ')
    : 'no spend data yet';

  const prompt = `You are analyzing a company's AI coworker usage against its stated strategic goals.

GOALS:
${goalsStr}

THIS PERIOD'S ACTIVITY (aggregated across the whole team — no individual identified):
${activityStr}
Company-wide signals: ${summary.signals.emails} emails, ${summary.signals.meetings} meetings, ${summary.signals.documents} documents.
AI spend concentration (highest first): ${costStr}.

For each goal, decide whether the team's actual AI usage patterns reinforce it ("aligned") or drift from
it ("drift"). Only comment on a goal when the activity data gives real, specific evidence — do not invent
a connection or comment on a goal with no relevant signal. Return JSON only, no prose:
{"observations": [{"goalId": "<id from GOALS>", "tone": "aligned"|"drift", "text": "one specific sentence referencing real activity above"}]}
Return at most ${goals.length * 2} observations total, prioritizing the clearest signals. If nothing
meaningful can be said for any goal, return {"observations": []}.`;

  try {
    const res = await aiCreate(client, {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
    });
    if (logCtx) {
      logAIUsage(logCtx.supabase, {
        userId: logCtx.userId, source: 'alignment_synthesis', provider: endpoint.provider, model, tier, taskType: 'summarization', usage: res.usage,
      }).catch(() => {});
    }
    const parsed = parseModelJSON<AlignmentResult>(res.choices[0]?.message?.content, { observations: [] });
    const goalIds = new Set(goals.map(g => g.id));
    const observations = (parsed.observations ?? []).filter(
      (o): o is AlignmentObservation =>
        !!o && goalIds.has(o.goalId) && (o.tone === 'aligned' || o.tone === 'drift') && typeof o.text === 'string' && o.text.length > 0,
    );
    return { observations };
  } catch (err) {
    console.error('[synthesizeAlignment] failed:', err);
    return { observations: [] };
  }
}
