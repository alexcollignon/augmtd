import { getAIClient, aiCreate } from '@/lib/ai/factory';

interface GenerateStartersParams {
  name: string;
  description?: string | null;
  instructions?: string | null;
  userId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
}

export async function generateStartersForAgent({
  name,
  description,
  instructions,
  userId,
  supabase,
}: GenerateStartersParams): Promise<string[] | null> {
  try {
    const { client, model } = await getAIClient(userId, 'summarization', supabase);

    const prompt = `You are helping configure a custom AI assistant.
Agent name: ${name}
${description ? `Agent description: ${description}` : ''}
${instructions ? `Agent instructions: ${instructions}` : ''}

Generate exactly 4 short conversation starter prompts a user might send to this agent.
Rules:
- Each starter must be 6–10 words
- Phrased as a direct user request (imperative or question)
- Specific to this agent's purpose — not generic
- Varied: cover different angles of what the agent can do

Respond with valid JSON only: { "starters": ["...", "...", "...", "..."] }`;

    const completion = await aiCreate(client, {
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.8,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(raw);
    const starters = parsed?.starters;
    if (!Array.isArray(starters) || starters.length === 0) return null;
    return starters.slice(0, 4).map((s: unknown) => String(s).trim()).filter(Boolean);
  } catch {
    return null;
  }
}
