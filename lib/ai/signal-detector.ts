/**
 * Work Signal Detection
 *
 * Analyzes email content to extract semantic work signals
 * that indicate work impact and cognitive cost.
 */

import OpenAI from 'openai';
import type { WorkSignals, SignalPatternKey } from '@/lib/types/recipient-detection';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ==========================================
// MAIN DETECTION FUNCTION
// ==========================================

/**
 * Detect work signals from email content
 */
export async function detectWorkSignals(
  emailBody: string,
  emailSubject: string,
  recipientEmail: string,
  recipientPosition: 'to' | 'cc' | 'bcc'
): Promise<WorkSignals> {

  const prompt = buildSignalDetectionPrompt(
    emailBody,
    emailSubject,
    recipientEmail,
    recipientPosition
  );

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Fast and cost-effective
      messages: [
        {
          role: 'system',
          content: SIGNAL_DETECTION_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0, // Deterministic
      max_tokens: 500,
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');

    // Validate and return signals
    return validateWorkSignals(result);
  } catch (error) {
    console.error('Error detecting work signals:', error);

    // Return default signals on error
    return getDefaultWorkSignals();
  }
}

// ==========================================
// PROMPT CONSTRUCTION
// ==========================================

const SIGNAL_DETECTION_SYSTEM_PROMPT = `You are a work signal detector for an AI work assistant.

Your job is to analyze email content and detect semantic signals that indicate:
1. What type of work is being requested
2. How much cognitive effort is required
3. How urgent the work is
4. What kind of collaboration is needed

Focus on SEMANTIC MEANING, not just keywords. Consider context.

Examples:
- "Can you review this?" → hasObligation=true, requiresJudgment=true, isTaskAssignment=true
- "FYI, the report is attached" → informationalOnly=true, all others=false
- "Which option do you prefer?" → requiresDecision=true, requiresJudgment=true
- "Please send by EOD" → hasObligation=true, hasDeadline=true, deadlineUrgency=90

Return JSON with ALL fields, even if false/0.`;

function buildSignalDetectionPrompt(
  emailBody: string,
  emailSubject: string,
  recipientEmail: string,
  recipientPosition: 'to' | 'cc' | 'bcc'
): string {
  return `Analyze this email and detect work signals.

EMAIL METADATA:
- Recipient: ${recipientEmail} (${recipientPosition.toUpperCase()})
- Subject: ${emailSubject}

EMAIL BODY:
${emailBody.substring(0, 2000)} ${emailBody.length > 2000 ? '...[truncated]' : ''}

INSTRUCTIONS:
For the recipient ${recipientEmail}, analyze:

1. OBLIGATION SIGNALS:
   - hasObligation: Is there a request, ask, or expectation of action?
   - obligationStrength: How strong is the ask? (0=suggestion, 50=request, 100=urgent demand)

2. COGNITIVE SIGNALS:
   - requiresJudgment: Does this need thinking/analysis (not just mechanical execution)?
   - judgmentComplexity: How complex is the thinking required? (0=simple, 50=moderate, 100=expert)
   - requiresDecision: Is there an explicit choice to make between options?

3. EXECUTION SIGNALS:
   - hasDeadline: Is there a time-bound element?
   - deadlineUrgency: How urgent? (0=no rush, 50=few days, 100=immediate)
   - isTaskAssignment: Is this an explicit "do X" assignment?

4. COLLABORATION SIGNALS:
   - isNegotiation: Does this require back-and-forth discussion?
   - requiresApproval: Is approval/sign-off needed?
   - isDelegation: Is someone passing work to the recipient?

5. CONTEXT SIGNALS:
   - informationalOnly: Is this purely FYI with no action needed?
   - isFollowUp: Is this continuing a previous conversation?
   - mentionsOthers: Does it reference other people's work?

IMPORTANT:
- If recipient is in CC (not To), lower obligation/urgency unless explicitly mentioned
- "Please review" = hasObligation + requiresJudgment + isTaskAssignment
- "FYI" or "For your information" = informationalOnly
- "Let me know" = hasObligation (low strength)
- Questions = hasObligation + may requireDecision
- Deadlines: "ASAP"=100, "EOD"=90, "this week"=60, "when you can"=20

Return ONLY valid JSON in this exact format:
{
  "hasObligation": boolean,
  "obligationStrength": 0-100,
  "requiresJudgment": boolean,
  "judgmentComplexity": 0-100,
  "requiresDecision": boolean,
  "hasDeadline": boolean,
  "deadlineUrgency": 0-100,
  "isTaskAssignment": boolean,
  "isNegotiation": boolean,
  "requiresApproval": boolean,
  "isDelegation": boolean,
  "informationalOnly": boolean,
  "isFollowUp": boolean,
  "mentionsOthers": boolean
}`;
}

// ==========================================
// VALIDATION & DEFAULTS
// ==========================================

/**
 * Validate AI response and ensure all required fields
 */
function validateWorkSignals(result: any): WorkSignals {
  return {
    // Obligation signals
    hasObligation: Boolean(result.hasObligation),
    obligationStrength: clamp(Number(result.obligationStrength) || 0, 0, 100),

    // Cognitive signals
    requiresJudgment: Boolean(result.requiresJudgment),
    judgmentComplexity: clamp(Number(result.judgmentComplexity) || 0, 0, 100),
    requiresDecision: Boolean(result.requiresDecision),

    // Execution signals
    hasDeadline: Boolean(result.hasDeadline),
    deadlineUrgency: clamp(Number(result.deadlineUrgency) || 0, 0, 100),
    isTaskAssignment: Boolean(result.isTaskAssignment),

    // Collaboration signals
    isNegotiation: Boolean(result.isNegotiation),
    requiresApproval: Boolean(result.requiresApproval),
    isDelegation: Boolean(result.isDelegation),

    // Context signals
    informationalOnly: Boolean(result.informationalOnly),
    isFollowUp: Boolean(result.isFollowUp),
    mentionsOthers: Boolean(result.mentionsOthers),
  };
}

/**
 * Default signals when detection fails
 */
function getDefaultWorkSignals(): WorkSignals {
  return {
    hasObligation: false,
    obligationStrength: 0,
    requiresJudgment: false,
    judgmentComplexity: 0,
    requiresDecision: false,
    hasDeadline: false,
    deadlineUrgency: 0,
    isTaskAssignment: false,
    isNegotiation: false,
    requiresApproval: false,
    isDelegation: false,
    informationalOnly: true, // Safe default: treat as FYI
    isFollowUp: false,
    mentionsOthers: false,
  };
}

// ==========================================
// SIGNAL ENCODING
// ==========================================

/**
 * Encode work signals into compact pattern key for lookup
 * Example: "OJT" = obligation + judgment + deadline
 */
export function encodeSignalPattern(signals: WorkSignals): SignalPatternKey {
  let pattern = '';

  if (signals.hasObligation) pattern += 'O';
  if (signals.requiresJudgment) pattern += 'J';
  if (signals.requiresDecision) pattern += 'D';
  if (signals.hasDeadline) pattern += 'T';
  if (signals.isTaskAssignment) pattern += 'A';
  if (signals.isNegotiation) pattern += 'N';
  if (signals.requiresApproval) pattern += 'P';
  if (signals.isDelegation) pattern += 'L';
  if (signals.informationalOnly) pattern += 'I';

  return pattern || 'NONE';
}

/**
 * Decode pattern key back to signal names
 */
export function decodeSignalPattern(pattern: SignalPatternKey): string[] {
  const signals: string[] = [];

  if (pattern.includes('O')) signals.push('obligation');
  if (pattern.includes('J')) signals.push('judgment');
  if (pattern.includes('D')) signals.push('decision');
  if (pattern.includes('T')) signals.push('deadline');
  if (pattern.includes('A')) signals.push('task_assignment');
  if (pattern.includes('N')) signals.push('negotiation');
  if (pattern.includes('P')) signals.push('approval');
  if (pattern.includes('L')) signals.push('delegation');
  if (pattern.includes('I')) signals.push('informational');

  return signals.length > 0 ? signals : ['none'];
}

// ==========================================
// BATCH DETECTION
// ==========================================

/**
 * Detect signals for multiple recipients at once
 * More efficient than individual calls
 */
export async function detectSignalsBatch(
  emailBody: string,
  emailSubject: string,
  recipients: Array<{ email: string; position: 'to' | 'cc' | 'bcc' }>
): Promise<Record<string, WorkSignals>> {

  // For now, detect individually (can optimize later with batched prompts)
  const results: Record<string, WorkSignals> = {};

  for (const recipient of recipients) {
    results[recipient.email] = await detectWorkSignals(
      emailBody,
      emailSubject,
      recipient.email,
      recipient.position
    );
  }

  return results;
}

// ==========================================
// SIGNAL ANALYSIS HELPERS
// ==========================================

/**
 * Calculate overall work impact score (0-100)
 */
export function calculateWorkImpact(signals: WorkSignals): number {
  let score = 0;

  // Obligation adds base impact
  if (signals.hasObligation) {
    score += signals.obligationStrength * 0.4; // Max 40 points
  }

  // Cognitive effort adds impact
  if (signals.requiresJudgment) {
    score += signals.judgmentComplexity * 0.3; // Max 30 points
  }

  // Urgency adds impact
  if (signals.hasDeadline) {
    score += signals.deadlineUrgency * 0.2; // Max 20 points
  }

  // Special cases
  if (signals.requiresDecision) {
    score += 10; // Decision = high impact
  }

  if (signals.informationalOnly) {
    score = Math.min(score, 10); // Cap FYI at very low impact
  }

  return Math.round(clamp(score, 0, 100));
}

/**
 * Check if signals indicate mechanical work (low judgment)
 */
export function isMechanicalWork(signals: WorkSignals): boolean {
  return (
    signals.hasObligation &&
    !signals.requiresJudgment &&
    !signals.requiresDecision &&
    signals.judgmentComplexity < 30
  );
}

/**
 * Check if signals indicate awareness only (no action)
 */
export function isAwarenessOnly(signals: WorkSignals): boolean {
  return (
    signals.informationalOnly ||
    (!signals.hasObligation &&
     !signals.requiresDecision &&
     !signals.isTaskAssignment)
  );
}

// ==========================================
// UTILITIES
// ==========================================

/**
 * Clamp number to range
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Format signals for human-readable display
 */
export function formatSignalsForDisplay(signals: WorkSignals): string {
  const active: string[] = [];

  if (signals.hasObligation) {
    active.push(`Obligation (${signals.obligationStrength}%)`);
  }
  if (signals.requiresJudgment) {
    active.push(`Judgment (complexity: ${signals.judgmentComplexity}%)`);
  }
  if (signals.requiresDecision) {
    active.push('Decision required');
  }
  if (signals.hasDeadline) {
    active.push(`Deadline (urgency: ${signals.deadlineUrgency}%)`);
  }
  if (signals.isTaskAssignment) {
    active.push('Task assignment');
  }
  if (signals.informationalOnly) {
    active.push('Informational only');
  }

  return active.length > 0 ? active.join(', ') : 'No clear signals';
}
