import OpenAI from 'openai';

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

  // ACTION DOMAIN (where does completion happen?)
  actionDomain: 'email' | 'external' | 'decision'; // Can this be completed via email reply?
  hasActionLinks: boolean; // Contains clickable action links/buttons (verify, update, login)
  mentionsExternalSystem: boolean; // References website, portal, account settings, "go to", "visit"

  // COMPLEXITY SIGNALS
  requiresJudgment: boolean; // Approval, choice, risk assessment
  canBePrepared: boolean; // Can AI draft a response that COMPLETES the task?
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
 * Maps to three levels of cognitive cost:
 * - Level 1 (Action): work_prepared, decision_required
 * - Level 2 (Awareness): noted
 * - Level 3 (Noise): noise (hidden completely)
 * - Special: waiting (blocked on external)
 */
export type WorkState = 'work_prepared' | 'decision_required' | 'waiting' | 'noted' | 'noise';

/**
 * Processed email with work-centric framing
 */
export interface ProcessedEmail {
  // WORK STATE (core)
  workState: WorkState;
  workTitle: string; // "Reply to Tea Vrcic" (not "Email from Tea")
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
 * Main processing function - detects signals and determines work state
 */
export async function processEmail(email: EmailData): Promise<ProcessedEmail> {
  const prompt = `You are a work preparation AI. Your job is to detect OBLIGATIONS and prepare WORK, not classify emails.

Email Details:
From: ${email.from_name} <${email.from_address}>
Subject: ${email.subject}
Received: ${new Date(email.received_at).toLocaleString()}

Body:
${email.body}

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

ACTION DOMAIN (CRITICAL - determines if task can be done via email):
Ask: "Can this task be COMPLETED by REPLYING to this email?"

- actionDomain: Classify as 'email', 'external', or 'decision'
  * email: Task completed by sending email reply (answer question, provide info, schedule via email)
  * external: Task requires leaving email (click link, visit website, login to portal, update settings, fill form)
  * decision: Task is cognitive only (approve with consequences, choose between options, assess tradeoffs)

- hasActionLinks: Does email contain action buttons/links? ("Click here", "Verify now", "Update", "Login")
- mentionsExternalSystem: Does it reference external systems? ("visit website", "go to portal", "login to", "update your account")

COMPLEXITY SIGNALS:
- requiresJudgment: Needs decision, approval, or choice with meaningful consequences?
- canBePrepared: Can AI write a draft response that COMPLETES the task (not just acknowledges it)?
- needsExternalInput: Blocked on external dependency (waiting for someone else)?

MECHANICAL SIGNALS (for filtering):
- isMechanicalConfirmation: Email verification, signup, password reset, account confirmation?
- isNotification: Receipt, invoice, shipping update, system alert, FYI update?
- hasOneObviousAction: Single obvious action with no judgment (click link, verify, confirm)?

URGENCY SIGNALS:
- explicitDeadline: Extract deadline (YYYY-MM-DD) or null
- impliedUrgency: immediate (ASAP, urgent), soon (this week), flexible (no rush)
- isTimebound: Meeting or time-sensitive event?

---

STEP 2: DETERMINE WORK STATE

CRITICAL: Use ACTION DOMAIN to determine correct work state.

Based on signals, classify into ONE work state:

1. WORK_PREPARED (Level 1 - Action Required)
   STRICT REQUIREMENT: actionDomain MUST be 'email'

   Must meet ALL:
   ✓ actionDomain = 'email' (task completed by REPLYING to email)
   ✓ Requires human judgment or meaningful human touch
   ✓ Draft reply would complete the task (not just acknowledge it)
   ✓ NOT a confirmation/notification/receipt

   Valid examples:
   - "Can you send me the report?" → Reply with report completes task
   - "When can we meet?" → Reply with times completes scheduling
   - "What's your opinion on X?" → Reply with opinion completes task

   INVALID examples (actionDomain = 'external'):
   - "Update your payment method" → Can't update via email reply
   - "Verify your email" → Must click link, not reply
   - "Complete this form" → Must visit external system

   → Action: Prepare draft reply that COMPLETES the task

2. DECISION_REQUIRED (Level 1 - Action Required)
   Two paths to this state:

   Path A - Pure decision:
   - actionDomain = 'decision'
   - Requires approval/choice with consequences
   - Multiple options with tradeoffs

   Path B - External action with urgency/judgment:
   - actionDomain = 'external'
   - High urgency OR significant consequences
   - Requires deciding WHEN/HOW to act externally

   Examples:
   - "Approve this $50k purchase" → decision domain
   - "Update payment or service stops tomorrow" → external + urgent
   - "Choose between vendor A or B" → decision domain

   → Action: Prepare analysis with options, risks, recommendation

3. WAITING (Special - Blocked)
   - needsExternalInput = true (waiting for someone else to respond first)
   - Scheduled for future (meeting is next week, not actionable now)
   - Requires information you don't have yet
   → Action: Track and resurface when ready

4. NOTED (Level 2 - Awareness Required)
   Two paths to this state:

   Path A - Mechanical external actions:
   - actionDomain = 'external'
   - Low judgment needed (obvious what to do)
   - Mechanical confirmations, verifications
   - User just needs awareness, not decision-making

   Path B - Pure notifications:
   - isNotification = true
   - Receipts, status updates, FYI updates
   - No action needed at all

   Examples:
   - "Confirm your email" → external + mechanical (just click link)
   - "Update payment method" → external BUT low urgency (can do later)
   - "Receipt for $49.99" → notification (already happened)
   - "Your order shipped" → notification (awareness only)

   → Action: Surface in "Noted" section, no response needed

5. NOISE (Level 3 - Hidden Completely)
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

Create user-facing text:
- workTitle: "Reply to [name]" or "Decide on [topic]" or "Review [topic]"
- whatIPrepared: "Draft to schedule call" or "Analysis with 3 options" or "Summary and key points"
- whyMatters: One sentence explaining context and importance

---

OUTPUT FORMAT (JSON):

{
  "workState": "work_prepared",
  "workTitle": "Reply to Tea Vrcic",
  "whatIPrepared": "Draft to schedule exhibition call",
  "whyMatters": "High-value meeting opportunity at 4YFN26 - first contact from potential partner",

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
    "actionDomain": "email",
    "hasActionLinks": false,
    "mentionsExternalSystem": false,
    "requiresJudgment": false,
    "canBePrepared": true,
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

CRITICAL RULES:
1. ALWAYS determine actionDomain FIRST: Can this be completed by replying to the email?
   - If YES → actionDomain = 'email'
   - If NO, requires external system → actionDomain = 'external'
   - If purely cognitive (approve, choose) → actionDomain = 'decision'

2. WORK_PREPARED rule: actionDomain MUST be 'email'
   - Only if replying to email COMPLETES the task
   - If action is external (update website, click link), NOT work_prepared
   - "Update payment method" = external, cannot be work_prepared
   - "Can you send report?" = email, can be work_prepared

3. DECISION_REQUIRED when:
   - actionDomain = 'decision' (approval, choice with consequences)
   - OR actionDomain = 'external' + high urgency/consequences

4. NOTED when:
   - actionDomain = 'external' + mechanical/low urgency
   - OR isNotification = true (receipts, status updates)
   - OR isMechanicalConfirmation = true

5. NOISE when:
   - Marketing/promotional content
   - Social notifications
   - No value to user awareness

6. Other rules:
   - If blocked on external input → WAITING
   - When uncertain between NOTED/NOISE → NOTED (safer)
   - For NOTED: no drafts, just awareness summary
   - For NOISE: no output at all
   - Confidence = certainty about signals + work state
   - Priority = urgency + sender authority + deadline + judgment

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
      workTitle: result.workTitle || `Email from ${email.from_name}`,
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
        actionDomain: 'email',
        hasActionLinks: false,
        mentionsExternalSystem: false,
        requiresJudgment: false,
        canBePrepared: true,
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
                    processed.workState === 'decision_required' ||
                    processed.workState === 'waiting',
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
