// Company Strategy — the "Recommendations" pass. Reads admin-set goals + the already-computed
// AIOperationsSummary (top tasks/tools per coworker, aggregate volumes — no new querying) and
// produces a CONCRETE, actionable suggestion per goal for how AI usage could better serve it
// day-to-day — not just an aligned/drift classification (user feedback: the pure alignment
// verdict "is not super relevant" on its own; what's useful is what to actually DO about it).
// The aligned/drift/opportunity tone is kept as a lightweight secondary signal, not the headline.
// Admin-only output — see supabase/migrations/20260708c_company_goals.sql for the hard invariant
// that this never reaches any employee-facing coworker context.
//
// Cheap, non-reasoning tier by design (mirrors lib/home/synthesize-brief.ts) — a reasoning-tier
// model burns its budget in the reasoning channel on judgment-shaped prompts like this one
// (the lesson documented in lib/home/item-plan.ts).

import { aiCreate, getAIClient, getSystemClient } from '@/lib/ai/factory';
import { logAIUsage } from '@/lib/ai/log-usage';
import { parseModelJSON } from '@/lib/ai/parse-json';
import type { AIOperationsSummary } from './ai-operations-metrics';
import type { SupabaseClient } from '@supabase/supabase-js';

// Bump whenever the prompt or AlignmentObservation shape changes — threaded into the cache
// sig (app/api/company/alignment/route.ts) so a code change invalidates stale cached results
// even when the goals/activity numbers themselves haven't moved (same pattern as
// item_plans.version in the Identified-tasks engine). Without this, editing the prompt has
// no effect until a goal is touched or the 12h TTL expires — confusing ("why isn't this
// updating?") since nothing about the STORED cache key changed.
export const ALIGNMENT_PROMPT_VERSION = 4;

/** A broad goal (especially the North Star) usually has more than one real avenue — capping
 *  to exactly one suggestion per goal was too thin for an admin/exec audience. Capped (not
 *  unlimited) to stay scannable; enforced both in the prompt and defensively client-side in
 *  case the model over-produces for one goal. */
const MAX_SUGGESTIONS_PER_GOAL = 3;

export interface CompanyGoal {
  id: string;
  kind: 'north_star' | 'goal';
  title: string;
  description: string | null;
}

export interface AlignmentObservation {
  goalId: string;
  /** 'opportunity' = no current activity maps to this goal yet — the suggestion is a fresh
   *  starting point, not a course-correction. */
  tone: 'aligned' | 'drift' | 'opportunity';
  /** Grounded observation of current activity — empty when tone is 'opportunity' (nothing to
   *  observe yet). */
  text: string;
  /** The headline: one concrete, specific, day-to-day-implementable suggestion — a task to set
   *  up, a coworker to assign it to, a habit to start. Always present. */
  suggestion: string;
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

  // The admin's tier = the company's tier (company ai_tier wins inside the factory) — a company-wide
  // synthesis stays inside the company's perimeter. System client only when no user is in scope.
  const { client, model, endpoint, tier } = logCtx
    ? await getAIClient(logCtx.userId, 'summarization', logCtx.supabase)
    : getSystemClient('summarization');

  const goalsStr = goals
    .map(g => `[${g.id}] (${g.kind}) ${g.title}${g.description ? ` — ${g.description}` : ''}`)
    .join('\n');

  // distinctUsers/memberCount ground WHO the suggestion is actually for — each coworker role
  // (Clara, Max, ...) is a separate per-user instance, not one shared assistant the admin
  // personally operates, so "only 2 of 5 members use Clara for X" is real, actionable context
  // an org-level suggestion can reference (roll out to the rest of the team), where "have
  // Clara do X" alone reads as if the admin personally controls her.
  const activityStr = summary.agentWork
    .map(row => {
      const tasks = row.topTasks
        .map(t => `${t.name} ×${t.count}${t.grounded ? '' : ' (insight/generative, not automation)'}`)
        .join('; ') || 'none';
      const tools = row.topTools.map(t => `${t.name} ×${t.count}`).join('; ') || 'none';
      return `- ${row.name}: used by ${row.distinctUsers} of ${summary.memberCount} team members, ${row.runs} runs, ${row.messages} chat messages — tasks: ${tasks} — tools: ${tools}`;
    })
    .join('\n');

  // Compact spend-concentration line — a dollar-weighted signal distinct from the task/tool
  // counts above (e.g. "heavy spend on X with no clear goal mapping" is itself a drift
  // signal). Deliberately terse: top 5 sources only, no raw event dump, to keep this
  // judgment-shaped call cheap.
  const costStr = summary.costBySource.length > 0
    ? summary.costBySource.slice(0, 5).map(s => `${s.label} (€${s.costEur.toFixed(2)})`).join(', ')
    : 'no spend data yet';

  const prompt = `You are advising a company admin/exec who does NOT personally operate the AI coworkers
day-to-day — each coworker (Clara, Max, etc.) is a separate assistant belonging to whichever individual
team member uses it. The admin's real lever is ORGANIZATIONAL: rolling out a standard workflow across the
team, following up with whichever members are under-using (or over-relying on) a coworker, or setting an
expectation for how a coworker should be used company-wide. NEVER phrase a suggestion as the admin
personally instructing a coworker (WRONG: "have Clara draft X" — reads like the admin controls Clara
directly). Instead phrase it as what the admin should roll out, standardize, or follow up on across the
team (RIGHT: "Roll out a standard step where whoever's using Clara for sales calls has her draft a
one-line sign-off summary after each one" or "Only 2 of 5 members use Max for research — check in with the
rest of the team about adopting the same workflow"). The headline deliverable is CONCRETE and SPECIFIC
enough to actually act on this week, not vague advice like "use AI more for sales."

GOALS:
${goalsStr}

THIS PERIOD'S ACTIVITY (aggregated across the whole team — no individual identified):
${activityStr}
Company-wide adoption: ${summary.adoptionUsers} of ${summary.memberCount} members used AI at all this period.
Company-wide signals: ${summary.signals.emails} emails, ${summary.signals.meetings} meetings, ${summary.signals.documents} documents.
AI spend concentration (highest first): ${costStr}.

For each goal, give 1 to ${MAX_SUGGESTIONS_PER_GOAL} DISTINCT suggestions — a broad goal (especially the
North Star) usually has more than one real avenue, so don't force everything into a single idea, but don't
pad with near-duplicates either; give 1 if that's genuinely all there is, up to ${MAX_SUGGESTIONS_PER_GOAL}
when there are truly separate angles (e.g. different coworkers, different parts of the workflow, or an
adoption gap across members). For each suggestion:
- If real activity above clearly reinforces it, tone="aligned" — the suggestion is how to go further
  (roll out to more members, extend to another coworker, standardize the next step).
- If activity above shows a mismatch, a missed opportunity given the spend, or a low-adoption gap, tone="drift"
  — the suggestion is the concrete organizational course-correction.
- If there's no clear activity signal for this goal at all, tone="opportunity" and text="" — the
  suggestion is a specific, realistic starting point to roll out to the team (name the coworker, the
  trigger, the output — but as something to introduce team-wide, not something the admin does themself).
Ground text/suggestions in the real activity data above wherever there's a signal — do not fabricate
activity that didn't happen, but DO propose real, actionable ideas even for a goal with no current signal.
Return JSON only, no prose:
{"observations": [{"goalId": "<id from GOALS>", "tone": "aligned"|"drift"|"opportunity", "text": "one sentence grounded in real activity, or empty string if opportunity", "suggestion": "one concrete, specific, organizational next step"}]}`;

  try {
    const res = await aiCreate(client, {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 1500,
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
        !!o && goalIds.has(o.goalId) && (o.tone === 'aligned' || o.tone === 'drift' || o.tone === 'opportunity')
        && typeof o.text === 'string' && typeof o.suggestion === 'string' && o.suggestion.length > 0,
    );

    // Defensive cap — the prompt asks for at most MAX_SUGGESTIONS_PER_GOAL, but never trust a
    // model to honor a count instruction exactly.
    const perGoalCount = new Map<string, number>();
    const capped = observations.filter(o => {
      const count = perGoalCount.get(o.goalId) ?? 0;
      if (count >= MAX_SUGGESTIONS_PER_GOAL) return false;
      perGoalCount.set(o.goalId, count + 1);
      return true;
    });

    return { observations: capped };
  } catch (err) {
    console.error('[synthesizeAlignment] failed:', err);
    return { observations: [] };
  }
}
