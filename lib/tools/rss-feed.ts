// ─── RSS / Atom feed reader ───────────────────────────────────────────────────

import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
});

const PRIVATE_IP_RE = /^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i;
const MAX_FEEDS = 10;
const MAX_ITEMS = 30;
const SUMMARY_CHARS = 250;

function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !PRIVATE_IP_RE.test(url);
  } catch {
    return false;
  }
}

function coerceText(val: unknown): string {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object' && '#text' in val) return String((val as Record<string, unknown>)['#text']);
  return '';
}

function parseDate(item: Record<string, unknown>): Date | null {
  const raw = coerceText(item.pubDate) || coerceText(item['dc:date']) ||
    coerceText(item.published) || coerceText(item.updated);
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

/** Item categories — RSS 2.0 `<category>` (string | {#text} | array) and Atom `<category term="…">`. */
function parseCategories(item: Record<string, unknown>): string[] {
  const raw = item.category;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list
    .map(c => {
      if (typeof c === 'string') return c;
      if (c && typeof c === 'object') {
        const o = c as Record<string, unknown>;
        return coerceText(c) || (typeof o['@_term'] === 'string' ? o['@_term'] : '');
      }
      return '';
    })
    .map(s => s.trim())
    .filter(Boolean);
}

function cutoffDate(since: string, lastRunAt?: string | null): Date {
  if (since === 'last_run' && lastRunAt) {
    const d = new Date(lastRunAt);
    if (!isNaN(d.getTime())) return d;
  }
  if (since === '7d' || since === 'last_run') return new Date(Date.now() - 7 * 86_400_000);
  return new Date(Date.now() - 86_400_000); // 24h default
}

function parseItems(xml: Record<string, unknown>): { items: Record<string, unknown>[]; title: string } {
  // RSS 2.0
  const rss = xml?.rss as Record<string, unknown> | undefined;
  const channel = (rss?.channel ?? xml?.feed ?? (xml?.['rdf:RDF'] as Record<string, unknown>)?.channel) as Record<string, unknown> | undefined;
  if (!channel) return { items: [], title: '' };

  const rawItems = channel.item ?? channel.entry ?? (xml?.['rdf:RDF'] as Record<string, unknown>)?.item;
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
  const title = coerceText(channel.title) || '';
  return { items: items as Record<string, unknown>[], title };
}

export const rssFeedDefinition = {
  name: 'rss_feed',
  description: 'Read RSS/Atom feeds and return new items published since the last run or a time window. Use for news monitoring, blog tracking, and scheduled briefings.',
  input_schema: {
    type: 'object' as const,
    properties: {
      feeds: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of RSS or Atom feed URLs to read',
      },
      since: {
        type: 'string',
        enum: ['last_run', '24h', '7d'],
        description: 'How far back to look. "last_run" uses the previous workflow execution time (falls back to 24h if no prior run). Default: 24h.',
      },
      max_items: {
        type: 'number',
        description: `Maximum total items to return across all feeds (default ${MAX_ITEMS})`,
      },
      category_filter: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: keep only items whose feed categories match one of these (case-insensitive). Useful to scope a general/site-wide feed to a topic (e.g. ["Economia", "Empresas"]) when the outlet has no topic-specific feed. Items without category tags are excluded when set.',
      },
    },
    required: ['feeds'],
  },
};

export async function executeRssFeed(
  config: Record<string, unknown>,
  lastRunAt?: string | null,
): Promise<string> {
  const rawFeeds = config.feeds;
  const feeds: string[] = (
    Array.isArray(rawFeeds) ? rawFeeds.filter(f => typeof f === 'string') :
    typeof rawFeeds === 'string' ? rawFeeds.split('\n').map(s => s.trim()).filter(Boolean) :
    []
  ).filter(isValidUrl).slice(0, MAX_FEEDS);

  if (feeds.length === 0) return '[rss_feed] No valid feed URLs provided.';

  const since = typeof config.since === 'string' ? config.since : '24h';
  const cutoff = cutoffDate(since, lastRunAt);
  const maxItems = Math.min(
    typeof config.max_items === 'number' ? config.max_items : MAX_ITEMS,
    MAX_ITEMS,
  );
  const categoryFilter = (Array.isArray(config.category_filter)
    ? config.category_filter.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    : []).map(c => c.trim().toLowerCase());

  type FeedItem = { title: string; link: string; date: Date | null; source: string; summary: string };
  const allItems: FeedItem[] = [];
  let filteredOut = 0;      // in-window items dropped by the category filter
  let uncategorized = 0;    // in-window items with NO category tags (dropped when a filter is set)

  await Promise.allSettled(
    feeds.map(async feedUrl => {
      try {
        const res = await fetch(feedUrl, {
          signal: AbortSignal.timeout(8000),
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        const text = await res.text();
        const xml = parser.parse(text) as Record<string, unknown>;
        const { items, title: sourceName } = parseItems(xml);

        for (const item of items) {
          const date = parseDate(item);
          // Skip items older than cutoff (null date = include, we can't tell age)
          if (date && date < cutoff) continue;

          if (categoryFilter.length > 0) {
            const cats = parseCategories(item).map(c => c.toLowerCase());
            if (cats.length === 0) { uncategorized++; continue; }
            if (!categoryFilter.some(f => cats.some(c => c === f || c.includes(f)))) { filteredOut++; continue; }
          }

          const title = coerceText(item.title) || '(no title)';
          const link = coerceText(item.link) ||
            (item.link && typeof item.link === 'object' ? coerceText((item.link as Record<string, unknown>)['@_href']) : '') ||
            '';
          const descRaw = coerceText(item.description) || coerceText(item.summary) || coerceText(item.content) || '';
          const summary = descRaw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SUMMARY_CHARS);

          allItems.push({
            title: title.trim(),
            link: link.trim(),
            date,
            source: sourceName || feedUrl,
            summary,
          });
        }
      } catch { /* skip unreachable feeds */ }
    })
  );

  // Honest filter accounting — a feed with no category tags must not read as "no news".
  const filterNote = categoryFilter.length > 0
    ? ` [category filter: ${categoryFilter.join(', ')} — ${filteredOut} off-topic dropped${uncategorized > 0 ? `, ${uncategorized} untagged dropped` : ''}]`
    : '';

  if (allItems.length === 0) {
    if (categoryFilter.length > 0 && uncategorized > 0 && filteredOut === 0) {
      return `No items matched the category filter, but ${uncategorized} in-window item${uncategorized !== 1 ? 's' : ''} carried NO category tags — this feed may not support categories; consider removing category_filter for it.`;
    }
    return `No new items found since ${cutoff.toLocaleDateString()} across ${feeds.length} feed${feeds.length !== 1 ? 's' : ''}.${filterNote}`;
  }

  // Sort newest first, cap
  allItems.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
  const limited = allItems.slice(0, maxItems);

  const header = `${limited.length} item${limited.length !== 1 ? 's' : ''} from ${feeds.length} feed${feeds.length !== 1 ? 's' : ''} (since ${cutoff.toLocaleDateString()})${filterNote}:\n\n`;

  return header + limited.map((item, i) => {
    const dateStr = item.date ? item.date.toLocaleDateString() : 'unknown date';
    return `${i + 1}. **${item.title}**\n   ${item.source} · ${dateStr}\n   ${item.link}\n   ${item.summary}`;
  }).join('\n\n');
}
