// Seed script: AHK Portugal PoC
// Creates LinkedIn Content + Executive Briefing workflows for user alextcollignon@gmail.com
// Run:        npx tsx scripts/seed-ahk.ts          — creates fresh workflows
// Run:        npx tsx scripts/seed-ahk.ts patch     — patches steps on existing workflows

import { createClient } from '@supabase/supabase-js';
import { computeNextRun } from '../lib/workflows/schedule';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const USER_ID = process.env.SEED_USER_ID ?? '08fe4449-e5eb-431d-9156-02e9324e5903';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars. Copy from .env.local and run:\n  SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/seed-ahk.ts');
  process.exit(1);
}

// Existing workflow IDs (created on 2026-05-12)
const LINKEDIN_WORKFLOW_ID  = '41939e06-72b2-43eb-b64b-0abdb7627063';
const BRIEFING_WORKFLOW_ID  = 'e9581093-4d79-49fa-ac64-e877fad8e97f';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function stepId() {
  return `step_${Math.random().toString(36).slice(2, 10)}`;
}

// ── Sources ──────────────────────────────────────────────────────────────────
// ⚠️ NO fetch_url on section landing pages (e.g. observador.pt/economia/). A landing
// page is a date-blind soup of teasers + evergreen/related links of any age — a 2021
// article entered a 2026 briefing this way and the synthesis redated it as current
// (real client incident, July 2026). RSS items carry publication dates and a
// since-last-run cutoff; full-article depth must come from fetching SPECIFIC dated
// article URLs, never a section front page.

// ── RSS source definitions ─────────────────────────────────────────────────────
// German sources
const SRC_SPIEGEL = {
  label: 'Spiegel — Wirtschaft',
  feeds: ['https://www.spiegel.de/wirtschaft/index.rss'],
};
const SRC_WIWO = {
  label: 'WirtschaftsWoche',
  feeds: ['https://www.wiwo.de/contentservice/content/rss/alle_nachrichten/rss.xml'],
};
const SRC_FAZ = {
  label: 'FAZ — Wirtschaft',
  feeds: ['https://www.faz.net/rss/aktuell/wirtschaft/'],
};
const SRC_HANDELSBLATT = {
  label: 'Handelsblatt',
  feeds: ['https://www.handelsblatt.com/contentexport/feed/schlagzeilen'],
};
const SRC_MANAGER_MAGAZIN = {
  label: 'manager magazin',
  feeds: [
    'https://www.manager-magazin.de/politik/index.rss',
    'https://www.manager-magazin.de/unternehmen/index.rss',
    'https://www.manager-magazin.de/finanzen/index.rss',
  ],
  // auth pending: thorsten-koetschau@ccila-portugal.com
};
// Portuguese sources
const SRC_JDN = {
  label: 'Jornal de Negócios',
  feeds: ['https://www.negocios.pt/rss'],
};
// Observador exposes NO working economy-only feed (/economia/ and /rss/economia
// redirect to a stale 2021 article; /seccao/economia/feed/ silently serves the
// site-wide feed) — so: general feed + category filter.
const SRC_OBSERVADOR = {
  label: 'Observador (Economia)',
  feeds: ['https://observador.pt/feed/'],
  category_filter: ['Economia', 'Empresas', 'Mercados', 'Energia'],
  max_items: 20,
};
const SRC_JN = {
  label: 'Jornal de Notícias',
  feeds: ['https://www.jn.pt/feed/'],
};
const SRC_DN = {
  label: 'Diário de Notícias',
  feeds: ['https://www.dn.pt/feed/'],
};

// The canonical freshness contract for every AHK AI step (the live workflows carry the
// same block — keep them in sync). Born from the redated-2021-article incident.
const DATE_DISCIPLINE = `DATE DISCIPLINE (HARD RULES — violations destroy client trust):
- The system message states today's date. Cover ONLY the 7 days up to and including today.
- Use ONLY facts present in the previous steps' source material. Never supplement from your own background knowledge or memory.
- Include an item ONLY if its publication date is stated in the source material AND falls inside that window. No stated date, or a date outside the window: EXCLUDE the item entirely.
- NEVER alter, shift, or modernize any date, year, or figure from the source material to make it fit the current period. Old news does not become this week's news; it gets excluded.
- Citation dates must be copied exactly from the source material. NEVER infer or invent a publication date.
- An empty section is honest; a stale or redated item is a defect. When in doubt, leave it out.`;

function rssStep(src: { label: string; feeds: string[]; auth?: object; category_filter?: string[]; max_items?: number }, maxItems = 15) {
  return {
    type: 'tool',
    id: stepId(),
    label: src.label,
    tool: 'rss_feed',
    config: {
      feeds: src.feeds,
      max_items: src.max_items ?? maxItems,
      since: 'last_run',
      ...(src.category_filter ? { category_filter: src.category_filter } : {}),
      ...(src.auth ? { auth: src.auth } : {}),
    },
  };
}

// ── 1. LinkedIn Content Workflow ──────────────────────────────────────────────

const linkedinSteps = [
  rssStep(SRC_SPIEGEL),
  rssStep(SRC_WIWO),
  rssStep(SRC_FAZ),
  rssStep(SRC_HANDELSBLATT),
  rssStep(SRC_MANAGER_MAGAZIN),
  rssStep(SRC_JDN),
  rssStep(SRC_OBSERVADOR),
  rssStep(SRC_JN),
  rssStep(SRC_DN),
  {
    type: 'ai',
    id: stepId(),
    label: 'Topic filter — bilateral relevance',
    prompt: `You are the content strategist for AHK Portugal (the German-Portuguese Chamber of Commerce).

Review all the news articles from the previous steps. Your task: identify the 3–5 stories most suitable for a LinkedIn post by AHK Portugal this week.

SELECTION CRITERIA (in order of priority):
1. Clear German-Portuguese angle — affects German companies operating in Portugal, or Portuguese companies with German/EU exposure
2. Business and economic relevance — trade, investment, regulation, innovation, sustainability, energy
3. Audience resonance — senior executives, entrepreneurs, business development professionals, diplomats
4. Newsworthiness — developments from the past 7 days that aren't already widely discussed

For each selected topic, write:
- **Headline**: one line, specific and compelling
- **Why it matters for AHK's audience**: one sentence tying the development to German-Portuguese business
- **Post angle**: the specific lens AHK should take (e.g. "frame as investment opportunity", "position as risk to monitor", "celebrate bilateral milestone")
- **Key fact or stat**: the single most powerful data point or quote to anchor the post
- **Source**: publication name and approximate date

Output in English. Be selective — 3 strong topics beat 7 mediocre ones. If fewer than 3 strong topics exist this week, say so and explain.

${DATE_DISCIPLINE}`,
    output_format: 'markdown',
    model_tier: 'reasoning',
  },
  {
    type: 'tool',
    id: stepId(),
    label: 'Draft LinkedIn posts',
    tool: 'linkedin_post',
    config: {
      tone: 'thought_leadership',
      length: 'standard',
      format: 'insight',
      language: 'en',
      variants: 2,
      include_image_prompt: false,
      // voice_kb_file_id: '' — set once voice reference file is uploaded to KB
    },
  },
];

const linkedinWorkflow = {
  user_id: USER_ID,
  name: 'AHK LinkedIn Content',
  description: 'Weekly LinkedIn content engine — scans German and Portuguese business sources, filters for bilateral relevance, drafts 2 post variants ready for review.',
  icon: 'pencil-square',
  color: 'blue',
  status: 'active',
  trigger: {
    type: 'schedule',
    cron: '0 8 * * 3',
    timezone: 'Europe/Lisbon',
    label: 'Every Wednesday at 9am Lisbon',
  },
  steps: linkedinSteps,
  output_config: {
    destination: 'artifact',
    artifact_type: 'document',
    title_template: 'LinkedIn Content — Week of {{week_of}}',
    notification_mode: 'inbox_card',
  },
};

// ── 2. Executive Briefing Workflow ────────────────────────────────────────────
// (Landing-page fetch_url steps removed 2026-07-30 — see the sources note above.)

const briefingSteps = [
  rssStep(SRC_SPIEGEL),
  rssStep(SRC_WIWO),
  rssStep(SRC_FAZ),
  rssStep(SRC_HANDELSBLATT),
  rssStep(SRC_MANAGER_MAGAZIN),
  rssStep(SRC_JDN),
  rssStep(SRC_OBSERVADOR),
  rssStep(SRC_JN),
  rssStep(SRC_DN),
  {
    type: 'tool',
    id: stepId(),
    label: 'Base.gov.pt — Contratos Públicos (últimos 7 dias)',
    tool: 'get_pt_tenders',
    config: {
      days: 7,
      endpoint: 'both',
    },
  },
  {
    type: 'tool',
    id: stepId(),
    label: 'Licitações Públicas — Pesquisa Recente',
    tool: 'web_search',
    config: {
      query: 'adjudicação contrato público Portugal empresa alemã investimento infraestrutura semana',
    },
  },
  {
    type: 'ai',
    id: stepId(),
    label: 'Synthesise 7-section briefing',
    prompt: `You are preparing the weekly AHK Portugal Executive Briefing for the leadership team.

REFERENCE TEMPLATES: The attached documents are real past AHK Portugal briefings. Before writing, study them carefully:
- Match their exact formatting conventions (headings, bullet style, spacing, section order)
- Match their tone: professional, concise, senior-executive audience, no fluff
- Match their level of detail per item: typically 2–4 sentences, one source reference inline
- Match how they handle the Quellenverzeichnis (numbered list or grouped by section)
- If the templates use a specific KW notation, date format, or header style, replicate it exactly

Using all news and information from the previous steps, produce a structured briefing in German (Deutsch) with these 7 sections:

1. Executive Signals — Top-Meldungen der Woche
   The 3–5 most important developments requiring senior leadership attention. State the implication for AHK Portugal or its member companies.

2. Politische Entwicklungen
   Key political and regulatory developments in Portugal, Germany, and the EU directly relevant to the bilateral business relationship.

3. Wirtschaft & Märkte
   Macroeconomic indicators, sector trends, and market movements relevant to German companies in Portugal and Portuguese companies with German exposure.

4. Investitionsradar
   Investment announcements, M&A activity, company expansions, and new market entries of bilateral interest.

5. Deal Flow & Ausschreibungen
   Public tenders and procurement opportunities from Portal Base (Base.gov.pt). For each item include: title / object, contracting authority, estimated or contracted value, publication date, and deadline if available. Flag any contracts or announcements with bilateral relevance (German companies operating in Portugal, infrastructure, energy, technology, professional services).

6. Umwelt & Energie
   Sustainability, green economy, energy transition, and ESG developments relevant to the German-Portuguese business community.

7. Quellenverzeichnis
   Complete list of all sources referenced, with publication name and date.

RULES:
- Write entirely in German (Deutsch)
- Each item: what happened → why it matters for German-Portuguese business → source
- Strictly factual and neutral — no political opinions, no editorialising
- If a section has no relevant news this week, write "Keine relevanten Meldungen diese Woche."
- Prioritise quality over quantity — only include items with clear bilateral relevance

${DATE_DISCIPLINE}`,
    output_format: 'markdown',
    model_tier: 'reasoning',
  },
  // The grounding gate — added after a live incident where the synthesis garnished
  // grounded facts with confident background knowledge (a wrong ownership claim,
  // invented "scheduled events"). Runs LAST so its output is the deliverable.
  {
    type: 'ai',
    id: stepId(),
    label: 'Verification gate (grounding check)',
    prompt: `You are the FINAL VERIFICATION GATE for this briefing. The output of the immediately preceding step is the DRAFT; every step before it is the SOURCE MATERIAL.

Go through the draft claim by claim and verify each against the source material:
1. GROUNDING: every fact, number, name, ownership claim, and background statement must appear in the source material. Delete or correct anything that does not, no matter how plausible it sounds. Do not add new facts of your own.
2. DATES: every cited date must appear in the source material; items outside the briefing window are removed. Forward-looking / "next week" entries are kept ONLY if the source material states the event and its date — delete invented calendar entries.
3. CITATIONS: every citation's outlet, title, date, and URL must match the source material. Fix mismatched URLs; remove citations with no matching source.
4. STYLE: enforce the draft's own stated style rules (e.g. if the draft's brief forbids em dashes, replace every em dash with a comma, semicolon, or full stop; keep the required language and date format).
5. STRUCTURE: reproduce the draft's title/header line, sections, section order, and headers EXACTLY as they are — do not rename, merge, add, or drop any section (the sources section stays). Do not rewrite prose that passes verification. This is a surgical pass, not an edit for taste; you are a verifier, not an author. If EVERY entry of a section fails verification, KEEP the section header and put one honest line in the briefing's language (e.g. "Keine relevanten Meldungen diese Woche." / "Sem eventos verificáveis esta semana.") — never drop or renumber a section.

Output ONLY the corrected briefing in full, in the same language and format as the draft. No preamble, no commentary, no list of changes.`,
    output_format: 'markdown',
    model_tier: 'reasoning',
    use_worker_identity: false,
  },
];

const briefingWorkflow = {
  user_id: USER_ID,
  name: 'AHK Executive Briefing',
  description: 'Weekly 7-section executive briefing for AHK Portugal leadership, drawing from German and Portuguese business sources.',
  icon: 'newspaper',
  color: 'indigo',
  status: 'active',
  trigger: {
    type: 'schedule',
    cron: '0 7 * * 1',
    timezone: 'Europe/Lisbon',
    label: 'Every Monday at 8am Lisbon',
  },
  steps: briefingSteps,
  output_config: {
    destination: 'artifact',
    artifact_type: 'document',
    title_template: 'AHK Briefing — {{week_of}}',
    notification_mode: 'inbox_card',
  },
};

// ── Run ───────────────────────────────────────────────────────────────────────

function nextRun(trigger: { cron: string; timezone: string }) {
  const d = computeNextRun(trigger.cron, trigger.timezone);
  return d ? d.toISOString() : null;
}

async function patch() {
  console.log('Patching existing AHK workflows with updated steps + next_run_at...\n');

  const linkedinNextRun = nextRun(linkedinWorkflow.trigger);
  const { error: e1 } = await supabase
    .from('workflows')
    .update({ steps: linkedinSteps, next_run_at: linkedinNextRun })
    .eq('id', LINKEDIN_WORKFLOW_ID)
    .eq('user_id', USER_ID);
  console.log(e1 ? `✗ LinkedIn patch failed: ${e1.message}` : `✓ LinkedIn workflow updated — next run: ${linkedinNextRun} (${LINKEDIN_WORKFLOW_ID})`);

  const briefingNextRun = nextRun(briefingWorkflow.trigger);
  const { error: e2 } = await supabase
    .from('workflows')
    .update({ steps: briefingSteps, next_run_at: briefingNextRun })
    .eq('id', BRIEFING_WORKFLOW_ID)
    .eq('user_id', USER_ID);
  console.log(e2 ? `✗ Briefing patch failed: ${e2.message}` : `✓ Briefing workflow updated — next run: ${briefingNextRun} (${BRIEFING_WORKFLOW_ID})`);
}

async function create() {
  console.log('Creating AHK Portugal workflows...\n');

  const { data: linkedin, error: e1 } = await supabase
    .from('workflows')
    .insert({ ...linkedinWorkflow, next_run_at: nextRun(linkedinWorkflow.trigger) })
    .select('id, name').single();
  console.log(e1 ? `✗ LinkedIn insert failed: ${e1.message}` : `✓ Created: "${linkedin!.name}" (${linkedin!.id})`);

  const { data: briefing, error: e2 } = await supabase
    .from('workflows')
    .insert({ ...briefingWorkflow, next_run_at: nextRun(briefingWorkflow.trigger) })
    .select('id, name').single();
  console.log(e2 ? `✗ Briefing insert failed: ${e2.message}` : `✓ Created: "${briefing!.name}" (${briefing!.id})`);

  console.log(`\nNext steps:`);
  console.log(`  1. Upload the 4 briefing examples to KB`);
  console.log(`  2. Briefing workflow → synthesis step → select them as reference documents`);
  console.log(`  3. Upload past AHK LinkedIn posts to KB → set as voice reference on LinkedIn workflow`);
  console.log(`  4. Run both workflows manually to verify output`);
}

const mode = process.argv[2];
(mode === 'patch' ? patch() : create()).catch(console.error);
