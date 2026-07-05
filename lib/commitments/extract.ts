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

// A first-person promise BY the sender — the only shape that keeps a from-user commitment as
// "you_owe". Anything else the sender writes (an imperative/request aimed at the recipient) is the
// OTHER party's obligation. Descriptions are short imperatives ("Send the Q3 proposal"), so we also
// accept a bare leading verb of sending/sharing that the user is the natural subject of — but the
// structural rule is: no first-person promise marker on a from-user email ⇒ treat as awaiting.
const FIRST_PERSON_PROMISE = /\b(i'?ll|i will|i'?m going to|i am going to|i shall|let me|we'?ll|we will|we'?re going to|we are going to|on my end|i'?ve|i have|i can|i'?d|i would)\b/i;

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
  instructions?: string;   // user's custom extraction guidance (Email tab → To-do capture)
  client: DBClient;
}): Promise<number> {
  const { userId, subject, body, isFromUser, userName, counterparty, sourceId, threadId, instructions, client } = opts;
  const text = (body || '').trim();
  if (text.length < 20 || !COMMITMENT_HINT.test(text)) return 0;
  // Received bulk/newsletter mail never carries a real commitment — skip before the AI call.
  if (!isFromUser && BULK_HINT.test(text)) return 0;

  const who = userName || 'the user';
  const perspective = isFromUser
    ? `This email was SENT BY ${who}. Things ${who} promises to do = direction "you_owe". Things ${who} asks or requests the other party to do (and is now waiting on) = direction "awaiting". CRITICAL: because ${who} is the SENDER, an imperative or request aimed at the other party ("process the refund", "please send X", "can you review Y") is something the OTHER party owes — direction "awaiting" — NOT something ${who} owes. Only a first-person promise by ${who} ("I'll…", "I will…", "let me…", "we'll…") is "you_owe".`
    : `This email was RECEIVED BY ${who} from ${counterparty || 'someone'}. Things the other party asks ${who} to do = direction "you_owe". Things the other party promises to do for ${who} = direction "awaiting".`;

  const prompt = `Extract concrete COMMITMENTS from this email — a specific promise or obligation between ${who} and a REAL person, with a clear owner and optionally a deadline (e.g. "Send the Q3 proposal", "Review the contract by Friday").

STRICTLY EXCLUDE and return an empty array if the message is a newsletter, promotion, receipt, invoice, or automated notification. NEVER treat marketing/newsletter calls-to-action as commitments — e.g. "reply with Q2", "submit your story", "subscribe", "reply for early access", "share your feedback", editorial/publishing schedules, or any mass-email ask. Also exclude CONDITIONAL or OPTIONAL offers ("reply if you need…", "let me know if you'd like…", "feel free to…", "happy to … if useful") — these are invitations, not commitments. Ignore pleasantries, vague intentions ("let's catch up sometime"), and anything already done.

${perspective}

Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}. Resolve any relative deadline ("Friday", "next week", "by EOD", "in 3 days") to an absolute YYYY-MM-DD relative to today; null if none is stated.
${instructions?.trim() ? `\nThe user added this guidance — follow it: ${instructions.trim()}\n` : ''}
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
    let list = (parsed.commitments ?? []) as ExtractedCommitment[];
    if (!list.length) return 0;
    // Structural backstop — a hard directional signal the model's text-inference cannot override.
    // When the email is FROM the user, an ask/imperative directed OUTWARD ("process the refund",
    // "send me X") is something the counterparty owes → "awaiting", NOT "you_owe". Only a clear
    // first-person promise ("I'll…", "we'll…", "let me…") stays "you_owe". This is general (no
    // names/subjects) — it keys purely off who sent the email + the grammatical shape of the task,
    // so a requested action can never land in the user's "on your plate" lane.
    if (isFromUser) {
      list = list.map((c) => (c.direction === 'you_owe' && !FIRST_PERSON_PROMISE.test(c.description) ? { ...c, direction: 'awaiting' } : c));
    }
    await writeCommitments(userId, list, { source: 'email', sourceId, threadId, counterparty }, client);
    return list.length;
  } catch {
    return 0;
  }
}
