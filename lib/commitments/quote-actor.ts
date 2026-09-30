// ════════════════════════════════════════════════════════════════════════════════════════════════
// W28 · THE QUOTE NAMES ITS ACTOR — the code half of the direction law, read from the VERIFIED quote.
//
// THE LOSSES (eval, extraction.commitments): "Vamos enviar a proposta revista" (the sender's side will
// send) stored as the USER's debt; "<user> will send us the final workplan" (the user named in the
// third person) stored as owed TO the user; "<Name> to send the list of …" in an action list
// stored as the user's; "On my side: I will send you the supplier scorecard" stored as the user's. In
// every one the model's `doer` contradicted the grammar of the very sentence it quoted verbatim.
//
// THE LAW: direction is WHO DOES IT (lib/commitments/direction.ts). The quote is the one piece of the
// extraction the code has VERIFIED (it exists in the message's own words — the quote floor), so when its
// own grammar names the actor unambiguously, that actor decides:
//   · a first-person subject with a COMMISSIVE form (I/we will…, "vamos enviar", "nous allons",
//     "wir werden", pro-drop futures "enviaremos") → the message's AUTHOR acts;
//   · a REQUEST (please / could you / merci de / bitte / por favor / podria…) or a first-person
//     DESIDERATIVE (I need / we are still waiting for / j'aurais besoin / precisamos…) or a second-person
//     subject with an obligation modal (you need to / vous devez…) → the ADDRESSEE acts;
//   · a named subject with an assignment or future form ("<Name> to send…", "<Name> will…") → that person:
//     the USER when the name denotes the user, else the named other party;
//   · a first-person-PLURAL SUGGESTION ("we should catch up", "on devrait se voir", "wir sollten",
//     "deveríamos", "deberíamos") → nobody: a suggestion has no owner, so it is no commitment.
// Anything else — no subject in the clause, a subordinate clause ("once you send…"), two clauses that
// disagree — is UNKNOWN and changes nothing: the floor only ever acts on a clear, single-actor clause.
//
// Grammar, not vocabulary of any case: pronouns, auxiliaries, modals and request forms in EN/FR/DE/PT/ES.
// PURE, zero AI, zero IO.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { denotesUser, type UserForms } from '@/lib/commitments/extraction-truth';
import { nameTokens } from '@/lib/projects/identity';

/** 'named-addressee' = a request whose vocative names someone who is NOT the user ("<Name>, please send…"). */
export type QuoteActor = 'author' | 'addressee' | 'user' | 'other' | 'suggestion' | 'named-addressee';

const low = (s: string) => s.toLowerCase().replace(/[‘’`´]/g, "'");
const fold = (s: string) => low(s).normalize('NFD').replace(/[̀-ͯ]/g, '');

// ── the grammar (lowercased; accented forms written as they are spelled) ────────────────────────
/** First-person SUBJECTS (singular + plural + possessive subjects "our team", "notre équipe"). */
const FIRST = new Set(['i', "i'll", "i'm", "i've", "i'd", 'we', "we'll", "we're", "we've", "we'd", 'our', 'my',
  'je', "j'", 'nous', 'notre', 'nos', 'mon', 'ma', 'mes',
  'ich', 'wir', 'unser', 'unsere', 'unser', 'unserem', 'unseren', 'unserer', 'mein', 'meine',
  'eu', 'nós', 'nosso', 'nossa', 'nossos', 'nossas', 'meu', 'minha',
  'yo', 'nosotros', 'nosotras', 'nuestro', 'nuestra', 'nuestros', 'nuestras']);
/** First-person PLURAL / impersonal subjects — the only ones a suggestion modal empties of an owner. */
const FIRST_PLURAL = new Set(['we', "we'll", "we'd", 'nous', 'on', 'wir', 'nós', 'nosotros', 'nosotras']);
/** Second-person subjects (German formal "Sie" is left out: sentence-initial it is also "they"). */
const SECOND = new Set(['you', "you'll", "you're", "you've", "you'd", 'your', 'vous', 'tu', 'votre', 'vos', 'ton', 'ta', 'tes',
  'du', 'ihr', 'dein', 'deine', 'você', 'vocês', 'voce', 'voces', 'usted', 'ustedes', 'tú', 'vosotros', 'vosotras']);
/** Third-person plural subjects (the other side's people). */
const THIRD = new Set(['they', "they'll", "they're", 'their', 'ils', 'elles', 'leur', 'leurs', 'eles', 'elas', 'ellos', 'ellas']);
/** Words a segment may open with that carry no subject (discourse markers, fillers). */
const LEAD = new Set(['and', 'also', 'so', 'then', 'but', 'ok', 'okay', 'yes', 'sure', 'great', 'thanks', 'et', 'puis', 'alors', 'donc', 'mais', 'oui',
  'und', 'dann', 'aber', 'ja', 'e', 'então', 'mas', 'sim', 'y', 'entonces', 'pero', 'sí']);
/** Commissive / future auxiliaries and forms. */
const COMMISSIVE = /^(will|'ll|shall|going|gonna|vais|allons|va|werde|werden|vou|vamos|irei|iremos|voy|vamos)$/;
/** Synthetic futures: FR -rai/-rons, PT -rei/-remos, ES -ré/-remos (≥ 5 letters: a real verb). */
const SYNTH_FUTURE = /^\p{L}{2,}(rai|rons|rei|remos|ré)$/u;
/** Pro-drop first-person-plural verbs (PT/ES "-mos", "vamos", "enviamos"), checked on the FIRST verb. */
const PRO_DROP_1PL = /^\p{L}{2,}mos$/u;
/** First-person desiderative verbs: the writer WANTS/WAITS — the other side acts. */
const DESIDERATIVE = /^(need|needed|needs|want|wanted|expect|expected|await|awaiting|waiting|require|required|besoin|voudrais|voudrions|aimerais|aimerions|souhaite|souhaitons|attends|attendons|attendais|demande|demandons|brauche|brauchen|benötige|benötigen|möchte|möchten|hätte|hätten|warte|warten|erwarte|erwarten|preciso|precisamos|precisava|gostaria|gostaríamos|aguardo|aguardamos|espero|esperamos|peço|pedimos|necessito|necesito|necesitamos|quisiera|quisiéramos|pido|espera|esperando|aguardando)$/;
/** "would like / would appreciate / would love" — the conditional desiderative (two tokens). */
const WOULD_WANT = /^(like|love|appreciate|need)$/;
/** Suggestion modals (first-person plural / impersonal "on"). */
const SUGGESTION = /^(should|could|might|ought|devrait|devrions|pourrait|pourrions|faudrait|sollten|könnten|sollte|könnte|deveríamos|poderíamos|devíamos|podíamos|deberíamos|podríamos|debería|podría)$/;
/** Second-person obligation modals. */
const OBLIGE = /^(need|needs|must|devez|dois|müssen|musst|precisa|precisas|deve|deves|necesita|necesitas|debe|debes)$/;
/** Offer questions ("would you like me to…") — the WRITER would act, on the reader's yes: no actor. */
const OFFER_OPEN = /^((would|do) you (like|want|prefer)|voulez-vous|souhaitez-vous|voulez vous|möchten sie|willst du|quer que|queres que|quiere que|quieres que)\b/;
/** Requests addressed to the reader (the segment opens with one). */
const REQUEST_OPEN = [
  /^(please|pls|kindly)\b/, /^(could|can|would|will) (you|u)\b/, /^i'?d (like|love) (you|for you) to\b/,
  /^(merci de|pourriez-vous|pouvez-vous|pourrais-tu|peux-tu|veuillez|je vous prie de|pourriez vous|pouvez vous)\b/,
  /^(bitte|könnten sie|können sie|würden sie|kannst du|könntest du)\b/,
  /^(por favor|poderia|podia|pode|podes|consegue|conseguia|conseguirias?)\b/,
  /^(podrías|podría|puede|puedes|podéis|pueden|podrian|podrías)\b/,
];
/** A named subject's assignment / future marker ("<Name> to send", "<Name> will", "<Name> vai enviar"). */
const NAMED_AUX = /^(to|will|'ll|shall|va|vai|wird|irá)$/;
/** Subordinators — a segment carrying one holds two clauses; the floor does not guess between them. */
// ("se" is left out: in PT it is also the reflexive clitic of "on se voit" / "se reunir").
// A subordinator only opens a second CLAUSE when a subject follows it ("once you send…"); "after the
// board meeting" is a prepositional phrase and changes nothing.
const SUBORDINATOR = /(^|\s)(once|when|after|as soon as|if|until|unless|dès que|quand|lorsque|après que|si|sobald|wenn|nachdem|falls|quando|assim que|logo que|depois que|cuando|en cuanto|tan pronto como|después de que)\s+(i|we|you|they|he|she|it|je|j'|nous|vous|tu|il|elle|ils|elles|on|ich|wir|sie|du|ihr|er|es|eu|nós|você|vocês|ele|ela|eles|elas|yo|nosotros|usted|ustedes|él|ella|ellos|ellas|\p{Lu}\p{L}+)(\s|$|')/u;
/** Words that open a sentence with a comma but are no vocative (greetings, discourse markers). */
const NOT_VOCATIVE = new Set(['hi', 'hello', 'hey', 'dear', 'thanks', 'thank', 'yes', 'no', 'ok', 'okay', 'also', 'however', 'finally', 'sure', 'great', 'so', 'well', 'first', 'second', 'lastly', 'then', 'again', 'anyway', 'btw', 'please', 'fyi', 'note', 'meanwhile', 'otherwise',
  'bonjour', 'salut', 'merci', 'oui', 'non', 'enfin', 'donc', 'ensuite', 'hallo', 'danke', 'ja', 'nein', 'also', 'olá', 'ola', 'obrigado', 'obrigada', 'sim', 'não', 'hola', 'gracias', 'sí', 'bueno', 'entonces']);
/** Copulas/auxiliaries a pro-drop verb may be (then the verb after it decides). */
const PRO_DROP_AUX = /^(estamos|somos|temos|tenemos|estábamos|estávamos|tínhamos|teníamos|fomos|fuimos|hemos)$/;

function tokens(seg: string, keepCase = false): string[] {
  return (keepCase ? seg.replace(/[‘’`´]/g, "'") : low(seg)).replace(/[¿¡"“”«»()[\]]/g, ' ').replace(/^[\s\-–—*•·>\d.)]+/, '')
    .split(/[\s,]+/).map((t) => t.replace(/[^\p{L}\p{N}'-]/gu, '')).filter(Boolean);
}

type SegCtx = { user: UserForms; others: string[] };

/** The actor ONE clause names, or null (unknown). */
function segmentActor(seg: string, ctx: SegCtx): QuoteActor | null {
  const raw = seg.trim();
  if (!raw) return null;
  const l = low(raw).replace(/^[\s\-–—*•·>\d.)¿¡]+/, '');
  let t = tokens(raw);
  let cased = tokens(raw, true);
  while (t.length && LEAD.has(t[0])) { t = t.slice(1); cased = cased.slice(1); }
  if (!t.length) return null;
  const head = t.join(' ');
  if (OFFER_OPEN.test(head)) return null;
  // Requests addressed to the reader.
  if (REQUEST_OPEN.some((re) => re.test(head)) || REQUEST_OPEN.some((re) => re.test(l))) return 'addressee';
  if (SUBORDINATOR.test(head) || SUBORDINATOR.test(cased.join(' '))) return null;
  const w0 = t[0];
  const within = (n: number, re: RegExp, from = 1) => t.slice(from, from + n).some((x) => re.test(x));
  const firstHit = (from: number, n: number): 'commissive' | 'desire' | 'suggest' | null => {
    const win = t.slice(from, from + n);
    for (let k = 0; k < win.length; k++) {
      const x = win[k];
      if (DESIDERATIVE.test(x) || ((x === 'would' || x === "'d") && WOULD_WANT.test(win[k + 1] ?? ''))) return 'desire';
      if (SUGGESTION.test(x)) return 'suggest';
      if (COMMISSIVE.test(x) || SYNTH_FUTURE.test(x)) return 'commissive';
    }
    return null;
  };
  // French impersonal "on" (never the English preposition: it must be followed by a verb form).
  const onSubject = w0 === 'on' && !!t[1] && /^(va|peut|doit|devrait|pourrait|vous|te|t'|se|s'|a|est|fera|fait|\p{L}{3,}ra)$/u.test(t[1]);
  if (FIRST.has(w0) || onSubject || /^j'/.test(w0)) {
    // "I'll" / "we'll" carry their own commissive.
    if (/'ll$/.test(w0)) return 'author';
    if (/'d$/.test(w0) && /^(like|love)$/.test(t[1] ?? '')) return 'addressee';
    const hit = firstHit(1, 8);
    if (hit === 'desire') return 'addressee';
    if (hit === 'suggest') return FIRST_PLURAL.has(w0) || onSubject ? 'suggestion' : null;
    if (hit === 'commissive') return 'author';
    // "I send you…/nous vous envoyons…" (a present-for-future with the reader as object) — the author.
    if (/^(je|nous|ich|wir|eu|nós|yo|nosotros)$/.test(w0) && within(2, /^(vous|te|t'|ihnen|dir|euch|lhe|lhes|te|le|les|os)$/)) return 'author';
    return null;
  }
  if (SECOND.has(w0)) {
    if (/'ll$/.test(w0)) return null; // "you'll receive…" — the reader is not the doer of a receipt
    return within(2, OBLIGE) ? 'addressee' : null;
  }
  if (THIRD.has(w0)) {
    return firstHit(1, 6) === 'commissive' || within(1, /^(to)$/) ? 'other' : null;
  }
  // Pro-drop (PT/ES) first-person plural: "Vamos enviar…", "Enviaremos…", "Te enviaremos…".
  const verb = /^(te|le|les|lhe|lhes|vos|os|lo|la|los|las)$/.test(w0) ? t[1] ?? '' : w0;
  if (verb && (PRO_DROP_1PL.test(verb) || /^\p{L}{2,}(rei|ré)$/u.test(verb)) && !/^(demos|memos|promos|photos|videos|logos|mos)$/.test(verb)) {
    if (SUGGESTION.test(verb)) return 'suggestion';
    if (DESIDERATIVE.test(verb)) return 'addressee';
    if (PRO_DROP_AUX.test(verb)) {
      const hit = firstHit(t.indexOf(verb) + 1, 4);
      return hit === 'desire' ? 'addressee' : hit === 'commissive' ? 'author' : null;
    }
    return 'author';
  }
  // A named subject with an assignment/future marker: "<Name> to send…", "<Name> will…".
  if (t.length >= 2 && NAMED_AUX.test(t[1])) {
    const original = cased[0] ?? '';
    if (!/^\p{Lu}/u.test(original)) return null;
    if (denotesUser(original, ctx.user)) return 'user';
    const tok = fold(original);
    if (ctx.others.some((o) => nameTokens(o).map(fold).includes(tok))) return 'other';
  }
  return null;
}

/**
 * THE ACTOR the quote names — pure. `ownWords` (the message's own words) widens a quote that starts
 * mid-clause by its short lead-in only (≤ 4 words: "Hi Sam, yes, | I will send…"). Every clause that
 * names an actor must name the SAME one; otherwise (or when none does) → null.
 */
export function quoteActor(
  quote: string | null | undefined,
  ctx: { user: UserForms; others?: Array<string | null | undefined>; ownWords?: string | null },
): QuoteActor | null {
  const q = String(quote ?? '').trim().replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '').trim();
  if (q.length < 6) return null;
  const segCtx: SegCtx = { user: ctx.user, others: (ctx.others ?? []).map((o) => String(o ?? '').replace(/<[^>]*>/g, ' ').trim()).filter(Boolean) };
  const read = (text: string): QuoteActor | null => {
    const seen = new Set<QuoteActor>();
    for (const sentence of text.split(/[.;:!?\n]+/)) {
      // A VOCATIVE naming someone other than the user, followed by a request: the ask is THEIRS.
      const voc = /^\s*(?:[-*•·]\s*)?(\p{Lu}[\p{L}'’-]+)\s*,\s*(.+)$/u.exec(sentence);
      if (voc && !NOT_VOCATIVE.has(low(voc[1])) && segmentActor(voc[2].split(/,(?=\s)/)[0], segCtx) === 'addressee') {
        seen.add(denotesUser(voc[1], ctx.user) ? 'addressee' : 'named-addressee');
        continue;
      }
      for (const seg of sentence.split(/,(?=\s)/)) {
        const a = segmentActor(seg, segCtx);
        if (a) seen.add(a);
      }
    }
    return seen.size === 1 ? [...seen][0] : null;
  };
  const direct = read(q);
  if (direct || !ctx.ownWords) return direct;
  // The lead-in: the words of the quote's own sentence before it, when short.
  const own = String(ctx.ownWords);
  const at = fold(own).indexOf(fold(q).slice(0, 40));
  if (at <= 0) return null;
  const before = own.slice(0, at);
  const lead = before.slice(Math.max(before.lastIndexOf('\n'), before.search(/[.!?;:][^.!?;:]*$/)) + 1);
  if (lead.trim().split(/\s+/).filter(Boolean).length > 4) return null;
  return read(`${lead}${q}`);
}

export type QuoteDirectionVerdict =
  | { kind: 'keep' }
  | { kind: 'direction'; direction: 'you_owe' | 'awaiting'; actor: QuoteActor }
  | { kind: 'drop'; actor: 'suggestion' | 'named-addressee' };

/**
 * THE QUOTE DIRECTION FLOOR (pure): what the quote's own grammar demands of a candidate's direction.
 * `authoredByUser` = the user wrote the message (then the AUTHOR is the user and the ADDRESSEE the other
 * party; on received mail the reverse). A suggestion is dropped (no owner). Unknown → keep.
 */
export function quoteDirectionFloor(
  c: { direction?: string | null; quote?: unknown; counterparty?: string | null },
  ctx: { authoredByUser: boolean; user: UserForms; other?: string | null; ownWords?: string | null },
): QuoteDirectionVerdict {
  const actor = quoteActor(typeof c.quote === 'string' ? c.quote : null, { user: ctx.user, others: [c.counterparty ?? null, ctx.other ?? null], ownWords: ctx.ownWords });
  if (!actor) return { kind: 'keep' };
  if (actor === 'suggestion') return { kind: 'drop', actor };
  // A request the sender addresses BY NAME to someone else, on mail the user received: between others.
  if (actor === 'named-addressee' && !ctx.authoredByUser) return { kind: 'drop', actor };
  if (actor === 'named-addressee') return c.direction === 'awaiting' ? { kind: 'keep' } : { kind: 'direction', direction: 'awaiting', actor };
  const userActs = actor === 'user' || (actor === 'author' && ctx.authoredByUser) || (actor === 'addressee' && !ctx.authoredByUser);
  const direction = userActs ? 'you_owe' : 'awaiting';
  return direction === (c.direction === 'awaiting' ? 'awaiting' : 'you_owe') ? { kind: 'keep' } : { kind: 'direction', direction, actor };
}

/**
 * W28 · THE QUOTE SEPARATES (pure): may these fragments merge into one motion? Parts the message states
 * in DIFFERENT sentences or list lines are separate asks (each keeps its own due and its own done);
 * only parts quoted from ONE sentence ("the proposal with pricing and the deck") may be one motion.
 * An unquoted part (the legacy meeting path) proves nothing and never blocks.
 */
export function mergeableByQuote(quotes: ReadonlyArray<string | null | undefined>, ownWords: string | null | undefined): boolean {
  const text = String(ownWords ?? '');
  if (!text.trim()) return true;
  const units = text.split(/(?<=[.!?;])\s+|\n+/).map(fold).filter((u) => u.trim());
  const where = new Set<number>();
  for (const q of quotes) {
    const f = fold(String(q ?? '').replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '').trim());
    if (f.length < 6) continue;
    const probe = f.slice(0, 40);
    const i = units.findIndex((u) => u.includes(probe));
    if (i >= 0) where.add(i);
  }
  return where.size <= 1;
}
