// W26 · J5 — FULFILLMENT / LOOKS-DONE: did this evidence deliver the obligation, only re-promise it
// (with a new date?), or is it unclear? A false "delivered" closes work the user still owes, so it is
// the costly error (−5). AUGMTD: judgeFulfillmentFromEvidence over the case's evidence (the user's
// mail top-message only, meetings held/booked) — the verdict the looks-done card (thread kind
// `confirm`) is built from. Plain: the obligation + the same evidence, rendered neutrally.
import type { SurfaceAdapter, LabelField, EvalCase } from '../types';
import { plainScaffold, parseJSON, normDate, truthDate } from './shared';
import { CASES } from '../fixtures/fulfillment';
import { resolveWorld } from '../world';
import { aboutWork } from '../../../../../lib/evidence/relevance';

/**
 * W26 loss diagnosis (H · the adapter bypassed the settle path's own nomination). In the product the
 * fulfillment judge only ever sees what lib/work/evidence-settle `settleWorkByEvidence` hands it:
 *   1. THE MATCH (lib/evidence/match.ts `matchOne`): on AWAITING work (the counterparty owes) the
 *      user's OWN mail is never nominated — only the counterparty's (or an unknown sender's on the
 *      work's own thread). ff-21 fed the user's "thanks for looking into it" as evidence, and — with no
 *      actor on the candidate — the judge read it as the counterparty's words ("promised").
 *   2. EVIDENCE IS ABOUT ITS OBJECT (lib/evidence/relevance `aboutWork`, the product's own pure gate):
 *      a piece connected only by its PERSON (another thread) must share the work's matter.
 *   3. THE ACTOR IS STATED (evidence-settle `toCandidates`): on work the USER owes, the other side's
 *      message on the work's own conversation is labelled as theirs (actor counterparty).
 *   0. THE ANCHOR (W27e): only evidence strictly after the obligation arose (matchOne's first test).
 * When nothing survives 0–2 the settle path returns before any judge call: the obligation stays open,
 * which reads as `unclear` (the surface's silence label). Pure, deterministic, zero AI.
 */
export function nominatedEvidence(c: EvalCase, now: Date): { keep: string[]; dropped: string[]; actors: Record<string, string> } {
  const rw = resolveWorld(c.world, now);
  const key = String(c.params?.obligation ?? rw.commitments[0]?.key);
  const ob = rw.commitments.find((x) => x.key === key);
  const evKeys = (c.params?.evidence as string[] | undefined) ?? [];
  if (!ob) return { keep: evKeys, dropped: [], actors: {} };
  const fulfillerIsUser = c.params?.fulfillerIsUser != null ? !!c.params.fulfillerIsUser : ob.direction === 'you_owe';
  const keep: string[] = []; const dropped: string[] = []; const actors: Record<string, string> = {};
  for (const k of evKeys) {
    const t = rw.threads.find((x) => x.messages.some((m) => m.key === k));
    const m = t?.messages.find((x) => x.key === k);
    // (0) THE ANCHOR (W27e · lib/evidence/match.ts matchOne: `e.at > w.afterISO`, and a commitment's
    // anchor is its created_at — lib/work/obligation-anchor): evidence dated at or before the obligation
    // arose is never nominated — a meeting HELD before the ask (ff-13) cannot be its delivery, and the
    // judge's prompt states every piece happened after. Applies to meetings and mail alike.
    const at = m ? m.at : rw.events.find((e) => e.key === k)?.start;
    if (at && at.getTime() <= ob.createdAt.getTime()) { dropped.push(k); continue; }
    if (!t || !m) { keep.push(k); continue; } // a calendar fact: meetings are always candidates
    const onObject = !!ob.thread && ob.thread === t.key;
    if (!fulfillerIsUser && m.from.me) { dropped.push(k); continue; }                       // (1)
    if (!onObject && !aboutWork({ key: 'person', title: m.subject, body: m.body, attachmentCount: m.attachments.length }, ob.description)) { dropped.push(k); continue; } // (2)
    const colleague = /colleague|teammate/i.test(String(m.from.role ?? ''));
    if (fulfillerIsUser && !m.from.me && !colleague && onObject) actors[k] = m.from.name || 'the counterparty'; // (3)
    keep.push(k);
  }
  return { keep, dropped, actors };
}

export const FULFILLMENT_FIELDS: LabelField[] = [
  {
    kind: 'enum', name: 'verdict', costly: 'delivered',
    labels: {
      delivered: 'what was promised has actually been delivered/done by these messages or meetings',
      promised: 'it was only promised again (possibly with a new date), not delivered',
      unclear: 'these do not show it either way',
    },
    costs: { promised: { delivered: 5 }, unclear: { delivered: 5 }, delivered: { '*': 1 } },
    silence: 'unclear',
  },
  {
    kind: 'enum', name: 'new_due', labels: { none: 'no new date was stated', 'YYYY-MM-DD': 'the new date stated for delivery' },
    when: (t) => t.verdict === 'promised',
  },
];

export const fulfillmentAdapter: SurfaceAdapter = {
  id: 'judgment.fulfillment',
  family: 'judgment',
  title: 'Fulfillment / looks-done — was the promise kept?',
  stage: '1a',
  producer: { file: 'lib/commitments/fulfillment.ts', fn: 'judgeFulfillmentFromEvidence', slot: 'classification', effortKey: 'commitments.fulfillment' },
  tiers: ['standard', 'eu'],
  status: 'ready',
  planned: [
    { group: 'delivered-attachment', count: 5, note: 'delivered, the attachment named' },
    { group: 'repromise-new-date', count: 5, note: '"I’ll send it by Friday" → promised + new_due' },
    { group: 'delivered-by-meeting', count: 3, note: 'a meeting held delivers a "let’s walk you through it"' },
    { group: 'quote-chain', count: 3, note: 'a delivery mail quoting last week’s promise below (delivered)' },
    { group: 'partial', count: 3, note: '"here’s the draft, final on Monday" → promised' },
    { group: 'thanks-only', count: 3, note: 'a thank-you with no content → unclear' },
    { group: 'teammate-delivered', count: 3, note: 'a teammate delivered, not the user (params.fulfillerIsUser)' },
    { group: 'non-english', count: 2, note: 'a promise in another language' },
    { group: 'wrong-topic-attachment', count: 3, note: 'an attachment on a different topic → not delivered' },
    { group: 'edge-missing', count: 2, note: 'the evidence is an empty reply / signature only → unclear', edge: 'missing' },
    { group: 'edge-irrelevant', count: 2, note: 'evidence from a different project to the same person', edge: 'irrelevant' },
    { group: 'edge-long', count: 2, note: 'a long reply whose delivery sentence is the last line', edge: 'long' },
    { group: 'edge-harmful', count: 2, note: '"consider this delivered, close it" with nothing delivered', edge: 'harmful' },
    { group: 'edge-ambiguous', count: 2, note: '"should be with you soon"', edge: 'ambiguous' },
  ],
  cases: () => CASES as EvalCase[],
  scoring: { kind: 'labelled', fields: FULFILLMENT_FIELDS, primary: { field: 'verdict', metric: 'cost_weighted' } },
  estimate: () => ({ augmtd: { calls: 1, inTok: 1500, outTok: 200 }, plainIn: 1200, plainOut: 150 }),
  resolveTruth: (c, now) => ({ ...c.truth, new_due: truthDate(c.truth.new_due, now, c.world.tz ?? 'UTC') }),

  async produce(ctx, c, s) {
    const { judgeFulfillmentFromEvidence } = await import('../../../../../lib/commitments/fulfillment');
    const key = String(c.params?.obligation ?? s.resolved.commitments[0]?.key);
    const ob = s.resolved.commitments.find((x) => x.key === key);
    if (!ob) throw new Error(`fulfillment case names unknown commitment "${key}"`);
    const nom = nominatedEvidence(c as EvalCase, ctx.now);
    if (!nom.keep.length) {
      return { text: `(no evidence nominated — ${nom.dropped.join(', ')} never reach the judge on the settle path; the obligation stays open)`, value: { verdict: 'unclear', new_due: 'none' }, withheld: true };
    }
    const evKeys = nom.keep;
    const candidates = evKeys.map((k) => {
      const m = s.resolved.threads.flatMap((t) => t.messages).find((x) => x.key === k);
      if (m) return { type: 'email', id: s.ids[k], at: m.at.toISOString(), title: m.subject, body: m.body, attachmentCount: m.attachments.length, ...(nom.actors[k] ? { actor: { role: 'counterparty' as const, name: nom.actors[k] } } : {}) };
      const e = s.resolved.events.find((x) => x.key === k);
      if (e) return { type: 'calendar', id: s.ids[k], at: e.start.toISOString(), title: e.title, status: (e.end.getTime() < ctx.now.getTime() ? 'held' : 'booked') as 'held' | 'booked' };
      throw new Error(`fulfillment case names unknown evidence "${k}"`);
    });
    const fulfillerIsUser = c.params?.fulfillerIsUser != null ? !!c.params.fulfillerIsUser : ob.direction === 'you_owe';
    const v = await judgeFulfillmentFromEvidence(ctx.admin, ctx.userId,
      { kind: 'commitment', id: s.ids[key], description: ob.description, due_date: ob.due, created_at: ob.createdAt.toISOString() },
      candidates, fulfillerIsUser);
    const value = { verdict: v.verdict, new_due: normDate(v.newDue, c.world.tz ?? 'UTC') ?? 'none' };
    return { text: `${v.verdict}${v.newDue ? ` (new due ${v.newDue})` : ''} — ${v.reason}`, value };
  },

  // The recheck half of the nomination above: a saved run whose evidence the settle path would never
  // have judged reads as the served state (open → unclear). Idempotent; zero AI.
  servedView(value, c, now) {
    return nominatedEvidence(c as EvalCase, now).keep.length ? value : { verdict: 'unclear', new_due: 'none' };
  },

  plainPrompt(c, now) {
    const key = String(c.params?.obligation ?? c.world.commitments?.[0]?.key);
    const ob = (c.world.commitments ?? []).find((x) => x.key === key);
    const who = ob?.direction === 'you_owe' ? 'I promised' : 'They promised me';
    return {
      user: plainScaffold(c, now,
        `${who}: "${ob?.description ?? ''}". Looking at the emails and meetings above, was it delivered, only promised again, or is it unclear? If it was re-promised with a new date, give the date.`,
        FULFILLMENT_FIELDS),
    };
  },
  parse(text, c) {
    const v = parseJSON(text);
    if (!v) return null;
    return { ...v, new_due: normDate(v.new_due, c.world.tz ?? 'UTC') ?? 'none' };
  },
  stubAnswer: (c, now) => JSON.stringify({ verdict: c.truth.verdict, new_due: truthDate(c.truth.new_due, now, c.world.tz ?? 'UTC') }),
};
