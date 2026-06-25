// AI-match rule evaluation — ONE batched AI call for a set of emails (mirrors batchClassifyEmails,
// no per-email cost). Given the ordered AI-match rules, assign each email the label of the FIRST
// rule whose description matches. Used at process time (sync) for the user's CUSTOM AI rules.

import { getAIClient, aiCreate } from '@/lib/ai/factory';
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

    // One chunk → one AI call. Returns the matches AND the set of ids the model actually listed —
    // so an OMITTED id (model skipped/truncated it) is distinguishable from a returned "none".
    const runChunk = async (chunk: EmailEnvelope[]): Promise<{ m: Map<string, RuleLabel>; returned: Set<string> }> => {
      const m = new Map<string, RuleLabel>();
      const returned = new Set<string>();
      try {
        const userContent = JSON.stringify({
          rules: rulesPayload,
          emails: chunk.map(e => ({ id: e.id, from: e.from, subject: e.subject, snippet: (e.body_preview || e.snippet || '').slice(0, 400) })),
        });
        const res = await aiCreate(ai, {
          model, messages: [{ role: 'system', content: `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.\n${SYSTEM}` }, { role: 'user', content: userContent }],
          // The model emits pretty-printed JSON (~60 tokens/email). Budget generously — under-budgeting
          // truncates the response mid-list and silently drops the tail's ids (→ null → misclassified).
          max_tokens: Math.min(8192, Math.max(1024, chunk.length * 90)), temperature: 0,
        });
        const parsed = parseModelJSON<{ results: Array<{ id: string; label: string }> }>(res.choices[0]?.message?.content || '', { results: [] });
        for (const item of parsed.results) {
          returned.add(item.id);
          if (item.label && item.label !== 'none' && valid.has(item.label as RuleLabel)) m.set(item.id, item.label as RuleLabel);
        }
      } catch { /* this chunk fails → its emails fall back to heuristics */ }
      return { m, returned };
    };

    // Smaller chunks (20) keep each response well under the cap, run in parallel.
    const CHUNK = 20;
    const chunks: EmailEnvelope[][] = [];
    for (let i = 0; i < unmatched.length; i += CHUNK) chunks.push(unmatched.slice(i, i + CHUNK));
    const parts = await Promise.all(chunks.map(runChunk));
    const returnedAll = new Set<string>();
    for (const p of parts) { for (const [id, label] of p.m) result.set(id, label); for (const id of p.returned) returnedAll.add(id); }

    // Fill-missing safety net: any email the model OMITTED (not a genuine "none") gets one focused
    // retry in small chunks, where the model reliably lists every id. Guarantees full coverage.
    const missing = unmatched.filter(e => !returnedAll.has(e.id));
    if (missing.length) {
      const rchunks: EmailEnvelope[][] = [];
      for (let i = 0; i < missing.length; i += 10) rchunks.push(missing.slice(i, i + 10));
      const rparts = await Promise.all(rchunks.map(runChunk));
      for (const p of rparts) for (const [id, label] of p.m) result.set(id, label);
    }
  } catch {
    /* no matches on failure — heuristics still classify */
  }
  return result;
}
