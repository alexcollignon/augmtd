import { getAIClient } from '@/lib/ai/factory';
import { parseModelJSON } from '@/lib/ai/parse-json';
import { makeStepId } from '@/lib/workflows/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface GeneratedWorkflowConfig {
  name: string;
  description: string | null;
  trigger: Record<string, unknown>;
  steps: Array<Record<string, unknown>>;
  output_config: Record<string, unknown>;
}

function buildGenerationPrompt(contextLine: string, workerContextLine: string, description: string): string {
  return `You are a workflow configuration generator for a business automation tool. Respond with ONLY a valid JSON object — no explanation, no markdown fences.

${contextLine}
${workerContextLine ? workerContextLine + '\n' : ''}User request: "${description}"

Generate a workflow matching this JSON structure exactly:
{
  "name": "Short human-readable name (3–5 words)",
  "description": "One sentence describing what this workflow produces",
  "trigger": { "type": "manual" },
  "steps": [],
  "output_config": { "destination": "thread_message", "notification_mode": "inbox_card" }
}

TRIGGER OPTIONS:
- Manual: { "type": "manual" }
- Scheduled: { "type": "schedule", "cron": "0 9 * * *", "label": "Daily at 9am" }
  Use a schedule trigger if the request mentions timing ("every morning", "weekly", "on Mondays", etc.)
  Common crons: daily 9am="0 9 * * *", weekdays 8am="0 8 * * 1-5", Mondays 9am="0 9 * * 1", Fridays 5pm="0 17 * * 5"

STEP TYPES:

Tool step — fetches data, runs first:
{ "type": "tool", "id": "step_001", "label": "Short label", "tool": "TOOL_ID", "config": {} }

Available tools:
- "get_urgent_emails" — fetches unread inbox emails. config: {}
- "get_calendar" — fetches upcoming calendar events. config: {}
- "web_search" — searches the web for a topic. config: { "query": "specific search query" }
- "fetch_url" — reads the current content of specific pages. config: { "urls": ["https://example.com"] }
- "rss_feed" — follows a news or blog feed, returns only new articles. config: { "feeds": ["https://example.com/feed.xml"], "since": "last_run" }

AI step — processes and writes, runs last:
{ "type": "ai", "id": "step_002", "label": "Short label", "prompt": "...", "output_format": "markdown", "model_tier": "fast" }
- output_format: "markdown" for briefings/reports with structure, "text" for plain prose, "json" for structured data
- model_tier: "fast" for summarisation and simple writing, "reasoning" for analysis and complex judgement
- prompt: always begin with "Using the previous step outputs, ..."

OUTPUT CONFIG:
- For briefings, digests, summaries: { "destination": "thread_message", "notification_mode": "inbox_card" }
- For documents/reports to keep: { "destination": "artifact", "artifact_type": "document", "title_template": "{{workflow}} — {{date}}", "notification_mode": "inbox_card" }

RULES:
1. Use 2–4 steps total. Start with tool step(s) to gather data, end with exactly 1 AI step to synthesise.
2. Each step id must be unique strings like "step_001", "step_002".
3. Keep step labels short (3–5 words).
4. The AI step prompt must be specific about what to produce, what format, and what to do if input is empty.
5. For web research requests: use web_search with a well-targeted query.
6. For news/feed monitoring: prefer rss_feed over web_search if the user mentions a feed, blog, or specific publication.
7. Do not use read_kb_file unless the user explicitly mentions a document in their knowledge base.

Return ONLY the JSON object.`;
}

export async function generateWorkflowConfig(
  description: string,
  userId: string,
  supabase: SupabaseClient,
  options?: {
    companyName?: string | null;
    workerContext?: { name: string; description: string | null; instructions: string | null } | null;
  },
): Promise<GeneratedWorkflowConfig | null> {
  const contextLine = options?.companyName ? `User's company: ${options.companyName}` : '';
  const w = options?.workerContext;
  const workerContextLine = w
    ? `This workflow belongs to a worker named "${w.name}" (${w.description ?? ''}). The final AI step's tone, voice, and output style should reflect this worker's role. Here is the worker's persona for reference:\n${w.instructions ?? ''}`
    : '';

  const prompt = buildGenerationPrompt(contextLine, workerContextLine, description.trim());

  const { client, model } = await getAIClient(userId, 'generation', supabase);
  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 1200,
    temperature: 0.3,
  });

  const raw = completion.choices[0]?.message?.content ?? '';
  const generated = parseModelJSON<Record<string, unknown> | null>(raw, null);

  if (!generated || typeof generated !== 'object' || !generated.name || !Array.isArray(generated.steps)) {
    return null;
  }

  const steps = (generated.steps as Array<Record<string, unknown>>).map((s, i) => ({
    ...s,
    id: typeof s.id === 'string' && s.id ? s.id : makeStepId(),
    label: typeof s.label === 'string' ? s.label : `Step ${i + 1}`,
  }));

  return {
    name: String(generated.name).trim(),
    description: typeof generated.description === 'string' ? generated.description.trim() : null,
    trigger: (generated.trigger as Record<string, unknown>) ?? { type: 'manual' },
    steps,
    output_config: (generated.output_config as Record<string, unknown>) ?? { destination: 'thread_message', notification_mode: 'inbox_card' },
  };
}
