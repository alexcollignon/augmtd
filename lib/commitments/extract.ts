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
  initiative?: string | null; // deal/client/project this belongs to (for project grouping); null = one-off
};

// Clean an initiative label (drop the model's "null"/"none" filler; cap length).
function cleanInitiative(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && !/^(null|none|n\/a|na|unknown|one-off|one off)$/i.test(s) ? s.slice(0, 60) : null;
}

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

// Attendee alias helpers now live in the shared identity module (single source across the initiative
// machine — commitments + calendar bridging). Same agnostic logic, one definition.
import { norm, emailLocalpart, nameTokens, emailDenotesName, sameAttendee } from '@/lib/projects/identity';

export function validDate(d: unknown): string | null {
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
export function isNearDuplicate(a: string, b: string, threshold = 0.6): boolean {
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

// Insert new commitments for a source, skipping ones already captured. Dedup is at THREE levels, all
// general (token-overlap, no text special-casing): (1) against commitments already stored for this
// source, (2) WITHIN the incoming batch (first occurrence wins), and (3) CROSS-SOURCE against the
// user's OPEN commitments in the SAME context — same counterparty or same initiative (projecthood-plan
// P5: a recurring meeting re-stating "secure the pilot project" must not mint a sibling every week —
// the wall of near-dupes). The context guard keeps generic phrasings ("send the proposal") from
// folding across unrelated deals. due_date is written ONLY when it survives validDate (an absolute
// YYYY-MM-DD) — a fabricated / unparseable date collapses to null rather than a made-up deadline.
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
  // The user's OPEN commitments from OTHER sources — the cross-meeting restatement pool.
  const { data: openOther } = await client.from('commitments')
    .select('description, counterparty, initiative').eq('user_id', userId).eq('status', 'open')
    .neq('source_id', meta.sourceId).order('created_at', { ascending: false }).limit(400);
  const openRows = (openOther ?? []) as Array<{ description: string; counterparty: string | null; initiative: string | null }>;

  const accepted: ExtractedCommitment[] = [];
  for (const c of clean) {
    const desc = c.description.trim();
    const cp = (c.counterparty || meta.counterparty || '').toString();
    const init = (c.initiative || '').toString().toLowerCase().trim();
    // Drop if it restates something already stored for this source, or one we've already accepted
    // from this same batch (first occurrence wins).
    const dupExisting = existingDescs.some((d: string) => isNearDuplicate(desc, d));
    const dupBatch = accepted.some((a) => isNearDuplicate(desc, a.description));
    // Cross-source: near-identical text (0.5) + a shared context anchor (counterparty or initiative).
    const dupCross = openRows.some((d) => {
      if (!isNearDuplicate(desc, d.description, 0.5)) return false;
      const sameParty = !!cp && !!d.counterparty && sameAttendee(cp, d.counterparty);
      const sameInit = !!init && !!d.initiative && d.initiative.toLowerCase().trim() === init;
      return sameParty || sameInit;
    });
    if (dupExisting || dupBatch || dupCross) continue;
    accepted.push(c);
  }

  const rows = accepted.map((c) => ({
    user_id: userId,
    direction: c.direction === 'awaiting' ? 'awaiting' : 'you_owe',
    description: c.description.trim().slice(0, 500),
    counterparty: (c.counterparty || meta.counterparty || null)?.toString().slice(0, 200) ?? null,
    due_date: validDate(c.due_date),
    initiative: cleanInitiative(c.initiative),
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
  const userName = meta.userName || '';
  const userNorm = norm(userName);
  // Strip the user in ANY form (name or an email that denotes their name), then collapse the rest
  // into DISTINCT people (alias-aware), preferring a display name over an email as the label.
  const notUser = [...new Set((meta.attendees ?? []).map((a) => (a || '').toString().trim()).filter(Boolean))]
    .filter((a) => {
      if (!userNorm) return true;
      if (norm(a) === userNorm) return false;
      const local = emailLocalpart(a);
      return !(local && emailDenotesName(local, userName));
    });
  const people: string[] = [];
  for (const a of notUser) {
    const idx = people.findIndex((p) => sameAttendee(p, a));
    if (idx === -1) people.push(a);
    else if (emailLocalpart(people[idx]) && !emailLocalpart(a)) people[idx] = a; // prefer a name over an email
  }
  const soleCounterpart = people.length === 1 ? people[0] : null;

  // Persist the initiative at write time (meeting commitments were born initiative-less and only got one
  // via the read-time person-bridge). Resolve each counterpart's GROUNDED canonical — the same label the
  // deal's emails carry — so a meeting joins the right project durably (and clusters immediately). Only when
  // the contact has ONE clear initiative (no other variants) — mirrors the bridge's "exactly one" safety;
  // ambiguous (multiple deals) or a brand-new contact → null (loose), never a guessed assignment.
  const { getInitiativeCandidates } = await import('@/lib/inbox/initiative-candidates');
  const initByPerson = new Map<string, string | null>();
  const resolveInitiative = async (cp: string | null): Promise<string | null> => {
    if (!cp) return null;
    const k = cp.toLowerCase().trim();
    if (initByPerson.has(k)) return initByPerson.get(k) ?? null;
    const { canonical, candidates } = await getInitiativeCandidates(client, userId, { personNames: [cp], personEmails: [cp] }).catch(() => ({ canonical: null, candidates: [] as string[] }));
    const val = canonical && candidates.length === 0 ? canonical : null;
    initByPerson.set(k, val);
    return val;
  };

  const list: ExtractedCommitment[] = [];
  for (const a of actionItems ?? []) {
    if (!a?.action?.trim()) continue;
    const isUser = a.isUserTask === true || a.isUserTask == null || !a.assignee;
    // Assigned-to-other → the assignee. User task → the sole counterpart if this was a 1:1, else null
    // (unresolvable in a group meeting; display derives a source label).
    const counterparty = isUser ? soleCounterpart : (a.assignee ?? soleCounterpart ?? null);
    list.push({
      direction: isUser ? 'you_owe' : 'awaiting',
      description: a.action!.trim(),
      due_date: a.dueDate ?? a.due_date ?? null,
      counterparty,
      initiative: await resolveInitiative(counterparty),
    } as ExtractedCommitment);
  }
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
  // Context-grounded initiative: the labels this counterparty/thread already carries, so a commitment
  // reuses the existing deal label instead of inventing a synonym (converges with the email understanding).
  const { getInitiativeCandidates, initiativeGroundingClause } = await import('@/lib/inbox/initiative-candidates');
  const initCand = await getInitiativeCandidates(client, userId, { threadId, personNames: [counterparty], personEmails: [counterparty] }).catch(() => ({ canonical: null, candidates: [] as string[] }));
  const initiativeGrounding = initiativeGroundingClause(initCand.canonical, initCand.candidates);
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

initiative: the specific deal, client, project, internal initiative, or goal this commitment belongs to — including a hiring effort, product launch, migration, or other bounded internal effort. Use a short proper-noun label derived from THIS email's own content, or null for a one-off or an ongoing category such as invoices, receipts, or newsletters. Two DIFFERENT clients/companies/initiatives ALWAYS get DIFFERENT labels; the SAME ongoing effort gets a CONSISTENT label. Never invent a label.
${initiativeGrounding}${instructions?.trim() ? `\nThe user added this guidance — follow it: ${instructions.trim()}\n` : ''}
Subject: ${subject || '(none)'}
Body:
"""
${text.slice(0, 2500)}
"""

Return ONLY JSON. Empty array if there are no real commitments:
{"commitments":[{"direction":"you_owe|awaiting","description":"short imperative, e.g. 'Send the Q3 proposal'","due_date":"YYYY-MM-DD or null","counterparty":"name/email or null","initiative":"short label or null"}]}`;

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
