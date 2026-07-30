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
import { aiCall } from '@/lib/ai/call';
import { dateStatedInText } from '@/lib/utils/user-time';

export type FulfillmentVerdict = {
  verdict: 'delivered' | 'promised' | 'unclear';
  /** Only on `promised`: a NEW deadline stated in the message itself (code-verified, future-only). */
  newDue?: string;
  reason: string;
};

/**
 * Judge whether the candidate fulfilling MESSAGE actually fulfills the commitment.
 * `fulfillerIsUser` — true when the user owes (their sent message is the candidate), false when the
 * counterparty owes (their reply is the candidate). The same law covers both directions.
 */
export async function judgeCommitmentFulfillment(
  client: SupabaseClient,
  userId: string,
  commitment: { id?: string; description: string; due_date?: string | null },
  message: { id?: string | null; body: string; attachmentCount?: number },
  fulfillerIsUser: boolean,
): Promise<FulfillmentVerdict> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const body = String(message.body ?? '').replace(/\s+/g, ' ').slice(0, 1800);
  if (!body.trim()) return { verdict: 'unclear', reason: 'no message text to judge' };
  // Cache per (commitment, candidate message) — the sweep re-nominates the same candidate every
  // pass; a non-delivered verdict must not re-burn AI every 2h. A NEW candidate message re-judges.
  const cacheKey = commitment.id && message.id ? { entity: `commitment:${commitment.id}`, sig: String(message.id) } : null;
  if (cacheKey) {
    try {
      const { data } = await client.from('item_plans').select('tasks')
        .eq('user_id', userId).eq('kind', 'fulfillment').eq('entity_id', cacheKey.entity).maybeSingle();
      const t = (data?.tasks ?? null) as { sig?: string; verdict?: FulfillmentVerdict } | null;
      if (t?.sig === cacheKey.sig && t.verdict?.verdict) return t.verdict;
    } catch { /* cache is best-effort */ }
  }
  const who = fulfillerIsUser ? 'the user (who owes it)' : 'the counterparty (who owes it)';
  try {
    const res = await aiCall<{ verdict?: string; new_due?: string | null; reason?: string }>({
      userId, supabase: client, shape: { output: 'json' }, temperature: 0, maxTokens: 160,
      source: 'brain_synthesis',
      prompt:
        `Did this message FULFILL the commitment, or merely acknowledge/promise it?\n` +
        `COMMITMENT owed: "${commitment.description}"${commitment.due_date ? ` (due ${commitment.due_date})` : ''}\n` +
        `THE MESSAGE, sent by ${who}:\n"""${body}"""\n` +
        `FACT: the message carries ${message.attachmentCount ?? 0} attachment(s). Today is ${todayStr}.\n` +
        `The law: "delivered" ONLY if the thing owed is actually handed over in/with this message — ` +
        `the substantive answer given, the document attached or linked, the action stated as ALREADY done. ` +
        `If what is owed IS a response/answer and this message substantively responds, that is delivered. ` +
        `If what is owed is a deliverable (report, file, document, artifact, an action to perform), a promise ` +
        `to do it later ("I'll send it by Sunday"), a thank-you, a status update, or a question is NOT delivery — ` +
        `that is "promised" (name the new deadline as YYYY-MM-DD ONLY if the message states one) or "unclear". ` +
        `When you cannot tell, say "unclear" — wrongly closing live work costs trust; leaving it open costs nothing.\n` +
        `JSON only: {"verdict":"delivered|promised|unclear","new_due":"YYYY-MM-DD or null","reason":"<one sentence>"}`,
    });
    const v = String(res.json?.verdict ?? '').toLowerCase();
    const reason = String(res.json?.reason ?? '').slice(0, 200);
    let out: FulfillmentVerdict;
    if (v === 'delivered') out = { verdict: 'delivered', reason };
    else if (v === 'promised') {
      // Re-anchor only on a code-verified future date the MESSAGE ITSELF states (same grammar as
      // the expired_on law: the model supplies judgment, the text supplies the fact).
      const nd = String(res.json?.new_due ?? '').slice(0, 10);
      out = /^\d{4}-\d{2}-\d{2}$/.test(nd) && nd > todayStr && dateStatedInText(body, nd)
        ? { verdict: 'promised', newDue: nd, reason }
        : { verdict: 'promised', reason };
    } else out = { verdict: 'unclear', reason: reason || 'model returned no usable verdict' };
    if (cacheKey) {
      await client.from('item_plans').upsert({
        user_id: userId, kind: 'fulfillment', entity_id: cacheKey.entity,
        tasks: { sig: cacheKey.sig, verdict: out }, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,kind,entity_id' }).then(() => {}, () => {});
    }
    return out;
  } catch (e) {
    // AI outage ≠ fulfillment: the structural candidate stays open and is re-checked next pass —
    // deliberately NOT cached (an outage verdict must not stick).
    console.error('[fulfillment] judge error:', e instanceof Error ? e.message : e);
    return { verdict: 'unclear', reason: 'fulfillment judge unavailable' };
  }
}

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
  if (verdict.verdict === 'delivered') return close();
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
