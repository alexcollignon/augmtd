// TEMP — one-off: what shape does the adapter assign the workshop prompt? Never committed.
import { createClient } from '@supabase/supabase-js';
import { resolveProbeUser } from './probe-user';
import { detectPromptShape } from '../lib/workflows/generate-config';

const PROMPT = `Use the Augmtd Knowledge Base folder "01_HR_CV_Screening" as the sole source of truth. The folder contains: 1 job description, 1 CV screening rubric, 10 individual candidate CVs.
Create the following workflow:
1. Retrieve Job Requirements — Read the job description and extract requirements.
2. Retrieve Screening Rubric — Read the rubric and convert it into criteria and weights.
3. Human Approval: Confirm Screening Criteria — Present to an HR reviewer; continue only after approval.
4. Review Candidate CVs — Process all 10 CVs individually.
5. Score Candidates — Score each against the rubric with evidence.
6. Apply Guardrails — Ignore protected characteristics; do not fabricate.
7. Rank & Recommend — Rank all 10; classify Shortlist / Review / Do Not Shortlist.
8. Human Approval: Validate Shortlist — Explicit approval before finalizing.
9. Generate Screening Report — Final structured report.`;

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const uid = await resolveProbeUser(sb);
  const shape = await detectPromptShape(PROMPT, uid, sb);
  console.log('SHAPE:', shape);
}
main().catch((e) => { console.error(e); process.exit(1); });
