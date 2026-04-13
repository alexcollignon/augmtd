import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAIClient } from '@/lib/ai/factory';

export const maxDuration = 30;

// POST /api/agents/enhance-instructions
// Streams an improved system prompt based on the user's rough input.
// Injects real user context (name, company) where available; uses [PLACEHOLDERS] otherwise.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { name, description, instructions } = await request.json() as {
    name?: string;
    description?: string;
    instructions?: string;
  };

  if (!instructions?.trim()) {
    return new Response('instructions is required', { status: 400 });
  }

  // Fetch user context in parallel — name + company
  const [profileResult, companyResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single(),
    supabase
      .from('company_members')
      .select('companies(name)')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single(),
  ]);

  const userName = profileResult.data?.full_name ?? null;
  const companyRaw = companyResult.data?.companies;
  const companyName = companyRaw
    ? (Array.isArray(companyRaw) ? companyRaw[0]?.name : (companyRaw as { name?: string })?.name) ?? null
    : null;

  const contextLines: string[] = [];
  if (userName) contextLines.push(`User's name: ${userName}`);
  if (companyName) contextLines.push(`Company: ${companyName}`);
  const contextBlock = contextLines.length > 0
    ? `Known context about the user:\n${contextLines.join('\n')}\n\nUse this context directly in the instructions where relevant.`
    : `No specific user context is available — use [PLACEHOLDER] format for any specifics that would normally be filled in (e.g. [COMPANY_NAME], [DAY_RATE], [INDUSTRY]).`;

  const prompt = `You are helping a user write system instructions for a custom AI assistant.

IMPORTANT — what this agent can and cannot do:
This is a conversational chat agent. It responds when the user asks it something. It can search its knowledge base, read emails and calendar events for context, draft text, and generate documents. It CANNOT send emails autonomously, run on a schedule, monitor inboxes, trigger workflows, or take any action outside of a conversation turn. Never describe the agent as "sending", "scheduling", "monitoring", "automatically", or "on a [FREQUENCY] basis" — only as helping the user do something when asked.

${contextBlock}

Agent name: ${name?.trim() || '[unnamed agent]'}
${description?.trim() ? `Agent description: ${description.trim()}` : ''}

The user's rough input:
"${instructions.trim()}"

Rewrite this as a clear, well-structured system prompt in 4–6 sentences. Cover:
- The agent's role and specific focus area
- How it should respond when the user asks for help (format, tone, style)
- Constraints or rules to always follow
- Any domain-specific context implied by the input

For any specifics not mentioned or not available in context (pricing, client names, industry), use [PLACEHOLDER] format so the user knows what to fill in.

Respond with only the system prompt text — no preamble, no explanation, no quotes around the output.`;

  // Use the cheapest summarization model
  const { client, model } = await getAIClient(user.id, 'summarization', supabase);

  const stream = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 400,
    temperature: 0.7,
    stream: true,
  });

  const encoder = new TextEncoder();

  const readableStream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta?.content ?? '';
          if (delta) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
          }
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readableStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
