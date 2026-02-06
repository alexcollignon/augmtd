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
  suggestionType: string;
  suggestionContent: string;
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
  const prompt = `Analyze this email and suggest what action the recipient should take.

Email Details:
From: ${email.from_name} <${email.from_address}>
Subject: ${email.subject}
Received: ${new Date(email.received_at).toLocaleString()}

Body:
${email.body}

Your task:
1. Determine the TYPE of action needed:
   - "reply" = Needs an email response (questions, discussions, requests for info)
   - "task" = Action item required outside of email (update payment, complete form, submit document)
   - "meeting" = Schedule or respond to meeting invitation
   - "review" = Read and review information (reports, documents, updates)
   - "track" = Monitor or track something (shipments, deadlines, waiting for response)
   - "fyi" = For information only, no action needed

2. Suggest specific CONTENT for that action (what exactly to do)
3. Explain your REASONING
4. Assign a CONFIDENCE score (0-100)
5. Assign a PRIORITY score (0-100, higher = more urgent)

Respond in JSON format:
{
  "suggestionType": "reply|task|meeting|review|track|fyi",
  "suggestionContent": "Specific action description",
  "reasoning": "Why this action is recommended",
  "confidenceScore": 85,
  "priority": 70
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
      suggestionType: result.suggestionType || 'review',
      suggestionContent: result.suggestionContent || 'Review this email',
      reasoning: result.reasoning || 'No specific reasoning provided',
      confidenceScore: Math.min(100, Math.max(0, result.confidenceScore || 50)),
      priority: Math.min(100, Math.max(0, result.priority || 50))
    };
  } catch (error) {
    console.error('Error processing email with AI:', error);
    throw error;
  }
}
