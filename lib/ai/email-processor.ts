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

  // COMPLEXITY SIGNALS
  requiresJudgment: boolean; // Approval, choice, risk assessment
  canBePrepared: boolean; // Can AI draft a response?
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
 */
export type WorkState = 'work_prepared' | 'decision_required' | 'waiting' | 'no_work';

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

COMPLEXITY SIGNALS:
- requiresJudgment: Needs decision, approval, or choice with meaningful consequences?
- canBePrepared: Can AI write a draft response that adds value?
- needsExternalInput: Blocked on external dependency?

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

CRITICAL: Only surface work that requires HUMAN JUDGMENT. Be ruthlessly strict.

Based on signals, classify into ONE work state:

1. NO_WORK (DEFAULT - BE AGGRESSIVE)
   ✓ Confirmations (email verification, signup confirmation, password reset)
   ✓ Receipts, invoices, order confirmations
   ✓ Notifications (system alerts, status updates, shipping updates)
   ✓ Marketing (newsletters, promotions, announcements)
   ✓ FYI updates (no response needed)
   ✓ Automated alerts (monitoring, security, automated systems)
   ✓ ONE obvious action with NO judgment needed (click to confirm, verify email)
   ✓ Low authority sender + no meaningful obligation
   → Action: Auto-handle silently or batch as "Handled for you"

2. WAITING
   - needsExternalInput = true (waiting for someone else to respond first)
   - Scheduled for future (meeting is next week, not actionable now)
   - Requires information you don't have yet
   → Action: Track and resurface when ready

3. DECISION_REQUIRED
   - requiresJudgment = true (approval with consequences, choice between options, strategic decision)
   - Multiple valid approaches with tradeoffs
   - Risk/reward assessment needed
   - Cannot be handled without human input
   → Action: Prepare analysis with options, risks, recommendation

4. WORK_PREPARED (STRICT - RARE)
   Must meet ALL of these:
   ✓ Requires human judgment OR meaningful human touch (not mechanical)
   ✓ Has meaningful consequences if done wrong
   ✓ Can prepare a draft response that saves time
   ✓ NOT a confirmation/notification/receipt
   ✓ NOT a single obvious mechanical action

   Examples that QUALIFY:
   - Reply to client inquiry (requires context, tone, judgment)
   - Schedule meeting with important contact (requires availability check, prioritization)
   - Respond to colleague's question (requires domain knowledge)

   Examples that DO NOT QUALIFY:
   - "Confirm your email address" → NO_WORK
   - "Update payment method" → NO_WORK (unless critical/urgent, then maybe DECISION_REQUIRED)
   - "Your order has shipped" → NO_WORK
   - "Please verify your account" → NO_WORK

   → Action: Prepare draft reply or next steps

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
1. Email is EVIDENCE. The WORK is what matters.
2. DEFAULT TO NO_WORK. Most emails don't need the user's attention.
3. If isMechanicalConfirmation = true → NO_WORK (confirmations are auto-handleable)
4. If isNotification = true → NO_WORK (notifications don't need response)
5. If hasOneObviousAction = true AND requiresJudgment = false → NO_WORK
6. If blocked on external input → WAITING
7. If requires meaningful judgment with consequences → DECISION_REQUIRED
8. WORK_PREPARED is RARE. Only use when human judgment + meaningful preparation is needed.
9. When uncertain, default to NO_WORK (not WORK_PREPARED). Better to hide than to spam.
10. For NO_WORK: don't create drafts, action items, or calendar events
11. Confidence = how certain you are about the signals + work state
12. Priority = urgency + sender authority + deadline proximity + judgment complexity

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
      workState: result.workState || 'work_prepared',
      workTitle: result.workTitle || `Review email from ${email.from_name}`,
      whatIPrepared: result.whatIPrepared || 'Summary and analysis',
      whyMatters: result.whyMatters || result.summary || 'Needs your attention',

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
      isActionable: processed.workState !== 'no_work',
      reasoning: processed.reasoning
    };
  } catch (error) {
    console.error('Error in checkIfActionable:', error);
    return {
      isActionable: true,
      reasoning: 'Pre-filter check failed, defaulting to actionable'
    };
  }
}
