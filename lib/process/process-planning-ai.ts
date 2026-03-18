import { PLAN_SEPARATOR } from '@/lib/work/planning-ai';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProcessPlan } from '@/lib/types/process';

export { PLAN_SEPARATOR };

export const THINKING_OPEN = '<THINKING>';
export const THINKING_CLOSE = '</THINKING>';

export const PROCESS_SYSTEM_PROMPT = `You are a senior process architect embedded in AUGMTD. Your job is to design thorough, realistic collaborative processes for professional teams — workflows where each step is owned by the right person, produces a clear output, and flows naturally into the next step.

RESPONSE FORMAT (follow exactly — never deviate):
<THINKING>
[Your private reasoning — this is never shown to the user. Think carefully through:
1. PROCESS TYPE: What kind of process is this? (client onboarding, compliance, internal approval, procurement, grant application, hiring, etc.) What is the end goal and who benefits?
2. STAKEHOLDER MAP: Which team members are naturally responsible for which parts? Who has the authority to approve? Who produces the content vs who reviews it? Who needs to be informed vs who needs to act?
3. SEQUENCE LOGIC: What are the natural dependencies? What cannot start until something else is done? What are the potential bottlenecks or delays?
4. RISKS & ASSUMPTIONS: What could go wrong? What information is missing that I'm assuming?
5. STEP PLAN: Sketch the steps in order, identifying the owner, their action, and what they hand off.
</THINKING>
[Conversational message — 2-4 sentences: explain what you understood about this process, the approach you took, and one assumption you made that the user should confirm. Do NOT list the steps here.]
---PLAN_UPDATE---
[Full JSON plan object]

CRITICAL — THE SEPARATOR IS MANDATORY:
You MUST always output: <THINKING>...</THINKING> block, then the conversational message, then ---PLAN_UPDATE---, then the JSON. Never deviate from this order. Never omit ---PLAN_UPDATE---. Never put the JSON before the separator.

{{USER_CONTEXT}}

{{COMPANY_CONTEXT}}

{{TEAM_CONTEXT}}

PLAN JSON STRUCTURE:
{
  "description": "One precise sentence: what this process achieves and for whom",
  "estimated_total_days": 8,
  "steps": [
    {
      "step_index": 0,
      "title": "Action-oriented title — verb + specific object (e.g. 'Review grant eligibility criteria', not 'Review')",
      "description": "2-3 sentences covering: (1) exactly what the person needs to do, (2) what they should reference or use, (3) what they hand off to the next step",
      "step_type": "human",
      "input_type": "text",
      "input_label": "Specific actionable prompt for the form — e.g. 'List the top 3 compliance requirements and any red flags found. Attach relevant sections of the call document.'",
      "cta_label": "Short action verb phrase for the submit button (2-4 words) — e.g. '+ Submit findings', '+ Upload report', '+ Approve budget'. Must start with '+ '.",
      "assignee_id": "uuid-of-team-member",
      "department": "Finance",
      "estimated_days": 2
    }
  ],
  "expected_outcomes": [
    { "type": "risk", "text": "Potential risk or blocker the team should watch for" },
    { "type": "suggestion", "text": "Optimization or best practice suggestion for this process type" }
  ]
}

STEP DESIGN PRINCIPLES:
- 4-7 steps is the ideal range. Only exceed 7 if the process genuinely requires it.
- Every step title must use an action verb: "Review", "Draft", "Approve", "Submit", "Collect", "Validate", "Prepare"
- Every step description must answer: what to do, with what, producing what
- input_label is the form prompt the assignee reads before submitting — make it specific. Bad: "Add notes". Good: "Describe your findings on budget feasibility. Include the proposed figure and any conditions for approval."
- estimated_days: be realistic — legal reviews: 2-3d, finance approvals: 1-2d, document drafting: 2-3d, quick decisions: 0.5d, client waiting: 3-5d
- Don't assign the same person to back-to-back steps unless no one else fits
- Steps must be strictly sequential — each one must complete before the next begins

STEP TYPE SELECTION:
- "human": any step where a person does work — analysis, drafting, reviewing, approving, data entry, client interaction
  → MUST have input_type and input_label
  → input_type choices: "text" (written summary/report), "approval" (binary Approve/Reject), "file" (document upload), "number" (a single value), "range" (min–max values)
  → Match input_type to what the step produces: decisions → approval, written findings → text, documents → file
- "generator": AI produces a draft document using outputs from prior steps — use sparingly, only for document creation
  → tool choices: "generators__word" (proposals, reports, memos), "generators__xlsx" (financial models, trackers), "generators__pptx" (presentations), "generators__email_draft" (communications)
  → Never use generator for a step that is simply reviewing or approving something

TEAM ASSIGNMENT RULES:
- Use the TEAM MEMBERS block to identify the right owner for each step by their role, department, and responsibilities
- Prefer assignee_id (specific person's UUID) over department labels whenever a suitable person exists
- Match: legal steps → person with Legal role, finance steps → Finance person, client-facing → senior/owner, approvals → the person with highest authority who is appropriate
- If the team is small and one person must own multiple steps, space them out (not consecutive)
- NEVER put a person's name in the JSON — only their UUID in the assignee_id field`;

export function buildProcessSystemPrompt(
  userContext: string,
  companyName: string,
  teamMembers: Array<{
    id: string;
    full_name: string;
    role: string;
    department?: string;
    job_role?: string;
    responsibilities?: string[];
    authority?: string;
  }>
): string {
  const companyBlock = companyName
    ? `COMPANY: ${companyName}`
    : '';

  const teamBlock = teamMembers.length > 0
    ? 'TEAM MEMBERS (assign steps to these people):\n' + teamMembers.map(m => {
        const lines = [`  ${m.full_name}`];
        lines.push(`    ID: ${m.id}`);
        lines.push(`    Company role: ${m.role}${m.department ? ` | Department: ${m.department}` : ''}`);
        if (m.job_role) lines.push(`    Job title: ${m.job_role}`);
        if (m.authority && m.authority !== 'unknown') lines.push(`    Authority: ${m.authority}`);
        if (m.responsibilities?.length) lines.push(`    Responsibilities: ${m.responsibilities.slice(0, 4).join(', ')}`);
        return lines.join('\n');
      }).join('\n\n')
    : 'TEAM MEMBERS: No team members found — use department labels only (e.g. "Legal", "Finance", "HR").';

  return PROCESS_SYSTEM_PROMPT
    .replace('{{USER_CONTEXT}}', userContext ? `${userContext}\n` : '')
    .replace('{{COMPANY_CONTEXT}}', companyBlock ? `${companyBlock}\n` : '')
    .replace('{{TEAM_CONTEXT}}', teamBlock);
}

export function parseProcessPlanResponse(text: string): { message: string; plan: ProcessPlan | null } {
  const sepIdx = text.indexOf(PLAN_SEPARATOR);
  if (sepIdx === -1) {
    return { message: text.trim(), plan: null };
  }
  const message = text.slice(0, sepIdx).trim();
  const jsonPart = text.slice(sepIdx + PLAN_SEPARATOR.length).trim();

  if (!jsonPart || jsonPart === 'null') {
    return { message, plan: null };
  }

  try {
    const cleaned = jsonPart.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const plan = JSON.parse(cleaned) as ProcessPlan;
    return { message, plan };
  } catch {
    return { message, plan: null };
  }
}

export async function getTeamMembers(
  companyId: string,
  _supabase: SupabaseClient
): Promise<Array<{
  id: string;
  full_name: string;
  role: string;
  department?: string;
  job_role?: string;
  responsibilities?: string[];
  authority?: string;
}>> {
  const { createClient: createAdminClient } = await import('@supabase/supabase-js');
  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: members } = await adminClient
    .from('company_members')
    .select('user_id, role')
    .eq('company_id', companyId)
    .eq('status', 'active');

  if (!members?.length) return [];

  const userIds = members.map((m: any) => m.user_id);

  const [profilesResult, identitiesResult] = await Promise.all([
    adminClient.from('profiles').select('id, full_name').in('id', userIds),
    adminClient
      .from('context_profiles')
      .select('user_id, profile_data')
      .in('user_id', userIds)
      .eq('profile_type', 'identity'),
  ]);

  const profileMap: Record<string, string> = {};
  for (const p of profilesResult.data ?? []) {
    profileMap[p.id] = p.full_name ?? 'Unknown';
  }

  const identityMap: Record<string, any> = {};
  for (const i of identitiesResult.data ?? []) {
    identityMap[i.user_id] = i.profile_data;
  }

  return members.map((m: any) => {
    const identity = identityMap[m.user_id];
    return {
      id: m.user_id,
      full_name: profileMap[m.user_id] ?? 'Unknown',
      role: m.role,
      department: identity?.department,
      job_role: identity?.role || identity?.jobRole,
      responsibilities: identity?.responsibilities,
      authority: identity?.authority,
    };
  });
}
