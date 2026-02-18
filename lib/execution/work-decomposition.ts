/**
 * Work Decomposition Layer
 *
 * Analyzes incoming work requests (emails, manual tasks, etc.) and breaks them down
 * into executable steps using AI. Leverages user context profiles to personalize
 * the execution plan.
 *
 * Layer 2 of the architecture: Email/Request → Decomposition → Execution Plan
 */

import { SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import type { WorkflowSeed, DeliverableType } from '@/lib/types/inbox';

// Lazy-load OpenAI client
let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

interface DecompositionInput {
  source_type: 'email' | 'manual' | 'workflow';
  content: string; // Email body or task description
  subject?: string; // Email subject if applicable
  from?: string; // Sender email/name
  context?: {
    deadline?: string;
    attachments?: string[];
    thread_history?: any[];
  };
}

interface UserContext {
  identity?: {
    role?: string;
    title?: string;
    authority?: string;
    responsibilities?: string[];
    department?: string;
  };
  work_patterns?: {
    common_deliverables?: string[];
    preferred_formats?: string[];
    typical_data_sources?: string[];
    work_hours?: string;
  };
  domain_knowledge?: {
    expertise_areas?: string[];
    tools_used?: string[];
    key_stakeholders?: string[];
  };
  email_communication?: {
    tone?: string;
    response_patterns?: any;
  };
}

/**
 * Load user context profiles from database
 */
async function loadUserContext(
  userId: string,
  supabase: SupabaseClient
): Promise<UserContext> {
  const { data: profiles } = await supabase
    .from('context_profiles')
    .select('profile_type, profile_data, confidence_score')
    .eq('user_id', userId)
    .in('profile_type', ['identity', 'work_patterns', 'domain_knowledge', 'email_communication']);

  if (!profiles || profiles.length === 0) {
    return {};
  }

  const context: UserContext = {};
  for (const profile of profiles) {
    // Only use high-confidence profiles (>= 0.6)
    if (profile.confidence_score && profile.confidence_score >= 0.6) {
      context[profile.profile_type as keyof UserContext] = profile.profile_data;
    }
  }

  return context;
}

// Removed heuristic-based detection - using pure AI analysis instead

/**
 * Main decomposition function: Analyzes work and generates execution plan
 */
export async function decomposeWork(
  input: DecompositionInput,
  userId: string,
  supabase: SupabaseClient
): Promise<WorkflowSeed | null> {
  try {
    // 1. Load user context profiles
    const userContext = await loadUserContext(userId, supabase);

    // 2. Build context prompt
    let contextPrompt = '';
    if (userContext.identity) {
      contextPrompt += `User Profile:
- Role: ${userContext.identity.role || 'Unknown'}
- Title: ${userContext.identity.title || 'Unknown'}
- Department: ${userContext.identity.department || 'Unknown'}
- Responsibilities: ${userContext.identity.responsibilities?.join(', ') || 'Unknown'}

`;
    }

    if (userContext.work_patterns) {
      contextPrompt += `Work Patterns:
- Common Deliverables: ${userContext.work_patterns.common_deliverables?.join(', ') || 'Various'}
- Preferred Formats: ${userContext.work_patterns.preferred_formats?.join(', ') || 'Various'}
- Data Sources: ${userContext.work_patterns.typical_data_sources?.join(', ') || 'Various'}

`;
    }

    if (userContext.domain_knowledge) {
      contextPrompt += `Domain Knowledge:
- Expertise: ${userContext.domain_knowledge.expertise_areas?.join(', ') || 'General'}
- Tools: ${userContext.domain_knowledge.tools_used?.join(', ') || 'Standard tools'}

`;
    }

    // 3. Build the decomposition prompt
    const prompt = `${contextPrompt}Work Request:
${input.subject ? `Subject: ${input.subject}\n` : ''}${input.from ? `From: ${input.from}\n` : ''}
Message:
${input.content}

Analyze this work request and determine if it requires creating a deliverable (report, presentation, document, analysis, etc.).

If this is NOT a deliverable request (e.g., just asking a question, requesting information, scheduling a meeting, simple yes/no), return: null

If this IS a deliverable request, return a JSON object in this exact format:
{
  "deliverable_type": "report" | "presentation" | "document" | "email" | "analysis" | "spreadsheet",
  "deliverable_description": "Specific description using actual names from the email — e.g. 'Q1 2024 revenue report for Acme Corp' not 'quarterly report'",
  "deadline": "ISO timestamp if mentioned, otherwise null",
  "workflow_prompt": "2-4 sentences describing exactly what needs to be created, grounded in the email's specific details. Include the requester's name, the exact client or project name, what content is needed, and any constraints or deadlines. This becomes the opening message of a workflow conversation — make it specific enough that an AI can generate a detailed plan from it alone."
}

Guidelines:
- Only identify deliverable requests (things that need to be created/generated)
- Simple information requests, questions, or status updates should return null
- **USE SPECIFIC DETAILS**: Extract and use exact proper nouns from the email — client/company names, project names, system names, data types, dates. If the email says "Acme Corp", write "Acme Corp" not "the client".
- **workflow_prompt**: Must be specific and actionable. Include: who requested it, what exactly needs to be created, for whom, and any key constraints from the email. Do NOT be generic.
- Match deliverable_type to what's actually being requested

Examples of executable work:
- "Can you send me the Q1 report?" → executable (report deliverable)
- "Please prepare a deck for the board meeting" → executable (presentation deliverable)
- "Analyze customer churn data" → executable (analysis deliverable)

Examples of non-executable work:
- "What time is the meeting?" → return null (simple question)
- "Thanks for the update" → return null (acknowledgment)
- "Can you attend the standup?" → return null (calendar request)

Return ONLY the JSON object or null, no other text.`;

    // 4. Call OpenAI to generate execution plan
    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an expert at analyzing work requests and determining if they require creating deliverables. You distinguish between executable work (reports, presentations, analysis) and simple requests (questions, info). Return valid JSON for executable work or null for non-executable requests.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3, // Lower temperature for more consistent decomposition
      max_tokens: 1500,
    });

    const response = completion.choices[0]?.message?.content?.trim();

    if (!response) {
      console.error('[WorkDecomposition] No response from GPT-4o-mini');
      return null;
    }

    // 5. Parse and validate the execution plan
    // AI returns 'null' (string) for non-executable work
    if (response === 'null') {
      console.log('[WorkDecomposition] Not executable work (AI decision)');
      return null;
    }

    const seed = JSON.parse(response) as WorkflowSeed;

    // Validate the seed has required fields
    if (!seed.deliverable_type || !seed.workflow_prompt) {
      console.error('[WorkDecomposition] Invalid workflow seed structure');
      return null;
    }

    console.log(`[WorkDecomposition] Generated seed: ${seed.deliverable_description}`);
    return seed;

  } catch (error) {
    console.error('[WorkDecomposition] Error decomposing work:', error);
    return null;
  }
}

/**
 * Decompose work from an email
 */
export async function decomposeEmailWork(
  emailData: {
    subject: string;
    body: string;
    from: string;
    threadHistory?: any[];
  },
  userId: string,
  supabase: SupabaseClient
): Promise<WorkflowSeed | null> {
  return decomposeWork(
    {
      source_type: 'email',
      content: emailData.body,
      subject: emailData.subject,
      from: emailData.from,
      context: {
        thread_history: emailData.threadHistory,
      },
    },
    userId,
    supabase
  );
}

/**
 * Decompose work from a manual task description
 */
export async function decomposeManualWork(
  taskDescription: string,
  userId: string,
  supabase: SupabaseClient,
  deadline?: string
): Promise<WorkflowSeed | null> {
  return decomposeWork(
    {
      source_type: 'manual',
      content: taskDescription,
      context: { deadline },
    },
    userId,
    supabase
  );
}
