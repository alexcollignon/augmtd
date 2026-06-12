import { getAIClient } from '@/lib/ai/factory';
import { parseModelJSON } from '@/lib/ai/parse-json';
import { SupabaseClient } from '@supabase/supabase-js';
import type { UserContextProfile } from '@/lib/types/user-context';

/**
 * Calendar context for email processing
 */
export interface CalendarContext {
  meetingBehavior?: {
    preferredTimes: string[];
    noMeetingDays: string[];
    avgMeetingLength: number;
    bufferTime: number;
    participationStyle: string;
    organizerRate: number;
  };
  upcomingMeetings?: Array<{
    title: string;
    start_time: string;
    end_time: string;
    attendees: string[];
  }>;
  availability?: {
    nextAvailableSlot?: string;
    busyPeriods: Array<{ start: string; end: string }>;
  };
}

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
  user_context?: UserContextProfile; // Learned user behavior patterns
  calendar_context?: CalendarContext; // Calendar availability and meeting preferences
  is_forwarded?: boolean; // Whether this email was forwarded to the user
  recipient_position?: 'to' | 'cc'; // The user's position on this email
  recipient_email?: string;          // The user's own email address
  user_context_block?: string;       // Pre-built identity+context block from buildUserContextBlock()
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
  senderAuthority: 'high' | 'medium' | 'low' | 'none'; // Boss, client, colleague, vendor, automated system
  threadDepth: number; // Is this ongoing conversation?
  hasPreviousCommitment: boolean; // Did you promise to do something?
  isFollowUp: boolean; // Reminder about something?
  isAutomatedSender: boolean; // Email from no-reply or automated system?

  // EXECUTION TARGET (where does execution happen? NOT mental state)
  executionTarget: 'email' | 'external' | 'none'; // Where is the action taken?
  hasActionLinks: boolean; // Contains clickable action links/buttons (verify, update, login)
  mentionsExternalSystem: boolean; // References website, portal, account settings, "go to", "visit"

  // COMPLEXITY SIGNALS
  requiresJudgment: boolean; // Approval, choice, risk assessment
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
  workTitle: string; // OUTCOME-CENTRIC: "Schedule exhibition call"

  // DETECTED SIGNALS
  signals: EmailSignals;

  // SEMANTIC TYPE — drives Smart view filtering
  itemType: string; // 'reply' | 'decision' | 'meeting' | 'review' | 'fyi' | 'notification'

  // SCORING
  confidence: number; // 0-100
  priority: number; // 0-100
}

/**
 * Helper function to truncate text safely
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '\n\n[... truncated for length ...]';
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
 * Helper function to format calendar context
 */
function formatCalendarContext(calendarContext: CalendarContext | undefined): string {
  if (!calendarContext) {
    return '';
  }

  let contextSection = '\n=== CALENDAR CONTEXT ===\n';

  // Add upcoming meetings with detailed time slots
  if (calendarContext.upcomingMeetings && calendarContext.upcomingMeetings.length > 0) {
    contextSection += '\n🚨 EXISTING MEETINGS (next 7 days) - CHECK FOR CONFLICTS:\n';

    // Group by day for easier conflict detection
    const meetingsByDay: Record<string, Array<{title: string, start: Date, end: Date, attendees: string[]}>> = {};

    calendarContext.upcomingMeetings.forEach(meeting => {
      const startTime = new Date(meeting.start_time);
      const dayKey = startTime.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

      if (!meetingsByDay[dayKey]) {
        meetingsByDay[dayKey] = [];
      }

      meetingsByDay[dayKey].push({
        title: meeting.title,
        start: startTime,
        end: new Date(meeting.end_time),
        attendees: meeting.attendees,
      });
    });

    // Format by day
    Object.entries(meetingsByDay).forEach(([day, meetings]) => {
      contextSection += `\n${day}:\n`;
      meetings
        .sort((a, b) => a.start.getTime() - b.start.getTime())
        .forEach(m => {
          const startStr = m.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
          const endStr = m.end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
          contextSection += `  • ${startStr} - ${endStr}: ${m.title}\n`;
        });
    });
  }

  // Add meeting behavior patterns
  if (calendarContext.meetingBehavior) {
    const behavior = calendarContext.meetingBehavior;
    contextSection += '\nMeeting Preferences (learned patterns):\n';

    if (behavior.preferredTimes.length > 0) {
      contextSection += `- Preferred times: ${behavior.preferredTimes.join(', ')}\n`;
    }

    if (behavior.noMeetingDays.length > 0) {
      contextSection += `- Protected periods: ${behavior.noMeetingDays.join(', ')}\n`;
    }

    contextSection += `- Typical duration: ${behavior.avgMeetingLength} min\n`;
    contextSection += `- Buffer time: ${behavior.bufferTime} min\n`;
  }

  // Add availability summary
  if (calendarContext.availability) {
    contextSection += '\nAvailability Summary:\n';
    if (calendarContext.availability.busyPeriods.length === 0) {
      contextSection += '- Status: Fully available (no meetings scheduled)\n';
    } else {
      contextSection += `- Busy periods: ${calendarContext.availability.busyPeriods.length} meetings in next 7 days\n`;
    }
    if (calendarContext.availability.nextAvailableSlot) {
      contextSection += `- Next free slot: ${calendarContext.availability.nextAvailableSlot}\n`;
    }
  }

  contextSection += `
🚨 CRITICAL SCHEDULING RULES:
1. ALWAYS check the EXISTING MEETINGS list above before confirming ANY meeting time
2. If a requested time CONFLICTS with an existing meeting, you MUST:
   - Politely DECLINE the conflicting time
   - Explain the conflict ("I have [meeting name] from [time] to [time]")
   - Suggest 2-3 alternative times that are FREE
3. When suggesting times, prefer the user's preferred meeting times if available
4. Account for buffer time (${calendarContext.meetingBehavior?.bufferTime || 15} min) between meetings
5. NEVER confirm a time that overlaps with existing meetings, even partially

===========================

`;

  return contextSection;
}

/**
 * Main processing function - detects signals and determines work state
 */
export async function processEmail(email: EmailData, supabase: SupabaseClient): Promise<ProcessedEmail> {
  const { client: openai, model: defaultModel, endpoint } = await getAIClient(email.user_id!, 'planning', supabase);

  // Format thread context if available
  const threadContextSection = formatThreadContext(email.thread_context);

  // Format calendar context if available
  const calendarContextSection = formatCalendarContext(email.calendar_context);

  // Forwarded email note (prepended to thread context section)
  const forwardedNote = email.is_forwarded
    ? `\nNote: This email was forwarded to you. You were not in the original thread.\nThis represents work being delegated to you — treat it as an assignment, not a reply.\n`
    : '';

  // CC note — user is not the primary recipient
  const ccNote = email.recipient_position === 'cc'
    ? `\nNote: You were CC'd on this email — you are NOT a primary TO recipient. ` +
      `Only prepare a draft or action if: (a) ${email.recipient_email || 'the user'}'s email or name ` +
      `is explicitly mentioned in the body requiring a specific response, ` +
      `(b) the content clearly delegates work to you specifically, or ` +
      `(c) you are a named decision-maker for this item. ` +
      `Otherwise classify as NOTED (awareness only) with canBePreparedViaEmail = false and no draft.\n`
    : '';

  // Identity + context block — must be first in the prompt to prevent name adoption from thread
  const contextBlockSection = email.user_context_block
    ? `${email.user_context_block}\n\nCRITICAL: You are preparing work FOR the person described above.${email.recipient_email ? ` Their email is <${email.recipient_email}>.` : ''}\nWhen drafting replies, always write AS them and sign with their name.\nNEVER adopt any other name found in the email thread as the sender or signatory.\n\n`
    : `IDENTITY: You are preparing work on behalf of the user${email.recipient_email ? ` <${email.recipient_email}>` : ''}.\nWhen drafting a reply, always write AS this person.\nNEVER adopt or use any other name found in the email thread as the sender or signatory.\n\n`;

  const prompt = `You are a work preparation AI. Your job is to detect OBLIGATIONS and prepare WORK, not classify emails.

${contextBlockSection}${calendarContextSection}${forwardedNote}${ccNote}${threadContextSection}CURRENT EMAIL (the one requiring your response):
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
- senderAuthority: high (boss/exec), medium (client/colleague), low (vendor/marketing), none (automated system)
- threadDepth: 0 (new thread), 1-2 (short thread), 3+ (long thread)
- hasPreviousCommitment: Did recipient promise something earlier?
- isFollowUp: Is this a reminder/follow-up?
- isAutomatedSender: Check if sender appears to be automated/no-reply
  Consider patterns like: "noreply@", "no-reply@", "notifications@", "billing@", etc.
  Use this as CONTEXT when deciding work state - automated senders usually can't receive replies

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

1. WORK_PREPARED (Reply Needed - Via Email)
   Email reply is the action.

   Typical characteristics:
   ✓ executionTarget = 'email' (completed by REPLYING)
   ✓ Requires human judgment or meaningful human touch
   ✓ NOT a confirmation/notification/receipt
   ✓ Sender can receive replies (usually not from no-reply@ addresses)

   Common examples:
   - "Can you send me the report?" → reply needed
   - "When can we meet?" → reply needed
   - "What's your opinion on this?" → reply needed
   - Question from colleague/client → reply needed

   Consider context:
   - If sender is automated (no-reply@, billing@), usually can't receive replies
   - If action is external (click link, update settings), not an email reply task

   → Action: Surface for user to reply (no draft generated)

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
      Examples: "Update payment method", "Complete tax form", "Fix billing", "Payment failed"

      For payment/billing/automated emails:
      - Usually have consequences (service suspension, account issues)
      - Typically require external action (portal, settings, website)
      - Guide user to WHERE to take action: "Go to Stripe dashboard", "Visit billing settings"
      - Consider: Can the user reply to this email address? (no-reply@ usually can't receive replies)

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

4b. STEP 2B: CLASSIFY ITEM TYPE

Assign one itemType based on what this email requires:
- "reply": needs a conversational response from you (executionTarget='email', direct question/request from a human sender)
- "decision": needs you to approve, choose, or authorize (requiresJudgment=true, or explicit approval language)
- "meeting": scheduling request, calendar invite, RSVP needed (hasMeetingReference=true or isTimebound=true)
- "review": document, proposal, contract, or attachment for you to read/give feedback on
- "fyi": CC'd, informational, waiting on others — no action from you (workState='noted' or 'waiting')
- "notification": automated receipt, system alert, marketing, mechanical confirmation (workState='noise', isAutomatedSender=true, or isMechanicalConfirmation=true)

Priority order (use the FIRST that applies):
1. workState='noise' OR isMechanicalConfirmation OR (isAutomatedSender AND isNotification) → "notification"
2. hasMeetingReference OR isTimebound → "meeting"
3. requiresJudgment OR hasExplicitApprovalRequest → "decision"
4. hasAttachmentNeedingReview → "review"
5. executionTarget='email' AND sender is human → "reply"
6. workState='waiting' OR workState='noted' → "fyi"
7. default → "fyi"

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
- No draft is generated. The user will reply using the AI chat assistant.
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

---

OUTPUT FORMAT (JSON):

{
  "workState": "work_prepared",
  "workTitle": "Schedule exhibition call for 4YFN26",

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
    "needsExternalInput": false,
    "isMechanicalConfirmation": false,
    "isNotification": false,
    "hasOneObviousAction": false,
    "explicitDeadline": null,
    "impliedUrgency": "soon",
    "isTimebound": true
  },

  "itemType": "meeting",
  "confidence": 85,
  "priority": 70
}

EXAMPLE 2 - Mechanical Confirmation (ACTION_REQUIRED):

{
  "workState": "action_required",
  "workTitle": "Confirm Your Signup",

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
    "needsExternalInput": false,
    "isMechanicalConfirmation": true,  // ← CRITICAL: Enables batching in UI
    "isNotification": false,
    "hasOneObviousAction": true,
    "explicitDeadline": null,
    "impliedUrgency": "flexible",
    "isTimebound": false
  },

  "itemType": "notification",
  "confidence": 95,
  "priority": 40
}

EXAMPLE 3 - Payment Failure (ACTION_REQUIRED - Operational):

{
  "workState": "action_required",
  "workTitle": "Update payment method",

  "signals": {
    "hasDirectQuestion": false,
    "hasRequestForAction": true,
    "hasDeadlineMention": true,
    "hasMeetingReference": false,
    "hasAttachmentNeedingReview": false,
    "hasExplicitApprovalRequest": false,
    "senderAuthority": "none",
    "threadDepth": 0,
    "hasPreviousCommitment": false,
    "isFollowUp": false,
    "isAutomatedSender": true,  // From billing@ - context for decision
    "executionTarget": "external",
    "hasActionLinks": true,
    "mentionsExternalSystem": true,
    "requiresJudgment": false,
    "needsExternalInput": false,
    "isMechanicalConfirmation": false,  // Operational, not mechanical (high stakes)
    "isNotification": false,
    "hasOneObviousAction": true,
    "explicitDeadline": "2024-03-15",
    "impliedUrgency": "immediate",
    "isTimebound": true
  },

  "itemType": "fyi",
  "confidence": 95,
  "priority": 85
}

CRITICAL RULES:
1. ALWAYS determine executionTarget FIRST: WHERE is execution?
   - If completed by email reply → executionTarget = 'email'
   - If requires external system (website, portal, link) → executionTarget = 'external'
   - If purely cognitive (no execution, just decision) → executionTarget = 'none'

   DOMAINS ARE PLACES. DECISIONS ARE MENTAL STATES.

2. WORK_PREPARED guideline: executionTarget should be 'email' and sender should be able to receive replies
   - Only if email reply COMPLETES the task
   - "Can you send report?" → executionTarget='email' → Usually WORK_PREPARED
   - "Update payment" → executionTarget='external' → Usually ACTION_REQUIRED
   - Consider: automated senders (no-reply@) typically can't receive replies

3. POSITIVE RULE for ACTION_REQUIRED:
   IF hasOneObviousAction = true
   AND executionTarget = 'external'
   AND requiresJudgment = false
   → ACTION_REQUIRED

   This is a strong positive anchor. Use it.

4. For executionTarget = 'external' + high consequences:
   "Multiple viable options with tradeoffs?"
   - YES → DECISION_REQUIRED (choice)
   - NO → ACTION_REQUIRED (execution)

5. WAITING must NOT have downside risk before unblocked:
   "If ignoring causes harm before new input, NOT WAITING"

6. NOTED must have ZERO consequences:
   "If consequences exist, NOTED is invalid"

7. Priority bands (enforce these):
   - 80-100: Immediate downside or exec decision
   - 50-79: Important but not urgent
   - 20-49: Awareness / monitoring
   - <20: Noise

8. Other rules:
   - Confidence = certainty about signals + work state (0-100)
   - If marketing/promotional → NOISE
   - When uncertain between NOTED/NOISE → NOTED

Respond ONLY with valid JSON matching the structure above.`;

  function deriveItemType(result: any): string {
    const s = result.signals || {};
    const ws = result.workState || 'noted';
    if (ws === 'noise' || s.isMechanicalConfirmation || (s.isAutomatedSender && s.isNotification)) return 'notification';
    if (s.hasMeetingReference || s.isTimebound) return 'meeting';
    if (ws === 'decision_required' || s.hasExplicitApprovalRequest || s.requiresJudgment) return 'decision';
    if (s.hasAttachmentNeedingReview) return 'review';
    if (s.executionTarget === 'email' || ws === 'work_prepared') return 'reply';
    return 'fyi';
  }

  try {
    const response = await openai.chat.completions.create({
      model: defaultModel,
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
      // Apply json_object mode for all providers — Bedrock adapter translates it to a system
      // prompt instruction; Together AI / OpenAI-compatible APIs support it natively.
      // Without this, Together AI (Kimi K2.6) returns unstructured text → parse fails → fallback fires.
      response_format: { type: 'json_object' as const },
      max_tokens: 2048,
      temperature: 0.4,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = parseModelJSON(response.choices[0].message.content, {});

    // Validate and return with defaults
    return {
      itemType: result.itemType || deriveItemType(result),
      workState: result.workState || 'noted',
      workTitle: result.workTitle || email.subject || 'Review email',

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
        needsExternalInput: false,
        isMechanicalConfirmation: false,
        isNotification: false,
        hasOneObviousAction: false,
        explicitDeadline: null,
        impliedUrgency: 'flexible',
        isTimebound: false
      },

      confidence: Math.min(100, Math.max(0, result.confidence || 50)),
      priority: Math.min(100, Math.max(0, result.priority || 50)),
    };
  } catch (error) {
    console.error('Error processing email with AI:', error);
    throw error;
  }
}

