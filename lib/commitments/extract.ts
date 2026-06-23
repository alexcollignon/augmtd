// Commitment extraction — "what I owe / what I'm owed", from emails and meetings.
// Email path uses a cheap keyword pre-filter to gate the AI call (most mail has no commitment).

import { getAIClient, aiCreate } from '@/lib/ai/factory';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = any;

export type ExtractedCommitment = {
  direction: 'you_owe' | 'awaiting';
  description: string;
  due_date?: string | null;
  counterparty?: string | null;
};

// Only worth an AI call if the text plausibly contains a promise/deadline.
const COMMITMENT_HINT = /\b(i'?ll|i will|we'?ll|we will|let me|i'?ll get|send you|get you|send over|follow up|circle back|will send|will get|will have|will share|by (mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|tomorrow|eod|cob|end of|next week|this week|end of day|end of week)|deadline|by the end|due |get back to you|revert|by then)\b/i;

// Bulk / newsletter / automated mail — never a source of personal commitments. An "unsubscribe"
// footer is a near-perfect signal that this is a broadcast, not a 1:1 message.
const BULK_HINT = /unsubscribe|view (this )?(e?-?mail )?in (your )?browser|manage (your )?(e?mail )?preferences|update your preferences|you'?re receiving this|sent to you because|no longer wish to receive|email preferences|all rights reserved/i;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
function validDate(d: unknown): string | null {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return d;
}

function parseJson(text: string): any {
  let raw = text.trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) raw = fenced[1].trim();
  try { return JSON.parse(raw); } catch { /* */ }
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(raw.slice(a, b + 1));
  throw new Error('no json');
}

// Insert new commitments for a source, skipping ones already captured (dedupe by description).
export async function writeCommitments(
  userId: string,
  list: ExtractedCommitment[],
  meta: { source: 'email' | 'meeting'; sourceId: string; threadId?: string | null; counterparty?: string | null },
  client: DBClient,
): Promise<void> {
  const clean = (list ?? []).filter((c) => c?.description?.trim());
  if (!clean.length) return;

  const { data: existing } = await client.from('commitments')
    .select('description').eq('user_id', userId).eq('source_id', meta.sourceId);
  const seen = new Set((existing ?? []).map((e: { description: string }) => norm(e.description)));

  const rows = clean
    .filter((c) => !seen.has(norm(c.description)))
    .map((c) => ({
      user_id: userId,
      direction: c.direction === 'awaiting' ? 'awaiting' : 'you_owe',
      description: c.description.trim().slice(0, 500),
      counterparty: (c.counterparty || meta.counterparty || null)?.toString().slice(0, 200) ?? null,
      due_date: validDate(c.due_date),
      source: meta.source,
      source_id: meta.sourceId,
      thread_id: meta.threadId ?? null,
      status: 'open',
    }));
  if (rows.length) await client.from('commitments').insert(rows);
}

// Meeting commitments — map already-extracted action items to commitments (no AI needed).
// The user's items = you_owe; items assigned to others = awaiting (they owe the user).
export async function writeMeetingCommitments(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actionItems: Array<{ action?: string; assignee?: string | null; isUserTask?: boolean | null; dueDate?: string | null; due_date?: string | null }>,
  meta: { transcriptId: string },
  client: DBClient,
): Promise<void> {
  const list: ExtractedCommitment[] = (actionItems ?? [])
    .filter((a) => a?.action?.trim())
    .map((a) => {
      const isUser = a.isUserTask === true || a.isUserTask == null || !a.assignee;
      return {
        direction: isUser ? 'you_owe' : 'awaiting',
        description: a.action!.trim(),
        due_date: a.dueDate ?? a.due_date ?? null,
        counterparty: isUser ? null : (a.assignee ?? null),
      } as ExtractedCommitment;
    });
  await writeCommitments(userId, list, { source: 'meeting', sourceId: meta.transcriptId, threadId: null }, client);
}

// Extract commitments from one email and persist them. Returns the count written.
export async function extractEmailCommitments(opts: {
  userId: string;
  subject: string;
  body: string;
  isFromUser: boolean;     // true = the user sent it
  userName: string | null;
  counterparty: string | null;  // the other party (recipient if sent, sender if received)
  sourceId: string;
  threadId?: string | null;
  client: DBClient;
}): Promise<number> {
  const { userId, subject, body, isFromUser, userName, counterparty, sourceId, threadId, client } = opts;
  const text = (body || '').trim();
  if (text.length < 20 || !COMMITMENT_HINT.test(text)) return 0;
  // Received bulk/newsletter mail never carries a real commitment — skip before the AI call.
  if (!isFromUser && BULK_HINT.test(text)) return 0;

  const who = userName || 'the user';
  const perspective = isFromUser
    ? `This email was SENT BY ${who}. Things ${who} promises to do = direction "you_owe". Things ${who} asks the other party to do (and is now waiting on) = direction "awaiting".`
    : `This email was RECEIVED BY ${who} from ${counterparty || 'someone'}. Things the other party asks ${who} to do = direction "you_owe". Things the other party promises to do for ${who} = direction "awaiting".`;

  const prompt = `Extract concrete COMMITMENTS from this email — a specific promise or obligation between ${who} and a REAL person, with a clear owner and optionally a deadline (e.g. "Send the Q3 proposal", "Review the contract by Friday").

STRICTLY EXCLUDE and return an empty array if the message is a newsletter, promotion, receipt, invoice, or automated notification. NEVER treat marketing/newsletter calls-to-action as commitments — e.g. "reply with Q2", "submit your story", "subscribe", "reply for early access", "share your feedback", editorial/publishing schedules, or any mass-email ask. Also ignore pleasantries, vague intentions ("let's catch up sometime"), and anything already done.

${perspective}

Subject: ${subject || '(none)'}
Body:
"""
${text.slice(0, 2500)}
"""

Return ONLY JSON. Empty array if there are no real commitments:
{"commitments":[{"direction":"you_owe|awaiting","description":"short imperative, e.g. 'Send the Q3 proposal'","due_date":"YYYY-MM-DD or null","counterparty":"name/email or null"}]}`;

  try {
    const { client: ai, model } = await getAIClient(userId, 'summarization', client);
    const res = await aiCreate(ai, { model, messages: [{ role: 'user', content: prompt }], max_tokens: 500, temperature: 0.2 });
    const parsed = parseJson(res.choices?.[0]?.message?.content ?? '');
    const list = (parsed.commitments ?? []) as ExtractedCommitment[];
    if (!list.length) return 0;
    await writeCommitments(userId, list, { source: 'email', sourceId, threadId, counterparty }, client);
    return list.length;
  } catch {
    return 0;
  }
}
