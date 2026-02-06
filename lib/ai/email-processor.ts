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

export interface ActionableResult {
  isActionable: boolean;
  reasoning: string;
}

export interface ProcessedEmail {
  // Quick classification
  category: string; // 'action_required' | 'question' | 'decision' | 'information' | 'newsletter' | 'promotional' | 'social' | 'other'

  // Summary and context
  summary: string;
  keyPoints: string[];
  urgency: 'low' | 'medium' | 'high' | 'critical';
  deadline?: string;

  // Prepared work
  actionItems: Array<{
    description: string;
    deadline?: string;
    estimatedTime?: string;
    preparedLink?: string;
  }>;

  draftReply?: {
    subject: string;
    body: string;
    tone: string;
  };

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

  followUpActions?: string[];

  // Metadata
  reasoning: string;
  confidenceScore: number;
  priority: number;
}

/**
 * Lightweight AI check to determine if email requires action
 * Uses GPT-4o-mini for cost efficiency (~$0.0001 per email)
 */
export async function checkIfActionable(email: EmailData): Promise<ActionableResult> {
  const prompt = `Analyze this email and determine if it requires action or response.

Email from: ${email.from_name} <${email.from_address}>
Subject: ${email.subject}
Body: ${email.body.substring(0, 1000)}

Classify as ACTIONABLE if:
- Requires a response (questions, requests, meeting invites)
- Contains important information that needs tracking
- Is from a colleague/client and not automated
- Contains deadlines or action items

Classify as NOT ACTIONABLE if:
- Promotional/marketing content
- Automated notifications (no-reply addresses)
- Newsletters or digests
- Social media updates
- Spam or low-priority updates

Respond in JSON format:
{
  "isActionable": true/false,
  "reasoning": "Brief explanation (1 sentence)"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an email triage assistant. Classify emails as actionable or not actionable.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');
    return {
      isActionable: result.isActionable || false,
      reasoning: result.reasoning || 'Unable to determine'
    };
  } catch (error) {
    console.error('Error checking if email is actionable:', error);
    // Default to actionable if check fails (fail open)
    return {
      isActionable: true,
      reasoning: 'Pre-filter check failed, defaulting to actionable'
    };
  }
}

/**
 * Full AI processing to generate inbox item suggestion
 * Uses GPT-4o-mini for cost efficiency (~$0.0001-0.0002 per email)
 */
export async function processEmail(email: EmailData): Promise<ProcessedEmail> {
  const prompt = `You are a work preparation AI for busy professionals. Analyze this email and prepare EVERYTHING the person needs to handle it efficiently.

Email Details:
From: ${email.from_name} <${email.from_address}>
Subject: ${email.subject}
Received: ${new Date(email.received_at).toLocaleString()}

Body:
${email.body}

PREPARE THE FOLLOWING:

1. CATEGORY (choose ONE that best fits):
   - action_required: Tasks that need to be completed
   - question: Someone is asking you a question
   - decision: Requires your approval/decision/input
   - information: FYI only, no action needed
   - newsletter: Subscribed newsletters, digests, updates
   - promotional: Marketing, sales, ads, special offers
   - social: Social media notifications, updates from platforms
   - other: Anything else (receipts, confirmations, automated messages)

2. SUMMARY: One sentence overview (max 100 chars)
3. KEY POINTS: 2-4 bullet points of important information
4. URGENCY: low, medium, high, or critical (only high/critical if truly time-sensitive)
5. DEADLINE: Extract any deadlines (YYYY-MM-DD format, or null)

6. ACTION ITEMS: List specific tasks with:
   - description (what to do)
   - deadline (if mentioned)
   - estimatedTime (rough estimate like "5 min", "1 hour")
   - preparedLink (extract any relevant URLs)

7. DRAFT REPLY: If this email needs a response, write a complete draft reply with:
   - subject (Re: original subject)
   - body (professional, clear, addresses all points)
   - tone (professional/friendly/formal)

8. CALENDAR EVENT: If there's a meeting/deadline, create event details:
   - title
   - date (if mentioned)
   - duration (if mentioned)
   - description

9. EXTRACTED DATA: Pull out structured information:
   - people (names mentioned)
   - companies (organizations mentioned)
   - amounts (money, quantities)
   - dates (all dates mentioned)
   - links (all URLs)

10. FOLLOW-UP ACTIONS: What happens after the main action? (e.g., "Confirm receipt", "Schedule follow-up")

11. REASONING: Why you classified/prepared it this way
12. CONFIDENCE SCORE: 0-100 (how confident in your analysis)
13. PRIORITY: 0-100 (how urgent/important)

Respond in JSON format matching this structure. If a field doesn't apply, use null or empty array.
{
  "category": "action_required",
  "summary": "Brief one-line summary",
  "keyPoints": ["Point 1", "Point 2"],
  "urgency": "high",
  "deadline": "2026-02-19",
  "actionItems": [
    {
      "description": "Specific task",
      "deadline": "2026-02-19",
      "estimatedTime": "10 min",
      "preparedLink": "https://example.com"
    }
  ],
  "draftReply": {
    "subject": "Re: ...",
    "body": "Full draft email...",
    "tone": "professional"
  },
  "calendarEvent": {
    "title": "Event title",
    "date": "2026-02-19",
    "duration": "30 min",
    "description": "Event details"
  },
  "extractedData": {
    "people": ["John Doe"],
    "companies": ["Acme Corp"],
    "amounts": ["$100"],
    "dates": ["Feb 19"],
    "links": ["https://..."]
  },
  "followUpActions": ["Action 1", "Action 2"],
  "reasoning": "Explanation of analysis",
  "confidenceScore": 90,
  "priority": 85
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a personal AI assistant helping users manage their inbox. Provide thoughtful, context-aware suggestions.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.5,
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');

    return {
      category: result.category || 'information',
      summary: result.summary || 'Email received',
      keyPoints: result.keyPoints || [],
      urgency: result.urgency || 'medium',
      deadline: result.deadline || undefined,
      actionItems: result.actionItems || [],
      draftReply: result.draftReply || undefined,
      calendarEvent: result.calendarEvent || undefined,
      extractedData: result.extractedData || undefined,
      followUpActions: result.followUpActions || [],
      reasoning: result.reasoning || 'No specific reasoning provided',
      confidenceScore: Math.min(100, Math.max(0, result.confidenceScore || 50)),
      priority: Math.min(100, Math.max(0, result.priority || 50))
    };
  } catch (error) {
    console.error('Error processing email with AI:', error);
    throw error;
  }
}
