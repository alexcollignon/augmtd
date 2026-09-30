// ════════════════════════════════════════════════════════════════════════════════════════════════
// W28 · workflow.step — A WORKFLOW / RELAY STEP WITH A DECLARED OUTPUT.
// PRODUCER: lib/workflows/execute-step.ts executeStep(step, ctx) — the run loop's one step executor —
// on the step as a workflow author declares it: an `ai` step with `output_format` (markdown | json) and
// the conversation-slot model (`model_tier: 'reasoning'`), or an `agent` step owned by a coworker; the
// final step of a coworker-owned workflow (`workerAgentId`, `isLastStep`), fed the upstream steps'
// outputs as `previousOutputs` (what the loop hands it). SERVED = the step's output.
// Plain columns: the SAME upstream outputs (labelled blocks), the SAME instruction and the SAME
// declared format line — the information the step itself receives, without the product's framing.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { makeSurface, extrasOf, DIM } from '../base';
import { workerOf } from '../team';
import type { SurfaceCaseSpec } from '../common';
import type { EvalCase } from '../../eval/engine/types';

type Input = { label: string; text: string };
type StepParams = { kind: 'ai' | 'agent'; format?: 'markdown' | 'json' | 'text'; worker?: 'branding_expert' | 'research_analyst' | 'personal_assistant'; workflow: string; inputs: Input[] };

const SALES_NOTES = `Week 39 sales notes (from the CRM export):
- New deals: 7 (last week 4). Largest: Globex, €38,000, annual licence, signed Thursday.
- Pipeline value: €412,000 across 29 open opportunities.
- Lost: Initech renewal (€22,000) — they moved to an in-house tool.
- Two enterprise demos booked for next week (Umbrella Corp, Stark Freight).
- Churn risk: Acme Logistics has opened three support tickets about invoicing errors this month.`;

const MEETING = `Transcript summary — ops sync, Tuesday:
Ana: I'll update the returns SOP by next Friday.
Sam: I can check the scanner warranty terms, no date yet.
Taylor: I'll send the revised timeline to Acme before their board meeting on the 9th.
Ana: Someone needs to book the label reprint station installation — we didn't decide who.`;

const PIPE_CRM = `CRM export (Monday 07:00): open deals 42; weighted pipeline €1.26M; deals closing this month 9.`;
const PIPE_EMAIL = `Email from the sales lead (Friday): "We're at 38 open deals after the clean-up, weighted pipeline about €1.1M; 9 are due to close this month."`;

const HIGHLIGHTS = `This week's highlights (from the team channel):
- We ran our first supplier-risk workshop with 18 procurement leads; the most-voted risk was single-source packaging.
- A new client, Northwind Foods, signed for the full onboarding service.
- Our checklist template was downloaded 140 times since launch.`;

const specs: SurfaceCaseSpec[] = [
  {
    id: 'step-briefing-md', group: 'ai-markdown', title: 'AI step (markdown): weekly sales briefing in four fixed sections', quick: true, edge: 'strict_format',
    params: { step: { kind: 'ai', format: 'markdown', workflow: 'Weekly sales briefing', inputs: [{ label: 'CRM export', text: SALES_NOTES }] } satisfies StepParams },
    turns: ['Turn the sales notes into the weekly briefing for the leadership team with exactly these sections: Headline, Numbers, Risks, Next steps. Max 150 words.'],
    truth: 'Four sections exactly — Headline, Numbers, Risks, Next steps — ≤150 words, markdown. Numbers from the notes only: 7 new deals (vs 4), largest Globex €38,000, pipeline €412,000 across 29 opportunities, Initech renewal lost (€22,000, moved in-house). Risks: Acme Logistics churn risk (three invoicing tickets), the lost renewal. Next steps: the two enterprise demos (Umbrella Corp, Stark Freight), address Acme invoicing. No invented figures.',
    checks: [{ kind: 'sections', names: ['Headline', 'Numbers', 'Risks', 'Next steps'] }, { kind: 'max_words', n: 165 }, { kind: 'mentions', groups: ['412', '38,000|38.000|38k'], label: 'keeps the key figures' }],
  },
  {
    id: 'step-actions-json', group: 'ai-json', title: 'AI step (json): action items with owner, task, due — unknowns are null', quick: true, edge: 'missing',
    params: { step: { kind: 'ai', format: 'json', workflow: 'Meeting action items', inputs: [{ label: 'Meeting transcript', text: MEETING }] } satisfies StepParams },
    turns: ['Extract every action item as JSON: {"actions":[{"owner":string|null,"task":string,"due":string|null}]}. Use null when the owner or the due date was not stated.'],
    truth: 'Valid JSON only with an "actions" array of 4 items: Ana — update the returns SOP — due next Friday; Sam — check the scanner warranty terms — due null; Taylor — send the revised timeline to Acme — due before the board meeting on the 9th; owner null — book the label reprint station installation — due null. No invented owners or dates.',
    checks: [{ kind: 'json_keys', keys: ['actions'] }, { kind: 'mentions', groups: ['warranty', 'reprint', 'sop'], label: 'all four actions present' }],
  },
  {
    id: 'step-pipeline-conflict', group: 'ai-markdown', title: 'AI step: Monday pipeline summary from two sources that disagree', edge: 'conflicting',
    params: { step: { kind: 'ai', format: 'markdown', workflow: 'Monday pipeline summary', inputs: [{ label: 'CRM export', text: PIPE_CRM }, { label: 'Sales lead email', text: PIPE_EMAIL }] } satisfies StepParams },
    turns: ['Write the Monday pipeline summary for the CEO (max 120 words).'],
    truth: 'A ≤120-word summary that FLAGS the disagreement between the sources: open deals 42 (CRM export, Monday) vs 38 (sales lead after clean-up, Friday); weighted pipeline €1.26M vs about €1.1M; both agree on 9 deals closing this month. Names both values and their sources (the CRM export is the newer); does not silently pick or average. No invented deals.',
    checks: [{ kind: 'mentions', groups: ['42', '38'], label: 'names both deal counts' }, { kind: 'max_words', n: 130 }],
  },
  {
    id: 'step-agent-luca', group: 'agent', title: 'Agent step (Luca owns the workflow): this week\'s LinkedIn post from the highlights',
    params: { step: { kind: 'agent', worker: 'branding_expert', workflow: 'Weekly LinkedIn post', inputs: [{ label: 'Team highlights', text: HIGHLIGHTS }] } satisfies StepParams },
    turns: ['Write this week\'s LinkedIn post from the highlights above. One post, under 180 words, no more than three hashtags.'],
    truth: 'One LinkedIn post under 180 words with at most three hashtags, built from the real highlights (supplier-risk workshop with 18 procurement leads — single-source packaging was the top risk; Northwind Foods signed for the full onboarding service; checklist template downloaded 140 times). Specific and human, no invented numbers or quotes, not generic.',
    checks: [{ kind: 'max_words', n: 200 }, { kind: 'mentions', groups: ['18', 'packaging|single-source|single source'], label: 'anchored in the workshop' }],
  },
  {
    id: 'step-empty-input', group: 'ai-markdown', title: 'AI step: summarise new applications when the upstream step found none', edge: 'missing',
    params: { step: { kind: 'ai', format: 'markdown', workflow: 'Supplier applications digest', inputs: [{ label: 'New supplier applications (form export)', text: '[] — 0 rows returned for the period 22–28 September.' }] } satisfies StepParams },
    turns: ['Summarise this week\'s new supplier applications: company, category, and whether the documents are complete.'],
    truth: 'The upstream step returned zero applications for 22–28 September. The output says so plainly (no applications this week) in a line or two. Must NOT invent companies, categories or document statuses; must not produce an empty table pretending to be data.',
    hard: ['The answer lists a supplier application (a company name, category or document status) that is not in the input.'],
    checks: [{ kind: 'max_words', n: 90 }, { kind: 'no_refusal' }],
  },
];

const stepOf = (c: EvalCase): StepParams => c.params?.step as StepParams;

/** The upstream outputs as the plain columns and the judge read them (labelled blocks). */
export function renderInputs(p: StepParams): string {
  return `MATERIAL FROM THE EARLIER STEPS OF THE "${p.workflow}" WORKFLOW:\n\n${p.inputs.map((x, i) => `[Step ${i + 1} — ${x.label}]\n${x.text}`).join('\n\n')}`;
}
const formatLine = (p: StepParams) => (p.format === 'json' ? 'Respond with valid JSON only. No prose.' : p.format === 'markdown' ? 'Respond in markdown.' : '');

export const stepSurface = makeSurface({
  id: 'workflow.step',
  title: 'Workflow / relay step with a declared output (ai + agent steps)',
  producer: { file: 'lib/workflows/execute-step.ts', fn: 'executeStep (final step, declared output_format)' },
  team: true,
  dims: [
    DIM.task('Produces the step\'s deliverable from the upstream material, ready for the next station.'),
    DIM.format('The declared output is the contract: format (markdown / valid JSON), named sections, counts, length.'),
    DIM.grounded('Uses only the upstream outputs; disagreeing sources named with both values; an empty input reported as empty.'),
    DIM.voice('Concise, specific writing a busy reader can use as is.'),
  ],
  hard: [],
  specs,
  plainPreamble: (c) => [renderInputs(stepOf(c)), formatLine(stepOf(c))].filter(Boolean).join('\n\n'),
  extraSource: (c) => renderInputs(stepOf(c)),
  augmtdCost: () => ({ calls: 1, inTok: 4_000, outTok: 600 }),
  plainOut: 450,
  async produce(ctx, c, seeded) {
    const p = stepOf(c);
    const e = extrasOf(seeded);
    const { executeStep } = await import('../../../../lib/workflows/execute-step');
    const worker = p.worker && e.team ? workerOf(e.team, p.worker) : e.team ? workerOf(e.team, 'personal_assistant') : null;
    const instruction = (c.turns ?? [])[0] ?? '';
    const step = p.kind === 'agent'
      ? { type: 'agent' as const, id: 'final', label: p.workflow, agent_id: worker!.id, prompt: instruction }
      : { type: 'ai' as const, id: 'final', label: p.workflow, prompt: instruction, model_tier: 'reasoning' as const, ...(p.format ? { output_format: p.format } : {}) };
    const out = await executeStep(step, {
      userId: ctx.userId, supabase: ctx.admin,
      previousOutputs: p.inputs.map((x, i) => ({ step_id: `in${i + 1}`, step_type: 'tool' as const, label: x.label, output: x.text })),
      workflowName: p.workflow, isLastStep: true, ...(worker ? { workerAgentId: worker.id } : {}),
    });
    if (out.error) throw new Error(`executeStep: ${out.error}`);
    const text = typeof out.output === 'string' ? out.output : JSON.stringify(out.output, null, 2);
    return { turns: [text] };
  },
});
