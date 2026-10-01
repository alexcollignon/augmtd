import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { parseModelJSON } from '@/lib/ai/parse-json';

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
- Written in the language of the agent's description and instructions, as natural, grammatical sentences (never telegraphic keyword strings); a request ends without a question mark, a question with one
- No specific figures, prices, quantities, dates, places, company or product names the description does not give — a starter asks for the work, it does not invent its details

Respond with valid JSON only: { "starters": ["...", "...", "...", "..."] }`;

    const completion = await aiCreate(client, {
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.8,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices?.[0]?.message?.content ?? '';
    // W37 (eval decoration.chat-starters, EU): a fenced or prefaced JSON reply threw in JSON.parse and every
    // EU coworker got no starters at all — the shared tolerant parser reads it.
    const parsed = parseModelJSON<{ starters?: unknown } | null>(raw, null);
    const starters = parsed?.starters;
    if (!Array.isArray(starters) || starters.length === 0) return null;
    const source = [name, description ?? '', instructions ?? ''].join('\n');
    const kept = starters.map((s: unknown) => String(s).trim()).filter(Boolean).filter((s: string) => !inventsFigure(s, source));
    return kept.length ? kept.slice(0, 4) : null;
  } catch (e) {
    console.warn('[generateStartersForAgent] failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** W37 · A STARTER NEVER INVENTS A FIGURE (eval decoration.chat-starters: "under $0.10 each", "1,000 MOQ",
 *  "<3 week lead time" for an agent whose description stated none). A starter carrying a number or currency
 *  amount the agent's own description/instructions do not state is dropped. Pure. */
export function inventsFigure(starter: string, source: string): boolean {
  const src = String(source ?? '');
  const figs = String(starter ?? '').match(/[$€£]\s?\d[\d.,]*|\d[\d.,]*/g) ?? [];
  return figs.some((f) => !src.includes(f.replace(/^[$€£]\s?/, '').replace(/[.,]$/, '')));
}

