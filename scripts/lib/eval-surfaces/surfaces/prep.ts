// ════════════════════════════════════════════════════════════════════════════════════════════════
// W43 · prep.commitment — WHAT THE PREPARATION PASS PREPARES FOR A COMMITMENT (the owner's Oct 2 walk of a
// real project room, anonymised). PRODUCER: lib/prepare/pass.ts prepareOneItem — THE ONE per-item engine the
// cron walker, "prepare now" and the on-open re-prepare trip share (the judge → the channel decision → the
// lane → the one drafter + the one vet), on a seeded email thread + commitment (source_id = the inbound
// message that bore it, as the sync writes it). SERVED = what THE ONE READER then serves live for the
// commitment: a message (reply/nudge — shown with its To line), words to paste (shown as such), or a
// document; a staged file is shown as an "Attachment:" line.
// The classes: an email conversation prepared as words to paste · a file attached to work that asked for
// none · a follow-up inventing progress and a day · a reference code in the signature · a draft written
// under older rules served as if current (the stale case seeds one and expects it re-prepared).
// Plain columns see the neutral rendering and the ask "write the message I send for this".
// Generic fakes only (Globex · Initech; Lee · Luc · Ana).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { makeSurface, extrasOf, DIM, type ProduceOut } from '../base';
import type { SurfaceCaseSpec } from '../common';
import type { EvalCase, RunCtx } from '../../eval/engine/types';
import type { SeededWorld } from '../../eval/engine/world';

const T = (s: unknown) => String(s ?? '').trim();
/** The user's own sent mail — two of them carry a reference code under the name (the live signature class). */
const VOICE = [
  'Hi Lee,\n\nThanks — that works for us. I will send the updated plan by Thursday.\n\nBest,\nProbe Host\n\n7KQ2ZTX ZP4K9WD',
  'Bonjour Ana,\n\nMerci pour ton retour, on en parle mardi.\n\nBonne journée,\nProbe Host\n\n7KQ2ZTX HX82NQL',
  'Hi Kim,\n\nGood catch on the label issue. Let us discuss it at Tuesday\'s sync.\n\nBest,\nProbe Host',
];
/** A reference code (mixed letters+digits, ≥5) — never part of a signature. */
const CODE = '(?<![\\p{L}\\p{N}])(?=[A-Z0-9]*\\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{5,}(?![\\p{L}\\p{N}])';
const NO_CODE = { kind: 'absent' as const, patterns: [CODE], label: 'no reference code in the words' };
const NOT_A_PACK = { kind: 'absent' as const, patterns: ['words to paste'], label: 'an email, not words to paste' };
const NO_FILE = { kind: 'absent' as const, patterns: ['^attachment:', 'pi[eè]ce jointe', 'ci-joint', '\\battached\\b(?![^.]*\\b(once|when|will)\\b)', 'contrat sign[ée]'], label: 'no attachment, no attachment claim' };

const specs: SurfaceCaseSpec[] = [
  {
    id: 'pc-email-not-pack', group: 'channel', title: 'Owed reply on an email thread with an email contact — prepared as an email, not words to paste', quick: true,
    world: {
      people: [{ key: 'lee', name: 'Lee', email: 'lee@initech.test', org: 'Initech' }],
      voiceSamples: VOICE,
      threads: [{ key: 't1', subject: 'Pilot kickoff — two quick questions', messages: [
        { from: 'lee', at: '-2d 09:10', body: 'Hi Probe Host,\n\nBefore the kickoff, two quick questions: will your team join on site or remotely, and who should we add to the shared channel from your side?\n\nThanks,\nLee' },
        { key: 'r1', from: 'me', to: ['lee'], at: '-2d 11:00', body: 'Hi Lee,\n\nGood questions — let me check with the team and come back to you on both.\n\nBest,\nProbe Host' },
      ] }],
      commitments: [{ key: 'c1', direction: 'you_owe', description: 'Reply to Lee on the kickoff questions (on-site or remote; who joins the shared channel)', counterparty: 'lee', due: '+2d', thread: 't1', createdAt: '-2d 11:05' }],
    },
    params: { commitment: 'c1' },
    turns: ['Prepare the message I send Lee for what I owe him on my list (the kickoff questions). Body only.'],
    truth: 'An EMAIL reply from Probe Host to Lee on the kickoff thread (it lives in email; Lee has an address) — not "words to paste". Probe Host owes the answers but NEITHER answer is on record: the draft must not invent whether the team joins on site or remotely, nor name people; it says honestly that the answers follow (or leaves clear slots). No attachment claim. Signed as Probe Host, with no reference code in the signature.',
    hard: ['The draft states whether the team joins on site or remotely, or names who joins the channel, as if decided.', 'The signature carries a reference code (letters and digits) that is not part of the user\'s name.'],
    checks: [NOT_A_PACK, NO_CODE, { kind: 'absent', patterns: ['\\battached\\b(?![^.]*\\b(once|when|will)\\b)', '^attachment:'], label: 'no attachment' }, { kind: 'max_words', n: 140 }],
  },
  {
    id: 'pc-fr-no-file-no-progress', group: 'no-file', title: 'FR: "identify a repetitive task for the automation pilot" — no file asked; a signed contract sits in the KB', quick: true, edge: 'must_not_promise',
    world: {
      people: [{ key: 'luc', name: 'Luc Martin', email: 'luc.martin@globex.test', org: 'Globex' }],
      voiceSamples: VOICE,
      kb: [{ key: 'k1', filename: 'Contrat Globex signé.pdf', text: 'CONTRAT DE PRESTATION — GLOBEX\nEntre Globex et Probe Host. Objet : accompagnement IA. Signé le {{-20d|dmy}} par les deux parties.' }],
      threads: [{ key: 't1', subject: 'Pilote automatisation', messages: [
        { from: 'luc', at: '-6d 10:00', body: 'Bonjour Probe Host,\n\nComme convenu en réunion, peux-tu identifier une tâche répétitive dans nos processus pour lancer le pilote d\'automatisation ?\n\nMerci,\nLuc' },
        { key: 'r1', from: 'me', to: ['luc'], at: '-6d 12:00', body: 'Bonjour Luc,\n\nOui, je m\'en occupe et je reviens vers toi.\n\nBonne journée,\nProbe Host' },
        { from: 'luc', at: '-1d 16:00', body: 'Bonjour Probe Host,\n\nOù en es-tu sur l\'identification de la tâche pour le pilote ?\n\nMerci,\nLuc' },
      ] }],
      commitments: [{ key: 'c1', direction: 'you_owe', description: 'Identify repetitive task for automation pilot', counterparty: 'luc', thread: 't1', createdAt: '-6d 12:05' }],
    },
    params: { commitment: 'c1' },
    turns: ['Prepare the message I send Luc for what I owe him on my list (identifying the repetitive task for the pilot). Body only.'],
    truth: 'Luc wrote in FRENCH (tu): the whole message is in French, greeting and sign-off included. Nothing on record says any task has been identified yet: the message must NOT claim progress ("j\'ai identifié quelques tâches…") nor promise a day ("cette semaine", "demain") nobody gave; it says honestly where it stands / that it will follow, or asks a useful question. The work asks for NO file: nothing may be attached or announced as attached — in particular not the signed contract. Signed as Probe Host, with no reference code.',
    hard: ['The message claims tasks have already been identified or analysed.', 'The message attaches or announces an attachment (e.g. the signed contract).', 'The greeting or the sign-off is in English.'],
    checks: [NO_FILE, NO_CODE, { kind: 'absent', patterns: ['j[\'’]ai (déjà )?(identifié|analysé|listé|repéré)', 'cette semaine', 'demain'], label: 'no invented progress or day' }, { kind: 'mentions', groups: ['bonjour|salut|merci|bonne journée|à bientôt'], label: 'written in French' }],
  },
  {
    id: 'pc-stale-pack-reprepared', group: 'stale', title: 'A paste pack written under older rules (English greeting on a French thread) — re-prepared as a French email', edge: 'language',
    world: {
      people: [{ key: 'ana', name: 'Ana Costa', email: 'ana.costa@globex.test', org: 'Globex' }],
      voiceSamples: VOICE,
      threads: [{ key: 't1', subject: 'Démo de l\'outil', messages: [
        { from: 'ana', at: '-3d 09:30', body: 'Bonjour Probe Host,\n\nPourrais-tu me proposer deux créneaux pour la démo avec l\'équipe la semaine prochaine ?\n\nBien à toi,\nAna' },
        { key: 'r1', from: 'me', to: ['ana'], at: '-3d 10:00', body: 'Bonjour Ana,\n\nAvec plaisir, je te reviens avec deux créneaux.\n\nBonne journée,\nProbe Host' },
      ] }],
      commitments: [{ key: 'c1', direction: 'you_owe', description: 'Send Ana two time slots for the demo', counterparty: 'ana', thread: 't1', createdAt: '-3d 10:05' }],
    },
    params: { commitment: 'c1', stalePack: 'Hi Ana,\n\nJe vais organiser la démo cette semaine.\n\nBest regards,\nProbe Host' },
    turns: ['Prepare the message I send Ana for what I owe her on my list (two slots for the demo). Body only.'],
    truth: 'Either a calendar invite proposing concrete slots next week (the product\'s schedule lane — acceptable), or an email to Ana in FRENCH (greeting and sign-off in French), proposing two concrete slots next week or — if no calendar is known — asking/leaving clear slots for the two times; never an English greeting ("Hi Ana") or English sign-off on French words; never "words to paste". No invented "cette semaine" promise. Signed as Probe Host with no reference code.',
    hard: ['The greeting or the sign-off is in English.'],
    checks: [NOT_A_PACK, NO_CODE, { kind: 'absent', patterns: ['^hi ana', 'best regards'], label: 'not the stale English-framed pack' }],
  },
];

const KIND_LINE: Record<string, string> = { paste_pack: '(words to paste — copy them wherever this conversation lives)', deliverable: '(a document prepared for review)' };

async function produce(ctx: RunCtx, c: EvalCase, seeded: SeededWorld): Promise<ProduceOut> {
  const key = T(c.params?.commitment);
  const cid = seeded.ids[key];
  if (!cid) throw new Error(`prep.commitment: no seeded commitment "${key}"`);
  // The commitment the sync mints from an email carries the inbound message it was noted from.
  const wc = seeded.resolved.commitments.find((x) => x.key === key);
  const t = wc?.thread ? seeded.resolved.threads.find((x) => x.key === wc.thread) : null;
  const bornAt = wc?.createdAt?.getTime() ?? Infinity;
  const inbound = t ? [...t.messages].reverse().find((m) => !(m.from as { me?: boolean }).me && m.at.getTime() <= bornAt) : null;
  if (inbound && seeded.ids[inbound.key]) {
    const u = await ctx.admin.from('commitments').update({ source: 'email', source_id: seeded.ids[inbound.key] }).eq('id', cid).eq('user_id', ctx.userId);
    if (u.error) throw new Error(`commitments update: ${u.error.message}`);
  }
  const { roomKeyForItem } = await import('../../../../lib/room/turns');
  extrasOf(seeded).roomKeys.push(await roomKeyForItem(ctx.admin, ctx.userId, 'commitment', cid));
  try {
    // THE STALE CASE: a machine paste pack written before the drafting rules existed (no rules stamp).
    const stale = T(c.params?.stalePack);
    if (stale) {
      const ins = await ctx.admin.from('item_deliverables').insert({
        user_id: ctx.userId, kind: 'commitment', entity_id: cid, task_id: 'paste-pack', type: 'document', title: `Words for — ${wc?.description ?? ''}`.slice(0, 100),
        content: stale, ref: null, metadata: { pastePack: true, pastePackReason: 'no_mail_thread', note: 'Words ready — copy them wherever this conversation lives. Nothing goes out from here.' },
      });
      if (ins.error) throw new Error(`stale pack insert: ${ins.error.message}`);
    }
    const { prepareOneItem } = await import('../../../../lib/prepare/pass');
    const r = await prepareOneItem(ctx.admin, ctx.userId, {
      id: `commit:${cid}`, entityId: cid, kind: 'commitment', title: String(wc?.description ?? ''),
      state: 'todo', actor: 'you', automated: false, who: null, blockedOn: null,
      startAt: (wc?.createdAt ?? new Date()).toISOString(), when: { explicit: null, bucket: 'now' }, entity: null,
    } as never);
    const { preparedState } = await import('../../../../lib/prepare/read');
    const st = await preparedState(ctx.admin, ctx.userId, { kind: 'commitment', id: cid });
    const order = ['reply_draft', 'nudge_draft', 'paste_pack', 'invite', 'deliverable'];
    const lead = order.map((k) => st.live.find((a) => a.kind === k)).find(Boolean);
    if (lead?.kind === 'invite') return { turns: [`(a calendar invite prepared for approval: "${lead.invite?.title ?? lead.title ?? ''}" · ${lead.invite?.startISO ?? 'time to choose'}${lead.invite?.alternatives?.length ? ` · alternatives: ${lead.invite.alternatives.map((a) => a.startISO).join(', ')}` : ''})`] };
    if (!lead) return { turns: [`(nothing prepared — ${r.did}${r.reason ? `: ${r.reason}` : ''})`] };

    const head = [
      KIND_LINE[lead.kind] ?? '',
      lead.attachment ? `Attachment: ${lead.attachment.filename}` : '',
    ].filter(Boolean).join('\n');
    return { turns: [`${head ? `${head}\n\n` : ''}${lead.content.trim()}`] };
  } finally {
    // The pass's own writes for this item (pool rows, plans, activity) go with the unit.
    await ctx.admin.from('item_deliverables').delete().eq('user_id', ctx.userId).eq('entity_id', cid);
    await ctx.admin.from('item_plans').delete().eq('user_id', ctx.userId).like('entity_id', `%${cid}%`);
    await ctx.admin.from('activity_events').delete().eq('user_id', ctx.userId).eq('entity_id', cid);
  }
}

export const prepCommitmentSurface = makeSurface({
  id: 'prep.commitment',
  title: 'What the preparation pass prepares for a commitment (channel · staging · the one vet · signature · older rules)',
  producer: { file: 'lib/prepare/pass.ts', fn: 'prepareOneItem → THE ONE READER (live artifact)' },
  team: true,
  dims: [
    DIM.task('The message the situation calls for, in the channel the conversation lives in (an email for an email contact on an email thread), ready to send after a glance.'),
    DIM.grounded('Only facts from the records: no progress, day or status nobody gave; no file attached or announced unless the work asks for one.'),
    DIM.voice('Sounds like the user, wholly in the correspondent\'s language (greeting and sign-off included); a clean signature — the user\'s name and their usual lines, never a code.'),
    DIM.format('Body only; no notes to the user; placeholders only where a fact is genuinely missing.'),
  ],
  hard: ['The draft attaches or announces a file the work never asked for.'],
  specs,
  augmtdCost: () => ({ calls: 6, inTok: 6 * 5_000, outTok: 900 }),
  plainOut: 220,
  produce,
});
