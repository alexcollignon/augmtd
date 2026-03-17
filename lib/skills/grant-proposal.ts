/**
 * Skill briefs for grant proposal generation.
 *
 * GRANT_PROPOSAL_REASONING      — injected into executeStep() system prompt for all
 *                                  intermediate steps.
 * GRANT_PROPOSAL_GENERATION     — replaces DOCX_SKILL in assembleArtifactFromSteps().
 * GRANT_PROPOSAL_REQUIREMENTS_SCHEMA — drives the structured requirements extraction
 *                                  pass that runs before the step loop.
 * GRANT_PROPOSAL_SKILL_REVIEW   — drives the post-generation QA pass.
 */

export const GRANT_PROPOSAL_REASONING = `
GRANT PROPOSAL WORKFLOW — apply this knowledge to all steps in this plan:

EXTRACTING CFP REQUIREMENTS:
When processing a call for proposals document, extract and record all of the following:
- Funder & programme (e.g. Horizon Europe – ERC Starting Grant, FCT, EIT KIC, private foundation)
- Call identifier and reference number (e.g. ERC-2025-StG)
- Submission deadline — exact date and time
- Page or word limits — per section if specified; note if overall limit only
- Eligible countries or institutions
- Funding ceiling and project duration
- Evaluation criteria — exact names and weightings if provided
- Mandatory section titles — copy exact wording from the call
- Template or form requirements (e.g. must use EU Part B template)
- Thematic scope, panel, domain, or SDG alignment
Flag anything ambiguous or absent before proceeding.

IDENTIFYING THE FUNDER TEMPLATE:
Map the call to exactly one funder type. Use these signals:

Horizon Europe (ERC, MSCA, RIA, IA, CSA):
  Signals: "Horizon Europe", "EU", "H2020", "Part B", "Excellence / Impact / Implementation"
  Structure — Part B1: 1. Excellence (State of the Art, Objectives, Methodology)
                        2. Impact (Outcomes, Dissemination, Communication)
                        3. Implementation (Work Plan, Consortium, Resources)
             Part B2: Budget justification + CVs (confidential section)

ERC (StG, CoG, AdG, SyG):
  Signals: "ERC", "Starting Grant", "Consolidator", "Advanced Grant", "Synergy"
  Structure: Extended Synopsis (2pp) → State of the Art → Objectives and Ambition
             → Methodology and Feasibility → Resources (Team + Budget)
  Note: groundbreaking, high-risk/high-gain framing is expected and rewarded.

MSCA (Postdoctoral Fellowships, Doctoral Networks):
  Signals: "MSCA", "Marie Skłodowska-Curie", "postdoctoral fellowship", "doctoral network"
  Structure: Excellence → Impact → Implementation
  Note: researcher's individual development and training are primary evaluation criteria.

FCT (Fundação para a Ciência e a Tecnologia):
  Signals: "FCT", "Fundação para a Ciência", "Portugal"
  Structure: Summary → Objectives → State of the Art → Work Plan → Budget
             → Expected Results & Dissemination → Team & Infrastructure

EIT (Knowledge and Innovation Communities):
  Signals: "EIT", "KIC", "knowledge and innovation"
  Structure: Problem Statement → Innovation Concept → Business Model & Sustainability
             → Impact & KPIs → Team & Partners → Budget & Timeline

Private Foundations / Industry Grants:
  Signals: named foundation, corporate funder, no EU/national programme reference
  Structure: Executive Summary → Problem Statement → Objectives → Methodology
             → Expected Impact → Budget → Team

BUILDING THE OUTLINE (Step 3):
For each section produce:
- Section title using exact funder terminology from the call
- 2–4 bullet points of proposed content and key arguments
- Which evaluation criterion this section primarily addresses
- Any information still needed from the user to complete this section
Keep the outline concise — it feeds directly into the full proposal writing step.
`.trim();


export const GRANT_PROPOSAL_GENERATION = `
GRANT PROPOSAL QUALITY RULES (follow exactly):

TONE AND REGISTER:
- Declarative and precise. Management-academic register.
- No em dashes. No hedging ("it could be argued", "this may suggest", "potentially").
- Active voice. Present tense for current state, future tense for proposed work.
- Every claim of novelty must be anchored to a gap in existing literature or practice.
- Every objective must connect to at least one evaluation criterion named in the step outputs.
- Use the exact section titles required by the funder — do not rename or reorder.

SECTION CONTENT RULES:

State of the Art / Background:
- Write a gap analysis, not a literature review.
- Identify the frontier of knowledge in 3–5 references.
- State the gap in one explicit sentence: "Current research does not address X."

Objectives:
- Numbered. Each must be SMART: Specific, Measurable, Achievable, Relevant, Time-bound.
- Connect each objective to a work package or deliverable.

Methodology:
- Explain why this approach over alternatives — not just what you will do, but why.
- For quantitative work: data sources, sample, analytical models.
- For qualitative work: case selection logic, data collection, analysis framework.

Impact:
- Distinguish scientific impact (contribution to knowledge), societal impact (real-world
  change), and economic impact (market or policy relevance).
- Reference the funder's stated priority areas explicitly using their terminology.

Budget:
- Justify every line item — not just totals.
- State overhead/indirect cost rate applied.
- Personnel effort must match budget figures.

FUNDER-SPECIFIC ADJUSTMENTS (use funder identified in step outputs):
ERC: "Groundbreaking" and "high-risk/high-gain" language is expected and rewarded.
  Do not soften ambitions. Highlight PI's 5 key publications and track record.
  Never write an incremental proposal — reviewers penalise it.
MSCA: Researcher's individual development is a primary criterion.
  Training plan, secondment plan, and career development must be detailed.
  Gender dimension in research content is evaluated — address it explicitly.
Horizon Europe: Use exact Part B section titles. Open Science compliance section
  is mandatory. Data Management Plan required. State TRL for Innovation Actions.
FCT: Include h-index and citation counts for all named team members.
  Justify equipment purchases against existing institutional infrastructure.
Private/Industry: Emphasise societal relevance over scientific novelty.
  Include sustainability and scale-up narrative. Justify overheads explicitly.

MISSING USER CONTENT:
Where specific research content, data, or citations have not been provided, write:
  [INSERT: brief description of what is needed here]
Never fabricate research data, statistics, citations, or PI-specific achievements.

COMMON DISQUALIFIERS TO AVOID:
- Exceeding page or word limits (disqualifies in most EU calls)
- Generic objectives not tied to the call's thematic priorities
- Methods described without justifying their selection
- Budget lines that do not match personnel effort in the work plan
- Ignoring mandatory open science or data management requirements
- Institution-specific acronyms used without definition

OUTPUT COMPLETENESS RULES (non-negotiable):
- CRITICAL OVERRIDE: If the prompt contains a CALL REQUIREMENTS block with a mandatory_sections
  field, use those strings verbatim as your sections[].heading values in that exact order.
  This overrides any structure implied by your training or general knowledge of the funder.
- Your JSON sections array must reproduce ALL mandatory sections from the funder template
  identified in the step outputs — exact titles, exact order. Do not collapse or omit sections.
- Every section must contain a minimum of 3 substantive paragraphs. One-sentence sections
  are not acceptable. Use the full content produced in the intermediate steps.
- Objectives must appear in their own section as a numbered list (1., 2., 3...) — not buried
  in prose. Each objective must be explicitly SMART.
- Where specific data, citations, or PI-specific content is missing, write
  [INSERT: brief description] rather than inventing numbers or paraphrasing generically.
- Completeness and fidelity to the funder structure take priority over brevity.
`.trim();


/**
 * Schema for the structured requirements extraction pass (Enhancement B).
 * Keys become JSON fields in the extracted requirements object.
 * Values describe what to look for — used verbatim in the extraction prompt.
 */
export const GRANT_PROPOSAL_REQUIREMENTS_SCHEMA: Record<string, string> = {
  funder_identity:       'Name of the funding body and programme (e.g. "Horizon Europe – ERC Starting Grant", "FCT", "EIT Digital")',
  call_id:               'Call identifier or reference number as it appears in the document (e.g. "ERC-2025-StG", "EIT-HEI-2025-BUILDING-SYNERGIES")',
  submission_deadline:   'Exact submission deadline including time and timezone if stated',
  funding_ceiling:       'Maximum grant amount in euros or stated currency',
  project_duration:      'Maximum project duration in months or years',
  page_limits:           'Page or word limits — overall and per-section if specified',
  mandatory_sections:    'Exact section titles in the required order, comma-separated, as they appear in the call template',
  evaluation_criteria:   'Criteria names and weightings exactly as stated (e.g. "Excellence 50%, Impact 30%, Implementation 20%")',
  eligible_entities:     'Eligible countries, institution types, or principal investigator eligibility conditions',
  template_requirement:  'Whether a specific template or form is required (e.g. "EU Part B template mandatory")',
  thematic_scope:        'Thematic domain, panel, or SDG alignment stated in the call',
  open_science_required: 'Whether open science compliance or a data management plan is mandatory — yes/no and any specifics',
  kpi_targets:           'KPI codes or quantitative targets explicitly stated in the call (e.g. "EITHE03.1: 6 start-ups", "EITHE08.1: 4000 trained")',
  budget_restrictions:   'Any specific budget line restrictions, indirect cost rates, or co-funding requirements stated',
  consortium_requirements: 'Minimum number of partners, required partner types (HEI, business, non-HEI), or geographic requirements',
};


/**
 * QA review brief for post-generation validation (Enhancement C).
 * Injected as the system prompt of the QA review call.
 */
export const GRANT_PROPOSAL_SKILL_REVIEW = `
GRANT PROPOSAL QA REVIEW — evaluate the generated proposal against the call requirements and quality rules.

You are a senior grant consultant reviewing a completed proposal draft before submission.

OUTPUT FORMAT: Return ONLY valid JSON — no markdown, no explanation:
{
  "issues": [
    {
      "section": "section name or null",
      "type": "missing_section | fabricated_data | structural | requirement_gap | other",
      "description": "Concise description of the specific problem",
      "severity": "error | warning"
    }
  ],
  "score": <integer 0-100>,
  "summary": "One to two sentence plain-language verdict."
}

SCORING: Start at 100. Deduct 20 for each error. Deduct 5 for each warning.
Score below 60 = proposal has blocking issues that would likely disqualify it.

CHECK FOR:

1. MISSING SECTIONS (severity: error)
   Compare the sections present in the generated document against mandatory_sections
   from CALL REQUIREMENTS. Any required section absent = one missing_section error.

2. FABRICATED DATA (severity: error)
   Flag any specific statistic, number, citation (author/year), PI publication,
   or named individual that does NOT appear in the CALL REQUIREMENTS block.
   Generic [INSERT: ...] placeholders are correct — do NOT flag them.
   Round numbers like "4,000 participants" are only valid if they appear in CALL REQUIREMENTS.

3. STRUCTURAL ISSUES (severity: warning)
   - Sections out of funder-required order
   - Objectives section present but objectives are not numbered
   - Any numbered objective missing a measurable target or time-bound element

4. REQUIREMENT GAPS (severity: warning)
   - Evaluation criteria from CALL REQUIREMENTS not explicitly addressed in corresponding sections
   - Open science / data management plan absent if open_science_required = yes
   - Budget section missing per-line justification or indirect cost rate
   - Consortium requirements from CALL REQUIREMENTS not addressed

5. DISQUALIFIERS (severity: error)
   - Methods described without justification of why this approach over alternatives
   - Budget lines without personnel effort matching
   - Undefined acronyms used more than once
   - Any section with only one paragraph where 3+ are required
`.trim();
