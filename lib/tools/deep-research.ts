// ─── Deep Research tool ───────────────────────────────────────────────────────
// Agentic research loop: given a list of topics (parsed from previous step
// output or supplied explicitly), runs Bedrock Claude + Tavily web search in
// multi-turn conversation to produce cited, substantive research per topic.
//
// Always uses Bedrock EU (Claude Haiku 4.5 / Sonnet 4.6) regardless of the
// user's tier — data isolation is the point.

import { createBedrockAdapter } from '@/lib/ai/bedrock-adapter';
import { aiCreate } from '@/lib/ai/factory';
import { logAIUsage } from '@/lib/ai/log-usage';
import { clipForPrompt, EXCERPT_MARK, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';

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

  // Tavily search depth. 'basic' (default, 1 credit) is enough for news/topic lookups;
  // 'advanced' (2 credits) only where a topic genuinely needs deeper page extraction.
  search_depth?: 'basic' | 'advanced';
}

export const deepResearchDefinition = {
  name: 'deep_research',
  description: "Run a thorough multi-step web research on a topic. Slower (30–60s) but comprehensive — uses multiple searches and synthesises cited findings. Use this whenever the user asks about current events, facts, companies, people, or anything that benefits from up-to-date web information.",
  input_schema: {
    type: 'object' as const,
    properties: {
      focus: { type: 'string', description: 'The research question or topic to investigate thoroughly.' },
      language: { type: 'string', description: 'Output language as BCP-47 code (e.g. en, de, pt). Default: en.' },
    },
    required: ['focus'],
  },
};

interface ResearchResult {
  topic: string;
  summary: string;
  sources: Array<{ title: string; url: string; outlet?: string }>;
  // Failure honesty accounting — a degraded run must be visible downstream, never dressed
  // up as research (Tavily 432 quota exhaustion, Aug 31 / Sep 15).
  searchesAttempted?: number;
  searchesFailed?: number;
  firstError?: string | null;
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
  ctx?: { userId?: string; supabase?: any },
): Promise<string> {
  const focus      = config.focus?.trim();
  const maxTopics  = Math.max(1, config.max_topics ?? 6);
  const maxSearches = Math.min(config.max_searches ?? 3, MAX_SEARCHES_CAP);
  const language   = config.language ?? 'en';
  const modelKey   = config.model === 'thorough' ? 'thorough' : 'fast';
  const modelId    = BEDROCK_MODELS[modelKey];
  const searchDepth = config.search_depth === 'advanced' ? 'advanced' : 'basic';

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

  // Telemetry — non-fatal, fire-and-forget. This tool always runs Bedrock EU regardless of the
  // user's billing tier, so `tier` is deliberately omitted rather than claimed.
  const onUsage = (usage: { prompt_tokens?: number; completion_tokens?: number } | null | undefined) => {
    if (!ctx?.userId || !ctx?.supabase) return;
    void logAIUsage(ctx.supabase, {
      userId: ctx.userId,
      source: 'deep_research',
      provider: 'bedrock',
      model: modelId,
      usage,
    }).catch(() => { /* telemetry never affects the run */ });
  };

  // Research all topics with bounded concurrency. A topic that throws degrades to an honest
  // line — one bad topic must never take the whole step down.
  const results = await runWithConcurrency(
    topics,
    async (topic): Promise<ResearchResult> => {
      try {
        return await researchOneTopic(topic, focus, language, modelId, maxSearches, client, searchDepth, onUsage);
      } catch (e) {
        const reason = clip(e instanceof Error ? e.message : String(e), 160);
        return { topic, summary: `[research unavailable for this topic: ${reason}]`, sources: [] };
      }
    },
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
  searchDepth: 'basic' | 'advanced' = 'basic',
  onUsage?: (usage: { prompt_tokens?: number; completion_tokens?: number } | null | undefined) => void,
): Promise<ResearchResult> {
  const langInstruction = language !== 'en'
    ? `Write your final synthesis in ${getLanguageName(language)}.`
    : 'Write your final synthesis in English.';

  const systemPrompt =
    `You are a research assistant. Today is ${new Date().toISOString().slice(0, 10)} (UTC). ` +
    `Your task: research the topic below, focusing specifically on "${focus}". ` +
    `Use the web_search tool to find recent, relevant information. Be systematic: start with a broad query, then follow up with targeted searches based on what you find. ` +
    `After searching, write a concise synthesis of your findings (2–4 paragraphs) that directly addresses the focus area. ` +
    `Include specific facts, numbers, named actors, and dates where available. ` +
    `DATE DISCIPLINE: search results carry a "Published:" line — anchor every fact to it. Treat results published long before today, or with an unknown date, as historical/unverified: never present them as current developments, and never shift their dates or years toward the present. ` +
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

  type ToolCall = { id: string; type?: string; function?: { name?: string; arguments?: string } };
  type Message = {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_call_id?: string;
    name?: string;
    // THE PROTOCOL: an assistant turn that requested tools must carry those tool_calls when it
    // is pushed back, or the role:'tool' messages below reference ids nothing declared. The
    // bedrock adapter already translates this shape (tool_calls → tool_use blocks).
    tool_calls?: ToolCall[];
  };
  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: `Research this topic: ${topic}` },
  ];

  const collectedSources: Array<{ title: string; url: string; outlet?: string }> = [];
  const queriesRun = new Set<string>();
  let searchCount = 0;
  let searchesFailed = 0;
  let firstError: string | null = null;
  let sawToolResult = false;
  // THE SYNTHESIS LAW: content produced AFTER the last tool result is the synthesis. A
  // round-1 preamble ("I'll search for…") is never it.
  let synthesisAfterResults = false;

  // Agentic loop — bounded by ROUNDS, not by the search counter. Parallel tool calls used to
  // push searchCount past the cap and exit before the model ever read a result.
  const MAX_ROUNDS = 4;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const remaining = Math.max(0, maxSearches - searchCount);

    const response = await aiCreate(client as any, {
      model: modelId,
      messages: messages as any,
      tools,
      // Budget exhausted → the model MUST synthesise from what it has.
      tool_choice: remaining > 0 ? 'auto' : 'none',
      temperature: 0.2,
      max_tokens: 2000,
    } as any);

    onUsage?.((response as any)?.usage);

    const choice = (response as any).choices?.[0];
    if (!choice) break;

    const msg = choice.message as { content?: string | null; tool_calls?: ToolCall[] };
    const content = (msg.content ?? '').trim();
    messages.push({
      role: 'assistant',
      content: msg.content ?? '',
      ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}),
    });

    if (content && sawToolResult) synthesisAfterResults = true;

    // No tool calls → this content IS the synthesis.
    if (!msg.tool_calls?.length) break;

    // EVERY declared tool_call_id must receive a tool message — executed, deduped, or refused.
    let executedThisRound = 0;
    for (const tc of msg.tool_calls) {
      let toolContent: string;

      if (tc.function?.name !== 'web_search') {
        toolContent = `Unsupported tool "${tc.function?.name ?? 'unknown'}" — only web_search is available.`;
      } else {
        let args: { query?: string } = {};
        try { args = JSON.parse(tc.function.arguments ?? '{}'); } catch { /* ignore */ }
        const query = args.query?.trim();

        if (!query) {
          toolContent = 'No query supplied — restate the query or synthesise from the results you already have.';
        } else if (queriesRun.has(query.toLowerCase())) {
          toolContent = 'Duplicate query skipped — reuse the earlier result.';
        } else if (executedThisRound >= remaining) {
          toolContent = 'Search budget exhausted — synthesise from the results you already have.';
        } else {
          executedThisRound++;
          searchCount++;
          queriesRun.add(query.toLowerCase());
          toolContent = await tavilySearch(query, searchDepth);

          if (toolContent.startsWith('[web_search error]') || toolContent.startsWith('[web_search]')) {
            searchesFailed++;
            if (!firstError) firstError = toolContent;
          } else {
            // Extract source URLs from the result text
            const urlMatches = toolContent.matchAll(/https?:\/\/[^\s)\]]+/g);
            for (const [url] of urlMatches) {
              if (!collectedSources.find(s => s.url === url)) {
                const titleMatch = toolContent.match(new RegExp(`\\*\\*([^*]+)\\*\\*[\\s\\S]{0,20}${escapeRegex(url.slice(0, 40))}`));
                collectedSources.push({ title: titleMatch?.[1]?.trim() ?? query, url });
              }
            }
          }
        }
      }

      messages.push({ role: 'tool', content: toolContent, tool_call_id: tc.id, name: 'web_search' });
      sawToolResult = true;
    }
  }

  const accounting = { searchesAttempted: searchCount, searchesFailed, firstError };

  // FAILURE HONESTY — every search failed: say so, never let model prose stand in for research.
  if (searchCount > 0 && searchesFailed === searchCount) {
    return {
      topic,
      summary: `[research degraded: ${searchesFailed}/${searchCount} searches failed — ${clip(firstError ?? 'unknown error', 120)}]`,
      sources: collectedSources,
      ...accounting,
    };
  }

  // A pre-search preamble is NOT a synthesis.
  if (searchCount > 0 && !synthesisAfterResults) {
    return {
      topic,
      summary: '[research degraded: searches ran but the model produced no synthesis of the results]',
      sources: collectedSources,
      ...accounting,
    };
  }

  const finalContent = [...messages]
    .reverse()
    .find(m => m.role === 'assistant' && m.content?.trim())
    ?.content ?? `No research results found for: ${topic}`;

  return { topic, summary: finalContent.trim(), sources: collectedSources, ...accounting };
}

// ─── Tavily search ────────────────────────────────────────────────────────────

async function tavilySearch(query: string, searchDepth: 'basic' | 'advanced' = 'basic'): Promise<string> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return `[web_search] TAVILY_API_KEY not configured.`;

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, max_results: 5, search_depth: searchDepth }),
    });

    if (!res.ok) return `[web_search error] ${res.status} ${res.statusText}`;

    const data = await res.json() as {
      results?: Array<{ title: string; url: string; content: string; score?: number; published_date?: string }>;
    };

    if (!data.results?.length) return `No results for "${query}".`;

    // EXCERPT HONESTY (invariant 13): a raw `.slice()` on the fetched page content is exactly the
    // failure the law names — the synthesis step reads a mid-sentence cut as the SOURCE being
    // truncated. `clipForPrompt` ends at a boundary and declares itself; the rule rides once at
    // the end of this tool result (it stands alone, so the rule can't depend on a caller).
    const clippedResults = data.results
      .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.published_date ? `Published: ${r.published_date}` : 'Published: unknown — do not assume this is current'}\n   ${r.content ? clipForPrompt(r.content, 500) : ''}`);
    const body = clippedResults.join('\n\n');
    return body.includes(EXCERPT_MARK) ? `${body}\n\n${EXCERPT_RULE}` : body;
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

  // FAILURE HONESTY — one trailing note when any search failed, so downstream prompts (and the
  // reader) can see that this run was degraded rather than thin.
  const attempted = results.reduce((n, r) => n + (r.searchesAttempted ?? 0), 0);
  const failed    = results.reduce((n, r) => n + (r.searchesFailed ?? 0), 0);
  const firstErr  = results.find(r => r.firstError)?.firstError ?? '';
  const note = failed > 0
    ? `_Note: research was degraded this run — ${failed} of ${attempted} searches failed (${clip(firstErr, 120)})._`
    : '';

  return [...sections, separator, sourceList, note].filter(Boolean).join('\n\n');
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

function clip(s: string, max: number): string {
  const t = (s ?? '').trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
