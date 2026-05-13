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

// ── Shared source credentials ─────────────────────────────────────────────────
// RSS feeds are publicly accessible — auth stored for fetch_url full-article reads
const AUTH_HANDELSBLATT = { username: 'monica-goncalves@ccila-portugal.com', password: 'aHK#2025_neu' };
const AUTH_JDN          = { username: 'monica-goncalves@ccila-portugal.com', password: 'AHK2026#nova' };
const AUTH_OBSERVADOR   = { username: 'Monica-goncalves@ccila-portugal.com', password: 'AHK2025' };
// manager magazin: thorsten-koetschau@ccila-portugal.com — password pending

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
const SRC_OBSERVADOR = {
  label: 'Observador',
  feeds: ['https://observador.pt/feed/'],
};
const SRC_JN = {
  label: 'Jornal de Notícias',
  feeds: ['https://www.jn.pt/feed/'],
};
const SRC_DN = {
  label: 'Diário de Notícias',
  feeds: ['https://www.dn.pt/feed/'],
};

function rssStep(src: { label: string; feeds: string[]; auth?: object }, maxItems = 15) {
  return {
    type: 'tool',
    id: stepId(),
    label: src.label,
    tool: 'rss_feed',
    config: {
      feeds: src.feeds,
      max_items: maxItems,
      since: 'last_run',
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

Output in English. Be selective — 3 strong topics beat 7 mediocre ones. If fewer than 3 strong topics exist this week, say so and explain.`,
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

function fetchStep(label: string, urls: string[], auth?: object) {
  return {
    type: 'tool',
    id: stepId(),
    label,
    tool: 'fetch_url',
    config: {
      urls,
      ...(auth ? { auth } : {}),
    },
  };
}

const briefingSteps = [
  rssStep(SRC_SPIEGEL),
  rssStep(SRC_WIWO),
  rssStep(SRC_FAZ),
  rssStep(SRC_HANDELSBLATT),
  fetchStep('Handelsblatt — Full articles', ['https://www.handelsblatt.com/wirtschaft/'], AUTH_HANDELSBLATT),
  rssStep(SRC_MANAGER_MAGAZIN),
  rssStep(SRC_JDN),
  fetchStep('Jornal de Negócios — Full articles', ['https://www.negocios.pt/economia/'], AUTH_JDN),
  rssStep(SRC_OBSERVADOR),
  fetchStep('Observador — Full articles', ['https://observador.pt/economia/'], AUTH_OBSERVADOR),
  rssStep(SRC_JN),
  rssStep(SRC_DN),
  {
    type: 'tool',
    id: stepId(),
    label: 'Base.gov.pt — Contratos Públicos (dados.gov.pt)',
    tool: 'fetch_url',
    config: {
      // IMPIC publishes biweekly contract dumps here — free, no auth, no WAF.
      // Returns dataset metadata: last update date + download URLs for current year file.
      // TODO (once IMPIC APIBase2 token arrives): replace with
      //   url: 'https://www.base.gov.pt/APIBase2/GetInfoContrato?numDias=7'
      //   headers: { '_AcessToken': '<token>' }
      // which gives real-time last-7-days contracts as JSON.
      urls: ['https://dados.gov.pt/api/1/datasets/contratos-publicos-portal-base-impic-contratos-de-2012-a-2026/'],
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
   Public tenders and procurement opportunities. Sources: (a) dados.gov.pt dataset metadata — note the last update date and total contract volume for 2026; (b) web search results — extract any specific tenders or contracts relevant to German companies or bilateral business. Include: title, contracting authority, estimated value if available, deadline if available. Note: full real-time tender feed via IMPIC APIBase2 pending token delivery.

6. Umwelt & Energie
   Sustainability, green economy, energy transition, and ESG developments relevant to the German-Portuguese business community.

7. Quellenverzeichnis
   Complete list of all sources referenced, with publication name and date.

RULES:
- Write entirely in German (Deutsch)
- Each item: what happened → why it matters for German-Portuguese business → source
- Strictly factual and neutral — no political opinions, no editorialising
- If a section has no relevant news this week, write "Keine relevanten Meldungen diese Woche."
- Prioritise quality over quantity — only include items with clear bilateral relevance`,
    output_format: 'markdown',
    model_tier: 'reasoning',
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
