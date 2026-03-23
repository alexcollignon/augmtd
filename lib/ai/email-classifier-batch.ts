/**
 * Batch email classifier — single AI call to pre-filter a batch of emails.
 *
 * Returns a map of emailId → 'process' | 'fyi_only' | 'noise' for each envelope.
 * Falls back to classifying all as 'process' if the AI call fails.
 */

import { getAIClient } from '@/lib/ai/factory';
import { parseModelJSON } from '@/lib/ai/parse-json';
import { SupabaseClient } from '@supabase/supabase-js';

export type EmailClass = 'process' | 'fyi_only' | 'noise';

export interface EmailEnvelope {
  id: string;
  from: string;
  subject: string;
  snippet: string;
}

const SYSTEM_PROMPT = `You are an email classifier. Given a batch of email envelopes (from, subject, snippet), classify each one:
- "process": requires the user's attention, action, decision, or a prepared reply
- "fyi_only": informational only — updates, newsletters, confirmations the user may want to see but need not act on
- "noise": automated notifications, marketing, spam, system alerts the user doesn't need to see

Respond with a JSON object: { "results": [ { "id": "...", "class": "process"|"fyi_only"|"noise" } ] }`;

export async function batchClassifyEmails(
  envelopes: EmailEnvelope[],
  userId: string,
  adminSupabase: SupabaseClient,
): Promise<Map<string, EmailClass>> {
  // Default: treat all as process
  const fallback = new Map<string, EmailClass>(envelopes.map(e => [e.id, 'process']));

  if (envelopes.length === 0) return fallback;

  try {
    const { client: ai, model } = await getAIClient(userId, 'classification', adminSupabase);

    const userContent = JSON.stringify(
      envelopes.map(e => ({
        id: e.id,
        from: e.from,
        subject: e.subject,
        snippet: e.snippet?.slice(0, 200),
      })),
    );

    const response = await ai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      max_tokens: 512,
    });

    const text = response.choices[0]?.message?.content || '';
    const parsed = parseModelJSON<{ results: Array<{ id: string; class: string }> }>(text, { results: [] });

    const result = new Map<string, EmailClass>();
    for (const item of parsed.results) {
      const cls = item.class as EmailClass;
      if (['process', 'fyi_only', 'noise'].includes(cls)) {
        result.set(item.id, cls);
      }
    }

    // Fill in any missing ids with fallback
    for (const e of envelopes) {
      if (!result.has(e.id)) result.set(e.id, 'process');
    }

    console.log(`[BatchClassify] ${envelopes.length} emails → process:${[...result.values()].filter(v => v === 'process').length} fyi:${[...result.values()].filter(v => v === 'fyi_only').length} noise:${[...result.values()].filter(v => v === 'noise').length}`);
    return result;
  } catch (err) {
    console.error('[BatchClassify] Failed, falling back to process-all:', err);
    return fallback;
  }
}
