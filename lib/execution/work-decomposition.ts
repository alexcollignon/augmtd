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
import type { ExecutionPlan, DeliverableType } from '@/lib/types/inbox';

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

/**
 * Determine if the work request is a deliverable that can be executed
 */
function isExecutableDeliverable(content: string, subject?: string): boolean {
  const text = `${subject || ''} ${content}`.toLowerCase();

  // Keywords indicating deliverable requests
  const deliverablePatterns = [
    /can you (send|provide|share|prepare|create|generate|make)/,
    /need (a |the )?(report|presentation|analysis|deck|spreadsheet|document)/,
    /please (send|provide|share|prepare|create)/,
    /(send|provide|share) (me |us )?(the |a )?/,
    /prepare (a |the )?(report|presentation|analysis)/,
    /create (a |the )?(report|presentation|analysis|deck)/,
    /put together/,
    /pull together/,
    /compile (a |the )?/,
  ];

  return deliverablePatterns.some(pattern => pattern.test(text));
}

/**
 * Main decomposition function: Analyzes work and generates execution plan
 */
export async function decomposeWork(
  input: DecompositionInput,
  userId: string,
  supabase: SupabaseClient
): Promise<ExecutionPlan | null> {
  try {
    // 1. Check if this is actually executable work
    if (!isExecutableDeliverable(input.content, input.subject)) {
      console.log('[WorkDecomposition] Not an executable deliverable, skipping');
      return null;
    }

    // 2. Load user context profiles
    const userContext = await loadUserContext(userId, supabase);

    // 3. Build context prompt
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

    // 4. Build the decomposition prompt
    const prompt = `${contextPrompt}Work Request:
${input.subject ? `Subject: ${input.subject}\n` : ''}${input.from ? `From: ${input.from}\n` : ''}
Message:
${input.content}

Analyze this work request and create an execution plan. Determine:
1. What deliverable is being requested (report, presentation, analysis, etc.)
2. What steps are needed to create it
3. What skills or capabilities are required for each step
4. Estimated timeline

Return ONLY a JSON object in this exact format:
{
  "deliverable_type": "report" | "presentation" | "document" | "email" | "analysis" | "spreadsheet",
  "deliverable_description": "Brief description of what will be created",
  "deadline": "ISO timestamp if mentioned, otherwise null",
  "estimated_time": "Human-readable estimate like '10 minutes' or '1 hour'",
  "steps": [
    {
      "number": 1,
      "action": "Clear description of what this step does",
      "skill": "Capability needed (e.g., 'data_pull', 'excel_generator', 'email_drafter')",
      "status": "pending"
    }
  ]
}

Available skills:
- data_pull: Retrieve data from databases or systems
- excel_generator: Create Excel spreadsheets with formatting and charts
- powerpoint_generator: Create PowerPoint presentations
- word_generator: Create Word documents
- email_drafter: Draft professional email responses
- data_analyzer: Analyze data and generate insights
- chart_generator: Create visualizations and charts

Guidelines:
- Keep steps concrete and actionable (not generic like "do analysis")
- Match deliverable_type to what's actually being requested
- Use user's typical work patterns when available
- Be realistic about estimated_time
- Maximum 6 steps (if more complex, group related actions)
- If no clear deliverable is requested, return null

Return ONLY the JSON object, no other text.`;

    // 5. Call OpenAI to generate execution plan
    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an expert at analyzing work requests and breaking them down into executable steps. Always return valid JSON only.',
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
      console.error('[WorkDecomposition] No response from GPT-4o');
      return null;
    }

    // 6. Parse and validate the execution plan
    const executionPlan = JSON.parse(response) as ExecutionPlan;

    // Validate the plan has required fields
    if (!executionPlan.deliverable_type || !executionPlan.steps || executionPlan.steps.length === 0) {
      console.error('[WorkDecomposition] Invalid execution plan structure');
      return null;
    }

    console.log(`[WorkDecomposition] Generated plan: ${executionPlan.deliverable_description} (${executionPlan.steps.length} steps)`);
    return executionPlan;

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
): Promise<ExecutionPlan | null> {
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
): Promise<ExecutionPlan | null> {
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
