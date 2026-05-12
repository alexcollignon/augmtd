// ─── Shared tool registry ─────────────────────────────────────────────────────
// All external-data tools live here and are consumed by both the chat route
// and the Studio step executor. Add new tools in this file to make them
// available in both surfaces automatically.

export { webSearchDefinition, executeWebSearch } from './web-search';
export { fetchUrlDefinition, executeFetchUrl } from './fetch-url';
export { rssFeedDefinition, executeRssFeed } from './rss-feed';
export { executeLinkedInPost } from './linkedin-post';
export type { LinkedInPostConfig } from './linkedin-post';
export { executeBrowserFetch } from './browser-fetch';

// OpenAI function-calling format converter — used by chat route
export function toOpenAITool(def: {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}) {
  return {
    type: 'function' as const,
    function: {
      name: def.name,
      description: def.description,
      parameters: def.input_schema,
    },
  };
}
