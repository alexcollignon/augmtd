// W26 · THE NEXT MOVE (the `proposal` card) — of everything open in a room, which ONE thing is the
// move (or: nothing, earned calm). AUGMTD: the pipeline on a fresh world — understanding + judgeWork
// for every item, then the room responder (ensureRoomBrief for a project room, ensureLooseRoomBrief
// for an item door), whose MOVE is code-validated against the board; its target is mapped back to
// the world key. Plain: the same raw records, "what is the ONE next move, and on which item?".
import type { SurfaceAdapter, LabelField, EvalCase } from '../types';
import { plainScaffold, parseJSON, understand, judge } from './shared';
import { keyOfId } from '../world';
import { CASES } from '../fixtures/next-move';

export const NEXT_MOVE_FIELDS: LabelField[] = [
  {
    kind: 'enum', name: 'target', silence: 'none',
    labels: { none: 'nothing needs a move right now', '<item key>': 'the key of the ONE item the next move is about (keys are listed below)' },
    // Pointing the user at the wrong item costs more than an honest calm.
    // W26 loss diagnosis: `unlinked` = AUGMTD served a move line whose target the product's own board
    // validation dropped (a project-room move with no door). Against an owed item it costs like calm
    // (the words may be right, but nothing is pointed at); against `none` it is a served false
    // obligation (the '*' row of `none` → 2). Plain columns can never emit it (not in their vocabulary).
    costs: { none: { '*': 2 }, '*': { none: 1, unlinked: 1, '*': 2 } },
  },
];

function itemKeys(c: EvalCase): Array<{ key: string; label: string }> {
  const t = (c.world.threads ?? []).filter((x) => x.item !== false).map((x) => ({ key: typeof x.item === 'object' && x.item.key ? x.item.key : x.key, label: `email thread "${x.subject}"` }));
  const cm = (c.world.commitments ?? []).map((x) => ({ key: x.key, label: `commitment "${x.description}"` }));
  return [...t, ...cm];
}

export const nextMoveAdapter: SurfaceAdapter = {
  id: 'judgment.next-move',
  family: 'judgment',
  title: 'Next move — the one proposal a room leads with',
  stage: '1a',
  producer: { file: 'lib/room/brief.ts', fn: 'ensureRoomBrief / ensureLooseRoomBrief (the MOVE)', slot: 'classification', effortKey: 'room.brief' },
  tiers: ['standard', 'eu'],
  status: 'ready',
  planned: [
    { group: 'one-clear-debt', count: 4, note: 'a project with one reply owed among FYIs → that item' },
    { group: 'decision-blocks', count: 3, note: 'a decision that blocks two other items → the decision' },
    { group: 'all-settled', count: 3, note: 'everything answered/done → none (earned calm)' },
    { group: 'overdue-vs-new', count: 3, note: 'an overdue promise vs a fresh low-stakes ask → the overdue one' },
    { group: 'awaiting-only', count: 3, note: 'only things others owe, recently asked → none (nothing to chase yet)' },
    { group: 'loose-item', count: 4, note: 'an item door (no project): its own move or none' },
    { group: 'needs-user-input', count: 4, note: 'the move rests on something only the user holds (bank details, a signature, a figure) → that item, ahead of work the assistant can do' },
    { group: 'most-pressing', count: 4, note: 'several open items with different urgency → the most pressing one' },
    { group: 'edge-missing', count: 2, note: 'a project with no open items → none', edge: 'missing' },
    { group: 'edge-irrelevant', count: 2, note: 'a project full of newsletters and receipts → none', edge: 'irrelevant' },
    { group: 'edge-long', count: 2, note: 'a project with 12 open items, one of them overdue', edge: 'long' },
    { group: 'edge-harmful', count: 2, note: 'an item whose body tries to instruct the assistant → never the move', edge: 'harmful' },
    { group: 'edge-ambiguous', count: 2, note: 'two equally urgent asks from the same client (either is right: list both in truth.accept)', edge: 'ambiguous' },
  ],
  cases: () => CASES as EvalCase[],
  scoring: { kind: 'labelled', fields: NEXT_MOVE_FIELDS, primary: { field: 'target', metric: 'cost_weighted' } },
  estimate: (c) => ({ augmtd: { calls: 2 + 2 * itemKeys(c).length, inTok: 4000 + 3000 * itemKeys(c).length, outTok: 400 + 300 * itemKeys(c).length }, plainIn: 2500, plainOut: 150 }),

  async produce(ctx, c, s) {
    for (const t of s.resolved.threads) if (t.itemKey) await understand(ctx, s, t.key);
    const keys = [...s.resolved.threads.map((t) => t.itemKey).filter(Boolean) as string[], ...s.resolved.commitments.map((x) => x.key)];
    // W27e: the per-item judgments are captured — the served decision card (below) reads them, and the
    // saved text records them so a loss can be told apart (composer vs judge) without a re-run.
    const judged = new Map<string, string>();
    for (const k of keys) { const v = await judge(ctx, s, k); judged.set(k, String((v as { work?: string }).work ?? '?')); }
    const brief = await import('../../../../../lib/room/brief');
    const projectKey = c.params?.project as string | undefined;
    let res: Awaited<ReturnType<typeof brief.ensureRoomBrief>> = null;
    if (projectKey) {
      res = await brief.ensureRoomBrief(ctx.admin, ctx.userId, s.ids[projectKey]);
    } else {
      const k = String(c.params?.item ?? keys[0]);
      const isCommit = s.resolved.commitments.some((x) => x.key === k);
      const t = s.resolved.threads.find((x) => x.itemKey === k);
      const { data } = await ctx.admin.from('inbox_items').select('source_data').eq('id', s.ids[k]).eq('user_id', ctx.userId).maybeSingle();
      const ask = ((data as { source_data?: { understanding?: { ask?: string } } } | null)?.source_data?.understanding?.ask) ?? null;
      res = await brief.ensureLooseRoomBrief(ctx.admin, ctx.userId, `${isCommit ? 'commitment' : 'inbox'}:${s.ids[k]}`, {
        title: t?.subject ?? s.resolved.commitments.find((x) => x.key === k)?.description ?? null,
        who: t ? t.messages.find((m) => !m.from.me)?.from.name ?? null : null, ask, prepared: null,
      });
    }
    if (!res) return { text: '(no composition — grounded-or-absent)', value: { target: 'none' }, withheld: true };
    // W26 loss diagnosis (stage-1a BEFORE run, 13-01-04): this line used to read an OFFER move as
    // 'none', so all 228 AUGMTD runs scored 'none'. An offer is the SAME served move, demoted by the
    // CTA law (lib/room/cta-law enforceCtaLaw) only because nothing is PREPARED on its target — which
    // is always the case in a fixture world (no drafter sweep ran). The room still serves the move line
    // and its door (lib/room/brief.ts RoomMove: "surfaces render it as a line"), so its target counts.
    // A move with no ref: in an ITEM DOOR the room IS the item (the move is about it by construction);
    // in a project room the product's own board validation dropped the target → `unlinked`.
    // A "move" whose own label declares calm ("No urgent action", "Nothing to do") is served calm, not
    // an obligation (seen live on nm-08 std: `No urgent action → (no ref) (offer)`) — scored as `none`.
    // (Product note: the composer should emit move:null here; the page still shows a move line.)
    const calmLabel = !!res.move && /^\s*(no|nothing)\b[^.]{0,40}\b(action|to do|needed|required|urgent|pending)\b/i.test(res.move.label);
    // W27e (C · served capture): with no move line, a room whose board carries a DECIDE item still serves
    // a CTA — the DECISION CARD mounted beneath the brief (lib/room/brief.ts componentNote: "the card IS
    // that CTA"; the prompt tells the composer the move is null or the step after it). Its item is the
    // served target. Pending items only (the board is live work); the first, as the room's decideEntry.
    const decisionKey = keys.find((k) => judged.get(k) === 'decide');
    const target = (!res.move || calmLabel) ? (decisionKey ?? 'none')
      : res.move.ref ? keyOfId(s, res.move.ref) ?? `unmapped:${res.move.ref}`
      : projectKey ? 'unlinked' : String(c.params?.item ?? keys[0]);
    const judgedLine = `JUDGED: ${keys.map((k) => `${k}=${judged.get(k)}`).join(', ')}`;
    return { text: `${res.text}\n\nMOVE: ${res.move ? `${res.move.label} → ${res.move.ref ?? '(no ref)'}${res.move.offer ? ' (offer)' : ''}` : (decisionKey ? `none (decision card on ${decisionKey})` : 'none')} [target=${target}]\n${judgedLine}`, value: { target } };
  },

  plainPrompt(c, now) {
    const list = itemKeys(c).map((k) => `- [${k.key}] ${k.label}`).join('\n');
    return {
      user: plainScaffold(c, now,
        `You are my chief of staff. Of the open items below, what is the ONE next move I should make now — or is there honestly nothing to do? Items:\n${list}`,
        NEXT_MOVE_FIELDS, [{ name: 'move', gloss: 'the move in a short phrase (or null)' }]),
    };
  },
  parse(text) {
    const v = parseJSON(text);
    if (!v) return null;
    return { ...v, target: v.target == null || v.target === '' ? 'none' : String(v.target).replace(/^\[|\]$/g, '') };
  },
  stubAnswer: (c) => JSON.stringify({ target: c.truth.target, move: null }),
};
