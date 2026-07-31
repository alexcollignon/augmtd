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

// ── Publication-date detection ────────────────────────────────────────────────
// A fetched page without a known publication date is a trust hazard downstream:
// briefing/synthesis steps have presented years-old articles as current news.
// Every result is therefore stamped with its detected date, or an explicit
// UNDATED warning; `max_age_days` lets a step drop stale pages entirely.

function toIsoDay(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (isNaN(dt.getTime()) || dt.getTime() > Date.now() + 86_400_000) return null;
  return dt.toISOString().slice(0, 10);
}

/** News CMS URLs commonly embed the publish date in the path (/2021/06/16/…). */
function dateFromUrl(url: string): string | null {
  const m = url.match(/\/(20\d{2})[/-](\d{1,2})(?:[/-](\d{1,2}))?(?=[/-]|$)/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const month = Number(mo);
  if (month < 1 || month > 12) return null;
  return toIsoDay(Number(y), month, d ? Number(d) : 1);
}

/** article:published_time / datePublished meta + JSON-LD, on the raw HTML. */
function dateFromHtml(html: string): string | null {
  const head = html.slice(0, 60_000);
  const patterns = [
    /<meta[^>]+(?:property|name)=["'](?:article:published_time|og:article:published_time|date|publish-date|publication_date|parsely-pub-date)["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:article:published_time|og:article:published_time|date|publish-date|publication_date|parsely-pub-date)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/,
    /<time[^>]+datetime=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = head.match(re);
    if (!m) continue;
    const d = new Date(m[1]);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

function ageDays(iso: string): number {
  return Math.floor((Date.now() - new Date(iso + 'T00:00:00Z').getTime()) / 86_400_000);
}

/** The header line stamped above every result — the downstream AI step reads this. */
function dateStamp(published: string | null): string {
  return published
    ? `Published: ${published}`
    : 'Publication date: UNKNOWN — treat this content as UNDATED; do NOT present it as current news.';
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
      max_age_days: {
        type: 'number',
        description: 'Optional freshness guard: pages whose detected publication date is older than this many days are dropped (replaced by a skip note). Pages with no detectable date are kept but flagged UNDATED.',
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

  const maxAgeDays = typeof config.max_age_days === 'number' && config.max_age_days > 0
    ? config.max_age_days : null;

  const render = (url: string, content: string, published: string | null): string => {
    if (published && maxAgeDays !== null && ageDays(published) > maxAgeDays) {
      return `## ${url}\n${dateStamp(published)}\n[skipped — published ${published}, older than the ${maxAgeDays}-day freshness window]`;
    }
    return `## ${url}\n${dateStamp(published)}\n\n${content}`;
  };

  const key = process.env.TAVILY_API_KEY;

  // Try Tavily /extract first — handles JS-rendered pages, returns clean markdown.
  // Tavily returns no HTML, so date detection here is URL-pattern only.
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
            render(r.url, (r.raw_content ?? '(empty)').slice(0, MAX_CONTENT_CHARS), dateFromUrl(r.url))
          ).join('\n\n---\n\n');
        }
      }
    } catch { /* fall through */ }
  }

  // Fallback: direct fetch + HTML strip (HTML available → meta-tag date detection too)
  const results = await Promise.allSettled(
    urls.map(async url => {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(10000),
      });
      const html = await res.text();
      const content = stripHtml(html).slice(0, MAX_CONTENT_CHARS);
      return render(url, content, dateFromUrl(url) ?? dateFromHtml(html));
    })
  );

  return results.map((r, i) =>
    r.status === 'fulfilled' ? r.value : `## ${urls[i]}\n[fetch failed]`
  ).join('\n\n---\n\n');
}
