/**
 * Recipient Detection Type Definitions
 *
 * Types for recipient role detection, work signal analysis,
 * and probabilistic confidence calculation.
 */

// ==========================================
// WORK SIGNALS
// ==========================================

/**
 * Work signals extracted from email content
 * These are semantic labels that relate to work impact and cognitive cost
 */
export interface WorkSignals {
  // Obligation signals
  hasObligation: boolean;           // "can you...", "please...", direct request
  obligationStrength: number;       // 0-100, how strong is the ask?

  // Cognitive signals
  requiresJudgment: boolean;        // needs thinking, not mechanical
  judgmentComplexity: number;       // 0-100, how complex is the decision?
  requiresDecision: boolean;        // explicit choice needed (A vs B vs C)

  // Execution signals
  hasDeadline: boolean;             // time-bound request
  deadlineUrgency: number;          // 0-100, how soon? (now vs next week)
  isTaskAssignment: boolean;        // explicit "do X" assignment

  // Collaboration signals
  isNegotiation: boolean;           // back-and-forth discussion needed
  requiresApproval: boolean;        // waiting for yes/no decision
  isDelegation: boolean;            // passing work to someone else

  // Context signals
  informationalOnly: boolean;       // FYI, no action needed
  isFollowUp: boolean;             // continuation of previous thread
  mentionsOthers: boolean;         // references other people's work
}

/**
 * Encoded signal pattern for efficient lookup
 * Example: "OJT" = obligation + judgment + deadline
 */
export type SignalPatternKey = string;

// ==========================================
// RECIPIENT ROLES
// ==========================================

/**
 * Detected role of recipient in email
 */
export type RecipientRole =
  | 'primary_owner'      // Main person responsible (should act)
  | 'secondary_owner'    // Co-owner, shared responsibility
  | 'reviewer'           // Asked to review/approve
  | 'approver'           // Final decision maker
  | 'informed'           // CC'd for awareness only
  | 'irrelevant';        // Email doesn't apply to them

/**
 * Position in email (To/CC/BCC)
 */
export type EmailPosition = 'to' | 'cc' | 'bcc';

/**
 * Sender relationship type
 */
export type SenderRelationship = 'client' | 'internal' | 'vendor' | 'unknown';

// ==========================================
// WORK STATES
// ==========================================

/**
 * Work states based on cognitive cost framework
 */
export type WorkState =
  | 'work_prepared'      // Judgment now (email domain, draft ready)
  | 'action_required'    // Execution to prevent downside (external actions)
  | 'decision_required'  // Choice under uncertainty (multiple options)
  | 'waiting'            // Blocked on external input
  | 'noted'              // Awareness only (low stakes, informational)
  | 'noise';             // Hidden completely (spam, irrelevant)

// ==========================================
// CONFIDENCE CALCULATION
// ==========================================

/**
 * Breakdown of confidence calculation factors
 * All values are probabilities [0.0, 1.0]
 */
export interface ConfidenceBreakdown {
  baseAI: number;           // AI's initial confidence in detection
  userBehavior: number;     // P(user acts | signal pattern) from learned patterns
  position: number;         // P(responsible | to/cc/bcc position)
  mentioned: number;        // P(responsible | explicitly mentioned)
  relationship: number;     // P(responsible | sender relationship)
  final: number;            // Combined probability (product of factors)
}

// ==========================================
// RECIPIENT CONTEXT
// ==========================================

/**
 * Complete recipient analysis for one person on one email
 * Stored in inbox_items.recipient_context JSONB column
 */
export interface RecipientContext {
  // Base detection
  detectedRole: RecipientRole;
  position: EmailPosition;
  wasExplicitlyMentioned: boolean;

  // Work signals (granular, semantic)
  workSignals: WorkSignals;

  // Derived work state
  inferredWorkState: WorkState;

  // Probabilistic confidence [0.0, 1.0]
  responsibilityConfidence: number;

  // Confidence breakdown (for debugging and learning)
  confidenceBreakdown: ConfidenceBreakdown;

  // Context
  reasoning: string;                    // Human-readable explanation
  otherRecipients: string[];           // Other people on the email
  senderEmail: string;                 // Who sent the email
  senderRelationship: SenderRelationship;
}

/**
 * Analysis of all recipients for an email
 */
export interface RecipientAnalysis {
  recipients: Array<RecipientContext & {
    email: string;
    userId: string | null;  // null if not in our system
    userName: string | null;
  }>;
  primaryOwner: string | null;         // Email of main responsible person
  mentionedUsers: string[];            // Users mentioned by name in body
  isTeamEmail: boolean;                // Sent to team@, all@, etc.
}

// ==========================================
// USER ACTIONS
// ==========================================

/**
 * Types of actions user can take on inbox item
 */
export type UserActionType =
  | 'approved'     // Sent as-is
  | 'modified'     // Edited before sending
  | 'rejected'     // Dismissed without action
  | 'reassigned'   // Assigned to someone else
  | 'ignored';     // No action taken (timed out)

/**
 * Types of modifications user made
 */
export type ModificationType =
  | 'tone_change'         // Made more/less formal
  | 'added_context'       // Added background info
  | 'added_deadline'      // Added or changed deadline
  | 'softened_language'   // Made less direct
  | 'made_concise'        // Shortened response
  | 'added_detail'        // Added more information
  | 'changed_structure'   // Reorganized content
  | 'other';

/**
 * User action data
 * Stored in inbox_items.user_action JSONB column
 */
export interface UserAction {
  action: UserActionType;
  timestamp: string;              // ISO 8601
  timeToAction: number;           // Seconds from created to action

  // If user disagreed with role detection
  correctedRole?: RecipientRole;  // What role they think it should be

  // If user reassigned task
  reassignedTo?: string;          // Email of person reassigned to

  // If user modified content
  modifications?: {
    editType: ModificationType;
    originalLength: number;       // Character count
    modifiedLength: number;
    originalContent?: string;     // Store for learning
    modifiedContent?: string;
  };
}

// ==========================================
// USER CONTEXT (LEARNING)
// ==========================================

/**
 * Signal-based response pattern (learned from history)
 */
export interface SignalResponse {
  signalPattern: SignalPatternKey;   // Encoded pattern (e.g., "OJT")
  actionRate: number;                 // P(user acts | this pattern)
  avgResponseTime: number;            // Average seconds to action
  confidence: number;                 // Statistical confidence [0.0, 1.0]
  sampleSize: number;                 // Number of observations
  examples: Array<{
    inboxItemId: string;
    acted: boolean;
    responseTime: number;
  }>;
}

/**
 * Position-based behavior pattern
 */
export interface PositionBehavior {
  to: {
    actionRate: number;              // P(acts when in To:)
    avgConfidence: number;           // Avg confidence score
    sampleSize: number;
  };
  cc: {
    actionRate: number;              // P(acts when in CC:)
    avgConfidence: number;
    sampleSize: number;
  };
  bcc: {
    actionRate: number;              // P(acts when in BCC:)
    avgConfidence: number;
    sampleSize: number;
  };
}

/**
 * Role frequency and behavior
 */
export interface RoleFrequency {
  [role: string]: {  // role: RecipientRole
    frequency: number;                // How often user has this role (0-1)
    actionRate: number;               // P(acts | has this role)
    confidence: number;               // Statistical confidence
    sampleSize: number;
  };
}

/**
 * Relationship-specific behavior
 */
export interface RelationshipBehavior {
  senderEmail: string;
  p_acts_when_from_sender: number;   // P(acts | email from this sender)
  p_is_primary_owner: number;        // P(is primary | email from this sender)
  avgResponseTime: number;           // Avg seconds to respond
  sampleSize: number;
}

// ==========================================
// ORGANIZATION CONTEXT
// ==========================================

/**
 * Organization-level context (shared across users)
 */
export interface OrganizationContext {
  organizationId: string;

  // Industry knowledge
  industry: string | null;           // 'consulting', 'legal', 'accounting', etc.
  domainKnowledge: {
    vocabulary: Record<string, string>;  // "SOW" → "Statement of Work"
    commonWorkflows: string[];
    clientTypes: string[];
    projectPatterns: string[];
  };

  // Company patterns (learned from all users)
  companyPatterns: {
    communicationNorms: {
      formalityLevel: 'formal' | 'business-casual' | 'casual';
      responseTimeExpectations: Record<string, number>;  // role: hours
      commonEmailTemplates: Array<{
        type: string;
        template: string;
        usageCount: number;
      }>;
    };
    documentPatterns: Array<{
      type: string;
      namingConvention: string;
      typicalLocation: string;
    }>;
    approvalWorkflows: Array<{
      type: string;
      steps: string[];
      typicalDuration: string;
    }>;
  };

  // Aggregate metrics
  totalUsers: number;
  totalInteractions: number;
  confidenceScore: number;           // 0-100
}

// ==========================================
// DETECTION METRICS
// ==========================================

/**
 * Weekly metrics for recipient detection accuracy
 */
export interface RecipientDetectionMetrics {
  id: string;
  userId: string;
  organizationId: string;

  // Overall accuracy
  totalDetections: number;
  correctDetections: number;         // User didn't correct role
  userCorrections: number;

  // Per-role accuracy
  roleAccuracy: Record<RecipientRole, {
    detected: number;                // How many times we detected this role
    correct: number;                 // How many were actually correct
    accuracy: number;                // correct / detected
  }>;

  // Signal detection accuracy
  signalAccuracy: Record<string, {   // signal name
    detected: number;
    correct: number;
    accuracy: number;
  }>;

  // Confidence calibration
  confidenceCalibration: Array<{
    confidenceRange: string;         // "0.0-0.2", "0.2-0.4", etc.
    predictions: number;             // How many predictions in this range
    correct: number;                 // How many were actually correct
    calibration: number;             // correct / predictions (should ≈ confidence)
  }>;

  // Time period
  weekStart: string;                 // ISO date
  weekEnd: string;
  createdAt: string;
}

// ==========================================
// API REQUEST/RESPONSE TYPES
// ==========================================

/**
 * Request to analyze recipients for an email
 */
export interface AnalyzeRecipientsRequest {
  email: {
    messageId: string;
    from: string;
    to: string[];
    cc: string[];
    subject: string;
    body: string;
    threadId?: string;
  };
  orgContext?: OrganizationContext;
}

/**
 * Response from recipient analysis
 */
export interface AnalyzeRecipientsResponse {
  analysis: RecipientAnalysis;
  processingTime: number;            // Milliseconds
}

// ==========================================
// HELPER TYPE GUARDS
// ==========================================

/**
 * Type guard to check if role requires action
 */
export function requiresAction(role: RecipientRole): boolean {
  return [
    'primary_owner',
    'secondary_owner',
    'reviewer',
    'approver'
  ].includes(role);
}

/**
 * Type guard to check if work state needs user attention
 */
export function needsUserAttention(workState: WorkState): boolean {
  return [
    'work_prepared',
    'action_required',
    'decision_required'
  ].includes(workState);
}

/**
 * Calculate if confidence is above threshold for action
 */
export function isAboveThreshold(
  confidence: number,
  threshold: number = 0.30
): boolean {
  return confidence >= threshold;
}
