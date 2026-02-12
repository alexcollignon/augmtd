/**
 * Inbox Item Types
 *
 * Supporting the new UX with:
 * - Visual sections (Prepared / Suggested / Awareness)
 * - User confirmations
 * - Learning signals
 */

export type VisualSection = 'prepared' | 'suggested' | 'awareness';

export type ConfirmationStatus = 'pending' | 'confirmed' | 'rejected';

export type ConfirmationAction = 'confirm_as_mine' | 'not_my_task';

export interface UserConfirmation {
  status: ConfirmationStatus | null;
  confirmedAt?: string; // ISO timestamp
  confirmedAction?: ConfirmationAction;
  previousSuggestionLevel?: string; // For learning: what was suggested before confirmation
  notes?: string; // Optional user notes
}

export interface InboxItem {
  id: string;
  user_id: string;
  source: string;
  source_id: string;

  // Work-state model
  work_state: string;
  work_title: string;
  what_i_prepared: string | null;
  why_matters: string | null;

  // NEW: Visual section (auto-calculated from suggestionLevel)
  visual_section: VisualSection | null;

  // NEW: User confirmation
  user_confirmation: UserConfirmation | null;

  // Recipient context
  recipient_context: {
    detectedRole: string;
    position: string;
    wasExplicitlyMentioned: boolean;
    workSignals: any;
    inferredWorkState: string;
    responsibilityConfidence: number;
    confidenceBreakdown: any;
    reasoning: string;
    otherRecipients: string[];
    senderEmail: string;
    senderRelationship: string;
    // NEW: Suggestion level
    suggestionLevel?: string;
    suggestionLabel?: string;
  } | null;

  // Source data
  source_data: any;

  // Legacy fields
  ai_suggestion_type: string | null;
  ai_suggestion_content: string | null;
  ai_suggestion_reasoning: string | null;
  confidence_score: number | null;
  priority: number;
  status: string;
  needs_review: boolean;

  // Timestamps
  created_at: string;
  updated_at: string;
}

/**
 * Helper: Determine visual section from suggestion level
 */
export function getVisualSection(suggestionLevel: string): VisualSection {
  switch (suggestionLevel) {
    case 'assigned':
      return 'prepared';
    case 'suggested':
      return 'suggested';
    case 'review':
    case 'fyi':
      return 'awareness';
    default:
      return 'awareness';
  }
}

/**
 * Helper: Get section display name
 */
export function getSectionDisplayName(section: VisualSection): string {
  const names: Record<VisualSection, string> = {
    prepared: 'Prepared Work',
    suggested: 'Suggested for You',
    awareness: 'For Your Awareness',
  };
  return names[section];
}

/**
 * Helper: Check if item needs user confirmation
 */
export function needsConfirmation(item: InboxItem): boolean {
  return (
    item.visual_section === 'suggested' &&
    (!item.user_confirmation || item.user_confirmation.status === 'pending')
  );
}

/**
 * Helper: Check if item was confirmed by user
 */
export function isUserConfirmed(item: InboxItem): boolean {
  return item.user_confirmation?.status === 'confirmed';
}

/**
 * Helper: Check if item was rejected by user
 */
export function isUserRejected(item: InboxItem): boolean {
  return item.user_confirmation?.status === 'rejected';
}
