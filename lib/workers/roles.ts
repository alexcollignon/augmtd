// Shared coworker role → avatar/label maps. Single source of truth — was
// duplicated across workers-roster.tsx, workers-setup-view.tsx, team-home-view.tsx.

export const ROLE_AVATARS: Record<string, string> = {
  personal_assistant: '/workers/clara.png',
  content_manager:    '/workers/sofia.png',
  linkedin_drafter:   '/workers/luca.png',
  research_analyst:   '/workers/max.png',
};

export const ROLE_LABELS: Record<string, string> = {
  personal_assistant: 'Personal Assistant',
  content_manager:    'Content Strategist',
  linkedin_drafter:   'LinkedIn Wizard',
  research_analyst:   'Research Analyst',
};
