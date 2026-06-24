// Load a user's triage rules from the DB. Falls back to the code defaults when the user has none
// yet (never opened the Email tab / table absent) — so the AI rules the UI shows ALWAYS evaluate
// via AI, whether default, edited, or added. Heuristics are only a fallback, never a substitute.

import type { InboxRule } from './types';
import { DEFAULT_RULES, defaultRulesForProvider } from './defaults';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = any;

// All of a user's rules across inboxes — for the render-time classifier cache.
export async function loadUserRules(userId: string, client: DBClient): Promise<InboxRule[]> {
  try {
    const { data } = await client.from('inbox_rules')
      .select('*').eq('user_id', userId).order('priority', { ascending: true });
    return (data && data.length ? data : DEFAULT_RULES) as InboxRule[];
  } catch {
    return DEFAULT_RULES;
  }
}

// One inbox's rules (DB), falling back to that provider's defaults — used at process time so the
// sync evaluates the connection's own rules.
export async function loadInboxRules(connectionId: string, provider: string, client: DBClient): Promise<InboxRule[]> {
  try {
    const { data } = await client.from('inbox_rules')
      .select('*').eq('connection_id', connectionId).order('priority', { ascending: true });
    return (data && data.length ? data : defaultRulesForProvider(provider)) as InboxRule[];
  } catch {
    return defaultRulesForProvider(provider);
  }
}

// Every enabled AI-match rule (default + edited + added) — they're presented as AI, so they run as AI.
export function activeAiRules(rules: InboxRule[]): InboxRule[] {
  return rules.filter(r => r.enabled && r.ai_match);
}
