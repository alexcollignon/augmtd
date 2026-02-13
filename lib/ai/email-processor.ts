import OpenAI from 'openai';
import type { UserContextProfile } from '@/lib/types/user-context';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export interface EmailData {
  id: string;
  user_id: string | null;
  message_id: string;
  from_address: string;
  from_name: string;
  subject: string;
  body: string;
  received_at: string;
  thread_context?: Array<{
    from_address: string;
    from_name: string;
    subject: string;
    body: string;
    received_at: string;
    is_from_user?: boolean;
  }>;
  user_context?: UserContextProfile; // NEW: Learned user behavior patterns
}

/**
 * Signals detected in the email that indicate obligations or work
 */
export interface EmailSignals {
  // OBLIGATION SIGNALS
  hasDirectQuestion: boolean;
  hasRequestForAction: boolean;
  hasDeadlineMention: boolean;
  hasMeetingReference: boolean;
  hasAttachmentNeedingReview: boolean;
  hasExplicitApprovalRequest: boolean;

  // CONTEXT SIGNALS
  senderAuthority: 'high' | 'medium' | 'low'; // Boss, client, colleague, vendor, unknown
  threadDepth: number; // Is this ongoing conversation?
  hasPreviousCommitment: boolean; // Did you promise to do something?
  isFollowUp: boolean; // Reminder about something?

  // EXECUTION TARGET (where does execution happen? NOT mental state)
  executionTarget: 'email' | 'external' | 'none'; // Where is the action taken?
  hasActionLinks: boolean; // Contains clickable action links/buttons (verify, update, login)
  mentionsExternalSystem: boolean; // References website, portal, account settings, "go to", "visit"

  // COMPLEXITY SIGNALS
  requiresJudgment: boolean; // Approval, choice, risk assessment
  canBePreparedViaEmail: boolean; // Can AI draft EMAIL REPLY that COMPLETES the task?
  needsExternalInput: boolean; // Blocked on someone else?

  // MECHANICAL SIGNALS (auto-handleable)
  isMechanicalConfirmation: boolean; // Email verification, signup confirmation, etc.
  isNotification: boolean; // System notification, receipt, FYI update
  hasOneObviousAction: boolean; // Single click, no judgment needed

  // URGENCY SIGNALS
  explicitDeadline: string | null; // YYYY-MM-DD
  impliedUrgency: 'immediate' | 'soon' | 'flexible';
  isTimebound: boolean; // Meeting invite, event
}

/**
 * Work state - the core abstraction
 *
 * Maps to cognitive load and action type:
 * - WORK_PREPARED: Judgment now (reply, decide, approve - via email)
 * - ACTION_REQUIRED: Execution (prevent downside, clear next step - external)
 * - DECISION_REQUIRED: Choice under uncertainty (multiple options, tradeoffs)
 * - WAITING: Blocked on external input
 * - NOTED: Awareness only (no action needed)
 * - NOISE: Hidden completely
 */
export type WorkState = 'work_prepared' | 'action_required' | 'decision_required' | 'waiting' | 'noted' | 'noise';

/**
 * Processed email with work-centric framing
 */
export interface ProcessedEmail {
  // WORK STATE (core)
  workState: WorkState;
  workTitle: string; // OUTCOME-CENTRIC: "Schedule exhibition call" (not "Reply to Tea" or "Email from Tea")
  whatIPrepared: string; // "Draft to schedule exhibition call"
  whyMatters: string; // "High-value opportunity at 4YFN26"

  // DETECTED SIGNALS
  signals: EmailSignals;

  // PREPARED OUTPUT (conditional on work state)
  preparedOutput: {
    draft?: {
      subject: string;
      body: string;
      tone: 'professional' | 'friendly' | 'formal';
    };
    analysis?: {
      options: string[];
      risks: string[];
      recommendation: string;
    };
    nextSteps?: Array<{
      description: string;
      deadline?: string;
      estimatedTime?: string;
      preparedLink?: string;
    }>;
    calendarEvent?: {
      title: string;
      date?: string;
      duration?: string;
      description: string;
    };
    extractedData?: {
      people?: string[];
      companies?: string[];
      amounts?: string[];
      dates?: string[];
      links?: string[];
    };
  };

  // METADATA
  summary: string; // One-line summary
  keyPoints: string[]; // 2-4 bullet points
  urgency: 'low' | 'medium' | 'high' | 'critical';
  confidence: number; // 0-100
  priority: number; // 0-100
  reasoning: string; // Why we determined this work state
}

/**
 * Helper function to truncate text safely
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '\n\n[... truncated for length ...]';
}

/**
 * Helper function to format user context for AI prompt
 */
function formatUserContext(
  userContext: UserContextProfile | undefined,
  senderEmail: string
): string {
  if (!userContext) {
    return '';
  }

  const style = userContext.communicationStyle;
  const relationship = userContext.relationshipGraph[senderEmail];

  // Format tone preferences
  const toneDescriptions: string[] = [];
  if (style.toneVector.formal > 0.6) toneDescriptions.push('formal');
  if (style.toneVector.casual > 0.6) toneDescriptions.push('casual');
  if (style.toneVector.friendly > 0.6) toneDescriptions.push('friendly');
  if (style.toneVector.technical > 0.6) toneDescriptions.push('technical');
  if (style.toneVector.direct > 0.6) toneDescriptions.push('direct');

  const toneDescription = toneDescriptions.length > 0
    ? toneDescriptions.join(', ')
    : 'neutral';

  // Format formality
  let formalityDescription = 'neutral';
  if (style.formalityScore > 0.7) formalityDescription = 'very formal';
  else if (style.formalityScore > 0.55) formalityDescription = 'somewhat formal';
  else if (style.formalityScore < 0.3) formalityDescription = 'very casual';
  else if (style.formalityScore < 0.45) formalityDescription = 'somewhat casual';

  // Build context section
  let contextSection = `
USER'S COMMUNICATION STYLE (learned from their past emails):
- Typical email length: ${style.avgLength > 0 ? `${Math.round(style.avgLength)} characters` : 'varies'}
- Formality level: ${formalityDescription}
- Tone preferences: ${toneDescription}
- Emoji usage: ${style.emojiUsage > 0.3 ? 'frequently uses emojis' : style.emojiUsage > 0.1 ? 'occasionally uses emojis' : 'rarely uses emojis'}`;

  if (style.greetingPatterns.length > 0) {
    contextSection += `\n- Common greetings: ${style.greetingPatterns.slice(-3).join(', ')}`;
  }

  if (style.signatureStyle) {
    contextSection += `\n- Signature style: "${style.signatureStyle}"`;
  }

  if (style.commonPhrases.length > 0) {
    contextSection += `\n- Frequently uses phrases like: ${style.commonPhrases.slice(-5).map(p => `"${p}"`).join(', ')}`;
  }

  // Add relationship context if available
  if (relationship) {
    contextSection += `\n\nRELATIONSHIP WITH SENDER:
- Interaction frequency: ${relationship.interactionCount} previous emails
- Response rate: ${Math.round(relationship.responseRate * 100)}%
- Importance score: ${Math.round(relationship.importance * 100)}%
- Typical tone with this person: ${relationship.typicalTone}`;

    if (relationship.topics.length > 0) {
      contextSection += `\n- Common topics: ${relationship.topics.slice(-3).join(', ')}`;
    }
  }

  // Add confidence context
  const confidence = userContext.confidenceMetrics;
  if (confidence.overallScore > 0.5) {
    contextSection += `\n\nSTYLE LEARNING CONFIDENCE: ${Math.round(confidence.overallScore * 100)}% (${confidence.signalCount} interactions analyzed)`;
  }

  contextSection += `\n\nIMPORTANT: Match the user's established communication style when drafting replies. Use their typical greetings, tone, formality level, and common phrases.\n`;

  return contextSection;
}

/**
 * Helper function to format thread context
 */
function formatThreadContext(threadContext: EmailData['thread_context']): string {
  if (!threadContext || threadContext.length === 0) {
    return '';
  }

  // Take last 20 messages, sort chronologically (oldest first)
  const recentMessages = threadContext
    .slice(-20)
    .sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime());

  const formatted = recentMessages.map((msg, index) => {
    const isFromUser = msg.is_from_user || false;
    const sender = isFromUser ? 'YOU' : `${msg.from_name} <${msg.from_address}>`;
    const body = truncateText(msg.body, 3000);

    return `[Message ${index + 1} - ${new Date(msg.received_at).toLocaleString()}]
From: ${sender}
Subject: ${msg.subject}

${body}`;
  }).join('\n\n---\n\n');

  return `
THREAD CONTEXT (${recentMessages.length} previous message${recentMessages.length > 1 ? 's' : ''}):
This email is part of an ongoing conversation. Here's the thread history in chronological order:

${formatted}

---

`;
}

/**
 * Main processing function - detects signals and determines work state
 */
export async function processEmail(email: EmailData): Promise<ProcessedEmail> {
  // Format user context if available (learned communication style)
  const userContextSection = formatUserContext(email.user_context, email.from_address);

  // Format thread context if available
  const threadContextSection = formatThreadContext(email.thread_context);

  const prompt = `You are a work preparation AI. Your job is to detect OBLIGATIONS and prepare WORK, not classify emails.

${userContextSection}${threadContextSection}CURRENT EMAIL (the one requiring your response):
From: ${email.from_name} <${email.from_address}>
Subject: ${email.subject}
Received: ${new Date(email.received_at).toLocaleString()}

Body:
${truncateText(email.body, 3000)}

---

STEP 1: DETECT SIGNALS

Analyze the email and detect these signals:

OBLIGATION SIGNALS:
- hasDirectQuestion: Is there a direct question asked?
- hasRequestForAction: Is there an explicit action request? ("please", "can you", "could you")
- hasDeadlineMention: Is a deadline mentioned?
- hasMeetingReference: Meeting invite or scheduling request?
- hasAttachmentNeedingReview: Attachment that needs review?
- hasExplicitApprovalRequest: Approval language? ("approve", "confirm", "authorize")

CONTEXT SIGNALS:
- senderAuthority: high (boss/exec), medium (client/colleague), low (vendor/marketing)
- threadDepth: 0 (new thread), 1-2 (short thread), 3+ (long thread)
- hasPreviousCommitment: Did recipient promise something earlier?
- isFollowUp: Is this a reminder/follow-up?

EXECUTION TARGET (where does execution happen? Domains are PLACES, not mental states):
Ask: "WHERE is this task executed?"

- executionTarget: Classify as 'email', 'external', or 'none'
  * email: Execution = send email reply (answer question, provide info, schedule via email)
  * external: Execution = leave email (click link, visit website, portal, update settings, fill form)
  * none: Purely cognitive (no execution, just mental processing: approve, decide, assess)

- hasActionLinks: Does email contain action buttons/links? ("Click here", "Verify now", "Update", "Login")
- mentionsExternalSystem: Does it reference external systems? ("visit website", "go to portal", "login to", "update your account")

COMPLEXITY SIGNALS:
- requiresJudgment: Needs decision, approval, or choice with meaningful consequences?
- canBePreparedViaEmail: Can AI draft EMAIL REPLY that COMPLETES the task?
  INVARIANT: If executionTarget !== 'email', then canBePreparedViaEmail = false
- needsExternalInput: Blocked on external dependency (waiting for someone else)?

MECHANICAL SIGNALS (positive anchors for classification):
- isMechanicalConfirmation: CRITICAL for batching mechanical actions

  Set to TRUE if email matches ANY of these patterns:
  ✓ Subject contains: "confirm", "verify", "activate", "complete signup", "reset password"
  ✓ Automated sender: "no-reply@", "noreply@", "auth@", "accounts@", "verify@"
  ✓ Single-action pattern: "Click to verify", "Confirm your email", "Activate account"
  ✓ Account setup: New account confirmation, email verification, password reset

  Common examples that MUST be marked TRUE:
  - "Confirm Your Signup" from Supabase → TRUE
  - "Verify Your Email Address" from any service → TRUE
  - "Reset Your Password" from any service → TRUE
  - "Activate Your Account" from any service → TRUE
  - "Complete Registration" from any service → TRUE

  These are ACTION_REQUIRED (consequences exist) BUT mechanical (low friction, repetitive).
  Setting this TRUE enables UI batching to reduce clutter.

- isNotification: Receipt, invoice, shipping update, system alert, FYI update?
- hasOneObviousAction: Single obvious action with no judgment (click link, verify, confirm)?
  RULE: If hasOneObviousAction AND executionTarget='external' AND !requiresJudgment → ACTION_REQUIRED

URGENCY SIGNALS:
- explicitDeadline: Extract deadline (YYYY-MM-DD) or null
- impliedUrgency: immediate (ASAP, urgent), soon (this week), flexible (no rush)
- isTimebound: Meeting or time-sensitive event?

---

STEP 2: DETERMINE WORK STATE

CRITICAL: Use ACTION DOMAIN to determine correct work state.

Based on signals, classify into ONE work state:

1. WORK_PREPARED (Judgment Now - Via Email)
   STRICT: executionTarget MUST be 'email'

   Must meet ALL:
   ✓ executionTarget = 'email' (completed by REPLYING)
   ✓ canBePreparedViaEmail = true
   ✓ Requires human judgment or meaningful human touch
   ✓ NOT a confirmation/notification/receipt

   Valid examples:
   - "Can you send report?" → executionTarget='email', draft completes task
   - "When can we meet?" → executionTarget='email', reply schedules
   - "What's your opinion?" → executionTarget='email', reply answers

   INVALID:
   - "Update payment" → executionTarget='external'
   - "Verify email" → executionTarget='external'

   → Action: Prepare draft reply that COMPLETES the task

2. ACTION_REQUIRED (Execution - Prevent Downside)
   POSITIVE RULE: hasOneObviousAction + executionTarget='external' + !requiresJudgment

   Requirements:
   ✓ executionTarget = 'external' (must leave email)
   ✓ High consequences if ignored
   ✓ Clear next step (no real choice)
   ✓ hasOneObviousAction OR very clear path

   Two subtypes (both are ACTION_REQUIRED):

   A. MECHANICAL (set isMechanicalConfirmation=true):
      - Email/signup confirmations → Will be BATCHED in UI
      - Password resets → Will be BATCHED in UI
      - Account verifications → Will be BATCHED in UI
      Examples: "Confirm signup", "Verify email", "Reset password"

   B. OPERATIONAL (set isMechanicalConfirmation=false):
      - Payment updates → Will be shown INDIVIDUALLY
      - Compliance forms → Will be shown INDIVIDUALLY
      - Service issues → Will be shown INDIVIDUALLY
      Examples: "Update payment method", "Complete tax form", "Fix billing"

   NOT this state:
   - "Choose provider A or B" → requiresJudgment = true → DECISION_REQUIRED

   → Action: Prepare instructions + deadline, NO draft email

3. DECISION_REQUIRED (Choice Under Uncertainty)
   CRITICAL: True decisions with multiple viable paths.

   Requirements:
   ✓ requiresJudgment = true
   ✓ Multiple reasonable options with tradeoffs
   ✓ Uncertainty about best path
   ✓ executionTarget can be 'email', 'external', or 'none'

   Examples:
   - "Approve $50k purchase" → executionTarget='none', pure judgment
   - "Choose vendor A or B" → executionTarget='none', strategic choice
   - "Decide partnership approach" → executionTarget='none', options + risks

   NOT this state:
   - "Update payment or lose service" → hasOneObviousAction = true → ACTION_REQUIRED

   → Action: Prepare analysis with options, risks, recommendation

4. WAITING (Blocked - No Downside Risk Right Now)
   STRICT: Must NOT contain downside risk before new input arrives

   Requirements:
   ✓ needsExternalInput = true (waiting for someone else)
   ✓ Scheduled for future (not actionable now)
   ✓ No harm from ignoring until unblocked

   CRITICAL: "If ignoring this could cause harm before new input arrives, it is NOT WAITING"

   Examples:
   - Waiting for client to provide specs → Can't act yet, no risk
   - Meeting scheduled for next week → Not actionable now

   NOT this state:
   - "Waiting for approval, deadline tomorrow" → Has risk = ACTION_REQUIRED or DECISION_REQUIRED

   → Action: Track and resurface when ready

5. NOTED (Awareness Only - NO Consequences)
   STRICT: If consequences exist, NOTED is INVALID

   Requirements:
   ✓ Zero/minimal consequences if ignored
   ✓ Informational only
   ✓ No downside risk
   ✓ Already happened OR no action possible

   Examples:
   - "Email confirmed" → Already done, just FYI
   - "Receipt for $49.99" → Past event, awareness
   - "Order shipped" → Status update
   - "Hiring update" → Informational

   INVALID (these are ACTION_REQUIRED, not NOTED):
   - "Update payment or service stops" → Consequences exist = ACTION_REQUIRED (operational)
   - "Verify email to activate" → Consequences exist (can't use account) = ACTION_REQUIRED (mechanical)
   - "Confirm your signup" → Consequences exist (can't access account) = ACTION_REQUIRED (mechanical)
   - "Reset password before lockout" → Consequences exist = ACTION_REQUIRED (mechanical)

   RULE: "If consequences exist, NOTED is invalid"

   IMPORTANT: Don't confuse "low friction" with "no consequences"
   - Clicking a confirmation link is LOW FRICTION but HAS CONSEQUENCES (can't use account)
   - This makes it ACTION_REQUIRED (mechanical), not NOTED

   → Action: Surface in "Noted" section, no response needed

6. NOISE (Hidden Completely)
   No awareness needed, pure noise:
   ✓ Marketing emails (newsletters, promotions, sales)
   ✓ Social notifications (LinkedIn, Twitter, Facebook)
   ✓ Automated marketing (drip campaigns, onboarding sequences)
   ✓ Spam or low-value bulk mail
   ✓ Announcements from services you don't actively use

   Examples:
   - "Our weekly newsletter" → NOISE
   - "50% off sale!" → NOISE
   - "You have 3 new LinkedIn notifications" → NOISE
   - "Tips for getting started with [tool]" → NOISE

   → Action: Hide completely, don't show anywhere

---

STEP 3: PREPARE THE WORK

For WORK_PREPARED:
- Draft a complete reply (subject, body, tone)
  CRITICAL: If USER'S COMMUNICATION STYLE is provided, MATCH IT EXACTLY:
  * Use their typical greetings (e.g., "Hey" vs "Dear" vs "Hi there")
  * Match their formality level (very formal → somewhat formal → neutral → casual → very casual)
  * Apply their signature style if provided
  * Adopt their tone preferences (formal, casual, friendly, technical, direct)
  * Use their common phrases naturally
  * Match their typical email length
  * Match emoji usage (frequently/occasionally/rarely)
  * If relationship context shows high importance sender, adjust tone appropriately

  IMPORTANT: If thread context is provided, USE IT to write contextual replies:
  * Reference previous messages when relevant
  * Don't repeat what was already said
  * Build on previous commitments or statements
  * Acknowledge prior exchanges if appropriate
  * Understand the full conversation arc before drafting
- Extract next steps/action items
- Prepare calendar event if meeting mentioned
- Extract structured data (people, companies, amounts, dates, links)

For DECISION_REQUIRED:
- List options clearly
- Identify risks
- Provide recommendation (labeled as AI suggestion)

For WAITING:
- Explain what we're waiting for
- When to resurface this

For NO_WORK:
- Just summarize briefly

---

STEP 4: FRAME AS WORK

Create user-facing text (OUTCOME-CENTRIC, NOT EMAIL-CENTRIC):
- workTitle: Focus on the OUTCOME/ACTION, not the email mechanics
  GOOD: "Confirm Tuesday meeting" | "Review Q4 budget proposal" | "Decide on vendor selection"
  BAD: "Reply to John" | "Respond to Sarah" | "Email back to client"
  Pattern: [Verb] + [Object/Topic] (the actual work to be done)

- whatIPrepared: What you actually prepared (draft/analysis/summary)
  Examples: "Draft confirming Tuesday at 2pm" | "Analysis with 3 vendor options" | "Summary of key points"

- whyMatters: One sentence explaining context and importance

---

OUTPUT FORMAT (JSON):

{
  "workState": "work_prepared",
  "workTitle": "Schedule exhibition call for 4YFN26",
  "whatIPrepared": "Draft proposing call times",
  "whyMatters": "High-value meeting opportunity - first contact from potential partner",

  "signals": {
    "hasDirectQuestion": true,
    "hasRequestForAction": true,
    "hasDeadlineMention": false,
    "hasMeetingReference": true,
    "hasAttachmentNeedingReview": false,
    "hasExplicitApprovalRequest": false,
    "senderAuthority": "medium",
    "threadDepth": 0,
    "hasPreviousCommitment": false,
    "isFollowUp": false,
    "executionTarget": "email",
    "hasActionLinks": false,
    "mentionsExternalSystem": false,
    "requiresJudgment": false,
    "canBePreparedViaEmail": true,
    "needsExternalInput": false,
    "isMechanicalConfirmation": false,
    "isNotification": false,
    "hasOneObviousAction": false,
    "explicitDeadline": null,
    "impliedUrgency": "soon",
    "isTimebound": true
  },

  "preparedOutput": {
    "draft": {
      "subject": "Re: Response to your web enquiry...",
      "body": "Dear Tea,\\n\\nThank you for reaching out...",
      "tone": "professional"
    },
    "nextSteps": [
      {
        "description": "Send reply to schedule call",
        "deadline": null,
        "estimatedTime": "2 min",
        "preparedLink": null
      }
    ],
    "calendarEvent": {
      "title": "Call with Tea Vrcic - 4YFN26 Exhibition",
      "date": null,
      "duration": "30 min",
      "description": "Discuss exhibition opportunities"
    },
    "extractedData": {
      "people": ["Tea Vrcic"],
      "companies": ["4YFN26"],
      "amounts": [],
      "dates": [],
      "links": ["https://..."]
    }
  },

  "summary": "Tea wants to discuss exhibiting at 4YFN26",
  "keyPoints": [
    "Exhibition opportunity at 4YFN26",
    "First contact - high potential value",
    "Needs scheduling confirmation"
  ],
  "urgency": "medium",
  "confidence": 85,
  "priority": 70,
  "reasoning": "Detected meeting request + can prepare draft = work_prepared state. High priority due to business opportunity signal."
}

EXAMPLE 2 - Mechanical Confirmation (ACTION_REQUIRED):

{
  "workState": "action_required",
  "workTitle": "Confirm Your Signup",
  "whatIPrepared": "Instructions to confirm email address",
  "whyMatters": "Required to activate your account and access features",

  "signals": {
    "hasDirectQuestion": false,
    "hasRequestForAction": true,
    "hasDeadlineMention": false,
    "hasMeetingReference": false,
    "hasAttachmentNeedingReview": false,
    "hasExplicitApprovalRequest": false,
    "senderAuthority": "none",
    "threadDepth": 0,
    "hasPreviousCommitment": false,
    "isFollowUp": false,
    "executionTarget": "external",
    "hasActionLinks": true,
    "mentionsExternalSystem": true,
    "requiresJudgment": false,
    "canBePreparedViaEmail": false,
    "needsExternalInput": false,
    "isMechanicalConfirmation": true,  // ← CRITICAL: Enables batching in UI
    "isNotification": false,
    "hasOneObviousAction": true,
    "explicitDeadline": null,
    "impliedUrgency": "flexible",
    "isTimebound": false
  },

  "preparedOutput": {
    "nextSteps": [
      {
        "description": "Click confirmation link in email to activate account",
        "deadline": null,
        "estimatedTime": "1 minute"
      }
    ]
  },

  "summary": "Automated account confirmation email",
  "keyPoints": [
    "Single click to verify email address",
    "Required for account activation",
    "Low friction mechanical action"
  ],
  "urgency": "low",
  "confidence": 95,
  "priority": 40,
  "reasoning": "Mechanical confirmation: executionTarget='external' + hasOneObviousAction + isMechanicalConfirmation=true. Low priority (can be batched) but has consequences (ACTION_REQUIRED not NOTED)."
}

CRITICAL RULES:
1. ALWAYS determine executionTarget FIRST: WHERE is execution?
   - If completed by email reply → executionTarget = 'email'
   - If requires external system (website, portal, link) → executionTarget = 'external'
   - If purely cognitive (no execution, just decision) → executionTarget = 'none'

   DOMAINS ARE PLACES. DECISIONS ARE MENTAL STATES.

2. INVARIANT: If executionTarget !== 'email', then canBePreparedViaEmail = false
   - Prevents hallucinated drafts for external actions

3. WORK_PREPARED rule: executionTarget MUST be 'email'
   - Only if email reply COMPLETES the task
   - "Can you send report?" → executionTarget='email' → WORK_PREPARED
   - "Update payment" → executionTarget='external' → NOT work_prepared

4. POSITIVE RULE for ACTION_REQUIRED:
   IF hasOneObviousAction = true
   AND executionTarget = 'external'
   AND requiresJudgment = false
   → ACTION_REQUIRED

   This is a strong positive anchor. Use it.

5. For executionTarget = 'external' + high consequences:
   "Multiple viable options with tradeoffs?"
   - YES → DECISION_REQUIRED (choice)
   - NO → ACTION_REQUIRED (execution)

6. WAITING must NOT have downside risk before unblocked:
   "If ignoring causes harm before new input, NOT WAITING"

7. NOTED must have ZERO consequences:
   "If consequences exist, NOTED is invalid"

8. Priority bands (enforce these):
   - 80-100: Immediate downside or exec decision
   - 50-79: Important but not urgent
   - 20-49: Awareness / monitoring
   - <20: Noise

9. Other rules:
   - Confidence = certainty about signals + work state (0-100)
   - If marketing/promotional → NOISE
   - When uncertain between NOTED/NOISE → NOTED

Respond ONLY with valid JSON matching the structure above.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a work preparation assistant. Detect obligations in emails and prepare work, don\'t just classify them.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.4,
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');

    // Validate and return with defaults
    return {
      workState: result.workState || 'noted',
      workTitle: result.workTitle || email.subject || 'Review email',
      whatIPrepared: result.whatIPrepared || 'Summary for awareness',
      whyMatters: result.whyMatters || result.summary || 'For your awareness',

      signals: result.signals || {
        hasDirectQuestion: false,
        hasRequestForAction: false,
        hasDeadlineMention: false,
        hasMeetingReference: false,
        hasAttachmentNeedingReview: false,
        hasExplicitApprovalRequest: false,
        senderAuthority: 'medium',
        threadDepth: 0,
        hasPreviousCommitment: false,
        isFollowUp: false,
        executionTarget: 'email',
        hasActionLinks: false,
        mentionsExternalSystem: false,
        requiresJudgment: false,
        canBePreparedViaEmail: true,
        needsExternalInput: false,
        isMechanicalConfirmation: false,
        isNotification: false,
        hasOneObviousAction: false,
        explicitDeadline: null,
        impliedUrgency: 'flexible',
        isTimebound: false
      },

      preparedOutput: result.preparedOutput || {},

      summary: result.summary || 'Email received',
      keyPoints: result.keyPoints || [],
      urgency: result.urgency || 'medium',
      confidence: Math.min(100, Math.max(0, result.confidence || 50)),
      priority: Math.min(100, Math.max(0, result.priority || 50)),
      reasoning: result.reasoning || 'No specific reasoning provided'
    };
  } catch (error) {
    console.error('Error processing email with AI:', error);
    throw error;
  }
}

/**
 * Legacy function for backward compatibility - now just calls processEmail
 * TODO: Remove after migration
 */
export async function checkIfActionable(email: EmailData): Promise<{ isActionable: boolean; reasoning: string }> {
  try {
    const processed = await processEmail(email);
    return {
      isActionable: processed.workState === 'work_prepared' ||
                    processed.workState === 'action_required' ||
                    processed.workState === 'decision_required',
      reasoning: processed.reasoning
    };
  } catch (error) {
    console.error('Error in checkIfActionable:', error);
    return {
      isActionable: false,
      reasoning: 'Pre-filter check failed, defaulting to not actionable'
    };
  }
}
