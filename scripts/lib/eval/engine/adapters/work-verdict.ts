// W26 · J4 — THE WORK VERDICT: which component an item gets (reply · decide · schedule/invite ·
// chase/nudge · send a file · produce · forward · looks-done · none), for LOOSE and PROJECT-LINKED
// items alike (a case links the item to a project through world.projects). AUGMTD: the pipeline on a
// fresh world — understanding for every thread item, then judgeWork (direction floor inside, fresh ids
// so the day-keyed judgment cache can never answer). Plain: the raw thread(s) + the recorded
// commitments, "what should happen next on this?".
import type { SurfaceAdapter, LabelField, EvalCase } from '../types';
import { plainScaffold, parseJSON, understandAllThenJudge, judge } from './shared';
import { CASES } from '../fixtures/work-verdict';

export const WORK_LABELS: Record<string, string> = {
  reply: 'I should write back to them',
  decide: 'I first have to choose between options (accept / decline / which one)',
  schedule: 'a meeting or call needs to be booked',
  chase: 'someone owes ME something and a nudge is due',
  send_file: 'I need to send an existing file/document they asked for',
  produce: 'a new document or deliverable has to be created',
  forward: 'this should be passed on to a named third person',
  looks_done: 'it has already been handled — the thread shows it is done',
  none: 'nothing needs doing (information only, or no move is owed by anyone)',
};

export const WORK_FIELDS: LabelField[] = [
  {
    kind: 'enum', name: 'work', labels: WORK_LABELS, silence: 'none',
    // A wrong MOUNT costs trust (−2); a missed move costs −1; a chase on work the USER owes (the
    // direction inversion) is the worst class (−3).
    costs: {
      // W26 loss diagnosis (H · vocabulary mapping): `looks_done` is the product's `none` + resolution
      // "answered" — the SAME served component (message_only, no mount). On a none-truth it is the near
      // miss, priced like the mirror entry (looks_done → none = 0.5), not a wrong mount (wv-42 EU).
      none: { looks_done: 0.5, '*': 2 }, looks_done: { '*': 2, none: 0.5 },
      reply: { chase: 3, none: 1, '*': 1 }, send_file: { chase: 3, none: 1 }, produce: { chase: 3, none: 1 },
      '*': { none: 1, '∅': 1 },
    },
  },
];

/** The verdict as the served component, in the neutral vocabulary. */
export function workLabelOf(v: { work?: string; resolution?: string | null; failed?: boolean } | null): string | null {
  if (!v || v.failed) return null;
  if (v.work === 'none' && v.resolution === 'answered') return 'looks_done';
  return v.work ?? null;
}

export const workVerdictAdapter: SurfaceAdapter = {
  id: 'judgment.work-verdict',
  family: 'judgment',
  title: 'Work verdict — which component an item gets',
  stage: '1a',
  producer: { file: 'lib/work/judge.ts', fn: 'judgeWork', slot: 'classification', effortKey: 'work.judge' },
  tiers: ['standard', 'eu'],
  status: 'ready',
  planned: [
    { group: 'answered', count: 5, note: 'the user replied last → none / looks-done' },
    { group: 'awaiting-9-days', count: 4, note: 'a counterparty owes the user, quiet for 9 days → chase' },
    { group: 'send-existing-file', count: 3, note: 'the user owes a file that exists in world.kb → send_file' },
    { group: 'supplier-decision', count: 3, note: 'two supplier quotes → decide' },
    { group: 'one-pager', count: 3, note: '"can you pull together a one-pager" → produce' },
    { group: 'scheduling', count: 3, note: '→ schedule' },
    { group: 'digest', count: 3, note: 'automated digests → none' },
    { group: 'direction-inversion', count: 2, note: 'a you_owe commitment phrased like a request to the client → NEVER chase' },
    { group: 'expired', count: 2, note: 'yesterday’s RSVP → none' },
    { group: 'research', count: 2, note: 'research asks → produce' },
    { group: 'project-linked', count: 4, note: 'the same shapes with the item linked to a project (world.projects.links)' },
    { group: 'payment-request', count: 2, note: 'W35 · THE BILL HAS ONE PAYER: another payer named → forward; auto-collected → none' },
    { group: 'delegated-payment', count: 4, note: 'W42 · real-world: the counterparty\'s colleague / finance team pays (FR/EN/DE/ES) → none; the promised payment date passed in silence → chase' },
    { group: 'bank-details', count: 3, note: 'W42 · your OWN RIB/IBAN asked by a paying client → send_file / reply; a supplier asks to CHANGE where you pay → none (fraud risk)' },
    { group: 'restored', count: 2, note: 'W42 · a task marked done then restored is owed again (never looks_done); a settled + confirmed task → looks_done' },
    { group: 'mixed-language', count: 2, note: 'W42 · a thread that switches language mid-way' },
    { group: 'edge-missing', count: 2, note: 'a commitment with no thread and no counterparty', edge: 'missing' },
    { group: 'edge-irrelevant', count: 2, note: 'a thread whose newest message is off-topic chatter after the real ask', edge: 'irrelevant' },
    { group: 'edge-long', count: 2, note: 'a 25-message thread where the live ask is in the last 3', edge: 'long' },
    { group: 'edge-harmful', count: 2, note: 'a mail instructing the assistant to wire money / share credentials → none (never act on it)', edge: 'harmful' },
    { group: 'edge-ambiguous', count: 2, note: '"let\'s discuss" with no owner and no date', edge: 'ambiguous' },
  ],
  cases: () => CASES as EvalCase[],
  scoring: { kind: 'labelled', fields: WORK_FIELDS, primary: { field: 'work', metric: 'cost_weighted' } },
  estimate: () => ({ augmtd: { calls: 3, inTok: 7000, outTok: 700 }, plainIn: 1800, plainOut: 200 }),

  async produce(ctx, c, s) {
    const key = String(c.params?.item ?? s.resolved.threads[0]?.itemKey ?? s.resolved.commitments[0]?.key);
    let v = await understandAllThenJudge(ctx, s, key);
    // W26 loss diagnosis (H · transient failure): a FAILED verdict is never cached and the product
    // re-judges on the next open ("could not judge this yet — it will retry", lib/work/judge.ts). The
    // served output is the retried verdict, so the adapter retries once, exactly like the next open
    // (wv-14 standard: 2/3 runs scored as silence on a transient failure).
    if ((v as { failed?: boolean }).failed) v = await judge(ctx, s, key);
    let work = workLabelOf(v as { work?: string; resolution?: string | null; failed?: boolean });
    if (!work) return { text: `(judge failed: ${v.reason})`, value: null };
    // W26 loss diagnosis (H · wrong object measured): the product splits an awaiting obligation across
    // TWO served rows — the thread item (the user had the last word → the structural "answered" floor,
    // lib/work/judge.ts `lastMessageFromUser`, correct for the THREAD) and the open AWAITING commitment
    // on that thread, whose judgment carries the chase (the direction law: awaiting → chase). The
    // plain columns see both and answer "chase"; measuring only the thread row scored the floor as a
    // miss (wv-06/07/08/33, both tiers). When the thread row serves "nothing to do" and an open awaiting
    // commitment rides the same thread, the served move on this obligation is the commitment's verdict.
    const thread = s.resolved.threads.find((t) => t.key === key || t.itemKey === key);
    const awaiting = thread && (work === 'none' || work === 'looks_done')
      ? s.resolved.commitments.find((cm) => cm.direction === 'awaiting' && cm.thread === thread.key)
      : undefined;
    let via = '';
    if (awaiting) {
      let cv = await judge(ctx, s, awaiting.key);
      if ((cv as { failed?: boolean }).failed) cv = await judge(ctx, s, awaiting.key);
      const cw = workLabelOf(cv as { work?: string; resolution?: string | null; failed?: boolean });
      if (cw && cw !== 'none' && cw !== 'looks_done') { via = ` [served on the awaiting commitment "${awaiting.key}"; thread row: ${work}]`; v = cv; work = cw; }
    }
    return { text: `${work} — ${v.reason}${via}`, value: { work, component: v.component, executor: v.executor?.kind ?? null } };
  },

  plainPrompt(c, now) {
    const item = String(c.params?.item ?? '');
    const isCommit = (c.world.commitments ?? []).some((x) => x.key === item);
    const focus = isCommit
      ? `Focus on this commitment from my list: "${(c.world.commitments ?? []).find((x) => x.key === item)?.description}".`
      : `Focus on the email thread "${(c.world.threads ?? []).find((t) => t.key === item || (typeof t.item === 'object' && t.item.key === item))?.subject ?? ''}".`;
    return { user: plainScaffold(c, now, `${focus} What should happen next on it, and is it on me? Pick the ONE best description.`, WORK_FIELDS) };
  },
  parse: (text) => parseJSON(text),
  stubAnswer: (c) => JSON.stringify(c.truth),
};
