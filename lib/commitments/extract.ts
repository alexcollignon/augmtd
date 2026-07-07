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

// ── Near-duplicate detection (general, language/text-agnostic) ────────────────────────────────
// Two commitment descriptions are "the same obligation" when their content words overlap heavily —
// used to collapse the near-identical fragments an over-eager extractor emits for one action
// ("Send the deck to Rene", "Send Rene the deck", "Send over the deck"). NO string special-casing:
// it works purely off token overlap, so it holds for any wording, any language's word boundaries.
const DUP_STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'for', 'of', 'and', 'or', 'with', 'on', 'in', 'at', 'by', 'from', 'up',
  'out', 'over', 'about', 'into', 'as', 'is', 'be', 'will', 'would', 'should', 'need', 'needs',
  'please', 'get', 'send', 'this', 'that', 'it', 'them', 'me', 'you', 'we', 'i', 'he', 'she', 'they',
]);
// The signal-bearing tokens of a description — lowercased words, stopwords dropped, deduped.
function contentTokens(s: string): Set<string> {
  const toks = norm(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
    .filter((t) => t.length > 2 && !DUP_STOPWORDS.has(t));
  return new Set(toks);
}
// Jaccard-style overlap over content tokens. ≥ threshold ⇒ the same obligation. A high default (0.6)
// keeps this conservative — it merges obvious restatements, never distinct tasks that share a noun.
function isNearDuplicate(a: string, b: string, threshold = 0.6): boolean {
  const na = norm(a), nb = norm(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true; // one description is a substring of the other
  const ta = contentTokens(a), tb = contentTokens(b);
  if (!ta.size || !tb.size) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union > 0 && inter / union >= threshold;
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

// Insert new commitments for a source, skipping ones already captured. Dedup is at TWO levels, both
// general (token-overlap, no text special-casing): (1) against commitments already stored for this
// source, and (2) WITHIN the incoming batch — so a single source can never produce two rows for the
// same obligation (the near-duplicate blowup). The first occurrence wins; later restatements are
// dropped. due_date is written ONLY when it survives validDate (an absolute YYYY-MM-DD) — a
// fabricated / unparseable date collapses to null rather than a made-up deadline.
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
  const existingDescs = (existing ?? []).map((e: { description: string }) => e.description || '');

  const accepted: ExtractedCommitment[] = [];
  for (const c of clean) {
    const desc = c.description.trim();
    // Drop if it restates something already stored for this source, or one we've already accepted
    // from this same batch (first occurrence wins).
    const dupExisting = existingDescs.some((d: string) => isNearDuplicate(desc, d));
    const dupBatch = accepted.some((a) => isNearDuplicate(desc, a.description));
    if (dupExisting || dupBatch) continue;
    accepted.push(c);
  }

  const rows = accepted.map((c) => ({
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
//
// Counterparty: for an item assigned to someone else it's the assignee. For a USER task it's left to
// the one clear counterpart when the meeting has exactly ONE identifiable other participant (a 1:1)
// — otherwise null (genuinely unresolvable in a group meeting; the display layer derives a source
// label instead of printing a placeholder). Source-agnostic: keyed off the passed attendee list, no
// names hardcoded.
//
// due_date: passed straight through validDate (in writeCommitments) — an absolute YYYY-MM-DD stays,
// anything else (a fabricated / relative / null value) becomes null. We never invent a date here.
// Write-time dedup (writeCommitments) collapses the near-identical fragments an over-eager insights
// pass emits for one obligation, so a meeting yields a small set of real commitments, not a backlog.
export async function writeMeetingCommitments(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actionItems: Array<{ action?: string; assignee?: string | null; isUserTask?: boolean | null; dueDate?: string | null; due_date?: string | null }>,
  meta: { transcriptId: string; attendees?: Array<string | null | undefined> | null; userName?: string | null },
  client: DBClient,
): Promise<void> {
  // The set of "other" participants (attendee names that aren't the user). Used only to resolve a
  // 1:1 counterpart for a user task — never to fabricate a name.
  const userNorm = norm(meta.userName || '');
  const others = [...new Set((meta.attendees ?? [])
    .map((a) => (a || '').toString().trim())
    .filter(Boolean)
    .filter((a) => !userNorm || norm(a) !== userNorm))];
  const soleCounterpart = others.length === 1 ? others[0] : null;

  const list: ExtractedCommitment[] = (actionItems ?? [])
    .filter((a) => a?.action?.trim())
    .map((a) => {
      const isUser = a.isUserTask === true || a.isUserTask == null || !a.assignee;
      return {
        direction: isUser ? 'you_owe' : 'awaiting',
        description: a.action!.trim(),
        due_date: a.dueDate ?? a.due_date ?? null,
        // Assigned-to-other → the assignee. User task → the sole counterpart if this was a 1:1,
        // else null (unresolvable in a group meeting; display derives a source label).
        counterparty: isUser ? soleCounterpart : (a.assignee ?? soleCounterpart ?? null),
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

  const prompt = `Extract concrete COMMITMENTS from this email — a SPECIFIC obligation a party EXPLICITLY took on, or is explicitly owed, between ${who} and a REAL person (e.g. "Send the Q3 proposal", "Review the contract by Friday").

What counts as ONE commitment — be selective, prefer FEWER and higher-confidence:
- A clear, explicit obligation with an owner. NOT every idea, sub-step, suggestion, aside, or granular task mentioned in passing.
- MERGE related sub-tasks of the same obligation into ONE commitment (don't split "send the deck" and "share the deck with Rene" into two).
- When in doubt, LEAVE IT OUT. A short list of real obligations is far better than a long list of maybes.

STRICTLY EXCLUDE and return an empty array if the message is a newsletter, promotion, receipt, invoice, or automated notification. NEVER treat marketing/newsletter calls-to-action as commitments — e.g. "reply with Q2", "submit your story", "subscribe", "reply for early access", "share your feedback", editorial/publishing schedules, or any mass-email ask. Also exclude CONDITIONAL or OPTIONAL offers ("reply if you need…", "let me know if you'd like…", "feel free to…", "happy to … if useful") — these are invitations, not commitments. Ignore pleasantries, vague intentions ("let's catch up sometime"), and anything already done.

${perspective}

due_date: set it ONLY when THIS email explicitly states a deadline — an absolute date, or an unambiguous relative one ("by Friday", "by EOD", "next Tuesday", "in 3 days"). Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, so resolve such a stated relative deadline to an absolute YYYY-MM-DD. If no deadline is stated in the email, due_date MUST be null. NEVER guess, infer, or invent a plausible date — a missing deadline is null, not a made-up one.

counterparty: the specific real person this obligation is with (who owes it, or is owed it), drawn from this email's actual participants — the sender or a named recipient. Use null only when genuinely unidentifiable; never invent a name.
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
