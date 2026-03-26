/**
 * Recipient Detection System
 *
 * Detects recipient roles using AI and calculates probabilistic confidence
 * based on multiple factors: position, mention, learned behavior, relationship.
 */

import { getAIClient } from '@/lib/ai/factory';
import { parseModelJSON } from '@/lib/ai/parse-json';
import { SupabaseClient } from '@supabase/supabase-js';
import type {
  RecipientRole,
  RecipientContext,
  RecipientAnalysis,
  EmailPosition,
  SenderRelationship,
  ConfidenceBreakdown,
  WorkSignals,
} from '@/lib/types/recipient-detection';
import { detectWorkSignals, encodeSignalPattern } from './signal-detector';
import { inferWorkState, calculatePriority } from './work-state-mapper';
import { analyzeBodyContent, applyBodyBoost } from './body-analyzer';

// ==========================================
// TYPES
// ==========================================

interface Email {
  messageId: string;
  from: string;
  fromName?: string;
  to: string[];
  cc: string[];
  bcc?: string[];
  subject: string;
  body: string;
  threadId?: string;
}

interface UserInSystem {
  userId: string;
  email: string;
  fullName?: string;
}

// ==========================================
// MAIN DETECTION FUNCTION
// ==========================================

/**
 * Analyze all recipients for an email and detect roles
 */
export async function analyzeRecipients(
  email: Email,
  usersInSystem: UserInSystem[],
  senderContext?: { importance: number; relationshipType?: string },
  userId?: string,
  supabase?: SupabaseClient
): Promise<RecipientAnalysis> {
  // Resolve AI client — falls back to standard tier if userId/supabase not provided
  const { getSystemClient } = await import('@/lib/ai/factory');
  const resolvedClient = userId && supabase
    ? await getAIClient(userId, 'classification', supabase)
    : getSystemClient('classification');

  // 1. Get all recipients
  const allRecipients = [
    ...email.to.map(e => ({ email: e, position: 'to' as EmailPosition })),
    ...email.cc.map(e => ({ email: e, position: 'cc' as EmailPosition })),
    ...(email.bcc || []).map(e => ({ email: e, position: 'bcc' as EmailPosition })),
  ];

  // 2. Map to users in our system
  const recipientsInSystem = allRecipients.map(r => {
    const user = usersInSystem.find(u => u.email.toLowerCase() === r.email.toLowerCase());
    return {
      ...r,
      userId: user?.userId || null,
      userName: user?.fullName || null,
    };
  });

  // 3. Analyze email body for explicit assignments and context
  const bodyAnalysis = analyzeBodyContent(
    email.body,
    email.subject,
    usersInSystem.map(u => ({ email: u.email, fullName: u.fullName }))
  );

  // 4. Detect mentioned users
  const mentionedUsers = extractMentionedUsers(email.body, usersInSystem);

  // 5. Check if team email
  const isTeamEmail = isTeamAddress(email.to);

  // 6. Use AI to detect roles for each recipient
  const aiRoleDetection = await detectRolesWithAI(email, recipientsInSystem, senderContext, resolvedClient);

  // 6. For each recipient, calculate full context
  const recipientContexts: Array<RecipientContext & {
    email: string;
    userId: string | null;
    userName: string | null;
  }> = [];

  for (const recipient of recipientsInSystem) {
    const aiRole = aiRoleDetection.find(r => r.email === recipient.email);

    if (!aiRole) continue; // Skip if AI didn't return this recipient

    // Detect work signals for this recipient
    const workSignals = await detectWorkSignals(
      email.body,
      email.subject,
      recipient.email,
      recipient.position,
      resolvedClient
    );

    // Infer work state from signals
    const inferredWorkState = inferWorkState(
      workSignals,
      aiRole.role,
      true // Assume email execution target for now
    );

    // Calculate probabilistic confidence
    const confidenceBreakdown = calculateConfidenceBreakdown(
      aiRole.baseConfidence,
      recipient.position,
      mentionedUsers.includes(recipient.email),
      workSignals,
      email.from, // sender email for relationship context
      senderContext
    );

    // Apply body analysis boost for explicit assignments
    const finalConfidence = applyBodyBoost(
      confidenceBreakdown.final,
      recipient.email,
      bodyAnalysis
    );

    // Build recipient context
    const context: RecipientContext & {
      email: string;
      userId: string | null;
      userName: string | null;
    } = {
      email: recipient.email,
      userId: recipient.userId,
      userName: recipient.userName,

      // Base detection
      detectedRole: aiRole.role,
      position: recipient.position,
      wasExplicitlyMentioned: mentionedUsers.includes(recipient.email),

      // Work signals
      workSignals,

      // Derived work state
      inferredWorkState,

      // Probabilistic confidence (with body analysis boost)
      responsibilityConfidence: finalConfidence,
      confidenceBreakdown,

      // Context
      reasoning: aiRole.reasoning,
      otherRecipients: allRecipients
        .filter(r => r.email !== recipient.email)
        .map(r => r.email),
      senderEmail: email.from,
      senderRelationship: (senderContext?.relationshipType as SenderRelationship) || 'unknown',
    };

    recipientContexts.push(context);
  }

  // 7. Determine primary owner
  const primaryOwner = determinePrimaryOwner(recipientContexts);

  return {
    recipients: recipientContexts,
    primaryOwner,
    mentionedUsers,
    isTeamEmail,
  };
}

// ==========================================
// AI ROLE DETECTION
// ==========================================

interface AIRoleDetection {
  email: string;
  role: RecipientRole;
  baseConfidence: number;
  reasoning: string;
  hasTask: boolean;
  taskDescription?: string;
}

/**
 * Use AI to detect roles for all recipients
 */
async function detectRolesWithAI(
  email: Email,
  recipients: Array<{ email: string; position: EmailPosition; userName: string | null }>,
  senderContext?: { importance: number; relationshipType?: string },
  resolvedClient?: { client: any; model: string; endpoint?: { provider: string } }
): Promise<AIRoleDetection[]> {
  const { getSystemClient } = await import('@/lib/ai/factory');
  const resolved = resolvedClient ?? getSystemClient('classification');
  const { client: openai, model: defaultModel } = resolved;
  const endpoint = (resolved as any).endpoint;

  const prompt = buildRoleDetectionPrompt(email, recipients, senderContext);

  try {
    const response = await openai.chat.completions.create({
      model: defaultModel,
      messages: [
        {
          role: 'system',
          content: ROLE_DETECTION_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      ...(endpoint?.provider === 'openai' || endpoint?.provider === 'azure_openai' ? { response_format: { type: 'json_object' as const } } : {}),
      temperature: 0,
      max_tokens: 1500,
    });

    const result = parseModelJSON(response.choices[0].message.content || '{}', { recipients: [] });
    return result.recipients || [];
  } catch (error) {
    console.error('Error detecting roles with AI:', error);

    // Fallback: use position-based detection
    return recipients.map(r => ({
      email: r.email,
      role: r.position === 'to' ? 'primary_owner' : 'informed',
      baseConfidence: 0.5,
      reasoning: 'AI detection failed, using position-based fallback',
      hasTask: r.position === 'to',
    })) as AIRoleDetection[];
  }
}

const ROLE_DETECTION_SYSTEM_PROMPT = `You are a recipient role detector for an email triage system.

Your job is to analyze an email and determine what role each recipient has.

ROLES:
- primary_owner: Main person responsible, should take action
- secondary_owner: Co-owner, shared responsibility
- reviewer: Asked to review/approve something
- approver: Final decision maker
- informed: CC'd for awareness only
- irrelevant: Email doesn't apply to them

RULES:
1. If in To: → usually primary_owner or secondary_owner
2. If in CC: → usually informed (unless explicitly mentioned)
3. If mentioned by name → boost responsibility
4. If email says "Alice, can you..." → Alice is primary_owner
5. If email says "Bob, please review" → Bob is reviewer
6. If general team email → multiple owners possible
7. If CC'd but email doesn't apply to their role → irrelevant

Return JSON with role, confidence (0.0-1.0), and reasoning for each recipient.`;

function buildRoleDetectionPrompt(
  email: Email,
  recipients: Array<{ email: string; position: EmailPosition; userName: string | null }>,
  senderContext?: { importance: number; relationshipType?: string }
): string {
  const senderContextLine = senderContext
    ? `\nSENDER CONTEXT:\n${email.from} is a ${senderContext.relationshipType || 'contact'} (importance: ${Math.round(senderContext.importance)}/100). High importance senders may create stronger obligations even from CC.\n`
    : '';

  return `Analyze this email and determine each recipient's role.

EMAIL METADATA:
From: ${email.fromName || email.from}
To: ${email.to.join(', ')}
CC: ${email.cc.join(', ')}
Subject: ${email.subject}
${senderContextLine}

EMAIL BODY:
${email.body.substring(0, 2500)}${email.body.length > 2500 ? '...[truncated]' : ''}

RECIPIENTS TO ANALYZE:
${recipients.map(r => `- ${r.email} (${r.position.toUpperCase()})${r.userName ? ` - ${r.userName}` : ''}`).join('\n')}

For each recipient, determine:
1. What is their role in this email?
2. Do they have a specific task?
3. How confident are you? (0.0-1.0)
4. Why did you assign this role?

IMPORTANT:
- Look for names mentioned in body
- "Can you..." or "Please..." indicates primary_owner
- "FYI" or "For your awareness" indicates informed
- Review requests → reviewer
- Approval requests → approver
- If CC'd and not mentioned → usually informed

Return ONLY valid JSON:
{
  "recipients": [
    {
      "email": "user@company.com",
      "role": "primary_owner" | "secondary_owner" | "reviewer" | "approver" | "informed" | "irrelevant",
      "baseConfidence": 0.0-1.0,
      "reasoning": "explanation",
      "hasTask": true/false,
      "taskDescription": "what they need to do" or null
    }
  ]
}`;
}

// ==========================================
// PROBABILISTIC CONFIDENCE CALCULATION
// ==========================================

/**
 * Calculate confidence breakdown using multiple factors
 *
 * Combines probabilities: P(responsible) = P(AI) × P(position) × P(mentioned) × P(signals) × P(relationship)
 */
function calculateConfidenceBreakdown(
  baseAI: number,
  position: EmailPosition,
  wasMentioned: boolean,
  workSignals: WorkSignals,
  senderEmail: string,
  senderContext?: { importance: number; relationshipType?: string }
): ConfidenceBreakdown {

  // Factor 1: Base AI confidence
  let confidence = baseAI;

  // Factor 2: Position weight
  const p_position = getPositionProbability(position);
  confidence *= p_position;

  // Factor 3: Mention weight
  const p_mentioned = wasMentioned ? 0.95 : 1.0; // Boost if mentioned
  confidence *= p_mentioned;

  // Factor 4: Work signals (has obligation = more likely responsible)
  const p_signals = getSignalsProbability(workSignals);
  confidence *= p_signals;

  // Factor 5: Relationship — boost confidence for high-importance senders
  let p_relationship = 1.0; // Neutral default
  if (senderContext) {
    if (senderContext.importance > 70) p_relationship = 1.25;       // VIP: boost
    else if (senderContext.importance < 40) p_relationship = 0.9;   // Low priority: slight reduction
    // 40-70: stays 1.0 (neutral)
  }
  confidence *= p_relationship;

  return {
    baseAI,
    userBehavior: p_signals, // Using signals as proxy for user behavior for now
    position: p_position,
    mentioned: p_mentioned,
    relationship: p_relationship,
    final: Math.max(0, Math.min(1, confidence)),
  };
}

/**
 * Get probability based on email position
 */
function getPositionProbability(position: EmailPosition): number {
  const probabilities: Record<EmailPosition, number> = {
    to: 0.90,   // 90% chance To: recipient is responsible
    cc: 0.25,   // 25% chance CC: recipient is responsible
    bcc: 0.10,  // 10% chance BCC: recipient is responsible
  };

  return probabilities[position] || 0.5;
}

/**
 * Get probability based on work signals
 */
function getSignalsProbability(signals: WorkSignals): number {
  let probability = 0.5; // Baseline

  // Strong obligation = more likely responsible
  if (signals.hasObligation) {
    probability = 0.5 + (signals.obligationStrength / 100) * 0.4; // 0.5 to 0.9
  }

  // Informational only = less likely responsible
  if (signals.informationalOnly) {
    probability = 0.2;
  }

  // Task assignment = very likely responsible
  if (signals.isTaskAssignment) {
    probability = Math.max(probability, 0.85);
  }

  return probability;
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

/**
 * Extract users mentioned by name in email body
 */
function extractMentionedUsers(
  emailBody: string,
  usersInSystem: UserInSystem[]
): string[] {
  const mentioned: string[] = [];
  const bodyLower = emailBody.toLowerCase();

  for (const user of usersInSystem) {
    if (!user.fullName) continue;

    const firstName = user.fullName.split(' ')[0];
    const lastName = user.fullName.split(' ').slice(1).join(' ');

    // Check if first name is mentioned (at least 3 chars to avoid false positives)
    if (firstName && firstName.length >= 3) {
      // Look for name as whole word
      const regex = new RegExp(`\\b${firstName.toLowerCase()}\\b`, 'i');
      if (regex.test(bodyLower)) {
        mentioned.push(user.email);
      }
    }
  }

  return [...new Set(mentioned)]; // Remove duplicates
}

/**
 * Check if email is sent to team address
 */
function isTeamAddress(addresses: string[]): boolean {
  const teamPatterns = [
    'team@',
    'everyone@',
    'all@',
    'group@',
    'staff@',
    'company@',
  ];

  return addresses.some(addr =>
    teamPatterns.some(pattern =>
      addr.toLowerCase().includes(pattern)
    )
  );
}

/**
 * Determine primary owner from recipient contexts
 */
function determinePrimaryOwner(
  recipients: Array<RecipientContext & { email: string }>
): string | null {
  // Find recipient with primary_owner role and highest confidence
  const primaryOwners = recipients.filter(r => r.detectedRole === 'primary_owner');

  if (primaryOwners.length === 0) {
    // No primary owner detected, try secondary_owner
    const secondaryOwners = recipients.filter(r => r.detectedRole === 'secondary_owner');
    if (secondaryOwners.length > 0) {
      // Return highest confidence secondary owner
      secondaryOwners.sort((a, b) => b.responsibilityConfidence - a.responsibilityConfidence);
      return secondaryOwners[0].email;
    }
    return null;
  }

  if (primaryOwners.length === 1) {
    return primaryOwners[0].email;
  }

  // Multiple primary owners, return highest confidence
  primaryOwners.sort((a, b) => b.responsibilityConfidence - a.responsibilityConfidence);
  return primaryOwners[0].email;
}

// ==========================================
// CONFIDENCE THRESHOLDS & SUGGESTION LEVELS
// ==========================================

/**
 * Multi-tier confidence thresholds for different UX treatments
 *
 * Instead of binary create/skip, we use suggestion levels:
 * - ASSIGNED: High confidence, auto-assign to user
 * - SUGGESTED: Medium confidence, user should confirm
 * - REVIEW: Low confidence, flag for review
 * - FYI: Very low confidence, context only
 */
export const CONFIDENCE_THRESHOLDS = {
  ASSIGNED: 0.60,    // 60%+: Clear assignment
  SUGGESTED: 0.40,   // 40-60%: Possible task, needs confirmation
  REVIEW: 0.20,      // 20-40%: Uncertain, user review recommended
  FYI: 0.0,          // <20%: Informational only
};

export type SuggestionLevel = 'assigned' | 'suggested' | 'review' | 'fyi';

/**
 * Map confidence score to suggestion level with business semantics
 */
export function getSuggestionLevel(confidence: number): SuggestionLevel {
  if (confidence >= CONFIDENCE_THRESHOLDS.ASSIGNED) return 'assigned';
  if (confidence >= CONFIDENCE_THRESHOLDS.SUGGESTED) return 'suggested';
  if (confidence >= CONFIDENCE_THRESHOLDS.REVIEW) return 'review';
  return 'fyi';
}

/**
 * Get user-friendly label for suggestion level
 */
export function getSuggestionLabel(level: SuggestionLevel): string {
  const labels: Record<SuggestionLevel, string> = {
    assigned: 'Assigned to you',
    suggested: 'Likely your task - confirm?',
    review: 'May need your input',
    fyi: 'For your awareness',
  };
  return labels[level];
}

/**
 * Check if recipient should get an inbox item
 *
 * NEW LOGIC: If user is a recipient (To/CC), ALWAYS create an item.
 * The confidence determines the SUGGESTION LEVEL, not whether to create.
 */
export function shouldCreateInboxItem(
  recipientContext: RecipientContext,
  isCurrentUser: boolean = false
): boolean {
  // Noise is always filtered
  if (recipientContext.inferredWorkState === 'noise') {
    return false;
  }

  // If this is the current user and they're in To/CC, ALWAYS create an inbox item
  // (even if role was detected as 'irrelevant' — low confidence is surfaced via suggestion level)
  if (isCurrentUser && (recipientContext.position === 'to' || recipientContext.position === 'cc')) {
    return true;
  }

  // Irrelevant role is filtered (for non-current-user recipients)
  if (recipientContext.detectedRole === 'irrelevant') {
    return false;
  }

  // For other users in the org, use confidence threshold
  // Only create if at least "review" level (20%+)
  if (recipientContext.responsibilityConfidence < CONFIDENCE_THRESHOLDS.REVIEW) {
    return false;
  }

  return true;
}

// ==========================================
// EXPORT UTILITIES
// ==========================================

export {
  calculateConfidenceBreakdown,
  extractMentionedUsers,
  isTeamAddress,
  determinePrimaryOwner,
};
