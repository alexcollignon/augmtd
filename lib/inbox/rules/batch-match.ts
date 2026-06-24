// AI-match rule evaluation — ONE batched AI call for a set of emails (mirrors batchClassifyEmails,
// no per-email cost). Given the ordered AI-match rules, assign each email the label of the FIRST
// rule whose description matches. Used at process time (sync) for the user's CUSTOM AI rules.

import { getAIClient } from '@/lib/ai/factory';
import { parseModelJSON } from '@/lib/ai/parse-json';
import type { EmailEnvelope } from '@/lib/ai/email-classifier-batch';
import type { InboxRule, RuleLabel } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = any;

const SYSTEM = `You match emails against an ordered list of user rules. Each rule has a "label" and a natural-language "description". For each email, return the label of the FIRST rule (in order) whose description fits the email. If no rule fits, return "none". Respond ONLY with JSON: {"results":[{"id":"...","label":"..."}]}. Include every id. No explanations.`;

export async function batchMatchRules(
  envelopes: EmailEnvelope[],
  aiRules: InboxRule[],
  userId: string,
  client: DBClient,
): Promise<Map<string, RuleLabel>> {
  const result = new Map<string, RuleLabel>();
  const rules = aiRules.filter(r => r.enabled && r.ai_match).sort((a, b) => a.priority - b.priority);
  if (!envelopes.length || !rules.length) return result;

  try {
    const { client: ai, model } = await getAIClient(userId, 'classification', client);
    const userContent = JSON.stringify({
      rules: rules.map(r => ({ label: r.outcome.set_type, description: r.ai_match })),
      emails: envelopes.map(e => ({ id: e.id, from: e.from, subject: e.subject, snippet: (e.body_preview || e.snippet || '').slice(0, 400) })),
    });
    const maxTokens = Math.min(4096, Math.max(512, envelopes.length * 40));
    const res = await ai.chat.completions.create({
      model, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userContent }],
      max_tokens: maxTokens, temperature: 0,
    });
    const parsed = parseModelJSON<{ results: Array<{ id: string; label: string }> }>(res.choices[0]?.message?.content || '', { results: [] });
    const valid = new Set(rules.map(r => r.outcome.set_type));
    for (const item of parsed.results) {
      if (item.label && item.label !== 'none' && valid.has(item.label as RuleLabel)) {
        result.set(item.id, item.label as RuleLabel);
      }
    }
  } catch {
    /* no matches on failure — heuristics still classify */
  }
  return result;
}
