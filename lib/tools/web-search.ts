// ─── Web search tool (Tavily) ─────────────────────────────────────────────────

export const webSearchDefinition = {
  name: 'web_search',
  description: 'Search the web for current information, news, or research on any topic. Use when the user asks about recent events, external data, or anything not in the knowledge base.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Search query' },
      max_results: { type: 'number', description: 'Number of results to return (default 6, max 10)' },
    },
    required: ['query'],
  },
};

export async function executeWebSearch(config: Record<string, unknown>): Promise<string> {
  const query = typeof config.query === 'string' ? config.query.trim() : '';
  if (!query) return '[web_search] No query provided.';

  const key = process.env.TAVILY_API_KEY;
  if (!key) return `[web_search] Not configured — add TAVILY_API_KEY to enable web search.`;

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        query,
        max_results: Math.min(typeof config.max_results === 'number' ? config.max_results : 6, 10),
        search_depth: 'basic',
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return `[web_search error] ${res.status} ${res.statusText}: ${body.slice(0, 200)}`;
    }
    const data = await res.json() as { results?: Array<{ title: string; url: string; content: string; published_date?: string }> };
    if (!data.results?.length) return `No results found for "${query}".`;
    return data.results.map((r, i) =>
      `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.published_date ? `Published: ${r.published_date}` : 'Published: unknown — do not assume this is current'}\n   ${r.content?.slice(0, 400) ?? ''}`
    ).join('\n\n');
  } catch (e) {
    return `[web_search error] ${e instanceof Error ? e.message : String(e)}`;
  }
}
