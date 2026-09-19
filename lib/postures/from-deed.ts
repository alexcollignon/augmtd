// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE POSTURE TAIL (docs/attention-plan.md — A7's last sentence: "Every bulk deed may end with
// 'keep doing this?' → a posture (A8)").
//
// PURE AND DETERMINISTIC, on purpose and by construction. This module composes the offered sentence
// AND the rule primitives from the deed's own facts — the verb and the class — with no model in the
// path. The registry's reasoned parser exists for what a PERSON types in their own words; a deed's
// tail is not that: the user is saying "again, for this exact class", and the class is a thing the
// house already has a word for. Asking a model to re-derive it would be spending a call to
// re-discover something we already know, and inviting it to write a rule nobody said.
//
// IT IS ALSO CLIENT-SAFE (types only from the registry — the registry itself builds an AI client at
// module scope, so a runtime import of it would drag the server graph into the card's bundle). The
// card uses this module to decide whether the tail may be offered at all; the route uses the SAME
// function to compose what it writes. One eligibility table, both sides.
//
// ── THE ELIGIBILITY LAW ─────────────────────────────────────────────────────────────────────────
// An unkeepable promise is worse than no promise. A tail is offered ONLY where both halves hold:
//
//   1 · THE CLASS IS A PROPERTY OF ARRIVING MAIL. The rules engine judges one message as it lands.
//       A class whose membership is a READ-TIME verdict about a thread's history, or about today's
//       calendar, or about a budget that was full this morning, cannot be expressed as a standing
//       rule at all — and a rule that approximates it would act on mail the user never meant.
//   2 · THE CLASS'S OWN ACCOUNT SURVIVES THE POSTURE. The ledger tells the user what each class
//       means. Where that account is "nothing changes if these wait", a standing archive keeps it.
//       Where the account is an ONGOING PROMISE ("watched — you'll hear if anyone asks you
//       something"), a standing deed would quietly cancel the very promise the ledger made, which
//       is a worse lie than never offering.
//
// AND THE VERB MUST EXIST IN THE ENGINE'S VOCABULARY: `archive` and `trash` are real rule outcomes;
// `unsubscribe` is not a thing the rules engine can do (it is a live conversation with a sender's
// list software), and `expire` acts on commitments, which are not mail at all.
//
// A HAND-PICKED deed (no class) is never offered a tail: the user selected five specific messages,
// and "keep doing this" has no honest subject.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { HeldClassId } from '@/lib/home/attention';
import type { BulkDeed, BulkVerb } from '@/lib/deeds/words';
import type { PosturePrimitives } from '@/lib/postures/registry';

/** Why each held class may or may not carry a standing posture. Stated once, read by both sides,
 *  and printed in the report — a table nobody can silently drift from. */
export const POSTURE_ELIGIBILITY: Record<HeldClassId, { offered: boolean; why: string }> = {
  brought_forward: {
    offered: false,
    why: 'membership is today’s calendar adjacency, read at serve time — there is nothing standing to keep, and the class’s deed is a navigation, not a deed.',
  },
  own_outreach: {
    offered: true,
    why: 'the echo floor reads the arriving message against the user’s own outbound sequence — expressible as a standing judgement, and the class’s account ("logged; you’d only slow it down") survives it.',
  },
  judged_quiet: {
    offered: false,
    why: 'membership is a CACHED VERDICT about one thread’s own history ("already answered", "the moment has passed"). Nothing about an arriving message says it; a rule shaped like it would archive live correspondence.',
  },
  bulk_mail: {
    offered: true,
    why: 'newsletters and promotions are a property of the message itself, and the class’s whole account is "nothing changes if these wait".',
  },
  notices: {
    offered: true,
    why: 'an automated notice is readable from the message as it lands, and the class states that no one is waiting on the user.',
  },
  cc_watch: {
    offered: false,
    why: 'expressible (copied-but-not-addressed is a literal condition) but REFUSED: the class’s account is an ongoing promise — "watched, you’ll hear if anyone asks you something" — and a standing archive cancels the watch it just promised.',
  },
  quieter_threads: {
    offered: false,
    why: 'this class is defined by the BUDGET, not by the mail — it is real correspondence that did not make today’s five. A standing rule over it would archive people’s letters.',
  },
};

/** The verbs a posture can actually keep. `unsubscribe` and `expire` are absent by construction —
 *  neither is an outcome the rules engine can perform on arriving mail. */
export const POSTURE_VERBS: BulkVerb[] = ['archive', 'trash'];

/** The engine's own judgement of each offered class, written once. These are `ai_match` strings —
 *  the engine's vocabulary for "a judgement rather than a literal string match". */
const CLASS_MATCH: Partial<Record<HeldClassId, string>> = {
  bulk_mail: 'newsletters, promotions, marketing and other bulk list mail — anything sent to a list rather than written to me',
  own_outreach: 'a reply landing inside an outbound sequence I sent myself — my own outreach answering itself',
  notices: 'an automated notice or system message that nobody expects a reply to',
};

/** The class in the sentence's own words — the subject the user reads back. */
const CLASS_WORDS: Partial<Record<HeldClassId, string>> = {
  bulk_mail: 'newsletters and promotions',
  own_outreach: 'replies to my own outreach',
  notices: 'automated notices',
};

const VERB_WORDS: Record<'archive' | 'trash', string> = { archive: 'Archive', trash: 'Move' };

export type PostureOffer = { sentence: string; ask: string; primitives: PosturePrimitives };
export type PostureOfferResult = { ok: true; offer: PostureOffer } | { ok: false; reason: string };

/**
 * THE OFFER, composed from the deed. Returns the exact sentence that will be stored verbatim as the
 * posture, the one-line ask the card shows, and the primitives the registry's floor will re-validate.
 */
export function postureFromDeed(deed: Pick<BulkDeed, 'verb' | 'classKey'>): PostureOfferResult {
  const verb = deed.verb;
  if (!POSTURE_VERBS.includes(verb)) {
    return { ok: false, reason: verb === 'unsubscribe'
      ? 'Unsubscribing is a conversation with each sender, not something I can keep doing on my own.'
      : 'That one acts on commitments, not on arriving mail — there is no standing version of it.' };
  }
  const cls = deed.classKey;
  if (!cls) return { ok: false, reason: 'That deed was a hand-picked set, so there is no kind of mail for me to keep doing it to.' };
  const rule = POSTURE_ELIGIBILITY[cls];
  if (!rule || !rule.offered) return { ok: false, reason: 'There is no standing version of that one I could actually keep.' };

  const match = CLASS_MATCH[cls];
  const words = CLASS_WORDS[cls];
  if (!match || !words) return { ok: false, reason: 'There is no standing version of that one I could actually keep.' };

  const sentence = verb === 'archive'
    ? `${VERB_WORDS.archive} ${words} as they arrive.`
    : `${VERB_WORDS.trash} ${words} to trash as they arrive.`;

  return {
    ok: true,
    offer: {
      sentence,
      ask: `Keep doing this? I’ll ${verb === 'archive' ? 'archive' : 'move'} ${words}${verb === 'trash' ? ' to trash' : ''} as they arrive.`,
      primitives: {
        trigger: 'received',
        match_mode: 'all',
        conditions: [],
        ai_match: match,
        outcome: verb === 'archive' ? { archive: true } : { trash: true },
      },
    },
  };
}
