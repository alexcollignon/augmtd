// ─── Deep Research tool ───────────────────────────────────────────────────────
// Agentic research loop: given a list of topics (parsed from previous step
// output or supplied explicitly), runs Bedrock Claude + Tavily web search in
// multi-turn conversation to produce cited, substantive research per topic.
//
// Always uses Bedrock EU (Claude Haiku 4.5 / Sonnet 4.6) regardless of the
// user's tier — data isolation is the point.

import { createBedrockAdapter } from '@/lib/ai/bedrock-adapter';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DeepResearchConfig {
  // What makes a topic worth including. Required — drives both search strategy
  // and synthesis framing. E.g. "German-Portuguese bilateral business" or
  // "regulatory changes affecting UK fintech".
  focus: string;

  // Explicit queries to research. If set, ignores the previous step output
  // entirely (standalone mode). If omitted, topics are extracted from the
  // previous step (enrichment mode).
  queries?: string[];

  // Enrichment mode: how many topics to extract from previous step (default 6).
  max_topics?: number;

  // Max Tavily search calls per topic (default 3, capped at 5).
  max_searches?: number;

  // Output language as BCP-47 code. Default 'en'. Set 'de' for German, etc.
  language?: string;

  // Bedrock model. 'fast' = Haiku 4.5 (default), 'thorough' = Sonnet 4.6.
  model?: 'fast' | 'thorough';
}

interface ResearchResult {
  topic: string;
  summary: string;
  sources: Array<{ title: string; url: string; outlet?: string }>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BEDROCK_MODELS = {
  fast:     'eu.anthropic.claude-haiku-4-5-20251001-v1:0',
  thorough: 'eu.anthropic.claude-sonnet-4-6-20251001-v1:0',
} as const;

const MAX_SEARCHES_CAP = 5;
const TOPIC_CONCURRENCY = 3;

// ─── Public entry point ───────────────────────────────────────────────────────

export async function executeDeepResearch(
  config: DeepResearchConfig,
  previousStepOutput: string,
): Promise<string> {
  const focus      = config.focus?.trim();
  const maxTopics  = Math.max(1, config.max_topics ?? 6);
  const maxSearches = Math.min(config.max_searches ?? 3, MAX_SEARCHES_CAP);
  const language   = config.language ?? 'en';
  const modelKey   = config.model === 'thorough' ? 'thorough' : 'fast';
  const modelId    = BEDROCK_MODELS[modelKey];

  if (!focus) return '[deep_research] No focus configured — add a research focus in the step settings.';

  // Resolve topics
  const topics: string[] = config.queries?.length
    ? config.queries.map(q => q.trim()).filter(Boolean)
    : extractTopics(previousStepOutput, maxTopics);

  if (topics.length === 0) {
    return '[deep_research] No topics found. Either add explicit queries or connect a previous step that outputs a list of topics.';
  }

  // Build Bedrock client
  const client = createBedrockAdapter({
    awsRegion:    process.env.AWS_BEDROCK_REGION ?? 'eu-west-1',
    awsAccessKey: process.env.AWS_BEDROCK_ACCESS_KEY,
    awsSecretKey: process.env.AWS_BEDROCK_SECRET_KEY,
  });

  // Research all topics with bounded concurrency
  const results = await runWithConcurrency(
    topics,
    topic => researchOneTopic(topic, focus, language, modelId, maxSearches, client),
    TOPIC_CONCURRENCY,
  );

  return formatOutput(results, language);
}

// ─── Topic extraction ─────────────────────────────────────────────────────────
// Handles numbered lists, bullet lists, and bold headings — the common output
// shapes from an upstream AI filter step.

function extractTopics(text: string, max: number): string[] {
  if (!text?.trim()) return [];

  const topics: string[] = [];

  // 1. Numbered list: "1. Topic" or "1) Topic"
  const numberedRe = /^\s*\d+[.)]\s+(.+)/gm;
  let m: RegExpExecArray | null;
  while ((m = numberedRe.exec(text)) !== null) {
    const line = m[1].replace(/\*\*/g, '').trim();
    if (line.length > 5) topics.push(line);
  }
  if (topics.length >= 2) return topics.slice(0, max);

  // 2. Bullet list: "- Topic" or "• Topic" or "* Topic"
  const bulletRe = /^\s*[-•*]\s+(.+)/gm;
  while ((m = bulletRe.exec(text)) !== null) {
    const line = m[1].replace(/\*\*/g, '').trim();
    if (line.length > 5) topics.push(line);
  }
  if (topics.length >= 2) return topics.slice(0, max);

  // 3. Bold headings: "**Topic**"
  const boldRe = /\*\*([^*]{5,})\*\*/g;
  while ((m = boldRe.exec(text)) !== null) {
    topics.push(m[1].trim());
  }
  if (topics.length >= 1) return topics.slice(0, max);

  // 4. Fallback: non-empty lines over 20 chars
  return text
    .split('\n')
    .map(l => l.replace(/^#+\s*/, '').trim())
    .filter(l => l.length > 20 && !l.startsWith('#'))
    .slice(0, max);
}

// ─── Agentic research loop ────────────────────────────────────────────────────

async function researchOneTopic(
  topic: string,
  focus: string,
  language: string,
  modelId: string,
  maxSearches: number,
  client: ReturnType<typeof createBedrockAdapter>,
): Promise<ResearchResult> {
  const langInstruction = language !== 'en'
    ? `Write your final synthesis in ${getLanguageName(language)}.`
    : 'Write your final synthesis in English.';

  const systemPrompt =
    `You are a research assistant. Your task: research the topic below, focusing specifically on "${focus}". ` +
    `Use the web_search tool to find recent, relevant information. Be systematic: start with a broad query, then follow up with targeted searches based on what you find. ` +
    `After searching, write a concise synthesis of your findings (2–4 paragraphs) that directly addresses the focus area. ` +
    `Include specific facts, numbers, named actors, and dates where available. ` +
    `${langInstruction} ` +
    `Do not pad. If little relevant information exists, say so briefly.`;

  const tools = [{
    type: 'function' as const,
    function: {
      name: 'web_search',
      description: 'Search the web for recent information on a topic.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
  }];

  type Message = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; name?: string };
  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: `Research this topic: ${topic}` },
  ];

  const collectedSources: Array<{ title: string; url: string; outlet?: string }> = [];
  let searchCount = 0;

  // Agentic loop — run until model stops calling tools or cap reached
  while (searchCount < maxSearches) {
    const response = await (client as any).chat.completions.create({
      model: modelId,
      messages,
      tools,
      tool_choice: searchCount < maxSearches ? 'auto' : 'none',
      temperature: 0.2,
      max_tokens: 2000,
    });

    const choice = response.choices?.[0];
    if (!choice) break;

    const msg = choice.message;
    messages.push({ role: 'assistant', content: msg.content ?? '' });

    // No more tool calls → done
    if (!msg.tool_calls?.length) break;

    // Execute each tool call
    for (const tc of msg.tool_calls) {
      if (tc.function?.name !== 'web_search') continue;

      let args: { query?: string } = {};
      try { args = JSON.parse(tc.function.arguments ?? '{}'); } catch { /* ignore */ }

      const query = args.query?.trim();
      if (!query) continue;

      searchCount++;
      const searchResult = await tavilySearch(query);

      // Extract source URLs from the result text
      const urlMatches = searchResult.matchAll(/https?:\/\/[^\s)\]]+/g);
      for (const [url] of urlMatches) {
        if (!collectedSources.find(s => s.url === url)) {
          const titleMatch = searchResult.match(new RegExp(`\\*\\*([^*]+)\\*\\*[\\s\\S]{0,20}${escapeRegex(url.slice(0, 40))}`));
          collectedSources.push({ title: titleMatch?.[1]?.trim() ?? query, url });
        }
      }

      messages.push({
        role: 'tool',
        content: searchResult,
        tool_call_id: tc.id,
        name: 'web_search',
      });
    }
  }

  // Extract the final synthesis from the last assistant message
  const finalContent = [...messages]
    .reverse()
    .find(m => m.role === 'assistant' && m.content?.trim())
    ?.content ?? `No research results found for: ${topic}`;

  return { topic, summary: finalContent.trim(), sources: collectedSources };
}

// ─── Tavily search ────────────────────────────────────────────────────────────

async function tavilySearch(query: string): Promise<string> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return `[web_search] TAVILY_API_KEY not configured.`;

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, max_results: 5, search_depth: 'advanced' }),
    });

    if (!res.ok) return `[web_search error] ${res.status} ${res.statusText}`;

    const data = await res.json() as {
      results?: Array<{ title: string; url: string; content: string; score?: number }>;
    };

    if (!data.results?.length) return `No results for "${query}".`;

    return data.results
      .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.content?.slice(0, 500) ?? ''}`)
      .join('\n\n');
  } catch (e) {
    return `[web_search error] ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ─── Output formatter ─────────────────────────────────────────────────────────

function formatOutput(results: ResearchResult[], language: string): string {
  const separator = '---';
  const sections = results.map(r =>
    `## ${r.topic}\n\n${r.summary}`
  );

  const allSources = results.flatMap(r => r.sources);
  const uniqueSources = allSources.filter(
    (s, i, arr) => arr.findIndex(x => x.url === s.url) === i,
  );

  const sourceList = uniqueSources.length > 0
    ? `## ${language === 'de' ? 'Quellen' : 'Sources'}\n\n` +
      uniqueSources.map((s, i) => `${i + 1}. ${s.title} — ${s.url}`).join('\n')
    : '';

  return [...sections, separator, sourceList].filter(Boolean).join('\n\n');
}

// ─── Utilities ────────────────────────────────────────────────────────────────

async function runWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

function getLanguageName(code: string): string {
  const map: Record<string, string> = {
    de: 'German (Deutsch)',
    pt: 'Portuguese (Português)',
    fr: 'French (Français)',
    es: 'Spanish (Español)',
    it: 'Italian (Italiano)',
    nl: 'Dutch (Nederlands)',
  };
  return map[code] ?? code;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
