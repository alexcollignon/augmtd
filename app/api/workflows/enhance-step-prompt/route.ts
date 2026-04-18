import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAIClient } from '@/lib/ai/factory';

export const maxDuration = 30;

// POST /api/workflows/enhance-step-prompt
// Streams an improved instruction for an AI workflow step.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { prompt, step_label, workflow_name, step_type, tool_type, output_format, model_tier } = await request.json() as {
    prompt?: string;
    step_label?: string;
    workflow_name?: string;
    step_type?: 'ai' | 'tool' | 'agent';
    tool_type?: string;
    output_format?: string;
    model_tier?: string;
  };

  if (!prompt?.trim()) {
    return new Response('prompt is required', { status: 400 });
  }

  const wfName = workflow_name?.trim() || '[unnamed workflow]';
  const stepName = step_label?.trim() || '[unnamed step]';

  let systemPrompt: string;

  if (step_type === 'tool' && tool_type === 'web_search') {
    systemPrompt = `You are improving a web search query for an automated workflow step.

Workflow: "${wfName}"
Step: "${stepName}"

The user's draft query:
"${prompt.trim()}"

Rewrite this as an optimised web search query. Make it specific, well-scoped, and likely to find high-quality and current results. You may use multiple lines if the query covers multiple sources or angles. Keep it to the point — no filler words, no instructions, just the query terms and any useful site/date filters.

Respond with only the query text — no explanation, no quotes.`;

  } else if (step_type === 'agent') {
    systemPrompt = `You are improving a task description given to a custom AI agent inside an automated workflow.

Workflow: "${wfName}"
Step: "${stepName}"

The user's draft task:
"${prompt.trim()}"

Rewrite this as a clear, specific task description in 3–5 sentences. The agent receives the previous step outputs as context. Cover:
- What the agent should do with those inputs
- The tone, format, or structure of the output
- Any scope constraints or rules to follow
- What to do if the input is empty or irrelevant

Respond with only the task text — no preamble, no explanation, no quotes.`;

  } else {
    // AI step — tailor to output format
    const formatGuidance =
      output_format === 'json'
        ? 'The output format is structured JSON. Include in the instruction which exact field names to use, what each field should contain, and what value to use when a field is not available.'
        : output_format === 'text'
        ? 'The output format is plain text. The instruction should produce clean prose with no markdown, headers, or bullet points.'
        : 'The output format is formatted markdown. The instruction should produce well-structured output with headers and bullet points where appropriate.';

    const modelGuidance = model_tier === 'reasoning'
      ? 'The model is set to Thorough — it can handle complex reasoning, synthesis, and multi-step analysis.'
      : 'The model is set to Fast — keep the instruction focused and avoid asking for deep synthesis.';

    systemPrompt = `You are improving an AI step instruction for an automated workflow pipeline.

Workflow: "${wfName}"
Step: "${stepName}"
${formatGuidance}
${modelGuidance}

The user's draft instruction:
"${prompt.trim()}"

Rewrite this as a clear, specific, actionable instruction in 3–5 sentences. The step receives previous step outputs as context. Cover:
- What exactly the AI should do with those inputs
- The structure and format of the output (consistent with the output format above)
- Any filtering, scope, or prioritisation rules
- What to do if the input is empty or irrelevant

Respond with only the instruction text — no preamble, no explanation, no quotes.`;
  }

  const { client, model } = await getAIClient(user.id, 'summarization', supabase);

  const stream = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: systemPrompt }],
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
