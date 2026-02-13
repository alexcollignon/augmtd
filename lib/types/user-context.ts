/**
 * User Context Profile Structure
 *
 * All fields are learned automatically from user behavior.
 * No manual input required.
 */

export interface UserContextProfile {
  communicationStyle: CommunicationStyle;
  rolePatterns: RolePatterns;
  urgencySensitivity: UrgencySensitivity;
  relationshipGraph: Record<string, ContactContext>;
  delegationBehavior: DelegationBehavior;
  confidenceMetrics: ConfidenceMetrics;
}

export interface CommunicationStyle {
  avgLength: number;                    // Average email length in chars
  toneVector: ToneVector;               // Tone preferences
  formalityScore: number;               // 0-1, learned from edits
  greetingPatterns: string[];           // Common greetings user uses
  signatureStyle: string | null;        // Extracted signature
  emojiUsage: number;                   // 0-1, how often emojis are used
  commonPhrases: string[];              // Frequently used phrases
}

export interface ToneVector {
  formal: number;                       // 0-1
  casual: number;                       // 0-1
  technical: number;                    // 0-1
  friendly: number;                     // 0-1
  direct: number;                       // 0-1
}

export interface RolePatterns {
  respondsWhenInTo: number;             // 0-1, response rate when primary recipient
  respondsWhenInCC: number;             // 0-1, response rate when CC'd
  mentionSensitivity: number;           // 0-1, response rate when @mentioned
  explicitAssignmentRate: number;       // 0-1, how often explicit assignments are accepted
  positionSensitivity: {                // How position in To/CC affects response
    primary: number;                    // First in To line
    secondary: number;                  // Later in To line
    cc: number;                         // In CC
  };
}

export interface UrgencySensitivity {
  thresholdScore: number;               // 0-1, minimum urgency to respond
  avgResponseTime: number;              // Seconds, average time to respond
  deadlineAdherence: number;            // 0-1, meets deadlines rate
  urgencyKeywords: string[];            // Words that trigger urgency for this user
}

export interface ContactContext {
  email: string;
  importance: number;                   // 0-1, learned from response patterns
  typicalTone: 'formal' | 'casual' | 'mixed';
  responseRate: number;                 // 0-1, how often user responds to this contact
  avgResponseTime: number;              // Seconds
  lastInteraction: string;              // ISO timestamp
  interactionCount: number;
  topics: string[];                     // Common discussion topics
}

export interface DelegationBehavior {
  delegationRate: number;               // 0-1, % of items delegated
  typicalTargets: string[];             // Email addresses
  delegationTriggers: string[];         // Patterns that trigger delegation
  neverDelegates: string[];             // Topics/senders never delegated
}

export interface ConfidenceMetrics {
  overallScore: number;                 // 0-1, how much we've learned
  signalCount: number;                  // Total learning signals processed
  lastUpdated: string;                  // ISO timestamp
  dimensionConfidence: {                // Confidence per dimension
    communicationStyle: number;
    rolePatterns: number;
    urgencySensitivity: number;
    relationshipGraph: number;
    delegationBehavior: number;
  };
}

/**
 * Learning Signal (from database)
 */
export interface LearningSignal {
  id: string;
  user_id: string;
  inbox_item_id: string | null;
  signal_type: SignalType;
  signal_data: Record<string, any>;
  created_at: string;
}

export type SignalType =
  | 'suggestion_confirmed'
  | 'suggestion_rejected'
  | 'reply_sent'
  | 'item_completed'
  | 'item_dismissed'
  | 'draft_modified'
  | 'action_taken';

/**
 * Tone Delta (extracted from draft edits)
 */
export interface ToneDelta {
  formalityChange: number;              // -1 to 1 (more casual to more formal)
  lengthChange: number;                 // Character difference
  toneVectorDelta: Partial<ToneVector>; // Changes in tone dimensions
  addedPhrases: string[];
  removedPhrases: string[];
}

/**
 * Default/Initial Context (empty state)
 */
export const DEFAULT_USER_CONTEXT: UserContextProfile = {
  communicationStyle: {
    avgLength: 0,
    toneVector: {
      formal: 0.5,
      casual: 0.5,
      technical: 0.5,
      friendly: 0.5,
      direct: 0.5,
    },
    formalityScore: 0.5,
    greetingPatterns: [],
    signatureStyle: null,
    emojiUsage: 0,
    commonPhrases: [],
  },
  rolePatterns: {
    respondsWhenInTo: 0.5,
    respondsWhenInCC: 0.5,
    mentionSensitivity: 0.5,
    explicitAssignmentRate: 0.5,
    positionSensitivity: {
      primary: 0.5,
      secondary: 0.5,
      cc: 0.5,
    },
  },
  urgencySensitivity: {
    thresholdScore: 0.5,
    avgResponseTime: 0,
    deadlineAdherence: 0.5,
    urgencyKeywords: [],
  },
  relationshipGraph: {},
  delegationBehavior: {
    delegationRate: 0,
    typicalTargets: [],
    delegationTriggers: [],
    neverDelegates: [],
  },
  confidenceMetrics: {
    overallScore: 0,
    signalCount: 0,
    lastUpdated: new Date().toISOString(),
    dimensionConfidence: {
      communicationStyle: 0,
      rolePatterns: 0,
      urgencySensitivity: 0,
      relationshipGraph: 0,
      delegationBehavior: 0,
    },
  },
};
