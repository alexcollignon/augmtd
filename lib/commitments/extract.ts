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
  // G1 (work-surface): the obligation's SUB-PARTS ("attach the deck", "include pricing") — one
  // commitment per MOTION, its clauses as steps. Persisted as the commitment's item plan.
  steps?: string[];
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
  // B2 (workbench): `status` — meeting-extracted commitments land as 'suggested' (a review gate:
  // meetings are noisy; the user Accepts/Rejects). Email-extracted stay 'open' (explicit written text).
  meta: { source: 'email' | 'meeting'; sourceId: string; threadId?: string | null; counterparty?: string | null; status?: 'open' | 'suggested' },
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

  // ── G1 backstop (work-surface): ONE OBLIGATION = ONE TASK. Same-counterparty, same-direction
  // fragments in one batch (the meeting insights extractor emits granular action items) get ONE
  // reasoned check: are these parts of a single motion? Merge → one commitment + steps. Conservative
  // by prompt (genuinely separate obligations stay apart); any failure → the batch stands as-is. ──
  let consolidated = accepted;
  if (accepted.length > 1) {
    try {
      const groups = new Map<string, number[]>();
      accepted.forEach((c, i) => {
        const key = `${c.direction}·${(c.counterparty || meta.counterparty || '').toString().toLowerCase().trim() || `solo-${i}`}`;
        (groups.get(key) ?? groups.set(key, []).get(key)!).push(i);
      });
      const merged = new Set<number>();
      const additions: ExtractedCommitment[] = [];
      for (const g of [...groups.values()].filter((x) => x.length > 1)) {
        const listTxt = g.map((i, n) => `${n}. ${accepted[i].description}`).join('\n');
        const { client: ai, model } = await getAIClient(userId, 'classification', client);
        const res = await aiCreate(ai, {
          model, max_tokens: 300, temperature: 0,
          messages: [{ role: 'user', content:
            `These tasks were extracted from ONE ${meta.source} with the SAME counterparty:\n${listTxt}\n\n` +
            `Are they parts of a SINGLE motion — one thing you'd mark done ONCE (e.g. one reply that must cover all of them)? ` +
            `Merge ONLY if clearly one deliverable/motion; genuinely separate obligations (different deliverables, different moments) stay separate.\n` +
            `JSON only: {"merge":true,"description":"<the one motion, short imperative>","steps":["<part>", "..."]} or {"merge":false}` }],
        });
        const parsed = JSON.parse((res.choices?.[0]?.message?.content ?? '{}').replace(/^```(json)?|```$/gm, '').trim()) as { merge?: boolean; description?: string; steps?: string[] };
        if (parsed.merge === true && parsed.description?.trim()) {
          g.forEach((i) => merged.add(i));
          const first = accepted[g[0]];
          additions.push({
            ...first,
            description: parsed.description.trim(),
            steps: [...new Set([...(Array.isArray(parsed.steps) ? parsed.steps : []), ...g.flatMap((i) => accepted[i].steps ?? [])])].slice(0, 5),
            due_date: g.map((i) => accepted[i].due_date).filter(Boolean).sort()[0] ?? null, // earliest stated
          });
        }
      }
      if (merged.size) consolidated = [...accepted.filter((_, i) => !merged.has(i)), ...additions];
    } catch { /* consolidation is an enhancement — the batch stands */ }
  }

  // IDENTITY RESOLUTION at the write (orchestrated-loop O1b) — the counterparty RESOLVES through the
  // person registry instead of being transcribed: one human never lands under two labels (the
  // canonical name wins), and a counterparty that resolves to the USER'S OWN self entity is a
  // structural impossibility with structural consequences — an "awaiting" on yourself IS your own
  // task (direction flips to you_owe), and you can never be your own counterparty (null; the display
  // layer derives a source label). Unresolved forms stay raw — honest, and future alias fodder.
  const { getPersonEntities, resolveIdentity } = await import('@/lib/entities/people');
  const persons = await getPersonEntities(client as never, userId).catch(() => []);
  const rows = consolidated.map((c) => {
    const rawCp = (c.counterparty || meta.counterparty || null)?.toString().slice(0, 200) ?? null;
    const id = resolveIdentity(persons, rawCp);
    const direction = id.isSelf ? 'you_owe' : (c.direction === 'awaiting' ? 'awaiting' : 'you_owe');
    const counterparty = id.isSelf ? null : (id.canonical ?? rawCp);
    return {
      user_id: userId,
      direction,
      description: c.description.trim().slice(0, 500),
      counterparty,
      due_date: validDate(c.due_date),
      initiative: cleanInitiative(c.initiative),
      source: meta.source,
      source_id: meta.sourceId,
      thread_id: meta.threadId ?? null,
      status: meta.status ?? 'open',
    };
  });
  if (!rows.length) return;
  const { data: inserted } = await client.from('commitments').insert(rows).select('id, description');

  // ── G1: the obligation's STEPS persist as its item plan (the deep-dive checklist), version-stamped
  // so the plan route serves them instead of regenerating. Non-fatal. ──
  try {
    const withSteps = consolidated.filter((c) => Array.isArray(c.steps) && c.steps.length >= 2);
    if (withSteps.length && inserted?.length) {
      const { PLAN_VERSION } = await import('@/lib/home/capability-map');
      const byDesc = new Map((inserted as Array<{ id: string; description: string }>).map((r) => [r.description, r.id]));
      for (const c of withSteps) {
        const cid = byDesc.get(c.description.trim().slice(0, 500));
        if (!cid) continue;
        await client.from('item_plans').upsert({
          user_id: userId, kind: 'commitment', entity_id: cid,
          tasks: c.steps!.slice(0, 5).map((s, i) => ({ id: `g1-${i}`, text: String(s).slice(0, 120), actor: 'you', done: false })),
          version: PLAN_VERSION, updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,kind,entity_id' });
      }
    }
  } catch { /* steps are an enhancement — the commitments landed */ }
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
  // B2: meeting follow-ups are PROPOSED, not imposed — they land 'suggested' for the user's
  // Accept/Reject (the review gate the cognitive-cost doctrine always implied for noisy extraction).
  await writeCommitments(userId, list, { source: 'meeting', sourceId: meta.transcriptId, threadId: null, status: 'suggested' }, client);
}

// ── THE DEIXIS SCRUBBER (proactive-team T-class) — stored text must stay true as time passes.
// Detection is LEXICAL (relative day-words in any of the user's working languages here — extend the
// list as languages appear); the rewrite is REASONED: one capped call over the offending titles
// only, anchored to the source's own date. Failure keeps the original (non-fatal, honest). ──
export const DEICTIC_RE = /\b(tomorrow|today|tonight|yesterday|next week|next month|this week|this (?:mon|tues|wednes|thurs|fri|satur|sun)day|amanh[ãa]|hoje|ontem|pr[óo]xima semana)\b/i;

export async function resolveDeixisInDescriptions<T extends { description: string }>(
  client: DBClient, userId: string, list: T[], anchorIso: string | null,
): Promise<T[]> {
  const offenders = list.map((c, i) => ({ c, i })).filter(({ c }) => DEICTIC_RE.test(c.description));
  if (!offenders.length) return list;
  try {
    const anchor = anchorIso && !isNaN(Date.parse(anchorIso)) ? new Date(anchorIso) : new Date();
    const anchorPretty = anchor.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const { client: ai, model } = await getAIClient(userId, 'classification', client);
    const res = await aiCreate(ai, {
      model, max_tokens: 300, temperature: 0,
      messages: [{ role: 'user', content:
        `These task titles contain RELATIVE time words that decay ("tomorrow" stops being true in a day). ` +
        `The source they came from is dated ${anchorPretty}. Rewrite each title with the relative words ` +
        `resolved to ABSOLUTE dates forward from THAT date (keep clock times; "tomorrow" → the next day's ` +
        `"MMM D"). Change NOTHING else about the title.\n\n` +
        offenders.map(({ c }, n) => `${n}. ${c.description}`).join('\n') +
        `\n\nJSON only: {"titles":["…", …]} (same order, same count)` }],
    });
    const m = (res.choices?.[0]?.message?.content ?? '').match(/\{[\s\S]*\}/);
    const titles = m ? (JSON.parse(m[0]) as { titles?: string[] }).titles : null;
    if (Array.isArray(titles) && titles.length === offenders.length) {
      const out = [...list];
      offenders.forEach(({ i }, n) => {
        const t = String(titles[n] ?? '').trim();
        // Accept only a rewrite that actually removed the deixis — a lazy echo keeps the original.
        if (t && !DEICTIC_RE.test(t)) out[i] = { ...out[i], description: t.slice(0, 140) };
      });
      return out;
    }
  } catch { /* the scrubber is a belt — the original title stands */ }
  return list;
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
  /** The email's OWN date — the deixis anchor ("tomorrow" in a 3-day-old email is 3 days ago's
   *  tomorrow, never extraction-day's). Falls back to now when absent. */
  receivedAt?: string | null;
  client: DBClient;
}): Promise<number> {
  const { userId, subject, body, isFromUser, userName, counterparty, sourceId, threadId, instructions, receivedAt, client } = opts;
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
- ONE commitment per MOTION/DELIVERABLE — the thing you'd mark done ONCE. A reply that must include pricing, a deck, and answers to two questions is ONE commitment ("Reply to X with the pilot proposal") whose parts go into "steps" — NEVER four sibling commitments.
- "steps": 2-5 short sub-parts of that one motion ("attach the deck", "include 7-8 seat pricing", "answer the data-source question"), or [] when the obligation has no distinct parts.
- A clear, explicit obligation with an owner. NOT every idea, sub-step, suggestion, aside, or granular task mentioned in passing.
- When in doubt, LEAVE IT OUT. A short list of real obligations is far better than a long list of maybes.

STRICTLY EXCLUDE and return an empty array if the message is a newsletter, promotion, receipt, invoice, or automated notification. NEVER treat marketing/newsletter calls-to-action as commitments — e.g. "reply with Q2", "submit your story", "subscribe", "reply for early access", "share your feedback", editorial/publishing schedules, or any mass-email ask. Also exclude CONDITIONAL or OPTIONAL offers ("reply if you need…", "let me know if you'd like…", "feel free to…", "happy to … if useful") — these are invitations, not commitments. Ignore pleasantries, vague intentions ("let's catch up sometime"), and anything already done.

${perspective}

due_date: set it ONLY when THIS email explicitly states a deadline — an absolute date, or an unambiguous relative one ("by Friday", "by EOD", "next Tuesday", "in 3 days"). THIS EMAIL IS DATED ${(receivedAt && !isNaN(Date.parse(receivedAt)) ? new Date(receivedAt) : new Date()).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} — resolve every relative time FORWARD FROM THAT DATE (its "tomorrow" is the day after IT was sent, not after today), to an absolute YYYY-MM-DD. If no deadline is stated in the email, due_date MUST be null. NEVER guess, infer, or invent a plausible date — a missing deadline is null, not a made-up one.

counterparty: the specific real person this obligation is with (who owes it, or is owed it), drawn from this email's actual participants — the sender or a named recipient. Use null only when genuinely unidentifiable; never invent a name.

initiative: the specific deal, client, project, internal initiative, or goal this commitment belongs to — including a hiring effort, product launch, migration, or other bounded internal effort. Use a short proper-noun label derived from THIS email's own content, or null for a one-off or an ongoing category such as invoices, receipts, or newsletters. Two DIFFERENT clients/companies/initiatives ALWAYS get DIFFERENT labels; the SAME ongoing effort gets a CONSISTENT label. Never invent a label.
${initiativeGrounding}${instructions?.trim() ? `\nThe user added this guidance — follow it: ${instructions.trim()}\n` : ''}
Subject: ${subject || '(none)'}
Body:
"""
${text.slice(0, 2500)}
"""

description — THE TITLE LAW: a short IMPERATIVE, at most ~9 words, starting with a verb and naming the deliverable ("Send the Q3 proposal", "Review the contract by Friday"). NEVER notes/narration phrasing ("Discussed the possibility of…", "It was agreed that…", "X mentioned…", "Follow up regarding the conversation about…") and never a sentence describing the conversation — the title is the TASK, written the way it would sit on a to-do list.
THE DEIXIS LAW: a stored title must stay TRUE as time passes — never write relative time words ("tomorrow", "today", "tonight", "next week", "this Friday") into the description. Resolve them against THIS EMAIL'S OWN DATE above and write the absolute instead: "Be at the meeting room at 12:30 tomorrow" (sent Jul 27) → "Be at the meeting room — Jul 28, 12:30". Clock times stay; day-words become dates.

Return ONLY JSON. Empty array if there are no real commitments:
{"commitments":[{"direction":"you_owe|awaiting","description":"short imperative, e.g. 'Send the Q3 proposal'","due_date":"YYYY-MM-DD or null","counterparty":"name/email or null","initiative":"short label or null","steps":["short sub-part", "..."]}]}`;

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
    // THE DEIXIS LAW, structural belt (T-class): a title carrying a relative time word decays into
    // a lie ("tomorrow" is only true for a day) — detection is lexical, the REWRITE is reasoned
    // (one capped call, only for offenders), anchored to the email's own date.
    list = await resolveDeixisInDescriptions(client, userId, list, receivedAt ?? null);
    await writeCommitments(userId, list, { source: 'email', sourceId, threadId, counterparty }, client);
    return list.length;
  } catch {
    return 0;
  }
}
