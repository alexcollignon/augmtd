// ─── Fetch URL tool (Tavily extract + direct fallback) ────────────────────────

const PRIVATE_IP_RE = /^https?:\/\/(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/i;
const MAX_URLS = 5;
const MAX_CONTENT_CHARS = 4000;

function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !PRIVATE_IP_RE.test(url);
  } catch {
    return false;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const fetchUrlDefinition = {
  name: 'fetch_url',
  description: 'Fetch and read the content of one or more specific web pages. Use when the user provides a URL or asks you to read a specific page.',
  input_schema: {
    type: 'object' as const,
    properties: {
      urls: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of URLs to fetch and read (max 5)',
      },
    },
    required: ['urls'],
  },
};

export async function executeFetchUrl(config: Record<string, unknown>): Promise<string> {
  const raw = config.urls;
  const urls: string[] = (
    Array.isArray(raw) ? raw.filter(u => typeof u === 'string') :
    typeof raw === 'string' ? raw.split('\n').map(s => s.trim()).filter(Boolean) :
    []
  ).filter(isValidUrl).slice(0, MAX_URLS);

  if (urls.length === 0) return '[fetch_url] No valid URLs provided. URLs must be https:// and not point to private networks.';

  const key = process.env.TAVILY_API_KEY;

  // Try Tavily /extract first — handles JS-rendered pages, returns clean markdown
  if (key) {
    try {
      const res = await fetch('https://api.tavily.com/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({ urls }),
      });
      if (res.ok) {
        const data = await res.json() as { results?: Array<{ url: string; raw_content: string }> };
        if (data.results?.length) {
          return data.results.map(r =>
            `## ${r.url}\n\n${(r.raw_content ?? '(empty)').slice(0, MAX_CONTENT_CHARS)}`
          ).join('\n\n---\n\n');
        }
      }
    } catch { /* fall through */ }
  }

  // Fallback: direct fetch + HTML strip
  const results = await Promise.allSettled(
    urls.map(async url => {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(10000),
      });
      const html = await res.text();
      const content = stripHtml(html).slice(0, MAX_CONTENT_CHARS);
      return `## ${url}\n\n${content}`;
    })
  );

  return results.map((r, i) =>
    r.status === 'fulfilled' ? r.value : `## ${urls[i]}\n[fetch failed]`
  ).join('\n\n---\n\n');
}
