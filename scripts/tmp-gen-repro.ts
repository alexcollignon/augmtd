// TEMP repro — never committed.
import { createClient } from '@supabase/supabase-js';
import { generateWorkflowConfig } from '../lib/workflows/generate-config';

const PROMPT = `Use the Augmtd Knowledge Base folder "HR | CV Screening" as the sole source of truth. The folder contains: 1 job description, 1 CV screening rubric, 5 individual candidate CVs with deliberately different levels of fit.
Create the following workflow:
1. Retrieve Job Requirements - Read the job description and extract the required skills, experience, education, domain knowledge, seniority, and other explicit requirements.
2. Retrieve Screening Rubric - Read the screening rubric and convert it into clear evaluation criteria, scoring rules, weights, and decision thresholds.
3. Human Approval: Confirm Screening Criteria - Present the extracted requirements, rubric, weights, and thresholds to an HR reviewer. The workflow may continue only after approval. If rejected, return the criteria for revision.
4. Review Candidate CVs - Process all 5 CVs individually. Extract only information explicitly contained in each CV that is relevant to the approved requirements and rubric.
5. Score Candidates - Score every candidate against each rubric criterion. Provide a concise evidence-based justification for every score.
6. Apply Guardrails - Do not infer or evaluate candidates based on protected or sensitive characteristics. Do not fabricate missing qualifications or evidence.
7. Rank and Recommend Candidates - Calculate the overall score for each candidate and rank all 5 candidates. Classify each as Shortlist, Review, or Do Not Shortlist.
8. Human Approval: Validate Shortlist - Present the proposed ranking, scores, evidence, and recommendations to an HR reviewer. Require explicit approval before finalizing the shortlist. Allow the reviewer to approve, reject, or request reassessment.
9. Generate Screening Report - Create a final structured output containing: Candidate | Overall Fit | Criterion Scores | Key Evidence | Strengths | Gaps | Recommendation. Conclude with a ranked overview of all candidates.
The workflow must run end-to-end inside Augmtd.ai, automatically use the documents in the HR | CV Screening folder, process all 5 CVs, and produce the final screening report.`;

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const uid = '08fe4449-e5eb-431d-9156-02e9324e5903';
  const t0 = Date.now();
  const cfg = await generateWorkflowConfig(PROMPT, uid, sb);
  console.log('elapsed', Math.round((Date.now() - t0) / 1000) + 's');
  if (!cfg) { console.log('NULL — see parse/shape failure log above'); process.exit(1); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of (cfg.steps as any[])) console.log(' ·', s.type + (s.tool ? ':' + s.tool : ''), '—', s.label, s.config?.folder ? '(folder: ' + s.config.folder + ')' : '');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
