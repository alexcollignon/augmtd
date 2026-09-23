// Shared coworker role → avatar/label maps. Single source of truth — was
// duplicated across workers-roster.tsx, workers-setup-view.tsx, team-home-view.tsx.

export const ROLE_AVATARS: Record<string, string> = {
  personal_assistant: '/workers/clara.png',
  content_manager:    '/workers/sofia.png',
  branding_expert:    '/workers/luca.png',
  linkedin_drafter:   '/workers/luca.png', // legacy role key
  research_analyst:   '/workers/max.png',
};

// Clara PROMOTED (owner, Sep 7): the assistant label → CHIEF OF STAFF, platform-wide. The threads
// arc seated her as the CoS; the label now says it everywhere. Role KEY stays `personal_assistant`
// (Slack app mapping, email local-parts, AgentOS routing and the seat resolver hang off keys — the
// Luca lesson: the label and the persona move, the key is identity).
export const ROLE_LABELS: Record<string, string> = {
  personal_assistant: 'Chief of Staff',
  content_manager:    'Content Strategist',
  branding_expert:    'LinkedIn Expert',
  linkedin_drafter:   'LinkedIn Expert', // legacy role key
  research_analyst:   'Research Analyst',
};

// ── THE SPECIALTY VOCABULARY (W4.1 — one source, keyed by ROLE KEY, never by a coworker's name) ──
// The DM first contact is CHROME, not speech (docs/threads-plan.md "SPEECH IS COMPOSED, NEVER
// TEMPLATED": deterministic text is lawful only as labels/vocabulary or as the floor beneath a
// composed pass — a template must not wear a face). So these are LABELS (noun phrases) and tappable
// starters; a role without an entry degrades to GENERIC_STARTERS and no specialty — never invented.
export const ROLE_SPECIALTIES: Record<string, string> = {
  personal_assistant: 'drafts, reports, agendas, follow-ups',
  content_manager:    'documents and content',
  branding_expert:    'LinkedIn posts, cadence, brand voice',
  linkedin_drafter:   'LinkedIn posts, cadence, brand voice', // legacy role key
  research_analyst:   'research, comparisons, data analysis',
};

export type RoleStarter = { label: string; say: string };

const LINKEDIN_STARTERS: RoleStarter[] = [
  { label: 'Draft a LinkedIn post', say: 'Draft a LinkedIn post about a recent team milestone — professional but human.' },
  { label: 'Plan a month of posts', say: 'Suggest five LinkedIn post ideas for this month based on what my company does.' },
  { label: 'Rework my draft', say: 'I will paste a rough draft — rework it into a stronger LinkedIn post that keeps my voice.' },
];

export const ROLE_STARTERS: Record<string, RoleStarter[]> = {
  personal_assistant: [
    { label: 'Draft a meeting agenda', say: 'Draft an agenda for a 30-minute kickoff meeting with a new client.' },
    { label: 'Set up a weekly summary', say: 'Set up a weekly task: every Monday morning, summarize my open work for the week.' },
    { label: 'Build a checklist', say: 'Make me a checklist for onboarding a new team member.' },
  ],
  research_analyst: [
    { label: 'Research a topic', say: 'Research current best practices for quarterly business reviews and give me a structured summary.' },
    { label: 'Compare options', say: 'Compare the pros and cons of three common approaches to team performance reviews.' },
    { label: 'Analyze attached data', say: 'I will attach a spreadsheet — analyze it and tell me the three most important patterns.' },
  ],
  branding_expert: LINKEDIN_STARTERS,
  linkedin_drafter: LINKEDIN_STARTERS, // legacy role key
};

export const GENERIC_STARTERS: RoleStarter[] = [
  { label: 'Draft a document', say: 'Draft a one-page document — ask me what you need to get started.' },
  { label: 'Set up a recurring task', say: 'Set up a weekly task that summarizes my open work every Monday morning.' },
  { label: 'Work on a file', say: 'I will attach a file — read it and tell me what you can do with it.' },
];

/** Context-free starters for a day-one sovereign account (no mail/calendar to draw on). */
export const INTAKE_STARTERS: RoleStarter[] = [
  { label: 'Draft a meeting agenda', say: 'Draft an agenda for a 30-minute kickoff meeting with a new client.' },
  { label: 'Summarize a document I attach', say: 'I will attach a document — summarize it into one page of key takeaways.' },
  { label: 'Build a checklist', say: 'Make me a checklist for onboarding a new team member.' },
];
