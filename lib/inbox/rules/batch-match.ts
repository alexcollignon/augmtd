// AI-match rule evaluation — ONE batched AI call for a set of emails (mirrors batchClassifyEmails,
// no per-email cost). Given the ordered AI-match rules, assign each email the label of the FIRST
// rule whose description matches. Used at process time (sync) for the user's CUSTOM AI rules.

import { getAIClient } from '@/lib/ai/factory';
import { parseModelJSON } from '@/lib/ai/parse-json';
import { evaluateDeterministic } from './evaluate';
import type { EmailEnvelope } from '@/lib/ai/email-classifier-batch';
import type { InboxRule, RuleEmail, RuleLabel } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = any;

const SYSTEM = `You match emails against an ordered list of user rules. Each rule has a "label" and a natural-language "description". For each email, return the label of the FIRST rule (in order) whose description fits the email. If no rule fits, return "none". Respond ONLY with JSON: {"results":[{"id":"...","label":"..."}]}. Include every id. No explanations.`;

// Pass the FULL rule set (deterministic + AI). The deterministic rules (no-reply/automated senders,
// etc.) pre-filter: mail they already settle never reaches the AI — so the AI only adjudicates the
// genuinely ambiguous mail, which keeps it cheap and stops it over-labeling automated senders.
export async function batchMatchRules(
  envelopes: EmailEnvelope[],
  rules: InboxRule[],
  userId: string,
  client: DBClient,
): Promise<Map<string, RuleLabel>> {
  const result = new Map<string, RuleLabel>();
  const aiRules = rules.filter(r => r.enabled && r.ai_match).sort((a, b) => a.priority - b.priority);
  if (!envelopes.length || !aiRules.length) return result;

  // Deterministic-first: drop any envelope a deterministic rule already classifies (matched on the
  // envelope's own from/subject/body — labels resolve at render where they're available).
  const unmatched = envelopes.filter(e => {
    const email: RuleEmail = {
      direction: 'received',
      from: (e.from || '').toLowerCase(),
      to: [], cc: [],
      subject: e.subject || '',
      body: e.body_preview || e.snippet || '',
      labels: [],
    };
    return !evaluateDeterministic(email, rules);
  });
  if (!unmatched.length) return result;

  try {
    const { client: ai, model } = await getAIClient(userId, 'classification', client);
    const valid = new Set(aiRules.map(r => r.outcome.set_type));
    const rulesPayload = aiRules.map(r => ({ label: r.outcome.set_type, description: r.ai_match }));

    // Chunk so the response can't be truncated — a single call over 100+ emails overflows the token
    // cap and returns invalid JSON (→ zero matches). 30 per chunk, run in parallel.
    const CHUNK = 30;
    const chunks: EmailEnvelope[][] = [];
    for (let i = 0; i < unmatched.length; i += CHUNK) chunks.push(unmatched.slice(i, i + CHUNK));

    const maps = await Promise.all(chunks.map(async (chunk) => {
      const m = new Map<string, RuleLabel>();
      try {
        const userContent = JSON.stringify({
          rules: rulesPayload,
          emails: chunk.map(e => ({ id: e.id, from: e.from, subject: e.subject, snippet: (e.body_preview || e.snippet || '').slice(0, 400) })),
        });
        const res = await ai.chat.completions.create({
          model, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userContent }],
          max_tokens: Math.min(4096, Math.max(512, chunk.length * 45)), temperature: 0,
        });
        const parsed = parseModelJSON<{ results: Array<{ id: string; label: string }> }>(res.choices[0]?.message?.content || '', { results: [] });
        for (const item of parsed.results) {
          if (item.label && item.label !== 'none' && valid.has(item.label as RuleLabel)) m.set(item.id, item.label as RuleLabel);
        }
      } catch { /* this chunk fails → its emails fall back to heuristics */ }
      return m;
    }));
    for (const m of maps) for (const [id, label] of m) result.set(id, label);
  } catch {
    /* no matches on failure — heuristics still classify */
  }
  return result;
}
