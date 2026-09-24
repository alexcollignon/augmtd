// ─── TEMP SMOKE: THE WORKSHOP WORKFLOW, GENERATED AND EXECUTED — never committed ─────────────
// The real instruction (counts matched to the halved kit: 5 CVs) → generateWorkflowConfig →
// every step EXECUTED against the probe's seeded copy of the REAL Emirates NBD kit. Approval
// gates are logged and simulated (the park/resume machinery is the UI dress rehearsal's job);
// the verify gate runs for real with the producing step's prompt.
// Run: npx tsx --env-file=.env.local scripts/tmp-workflow-run-smoke.ts
import { createClient } from '@supabase/supabase-js';
import { resolveProbeUser } from './probe-user';

const PROMPT = `Use the Augmtd Knowledge Base folder "01_HR_CV_Screening" as the sole source of truth. The folder contains: 1 job description, 1 CV screening rubric, and 5 individual candidate CVs with deliberately different levels of fit.
Create the following workflow:
1. Retrieve Job Requirements — Read the job description and extract the required skills, experience, education, domain knowledge, seniority, and other explicit requirements.
2. Retrieve Screening Rubric — Read the screening rubric and convert it into clear evaluation criteria, scoring rules, weights, and decision thresholds.
3. Human Approval: Confirm Screening Criteria — Present the extracted requirements, rubric, weights, and thresholds to an HR reviewer. The workflow may continue only after approval.
4. Review Candidate CVs — Process all 5 CVs individually. Extract only information explicitly contained in each CV that is relevant to the approved requirements and rubric.
5. Score Candidates — Score every candidate against each rubric criterion. Provide a concise evidence-based justification for every score. Do not introduce criteria that are not present in the job description or rubric.
6. Apply Guardrails — Do not infer or evaluate candidates based on protected or sensitive characteristics. Ignore age, gender, ethnicity, nationality, religion, marital status, photographs, or other characteristics unrelated to the stated selection criteria. Do not fabricate missing qualifications or evidence.
7. Rank & Recommend Candidates — Calculate the overall score for each candidate and rank all 5 candidates. Classify each as Shortlist, Review, or Do Not Shortlist.
8. Human Approval: Validate Shortlist — Present the proposed ranking, scores, evidence, and recommendations to an HR reviewer. Require explicit approval before finalizing the shortlist.
9. Generate Screening Report — Create a final structured output containing: Candidate | Overall Fit | Criterion Scores | Key Evidence | Strengths | Gaps | Recommendation. Conclude with a ranked overview of all candidates and why the top candidates best match the role.
The workflow must run end-to-end inside Augmtd.ai, automatically use the documents in the 01_HR_CV_Screening folder, process all 5 CVs, and produce the final screening report. Every score, conclusion, and recommendation must be traceable to evidence from the Knowledge Base.`;

const CANDIDATES = ['Mariam', 'Karim', 'Dalia', 'Omar', 'Sara'];

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const uid = await resolveProbeUser(sb);
  const fails: string[] = [];
  const ok = (cond: boolean, label: string) => { console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${label}`); if (!cond) fails.push(label); };

  // ── 1. The probe wears the REAL kit (idempotent — cheap if already seeded). ──
  const { data: co } = await sb.from('companies').select('id').eq('slug', 'emirates-nbd').maybeSingle();
  const { seedKnowledgeForUser } = await import('../lib/workspace/seed-kb');
  const r = await seedKnowledgeForUser(sb, co!.id, uid);
  console.log(`probe kit: ${JSON.stringify(r)}`);

  // ── 2. Generate from the real instruction. ──
  const { generateWorkflowConfig } = await import('../lib/workflows/generate-config');
  const cfg = await generateWorkflowConfig(PROMPT, uid, sb);
  if (!cfg) { console.error('generate returned null'); process.exit(1); }
  const steps = cfg.steps as Array<{ type: string; id: string; label?: string; tool?: string; prompt?: string; config?: Record<string, unknown>; instruction?: string }>;
  console.log('generated steps:');
  for (const s of steps) console.log(`  · [${s.type}${s.tool ? `:${s.tool}` : ''}] ${s.label ?? ''}`);
  ok(steps.filter((s) => s.type === 'approval').length >= 2, '≥2 approval gates');
  ok(steps.some((s) => s.tool === 'read_kb_folder'), 'read_kb_folder present');

  // ── 3. Execute — approvals simulated, everything else REAL. ──
  const { executeStep } = await import('../lib/workflows/execute-step');
  const previousOutputs: Array<Record<string, unknown>> = [];
  let lastAiPrompt: string | null = null;
  const t0 = Date.now();
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.type === 'approval') { console.log(`  [gate] "${s.label}" — simulated APPROVE (park/resume is the UI rehearsal)`); continue; }
    if (s.type === 'ai') lastAiPrompt = s.prompt ?? null;
    const st = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await executeStep(s as any, {
      userId: uid, supabase: sb, previousOutputs: previousOutputs as never[],
      workflowName: 'tmp-workshop-run', isLastStep: i === steps.length - 1,
      ...(s.type === 'verify' && lastAiPrompt ? { producingPrompt: lastAiPrompt } : {}),
    });
    previousOutputs.push(out as unknown as Record<string, unknown>);
    const text = typeof out.output === 'string' ? out.output : JSON.stringify(out.output ?? '');
    console.log(`  [${s.type}${s.tool ? `:${s.tool}` : ''}] "${s.label}" → ${out.error ? `ERROR: ${out.error}` : `${text.length} chars`} (${Math.round((Date.now() - st) / 1000)}s)`);
    if (out.error) fails.push(`step "${s.label}" errored`);
  }
  console.log(`pipeline executed in ${Math.round((Date.now() - t0) / 1000)}s`);

  // ── 4. The report's truth: every candidate present, the grammar of a screening report. ──
  const finalText = (() => {
    for (let i = previousOutputs.length - 1; i >= 0; i--) {
      const o = previousOutputs[i] as { step_type?: string; output?: unknown };
      if (o.step_type === 'ai' || o.step_type === 'verify') {
        const t = typeof o.output === 'string' ? o.output : '';
        if (t.length > 200) return t;
      }
    }
    return '';
  })();
  for (const name of CANDIDATES) ok(finalText.includes(name), `report mentions ${name}`);
  ok(/shortlist/i.test(finalText), 'report speaks Shortlist grammar');
  ok(/recommend/i.test(finalText), 'report carries recommendations');
  console.log('\n── report head ──\n' + finalText.slice(0, 600));

  console.log(fails.length ? `\nRESULT: ${fails.length} FAILURE(S)` : '\nRESULT: ALL GREEN');
  if (fails.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
