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
/** 'delegated' = the writer hands the act to a third party on THEIR OWN side ("je demande à <colleague> de…",
 *  "<colleague> will…"): on received mail the sender's side owes it; on the user's own mail it is a colleague's
 *  task — the user owes nothing personally and the other party owes nothing either. */
export type QuoteActor = 'author' | 'addressee' | 'user' | 'other' | 'suggestion' | 'named-addressee' | 'delegated';

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

// ── W42 · THE DELEGATION READS THROUGH (owner walk, Oct 2) ───────────────────────────────────────
// "je demande à <colleague> d'effectuer le virement" was read as a first-person DESIRE ("demande") →
// the ADDRESSEE (the user) acts → "Arrange payment transfer…", "You owe <sender>". But an ask verb whose
// OBJECT is a third party is a DELEGATION: the writer hands the act to someone on their own side — the
// writer's side acts (or the user, when the delegate IS the user; the reader, when the object is "you").
/** Ask/delegate verbs (any tense) — the verb of "I ask/asked/will ask X to…" in EN/FR/DE/PT/ES. */
const DELEGATE_VERB = /^(ask|asked|asking|demande|demandé|demander|demandons|demandais|charge|chargé|charger|bitte|bitten|gebeten|pedir|pedi|peço|pedimos|pedirei|pedirlhe|pido|pedí|pediré|pedirle|pedimos|pedido|pidiendo|pedindo)$/;
/** A second-person object: the ask is addressed to the reader, not delegated. */
const SECOND_OBJ = /^(you|u|vous|te|t'|toi|sie|ihnen|dich|dir|euch|lhe|lhes|você|vocês|voce|usted|ustedes|os|vos|ti)$/;
/** Words between the verb and its object (prepositions/articles/possessives) that carry no person. */
const OBJ_LEAD = /^(à|a|ao|à|aos|au|aux|al|to|the|my|our|mon|ma|mes|notre|nos|meu|minha|nosso|nossa|mi|mis|nuestro|nuestra|meinen|meine|unseren|unsere|herrn|frau|mr|mrs|ms|m|mme|sr|sra|dr|le|la|el|o|de|der|die|den|dem)$/;
/** The infinitive/complement link after the delegate ("to", "de/d'", "que", "para", "pour", "zu"). */
const DELEGATE_LINK = /^(to|de|d'.*|que|qu'.*|para|pour|zu|um|that|if|si|se|whether)$/;
/** First-person auxiliaries/clitics that may sit between the subject and the ask verb. */
const FP_AUX = /^(will|'ll|have|'ve|had|am|'m|was|did|just|already|also|vais|ai|avons|allons|viens|venons|suis|lui|leur|werde|werden|habe|haben|hab|vou|vamos|já|ja|voy|he|hemos|le|les|ya|also)$/;

/** Is a delegation in this clause? → who acts: the user (the delegate denotes them), the reader
 *  ("I ask you to…"), the named counterparty ('other'), else the WRITER'S side ('author'). null = none. */
function delegationActor(t: string[], cased: string[], ctx: SegCtx): QuoteActor | null {
  const w0 = t[0];
  const firstPerson = FIRST.has(w0) || /^j'/.test(w0) || /^(le|lhe)$/.test(w0) && DELEGATE_VERB.test(t[1] ?? '');
  // Pro-drop delegators open the clause with the verb itself ("Pedi ao X…", "Le pido a X…", "Peço ao X…").
  const proDropAux = /^(vou|vamos|voy|vais)$/.test(w0) && DELEGATE_VERB.test(t[1] ?? '');
  const proDrop = /^(pedi|peço|pedimos|pido|pedí|pediré|pedirei|bitte)$/.test(w0) && !REQUEST_OPEN.some((re) => re.test(t.join(' ')));
  if (!firstPerson && !proDrop && !proDropAux) return null;
  let k = proDrop ? 0 : proDropAux ? 1 : -1;
  // German perfect: "ich habe X gebeten" — the participle closes the clause.
  if (k < 0 && /^(habe|haben|hab|hatte|hatten)$/.test(t[1] ?? '') && t.includes('gebeten')) k = 1;
  if (k < 0) {
    for (let i = /^j'/.test(w0) && t[0].length > 2 ? 0 : 1; i < Math.min(t.length, 5); i++) {
      const x = i === 0 ? t[0].slice(2) : t[i];
      if (DELEGATE_VERB.test(x)) { k = i; break; }
      if (!FP_AUX.test(x) && !/^j'/.test(x)) break;
    }
  }
  if (k < 0) return null;
  // The object: skip leads, collect up to 3 person tokens, then a link (or, in German, the clause end /
  // "gebeten" — "ich bitte X, …" splits the clause on its comma; "ich habe X gebeten").
  let i = k + 1;
  while (i < t.length && OBJ_LEAD.test(t[i]) && !SECOND_OBJ.test(t[i])) i++;
  if (i >= t.length) return null;
  // An ask whose object is the reader ("I ask you to…", "je vous demande de…" reads earlier) is a request.
  if (SECOND_OBJ.test(t[i])) return DELEGATE_LINK.test(t[i + 1] ?? '') ? 'addressee' : null;
  if (/^(me|moi|mich|mir|us|nous|uns|nos)$/.test(t[i])) return null; // to ourselves: not a delegation
  const obj: string[] = [];
  const objCased: string[] = [];
  // The delegate's name leads; a short apposition may follow before the link ("Kofi (copied) in our finance
  // team to pay…", "Léa (en copie) d'effectuer…") — the link is looked for within 8 words.
  let j = i;
  while (j < t.length && j - i < 8 && !DELEGATE_LINK.test(t[j]) && t[j] !== 'gebeten') j++;
  const end = j < t.length && j - i < 8 ? j : Math.min(t.length, i + 3);
  for (let k2 = i; k2 < Math.min(end, i + 3); k2++) { obj.push(t[k2]); objCased.push(cased[k2] ?? t[k2]); }
  i = end;
  if (!obj.length) return null;
  const linked = i < t.length && (DELEGATE_LINK.test(t[i]) || t[i] === 'gebeten');
  const german = /^(bitte|bitten|gebeten)$/.test(t[k]) || t.includes('gebeten');
  // A bare noun after "ask" with no link is an ask FOR a thing ("I ask for the invoice", "je demande un
  // devis") — a desire, never a delegation. A delegate is a person: linked, or a capitalised name in German.
  if (!linked && !(german && /^\p{Lu}/u.test(objCased[0] ?? '') && obj.length <= 3 && i >= t.length)) return null;
  if (/^(for|um|un|une|des|du|uma|um|una|unos|the|a|an|que|if)$/.test(obj[0])) return null;
  const name = objCased.join(' ');
  if (denotesUser(name, ctx.user) || objCased.some((w) => denotesUser(w, ctx.user))) return 'user';
  // (No 'other' here: the delegate is on the WRITER's side by construction — a model-named counterparty that
  // happens to be the delegate is no evidence they are the mail's other party.)
  return 'delegated';
}

/** Capitalised words that open a clause but name no person (time words, determiners, pronouns). */
const NOT_A_NAME = new Set(['this', 'that', 'it', 'there', 'everything', 'nothing', 'which', 'the', 'a', 'an', 'each', 'all', 'today', 'tomorrow', 'next', 'payment', 'delivery',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'ce', 'cela', 'ça', 'ca', 'il', 'elle', 'tout', 'rien', 'le', 'la', 'les', 'un', 'une', 'demain', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche',
  'das', 'es', 'dies', 'alles', 'er', 'sie', 'der', 'die', 'morgen', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag',
  'isso', 'isto', 'tudo', 'ele', 'ela', 'amanhã', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'eso', 'esto', 'todo', 'él', 'ella', 'mañana', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes']);
/** A copula/passive after the future marker: "X will be …" describes a state, not an actor's deed. */
const COPULA = /^(be|être|etre|sein|ser|estar|been|get|have|avoir|haben|ter|tener|happen|work)$/;

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
  // W42: a delegation ("je demande à X de…", "I've asked X to…") is read before the desire/request forms.
  const delegated = delegationActor(t, cased, ctx);
  if (delegated) return delegated;
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
    // W42: an unknown named subject with a FUTURE marker ("<Name> va effectuer le virement", "<Name> will
    // send…") is someone on the writer's side doing it — never the reader's deed. ("<Name> to …" in an
    // action list stays unknown: a note-taker's list names no side.)
    if (t[1] !== 'to' && !NOT_A_NAME.has(tok) && t[2] && !COPULA.test(t[2]) && original.length >= 2) return 'delegated';
  }
  // "<First> <Last> will/va …" — a two-word name before the future marker.
  if (t.length >= 3 && /^(will|'ll|va|vai|wird|irá|fera|fará)$/.test(t[2]) && /^\p{Lu}/u.test(cased[0] ?? '') && /^\p{Lu}/u.test(cased[1] ?? '')
    && !NOT_A_NAME.has(fold(cased[0])) && t[3] && !COPULA.test(t[3])) {
    const full = `${cased[0]} ${cased[1]}`;
    if (denotesUser(full, ctx.user)) return 'user';
    const toks = [fold(cased[0]), fold(cased[1])];
    if (ctx.others.some((o) => nameTokens(o).map(fold).some((n) => toks.includes(n)))) return 'other';
    return 'delegated';
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
      // W35: a word that itself OPENS a request ("Pode, por favor, …", "Could, …", "Bitte, …") is the
      // request's own verb/marker, never a vocative name (a PT/ES/DE ask was read as addressed to "Pode").
      if (voc && !NOT_VOCATIVE.has(low(voc[1])) && !REQUEST_OPEN.some((re) => re.test(low(voc[1])))
        && segmentActor(voc[2].split(/,(?=\s)/)[0], segCtx) === 'addressee') {
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
  | { kind: 'drop'; actor: 'suggestion' | 'named-addressee' | 'delegated' };

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
  // W42: the user's own hand-off to a colleague is the colleague's task (no personal debt, nothing owed back);
  // a sender's hand-off on their own side is THEIR side's debt.
  if (actor === 'delegated') return ctx.authoredByUser ? { kind: 'drop', actor } : (c.direction === 'awaiting' ? { kind: 'keep' } : { kind: 'direction', direction: 'awaiting', actor });
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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// W42 · THE BILL HAS ONE PAYER (owner walk, Oct 2). A message in which the SENDER'S side pays ("je
// demande à <colleague> d'effectuer le virement", "our finance team will process the payment") minted a
// task the USER owes ("Arrange payment transfer…") and a draft promising the user would pay. One bill,
// one payer: when the message's own words name the writer's side as the payer and nowhere ask the reader
// to pay, a payment act is never the reader's debt. Grammar from the one actor reader above; pure.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** A payment act (pay / transfer / wire / settle / refund) in EN/FR/DE/PT/ES — word-bounded stems. */
const PAYMENT = /(^|[^\p{L}])(pay|pays|paid|paying|payment|payments|wire|wired|transfer|transfers|remit|remittance|settle|settlement|reimburse|refund|virement|virements|virer|paiement|paiements|payer|paye|payons|réglement|règlement|régler|regler|rembourser|remboursement|versement|überweisung|überweisen|zahlung|zahlen|bezahlen|begleichen|erstatten|pagamento|pagar|pago|pagamos|transferência|transferencia|transferir|liquidar|reembolso|reembolsar|abonar)(?=$|[^\p{L}])/iu;
/** Bank-details / invoice-document objects: sending THESE is a document act, never the payment itself. */
const PAYMENT_DOCUMENT = /(bank details|banking details|iban|swift|rib|coordonnées bancaires|coordonnees bancaires|relevé d'identité|bankverbindung|bankdaten|dados bancários|dados bancarios|datos bancarios|nib\b|invoice|facture|rechnung|fatura|factura|receipt|reçu|quittung|recibo)/i;

/** Handling verbs that, on a bill thread, ARE the payment ("process it", "traiter", "bearbeiten", "tramitar"). */
const HANDLING = /(^|[^\p{L}])(process|processed|processing|handle|handled|release|traiter|traité|bearbeiten|bearbeitet|freigeben|anweisen|processar|tramitar|procesar|gestionar)(?=$|[^\p{L}])/iu;

/** Is this task text a payment ACT (the deed of paying), not a document about one? Pure. */
export function isPaymentAct(text: string | null | undefined): boolean {
  const s = String(text ?? '');
  if (!PAYMENT.test(s)) return false;
  // "Pay the invoice" is a payment act; "Send the invoice for the transfer" is a document act.
  const leadPay = PAYMENT.test(s.split(/\s+/).slice(0, 4).join(' '));
  return leadPay || !PAYMENT_DOCUMENT.test(s);
}

/** Who pays, by the message's own words: 'writer' (the author's side), 'reader' (the addressee), or
 *  null (no payment sentence, or both sides named — then the floor says nothing). Pure. */
export function payerOf(ownWords: string | null | undefined, ctx: { user: UserForms; others?: Array<string | null | undefined>; authoredByUser: boolean }): 'user' | 'other' | null {
  const text = String(ownWords ?? '');
  // On a bill thread (an invoice/facture/Rechnung named anywhere in the words), "process / handle / settle /
  // release it" is the payment too ("I've asked our finance team to process it").
  const billThread = PAYMENT_DOCUMENT.test(text);
  const paySentence = (x: string) => PAYMENT.test(x) || (billThread && HANDLING.test(x));
  if (!paySentence(text)) return null;
  const sides = new Set<'user' | 'other'>();
  for (const sentence of text.split(/(?<=[.!?;])\s+|\n+/)) {
    if (!paySentence(sentence)) continue;
    const a = quoteActor(sentence, { user: ctx.user, others: ctx.others });
    if (!a || a === 'suggestion') continue;
    const userPays = a === 'user' || ((a === 'author' || a === 'delegated') && ctx.authoredByUser) || ((a === 'addressee') && !ctx.authoredByUser);
    sides.add(userPays ? 'user' : 'other');
  }
  return sides.size === 1 ? [...sides][0] : null;
}

/** THE BILL HAS ONE PAYER (pure): a you_owe PAYMENT act on a message whose words make the other side the
 *  payer is theirs — 'awaiting'. Anything else (no payment, the user asked to pay, both sides) → unchanged. */
export function payerFloor(
  c: { direction?: string | null; description?: string | null },
  ctx: { ownWords: string | null | undefined; user: UserForms; others?: Array<string | null | undefined>; authoredByUser: boolean },
): 'you_owe' | 'awaiting' | null {
  if (c.direction !== 'you_owe' || !isPaymentAct(c.description)) return null;
  return payerOf(ctx.ownWords, ctx) === 'other' ? 'awaiting' : null;
}

/** The same law on the inbox lane (pure): an understanding that says the user owes a PAYMENT move on a
 *  RECEIVED message whose words make the sender's side the payer → 'awaiting'. null = unchanged. */
export function ownershipPayerFloor(
  u: { ownership?: string | null; ask?: string | null },
  ctx: { ownWords: string | null | undefined; user: UserForms; others?: Array<string | null | undefined> },
): 'awaiting' | null {
  if (u.ownership !== 'you_owe' || !isPaymentAct(u.ask)) return null;
  return payerOf(ctx.ownWords, { ...ctx, authoredByUser: false }) === 'other' ? 'awaiting' : null;
}

/** W42 · THE SENDER'S OWN PROMISE IS A COMMITMENT (pure): does any sentence of the message's own words have
 *  the writer's side commit to a deed — a first-person commissive ("we will send…", "nous allons…") or a
 *  delegation on their side ("je demande à <colleague> de…")? The extraction gate reads this so an
 *  understanding of "no move for the user" never hides what the OTHER side owes them. */
export function ownWordsCommit(ownWords: string | null | undefined): boolean {
  const text = String(ownWords ?? '');
  if (text.trim().length < 12) return false;
  const none = { name: null, aliases: [] as string[] };
  return text.split(/(?<=[.!?;])\s+|\n+/).some((s) => {
    const a = quoteActor(s, { user: none });
    if (a === 'delegated') return true;
    // A first-person deed counts only in a FUTURE form (a past "cancelámos…" / "we sent…" is a report, not a promise).
    return a === 'author' && tokens(s).some((x) => COMMISSIVE.test(x) || SYNTH_FUTURE.test(x) || /'ll$/.test(x));
  });
}
