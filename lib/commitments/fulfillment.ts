// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE FULFILLMENT LAW (July 30 — found live: "I'll close the assessment and share the report
// before Sunday" marked the DELIVER-THE-REPORT commitment fulfilled, and the week's most important
// deliverable vanished from the Home).
//
// A message and a deliverable are different things. The structural resolvers (resolve-on-reply,
// the commitments sweep) are right that "the user wrote to the counterparty" SETTLES a
// reply-obligation — but a commitment can owe a DELIVERABLE (a report, a file, an action), and a
// reply that merely PROMISES it fulfills nothing. The judge already draws this line ("an
// unfulfilled request still owes the doing"); this module gives the RESOLVERS the same brain.
//
// The division of labor (the registry law, everywhere): the MODEL judges what the message did
// (delivered · promised · unclear) from the message's own words; the CODE applies the
// consequences — only `delivered` closes; a re-promise with a stated NEW date re-anchors
// `due_date` (code-verified via dateStatedInText against the message's own text, future-only);
// `unclear` or an AI failure changes NOTHING (failure is never fulfillment — the W2 honesty law).
// Zero keyword lists; one cheap reasoned pass, fired ONLY at a structural resolution candidate
// (the resolvers' direction+time signal remains the gate, so this adds no ambient cost).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { readPlan, upsertPlan } from '@/lib/store/item-plans';
import { aiCall } from '@/lib/ai/call';
import { dateStatedInText } from '@/lib/utils/user-time';
import { topMessageOf } from '@/lib/inbox/top-message';
import { clipForPrompt, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';
import { openAgeDays } from '@/lib/commitments/expiry';

// Bump on ANY change to the judging prompt/facts/scoping — a cached verdict from an older law
// must never satisfy the current one (the prompt-version-in-cache-sig law, learned twice now).
// 5: EVIDENCE SETTLES (W3.1) — the judge reads a SET of candidates (emails on any thread + held/
//    booked meetings + transcripts with the counterparty) and a held/booked meeting counts as
//    delivery for a scheduling obligation; the sig is the evidence set, not one message id.
export const FULFILLMENT_LAW_VERSION = 5;

export type FulfillmentVerdict = {
  verdict: 'delivered' | 'promised' | 'unclear';
  /** Only on `promised`: a NEW deadline stated in the message itself (code-verified, future-only). */
  newDue?: string;
  reason: string;
  /** On `delivered`: WHICH candidate delivered (type + id + its own time) — the settle stamps from it. */
  by?: { type: 'email' | 'calendar' | 'transcript'; id: string; at: string };
};

/** One piece of evidence the judge may read — the nominator's shape (lib/work/evidence-nominator). */
export type FulfillmentCandidate = {
  type: 'email' | 'calendar' | 'transcript';
  id: string;
  at: string;
  title: string;
  body?: string;
  attachmentCount?: number | null;
  status?: 'held' | 'booked';
};

export type FulfillmentObligation = {
  kind?: 'commitment' | 'inbox';
  id?: string;
  description: string;
  due_date?: string | null;
  created_at?: string | null;
  /** A STRUCTURED scheduling signal from the item's own judgment record (work='schedule') — never
   *  a keyword read. When absent the evidence is passed as facts and the judge decides alone. */
  schedulingSignal?: boolean;
};

// item_plans kind: 'fulfillment' (the one verdict store both doors share)

/**
 * Judge whether the candidate fulfilling MESSAGE actually fulfills the commitment.
 * `fulfillerIsUser` — true when the user owes (their sent message is the candidate), false when the
 * counterparty owes (their reply is the candidate). The same law covers both directions.
 * Kept as the one-message door (both resolvers + the repair sweep call it); it rides the
 * multi-candidate judge below with a single email candidate.
 */
export async function judgeCommitmentFulfillment(
  client: SupabaseClient,
  userId: string,
  commitment: { id?: string; description: string; due_date?: string | null; created_at?: string | null },
  message: { id?: string | null; body: string; attachmentCount?: number | null },
  fulfillerIsUser: boolean,
): Promise<FulfillmentVerdict> {
  return judgeFulfillmentFromEvidence(client, userId, { kind: 'commitment', ...commitment },
    [{ type: 'email', id: message.id ? String(message.id) : '', at: '', title: '', body: message.body, attachmentCount: message.attachmentCount }],
    fulfillerIsUser);
}

/**
 * THE MULTI-CANDIDATE JUDGE (W3.1). One reasoned pass over EVERY nominated piece of evidence —
 * the user's emails to the counterparty on any thread (own words only), meetings held or booked
 * with them, transcripts — decides delivered · promised · unclear and, on delivered, WHICH piece
 * did it. Cached per (obligation, evidence set) under the law version: the same set never
 * re-spends; a new piece re-judges. Failure and `unclear` change nothing.
 */
export async function judgeFulfillmentFromEvidence(
  client: SupabaseClient,
  userId: string,
  obligation: FulfillmentObligation,
  candidates: FulfillmentCandidate[],
  fulfillerIsUser: boolean,
): Promise<FulfillmentVerdict> {
  const todayStr = new Date().toISOString().slice(0, 10);
  // THE TOP MESSAGE: judge only the sender's OWN words — the quoted reply-chain underneath is
  // history, and a delivery mail quoting last week's promise must never be judged as the promise.
  // EXCERPT-HONESTY (Aug 4): the clip declares itself; the prompt rules it out as source truth.
  const emails = candidates.filter((c) => c.type === 'email')
    .map((c) => ({ ...c, body: clipForPrompt(topMessageOf(String(c.body ?? '')).replace(/\s+/g, ' '), emailBudget(candidates)) }))
    .filter((c) => c.body.trim());
  const meetings = candidates.filter((c) => c.type !== 'email');
  if (!emails.length && !meetings.length) return { verdict: 'unclear', reason: 'no evidence text to judge' };
  const kind = obligation.kind ?? 'commitment';
  // Cache per (obligation, evidence SET) — the sweep re-nominates the same set every pass; a
  // non-delivered verdict must not re-burn AI every 2h. A new piece of evidence re-judges. An
  // id-less candidate (an ad-hoc probe) never caches.
  const allIds = candidates.every((c) => c.id);
  const sig = `${FULFILLMENT_LAW_VERSION}:${candidates.map((c) => `${c.type[0]}${c.id}`).sort().join(',')}`;
  const cacheKey = obligation.id && allIds ? { entity: `${kind}:${obligation.id}`, sig } : null;
  if (cacheKey) {
    try {
      const data = await readPlan(client, userId, 'fulfillment', cacheKey.entity);
      const t = (data?.tasks ?? null) as { sig?: string; verdict?: FulfillmentVerdict } | null;
      if (t?.sig === cacheKey.sig && t.verdict?.verdict) return t.verdict;
    } catch { /* cache is best-effort */ }
  }
  const who = fulfillerIsUser ? 'the user (who owes it)' : 'the counterparty (who owes it)';
  const ageDays = openAgeDays(obligation.created_at);
  // The candidate labels the model answers with — code maps them back; an invented label is
  // never trusted (THE QUOTE LAW's cousin: the model picks, the code validates the pick).
  const labels = new Map<string, FulfillmentCandidate>();
  const evidenceLines: string[] = [];
  emails.forEach((c, i) => {
    const label = `E${i + 1}`; labels.set(label, c);
    evidenceLines.push(
      `[${label}] EMAIL sent by ${who}${c.at ? ` on ${c.at.slice(0, 10)}` : ''}${c.title ? `, subject "${clipForPrompt(c.title, 100)}"` : ''}. ` +
      // TRUE FACTS OR NO FACTS: a count the code cannot verify is passed as UNKNOWN, never as a
      // confident zero (sent-mail metadata may predate attachment capture).
      `FACT: ${typeof c.attachmentCount === 'number' ? `it carries ${c.attachmentCount} attachment(s)` : 'its attachment count is UNKNOWN (metadata unavailable — do not treat as zero; judge from the words)'}. ` +
      `Its own words (quoted reply-history removed):\n"""${c.body}"""`);
  });
  meetings.forEach((c, i) => {
    const label = `${c.type === 'calendar' ? 'C' : 'T'}${i + 1}`; labels.set(label, c);
    evidenceLines.push(c.type === 'calendar'
      ? `[${label}] CALENDAR FACT: a meeting with the counterparty, "${clipForPrompt(c.title || 'meeting', 80)}", ${c.status === 'held' ? `was HELD on ${c.at.slice(0, 16).replace('T', ' ')} (it already took place)` : `is BOOKED for ${c.at.slice(0, 16).replace('T', ' ')} (on the user's calendar, not yet held)`}.`
      : `[${label}] MEETING FACT: a recorded meeting with the counterparty, "${clipForPrompt(c.title || 'meeting', 80)}", took place on ${c.at.slice(0, 16).replace('T', ' ')} (a transcript exists).`);
  });
  try {
    const res = await aiCall<{ verdict?: string; by?: string | null; new_due?: string | null; reason?: string }>({
      userId, supabase: client, shape: { output: 'json' }, temperature: 0, maxTokens: 200,
      source: 'brain_synthesis',
      prompt:
        `Was this obligation FULFILLED by any of the evidence below, or only acknowledged/promised?\n` +
        `OBLIGATION owed by ${who}: "${clipForPrompt(obligation.description, 600)}"${obligation.due_date ? ` (due ${obligation.due_date})` : ''}${obligation.created_at ? `, arising ${String(obligation.created_at).slice(0, 10)}` : ''}\n` +
        `${obligation.schedulingSignal ? `FACT: the user's own work judgment classed this obligation as SCHEDULING work (arranging a meeting or call).\n` : ''}` +
        `Today is ${todayStr}.\n` +
        // LAW 2's undated clause: an obligation with no stated date can never be nominated for
        // expiry — it AGES into the judges' facts instead (the open-ask-age fact the item judge
        // already carries). Age is context for reading the message, never a reason to close.
        `${ageDays !== null ? `FACT: this obligation has been open ${ageDays} day(s) (age is context, never evidence of delivery).\n` : ''}` +
        `${EXCERPT_RULE}\n` +
        `EVIDENCE (each piece happened AFTER the obligation arose; newest first within a type):\n${evidenceLines.join('\n')}\n` +
        `The law: "delivered" ONLY if the thing owed is actually handed over in/with one piece of evidence — ` +
        `the substantive answer given, the document attached or linked, the action stated as ALREADY done. ` +
        `If what is owed IS a response/answer and an email substantively responds, that is delivered. ` +
        `THE MEETING CLAUSE: when what is owed is to schedule, book, arrange, hold or join a meeting or call with ` +
        `this counterparty, a meeting with them HELD or BOOKED after the obligation arose IS delivery (a booked slot ` +
        `fulfills "set up a call"; a held one fulfills "meet them"). A meeting fact is NEVER delivery of a report, file, ` +
        `document, answer, decision or payment — those must be handed over in words or attachments. ` +
        `If what is owed is a deliverable (report, file, document, artifact, an action to perform), a promise ` +
        `to do it later ("I'll send it by Sunday"), a thank-you, a status update, or a question is NOT delivery — ` +
        `that is "promised" (name the new deadline as YYYY-MM-DD ONLY if an email states one) or "unclear". ` +
        `When you cannot tell, say "unclear" — wrongly closing live work costs trust; leaving it open costs nothing.\n` +
        `JSON only: {"verdict":"delivered|promised|unclear","by":"the label of the piece that delivered (E1/C1/T1…) or null","new_due":"YYYY-MM-DD or null","reason":"<one sentence>"}`,
    });
    const v = String(res.json?.verdict ?? '').toLowerCase();
    const reason = String(res.json?.reason ?? '').slice(0, 200);
    let out: FulfillmentVerdict;
    if (v === 'delivered') {
      // The pick is validated against the candidate list; an invented label falls back to the
      // newest email (a delivery is words or attachments first), else the newest evidence.
      const picked = labels.get(String(res.json?.by ?? '').trim().toUpperCase())
        ?? emails[0] ?? [...meetings].sort((a, b) => b.at.localeCompare(a.at))[0];
      out = { verdict: 'delivered', reason, ...(picked?.id ? { by: { type: picked.type, id: picked.id, at: picked.at } } : {}) };
    } else if (v === 'promised') {
      // Re-anchor only on a code-verified future date an EMAIL ITSELF states (same grammar as
      // the expired_on law: the model supplies judgment, the text supplies the fact).
      const nd = String(res.json?.new_due ?? '').slice(0, 10);
      const body = emails.map((c) => c.body).join('\n');
      out = /^\d{4}-\d{2}-\d{2}$/.test(nd) && nd > todayStr && dateStatedInText(body, nd)
        ? { verdict: 'promised', newDue: nd, reason }
        : { verdict: 'promised', reason };
    } else out = { verdict: 'unclear', reason: reason || 'model returned no usable verdict' };
    if (cacheKey) {
      await upsertPlan(client, userId, 'fulfillment', cacheKey.entity, { sig: cacheKey.sig, verdict: out });
    }
    return out;
  } catch (e) {
    // AI outage ≠ fulfillment: the structural candidate stays open and is re-checked next pass —
    // deliberately NOT cached (an outage verdict must not stick).
    console.error('[fulfillment] judge error:', e instanceof Error ? e.message : e);
    return { verdict: 'unclear', reason: 'fulfillment judge unavailable' };
  }
}

/** Per-email clip budget: one candidate keeps the historical 1800 chars; a set shares the window. */
const emailBudget = (candidates: FulfillmentCandidate[]): number => {
  const n = candidates.filter((c) => c.type === 'email').length;
  return n <= 1 ? 1800 : n === 2 ? 1200 : 900;
};

/**
 * The ONE consequence applier both resolvers call for a structurally-resolved commitment candidate.
 * Returns true when the commitment was CLOSED (so callers count/log); a re-anchor or unclear leaves
 * it open (and re-anchoring stamps the new due date + an activity line).
 */
export async function applyFulfillmentVerdict(
  client: SupabaseClient,
  userId: string,
  commitment: { id: string; description: string; due_date?: string | null },
  verdict: FulfillmentVerdict,
  close: () => Promise<boolean>,
): Promise<boolean> {
  if (verdict.verdict === 'delivered') {
    const closed = await close();
    // ── LAW 4 · ONE CONVERSATION, ONE OBLIGATION: a delivery settles the obligation, and the same
    // exchange may be standing on a second thread of the user's other mailbox. The scan is bounded,
    // best-effort and fires only on a REAL close (a promise or an unclear verdict spreads nothing). ──
    if (closed) {
      try {
        const { data: row } = await client.from('commitments').select('thread_id')
          .eq('id', commitment.id).eq('user_id', userId).maybeSingle();
        const threadId = (row?.thread_id as string | null) ?? null;
        if (threadId) {
          const { cascadeConversationSettlement } = await import('@/lib/inbox/conversation-identity');
          await cascadeConversationSettlement(client, userId, {
            threadId, settledAt: new Date().toISOString(), via: 'the deliverable was judged delivered',
          });
        }
      } catch { /* the cascade is an enhancement — this commitment is closed regardless */ }
    }
    return closed;
  }
  if (verdict.verdict === 'promised' && verdict.newDue && verdict.newDue !== commitment.due_date) {
    const nowIso = new Date().toISOString();
    await client.from('commitments')
      .update({ due_date: verdict.newDue, updated_at: nowIso })
      .eq('id', commitment.id).eq('user_id', userId).eq('status', 'open');
    try {
      const { logActivity } = await import('@/lib/activity/log');
      await logActivity(client, userId, {
        type: 'commitment_reanchored',
        title: `New deadline (you promised ${verdict.newDue}): ${commitment.description}`,
        entityType: 'commitment', entityId: commitment.id,
        metadata: { reason: 'promised', newDue: verdict.newDue, auto: true },
      });
    } catch { /* non-fatal */ }
  }
  return false;
}
