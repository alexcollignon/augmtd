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
