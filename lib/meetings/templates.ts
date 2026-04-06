/**
 * Meeting Note Templates
 *
 * Each template defines the sections that the AI will generate.
 * Templates guide the AI prompt structure — each section gets its own focused
 * AI call for better quality, especially with OSS models.
 */

export interface TemplateSection {
  /** Machine-readable key */
  key: string;
  /** Display label */
  label: string;
  /** AI instruction — tells the model what to extract for this section */
  instruction: string;
  /** Whether this section is always shown even if empty */
  required?: boolean;
}

export interface MeetingTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  sections: TemplateSection[];
}

export const MEETING_TEMPLATES: MeetingTemplate[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'General purpose meeting notes',
    icon: '📝',
    sections: [
      {
        key: 'summary',
        label: 'Summary',
        instruction: 'Write a concise 2-3 sentence summary of what was discussed and any outcomes. Focus on what matters most.',
        required: true,
      },
      {
        key: 'decisions',
        label: 'Decisions',
        instruction: 'List specific decisions that were made. For each, note who made it and any deadlines. Only include explicit agreements, not suggestions.',
      },
      {
        key: 'action_items',
        label: 'Action Items',
        instruction: 'List concrete next steps with an owner and due date where mentioned. Format: task — owner (deadline). Only include items that were explicitly committed to.',
        required: true,
      },
      {
        key: 'risks',
        label: 'Risks & Blockers',
        instruction: 'List concerns, blockers, or risks that were raised. Rate each as high/medium/low severity.',
      },
    ],
  },
  {
    id: 'client_call',
    name: 'Client Call',
    description: 'External client or prospect meeting',
    icon: '🤝',
    sections: [
      {
        key: 'summary',
        label: 'Summary',
        instruction: 'Summarize the meeting purpose, client mood/sentiment, and outcome in 2-3 sentences.',
        required: true,
      },
      {
        key: 'client_needs',
        label: 'Client Needs & Questions',
        instruction: 'List specific questions the client asked, concerns they raised, and requirements they mentioned. Quote key phrases where possible.',
      },
      {
        key: 'decisions',
        label: 'Decisions & Agreements',
        instruction: 'List what was agreed upon — pricing, timelines, scope, deliverables. Be precise about numbers and dates.',
      },
      {
        key: 'objections',
        label: 'Objections & Concerns',
        instruction: 'List any pushback, hesitations, or concerns the client expressed. Note what was said in response.',
      },
      {
        key: 'action_items',
        label: 'Next Steps',
        instruction: 'List committed next steps with clear ownership. Separate our actions from client actions.',
        required: true,
      },
    ],
  },
  {
    id: 'one_on_one',
    name: '1:1',
    description: 'One-on-one check-in',
    icon: '👥',
    sections: [
      {
        key: 'summary',
        label: 'Summary',
        instruction: 'Brief summary of the check-in topics and overall tone/sentiment.',
        required: true,
      },
      {
        key: 'updates',
        label: 'Updates',
        instruction: 'List status updates shared — progress on projects, completed work, things in motion.',
      },
      {
        key: 'blockers',
        label: 'Blockers & Challenges',
        instruction: 'List any blockers, frustrations, or challenges mentioned. Note who needs to help resolve them.',
      },
      {
        key: 'feedback',
        label: 'Feedback',
        instruction: 'Any feedback given or received, positive or constructive. Be specific about what was said.',
      },
      {
        key: 'action_items',
        label: 'Action Items',
        instruction: 'Committed follow-ups from both sides.',
        required: true,
      },
    ],
  },
  {
    id: 'sales',
    name: 'Sales Meeting',
    description: 'Sales call or demo',
    icon: '💼',
    sections: [
      {
        key: 'summary',
        label: 'Summary',
        instruction: 'Meeting overview — prospect stage, what was presented, overall engagement level.',
        required: true,
      },
      {
        key: 'pain_points',
        label: 'Pain Points',
        instruction: 'Specific problems the prospect described. Use their exact words where possible.',
      },
      {
        key: 'objections',
        label: 'Objections',
        instruction: 'Any pricing, timing, competitive, or other objections raised. Note responses given.',
      },
      {
        key: 'champion_signals',
        label: 'Champion Signals',
        instruction: 'Positive signals: enthusiasm, specific use cases mentioned, internal advocacy, timeline urgency.',
      },
      {
        key: 'action_items',
        label: 'Next Steps',
        instruction: 'Agreed next steps — follow-up email, proposal, demo, intro to decision maker, etc.',
        required: true,
      },
    ],
  },
  {
    id: 'standup',
    name: 'Team Standup',
    description: 'Daily or weekly team sync',
    icon: '🔄',
    sections: [
      {
        key: 'summary',
        label: 'Summary',
        instruction: 'One-sentence summary of the sync — key theme or decision if any.',
        required: true,
      },
      {
        key: 'updates_by_person',
        label: 'Updates by Person',
        instruction: 'For each person who spoke, list their updates as bullet points under their name. Group by speaker.',
      },
      {
        key: 'blockers',
        label: 'Blockers',
        instruction: 'Cross-team blockers or dependencies raised. Note who is blocked and by what.',
      },
      {
        key: 'decisions',
        label: 'Decisions',
        instruction: 'Any decisions made during the sync.',
      },
      {
        key: 'action_items',
        label: 'Action Items',
        instruction: 'Specific follow-ups with owners.',
        required: true,
      },
    ],
  },
  {
    id: 'interview',
    name: 'Interview',
    description: 'Candidate interview or evaluation',
    icon: '🎯',
    sections: [
      {
        key: 'summary',
        label: 'Summary',
        instruction: 'Brief overview — role being interviewed for, overall impression, and recommendation.',
        required: true,
      },
      {
        key: 'background',
        label: 'Background & Experience',
        instruction: 'Key points from the candidate\'s background, relevant experience, and skills discussed.',
      },
      {
        key: 'strengths',
        label: 'Strengths',
        instruction: 'Demonstrated strengths, strong answers, or impressive qualifications.',
      },
      {
        key: 'concerns',
        label: 'Concerns',
        instruction: 'Red flags, weak answers, gaps in experience, or areas of concern.',
      },
      {
        key: 'action_items',
        label: 'Next Steps',
        instruction: 'Follow-up: next round, offer, rejection, additional evaluation needed.',
        required: true,
      },
    ],
  },
];

export function getTemplate(id: string): MeetingTemplate {
  return MEETING_TEMPLATES.find((t) => t.id === id) ?? MEETING_TEMPLATES[0];
}

export function getTemplateNames(): Array<{ id: string; name: string; icon: string }> {
  return MEETING_TEMPLATES.map((t) => ({ id: t.id, name: t.name, icon: t.icon }));
}
