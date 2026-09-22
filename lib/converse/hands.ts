// ════════════════════════════════════════════════════════════════════════════════════════════════
// HANDS FOR THE SCOPE — THE OFFER LAW + THE REPLY-TARGET MATCHER (Sep 21, a live pilot incident)
//
// WHAT HAPPENED. The user pasted a contact's email into the Home chat and asked for a reply built
// around their free time. The assistant read the calendar, then offered: "would you like me to
// offer both options to <them>?" The user said "yes please". The answer came back: "I can't
// prepare a forward from this view. Could you let me know how you'd like to reply…" — and re-asked
// the question it had just asked.
//
// THREE ROOT CAUSES, THREE LAWS:
//
//   1. NO HANDS. From the Home scope NOTHING drafts a reply. The model reached for the nearest
//      verb it could see (`prepare_forward`), whose dispatcher resolves an item/entity scope and
//      `return null`s for the Home — a SILENT null, handed back as an empty tool result the model
//      then papered over in prose. Hence `draft_reply` (below) and THE NULL IS NEVER SILENT: an
//      unavailable action comes back as an explicit line naming what IS available.
//
//   2. THE OFFER LAW. The assistant may only OFFER what a tool in the CURRENT scope can perform.
//      The capability block that states this is DERIVED from the very toolDefs the loop is handed
//      (after the workspace-feature filter), so it can never drift from the hands the model holds —
//      the same reason the router's command list is derived from the registry slice.
//
//   3. THE FORWARD-MOTION LAW (CLAUDE.md): an affirmation of the assistant's OWN offer is a
//      go-ahead, and a go-ahead EXECUTES. It is never answered by re-asking the question that
//      earned it. Prompt-side the directive says so; code-side `repeatsTheQuestion` catches the
//      failure deterministically and buys exactly one corrective retry.
//
// The matcher is deterministic FIRST and the ladder is the house grammar: one confident match acts,
// several plausible ones REFUSE BY LISTING, none falls through to a standalone draft.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { GENERIC_WORK_WORDS } from '@/lib/entities/recognize';
import { topMessageOf } from '@/lib/inbox/top-message';

// ── THE OFFER LAW ────────────────────────────────────────────────────────────────────────────────

/** The one email shape this module reads — the platform's existing EMAIL_RE, restated locally so
 *  the matcher stays a pure module (the punctuation-tolerant form; see the B5 repair). */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** The first sentence of a tool's description — the capability as the user would hear it. */
const blurbOf = (d: string): string => {
  const s = String(d || '').trim().split(/(?<=[.!?])\s/)[0] ?? '';
  return s.length > 180 ? `${s.slice(0, 177)}…` : s;
};

/** THE CAPABILITY BLOCK — derived, never hand-written. Feed it the SAME toolDefs the loop holds
 *  (post feature-filter) and the list is exactly the hands available in this conversation. */
export function renderOfferLaw(toolDefs: ReadonlyArray<{ name: string; description?: string }>): string {
  const lines = toolDefs.map((d) => `- ${d.name}: ${blurbOf(d.description ?? '')}`).join('\n');
  return (
    `WHAT YOU CAN ACTUALLY DO IN THIS CONVERSATION (the complete list — it is derived from the ` +
    `tools you hold, so nothing outside it exists here):\n${lines}\n` +
    `THE OFFER LAW: never offer, propose, promise or ask permission for an action that is not on ` +
    `that list. If the user needs something outside it, say plainly what you CAN do instead and ` +
    `do that. And when you DO offer something on the list and the user agrees — "yes", "please ` +
    `do", "go ahead", or the same in any language — CALL THE TOOL immediately with the specifics ` +
    `already stated in this conversation. Never answer an agreement by re-asking what you just ` +
    `asked: the agreement is the answer.`
  );
}

/** THE NULL IS NEVER SILENT — what an unavailable/unreachable tool call hands back to the model. */
export function unavailableToolResult(
  tool: string, toolDefs: ReadonlyArray<{ name: string }>,
): { error: string; message: string } {
  const others = toolDefs.map((d) => d.name).filter((n) => n !== tool);
  return {
    error: 'not_available_here',
    message:
      `"${tool}" cannot run from this view — nothing happened. The actions available here are: ` +
      `${others.join(', ')}. Tell the user plainly what you can do instead and do it; do not ` +
      `describe this action as if it had run, and do not re-ask a question you have already asked.`,
  };
}

// ── THE FORWARD-MOTION LAW, deterministically ────────────────────────────────────────────────────

/** Affirmations in the languages the platform serves (EN/PT/ES/DE/FR). Whole-utterance shapes only:
 *  a bare agreement, optionally softened. A sentence that goes on to say something else is not a
 *  pure affirmation and never takes this path. */
const AFFIRMATION_RE =
  /^\s*(?:yes|yeah|yep|sure|ok|okay|please|go ahead|do it|sounds good|perfect|great|sim|claro|pode ser|por favor|vamos|sí|si|vale|ja|bitte|gerne|mach das|oui|volontiers|d'accord|vas-y)\b[\s,.!]*(?:please|do|go ahead|sounds good|por favor|faz isso|por favor faz|bitte|gerne|s'il te pla[îi]t|s'il vous pla[îi]t|thanks|obrigad[oa]|danke|merci)?[\s,.!]*$/i;

export const isAffirmation = (text: string): boolean =>
  !!text && text.trim().length <= 40 && AFFIRMATION_RE.test(text.trim());

/** Did the previous assistant turn END in an offer? Structural: its last sentence is a question.
 *  (An offer is the only reason a chief-of-staff turn ends in a question mark; we deliberately do
 *  not keyword-match offer verbs — that list would be a language trap.) */
export const endsInAnOffer = (assistantText: string): boolean =>
  /\?\s*$/.test(String(assistantText || '').trim());

const wordsOf = (s: string) =>
  String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter((t) => t.length >= 3);

/** The last question in a turn — the sentence the user was answering. */
const lastQuestion = (s: string): string => {
  const qs = String(s || '').split(/(?<=[.!?])\s+/).filter((x) => x.trim().endsWith('?'));
  return qs.length ? qs[qs.length - 1] : '';
};

/** Does `now` re-ask the question `before` already asked? Jaccard over the two question sentences —
 *  high bar, because a WRONG positive costs a needless second model call and a right one rescues a
 *  dead loop. Pure and testable. */
export function repeatsTheQuestion(before: string, now: string): boolean {
  const a = new Set(wordsOf(lastQuestion(before)));
  const b = new Set(wordsOf(lastQuestion(now)));
  if (a.size < 3 || b.size < 3) return false;
  let shared = 0;
  for (const t of b) if (a.has(t)) shared++;
  const union = new Set([...a, ...b]).size;
  // 0.5 of the UNION is already a very close paraphrase of a question (measured against the
  // incident's own pair); the cost of a false positive is one extra model call, the cost of a
  // false negative is the dead loop this exists to break.
  return shared / union >= 0.5;
}

/** The directive handed to the model when an affirmation lands on a standing offer. */
export const FORWARD_MOTION_DIRECTIVE =
  'THE USER HAS JUST AGREED TO WHAT YOU OFFERED IN YOUR PREVIOUS TURN. That agreement IS the ' +
  'instruction: carry the offered action out NOW, using the specifics already stated in this ' +
  'conversation, by calling the tool that performs it. Do not re-ask what you just asked, do not ' +
  'ask for details the conversation already contains, and do not describe the action instead of ' +
  'taking it. If the action turns out to be one you cannot perform here, say so in one sentence ' +
  'and do the nearest thing you CAN do.';

// ── THE REPLY-TARGET MATCHER ─────────────────────────────────────────────────────────────────────

export type ReplyCandidate = {
  id: string;
  title: string;
  fromName: string;
  fromAddress: string;
  subject: string;
  body: string;
};

export type ReplyMatch =
  | { kind: 'one'; candidate: ReplyCandidate; why: string }
  | { kind: 'many'; candidates: ReplyCandidate[] }
  | { kind: 'none' };

/** Distinctive tokens only — the recognition law: generic work-words match every thread in a
 *  portfolio and prove nothing. */
const distinctive = (s: string): string[] =>
  [...new Set(wordsOf(s).filter((t) => !GENERIC_WORK_WORDS.has(t) && t.length >= 4))];

/** Tokens that live in every address and therefore separate nothing — a domain suffix matching is
 *  a coincidence, not a signal (found by the ladder's own gate: "someone@elsewhere.example" scored
 *  against every sender whose address ends the same way). */
const ADDRESS_NOISE = new Set(['com', 'net', 'org', 'www', 'mail', 'email', 'example', 'test', 'local']);

/** A PERSON'S NAME is distinctive at three letters ("Sam", "Rui", "Jan") where a work-word is not —
 *  so the sender lane reads its own, laxer token set. The generic-word and address-noise filters
 *  still apply: the law being relaxed is length, never distinctiveness. */
const nameTokensOf = (s: string): string[] =>
  [...new Set(wordsOf(s).filter((t) => !GENERIC_WORK_WORDS.has(t) && !ADDRESS_NOISE.has(t)))];

const addressesIn = (s: string): string[] =>
  [...new Set((String(s || '').match(EMAIL_RE) ?? []).map((a) => a.toLowerCase()))];

/** A confident single match needs BOTH a real score and daylight over the runner-up — ambiguity is
 *  a refusal, never a guess with the user's mail. */
const MIN_SCORE = 4;
const MARGIN = 3;
/** How many plausible-but-not-confident candidates we are willing to LIST back. */
const LIST_CAP = 4;

/** Pure scoring — the whole ladder's judgment, testable without a database.
 *  `hints.to` = who the user named · `hints.about` = the subject/topic they named ·
 *  `hints.pasted` = the user's raw message (a pasted email lives here). */
export function scoreReplyCandidates(
  candidates: ReplyCandidate[],
  hints: { to?: string | null; about?: string | null; pasted?: string | null },
): Array<{ candidate: ReplyCandidate; score: number; why: string }> {
  const toText = String(hints.to ?? '');
  const aboutText = String(hints.about ?? '');
  const pasted = String(hints.pasted ?? '');
  // The address the user named, or any address inside what they pasted.
  const namedAddresses = new Set([...addressesIn(toText), ...addressesIn(pasted)]);
  const nameTokens = nameTokensOf(toText);
  const aboutTokens = distinctive(aboutText);
  // The PASTED-EMAIL overlap reads the sender's OWN words only (the top-message law) — a quoted
  // history would match every thread the quote ever touched.
  const pastedTokens = new Set(distinctive(topMessageOf(pasted)));

  return candidates.map((c) => {
    let score = 0;
    const why: string[] = [];
    if (c.fromAddress && namedAddresses.has(c.fromAddress.toLowerCase())) { score += 6; why.push('sender address'); }
    const hay = `${c.fromName} ${c.fromAddress}`.toLowerCase();
    const nameHits = nameTokens.filter((t) => hay.includes(t)).length;
    // A named sender with exactly ONE open thread must clear MIN_SCORE on the name alone — the
    // ladder does not get to demand a subject the user never had to give.
    if (nameHits) { score += Math.min(5, nameHits * 4); why.push('sender name'); }
    const subjHay = `${c.subject} ${c.title}`.toLowerCase();
    const subjHits = aboutTokens.filter((t) => subjHay.includes(t)).length;
    if (subjHits) { score += Math.min(4, subjHits * 2); why.push('subject'); }
    if (pastedTokens.size >= 8) {
      const own = distinctive(topMessageOf(c.body));
      const shared = own.filter((t) => pastedTokens.has(t)).length;
      // A real paste of THIS message shares most of its distinctive vocabulary; a coincidental
      // topic overlap shares a handful. The ratio is over the CANDIDATE's own words, so a short
      // message cannot win on length alone.
      const ratio = own.length >= 8 ? shared / own.length : 0;
      if (ratio >= 0.5) { score += 6; why.push('pasted text'); }
      else if (ratio >= 0.3) { score += 3; why.push('pasted text'); }
    }
    return { candidate: c, score, why: why.join(' + ') };
  }).sort((a, b) => b.score - a.score);
}

/** The ladder: one confident match / several plausible / none. */
export function pickReplyTarget(
  candidates: ReplyCandidate[],
  hints: { to?: string | null; about?: string | null; pasted?: string | null },
): ReplyMatch {
  const scored = scoreReplyCandidates(candidates, hints).filter((s) => s.score > 0);
  if (!scored.length) return { kind: 'none' };
  const [best, second] = scored;
  if (best.score >= MIN_SCORE && (!second || best.score - second.score >= MARGIN)) {
    return { kind: 'one', candidate: best.candidate, why: best.why };
  }
  const plausible = scored.filter((s) => s.score >= MIN_SCORE).slice(0, LIST_CAP);
  if (plausible.length >= 2) return { kind: 'many', candidates: plausible.map((p) => p.candidate) };
  return { kind: 'none' };
}

// ── THE STANDALONE LANE ──────────────────────────────────────────────────────────────────────────

/** Did the user PASTE a message (rather than describe one)? Structural: it carries an address and
 *  enough body to be a message, or it carries mail headers. Never a keyword read of intent. */
export function looksPasted(text: string): boolean {
  const t = String(text || '');
  if (t.length < 160) return false;
  if (/^\s*(from|to|subject|sent|de|para|assunto|von|an|betreff)\s*:/im.test(t)) return true;
  return addressesIn(t).length > 0 && t.split(/\n/).length >= 3;
}

/** Read a pasted message into the shape `generateReplyDraft` already speaks — so the standalone
 *  lane is THE SAME drafter, not a second one. Deterministic: headers when present, else the first
 *  address as the sender and the first non-empty line as the subject. */
export function pastedAsSourceData(text: string): Record<string, unknown> | null {
  const t = String(text || '').replace(/\r\n/g, '\n');
  if (!t.trim()) return null;
  const header = (labels: string[]): string | null => {
    const re = new RegExp(`^\\s*(?:${labels.join('|')})\\s*:\\s*(.+)$`, 'im');
    return re.exec(t)?.[1]?.trim() ?? null;
  };
  const fromLine = header(['from', 'de', 'von', 'expediteur', 'exp[ée]diteur']);
  const subject = header(['subject', 'assunto', 'asunto', 'betreff', 'objet'])
    ?? t.split('\n').map((l) => l.trim()).find((l) => l.length >= 4 && !EMAIL_RE.test(l))?.slice(0, 120)
    ?? '';
  const addr = addressesIn(fromLine ?? t)[0] ?? null;
  if (!addr) return null;
  const fromName = (fromLine ?? '').replace(EMAIL_RE, '').replace(/[<>"]/g, '').trim() || addr.split('@')[0];
  // The body is the paste with its own header block removed — the drafter must answer the message,
  // not the envelope.
  const body = t.replace(/^\s*(?:from|to|cc|sent|date|subject|de|para|assunto|von|an|betreff|objet)\s*:.*$/gim, '').trim();
  return { from: addr, from_address: addr, from_name: fromName, subject, body: body || t };
}

// ⚠️ `standaloneDraftBlock` RETIRED (Sep 21, the owner's convergence call). It wrapped an
// un-anchored draft in delimited plain text because "no card exists for it on the Home" — which
// was true for one day and was the wrong thing to accept: it made a FOURTH rendering of an email,
// and the only one the user could not send. The standalone draft now lands on THE ONE EMAIL CARD
// (`lib/prepare/standalone-reply.ts` → the card's `standalone` lane → /api/emails/send). A donor
// retires with the wave its successor ships.
