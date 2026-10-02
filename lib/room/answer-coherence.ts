// ════════════════════════════════════════════════════════════════════════════════════════════════
// W42 · THE ANSWER IS COHERENT WITH ITSELF AND WITH ITS BOARD (owner walk, Oct 2).
//
// THE INCIDENT: in a project room, "catch me up: what's open, who owes what, anything blocking?" was
// answered with "<counterparty> is waiting on your bank details" AND "their last message confirms payment
// is moving"; "nothing blocking" beside an overdue row; "the demo invite is staged and ready" while the
// row said "Contact X to schedule demo" with nothing prepared; and its "who owes what" named three debts
// while the cards beneath showed three others.
//
// THE LAW: an answer never asserts a state and its negation about the same row, never calls a row
// prepared that the board says is not, never says "nothing blocking" while the board holds overdue work,
// and — for a catch-up — names every board row that carries a card beneath it. The board rows are the
// ONE list (lib/room/grounding.ts); this floor reads the answer against them. A conflict earns ONE
// re-ask naming it (lib/converse/index.ts); the floor itself never rewrites prose.
//
// PURE, zero AI, zero IO. Lexicon in EN/FR/DE/PT/ES — grammar of state, not vocabulary of any case.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type CoherenceRow = {
  ref: string;
  title: string;
  who?: string | null;
  due?: string | null;
  direction?: string | null;
  prepared?: string[];
  /** W42: the row asks to change payment details (security-marked on the board). */
  changeRequest?: boolean;
  /** W42: the row's only prepared work is a staged invite — prepared work, never overdue. */
  staged?: boolean;
};

export type CoherenceConflict = { kind: 'waiting-vs-settled' | 'staged-vs-todo' | 'staged-not-prepared' | 'nothing-blocking' | 'card-unnamed' | 'staged-called-overdue' | 'legitimises-detail-change'; ref?: string; detail: string };

import { legitimisesDetailChange } from '@/lib/prepare/risky-asks';

const fold = (s: string) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const STOP = new Set(['with', 'from', 'about', 'their', 'your', 'this', 'that', 'them', 'they', 'have', 'will', 'into', 'over', 'after', 'before', 'still',
  'avec', 'pour', 'dans', 'leur', 'votre', 'cette', 'sobre', 'para', 'com', 'como', 'mit', 'fur', 'uber', 'eine', 'einen', 'send', 'reply', 'email', 'follow', 'review']);

/** A row's distinctive words (≥ 4 letters, title + who), folded. */
function rowTokens(r: CoherenceRow): { title: string[]; who: string[] } {
  const words = (s: string) => fold(s).replace(/<[^>]*>/g, ' ').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !STOP.has(w));
  const who = words(String(r.who ?? '').replace(/@.*/, ''));
  return { title: words(r.title).filter((w) => !who.includes(w)), who };
}

/** Does a sentence mention a token (stem-tolerant: the first 5 letters of longer words)? */
function hit(sentence: string, tok: string): boolean {
  const stem = tok.length > 6 ? tok.slice(0, Math.max(5, tok.length - 3)) : tok;
  return new RegExp(`(^|[^\\p{L}])${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(sentence);
}

const WAITING = /(waiting (on|for)|awaiting|still owe|still need|outstanding|not yet (received|paid|sent)|hasn'?t (sent|paid)|has not (sent|paid)|pending (from|on)|en attente|attend (encore|toujours|votre|vos|ton|tes)|toujours pas|wartet auf|warten auf|ausstehend|noch nicht|aguarda|aguardando|à espera|ainda nao|esperando|todavia no|pendiente de)/;
const SETTLED = /(confirm(s|ed)? (that )?(the )?(payment|transfer|it)|is moving|are moving|in motion|on (its|the) way|under ?way|already (paid|sent|done|settled|handled)|has (paid|sent|settled)|was (paid|sent|settled)|been (paid|sent|settled|handled)|is settled|now settled|is done|completed|virement (est )?(en cours|effectue|parti)|est regle|a ete (paye|regle|envoye|effectue)|deja (paye|regle|envoye)|bereits (bezahlt|uberwiesen|erledigt)|ist erledigt|ja (foi )?(pago|enviado|feito)|esta a caminho|ya (fue )?(pagado|enviado|hecho)|en camino)/;
// Prepared-WORK vocabulary only ("the invite is staged", "a draft is ready to send") — never a world fact
// ("the training is booked", "the site is ready"), which a status answer states freely.
const STAGED = /(staged|ready to send|ready for your (review|click|send)|(invite|invitation|draft|reply|email|nudge|deck|document) (is |has been )?(prepared|drafted|ready)|drafted (and|&) ready|brouillon (est )?pret|entwurf (ist )?(bereit|fertig)|rascunho (esta )?pronto|borrador (esta )?listo)/;
const TODO = /(to schedule|still (need|needs|has) to|needs? to be (scheduled|sent|booked|done)|need to (contact|schedule|book|send|set up)|not (yet )?(scheduled|booked|sent)|a planifier|reste a (planifier|envoyer|faire)|doit encore|noch (zu|nicht)|ainda (precisa|falta|nao)|falta (marcar|agendar|enviar)|todavia (hay que|falta|no))/;
const LATE = /(overdue|is late|a day late|days late|was due|due today|past due|en retard|uberfallig|verspatet|atrasad|vencid|retrasad)/;
const NOTHING_BLOCKING = /(nothing (is |'s )?(blocking|blocked|in the way)|no blockers?|nothing blocks|not blocked|rien ne bloque|aucun (blocage|point bloquant)|pas de blocage|nichts blockiert|keine blocker|kein blocker|nada (esta )?(a )?bloque|sem bloqueios|nada bloquea|sin bloqueos)/;
const BLOCKING_SAID = /(overdue|is blocking|are blocking|blocked (by|on)|en retard|bloque par|bloquant|uberfallig|blockiert durch|atrasad|bloqueado por|vencid)/;

/** Sentences of an answer (markdown bullets and line breaks count as boundaries). */
function sentencesOf(text: string): string[] {
  return fold(text).replace(/\*\*|__|`/g, '').split(/(?<=[.!?;])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

/** Which rows each sentence is ABOUT — the best-scoring rows only (title word = 2, who = 1). */
function rowsOfSentence(sentence: string, rows: CoherenceRow[]): number[] {
  const scores = rows.map((r) => {
    const t = rowTokens(r);
    return t.title.filter((w) => hit(sentence, w)).length * 2 + (t.who.some((w) => hit(sentence, w)) ? 1 : 0);
  });
  const best = Math.max(0, ...scores);
  return best === 0 ? [] : scores.flatMap((s, i) => (s === best ? [i] : []));
}

/** Does the answer NAME this row (≥ 2 distinctive title words, or 1 when the title has only one/two)? */
export function namesRow(answer: string, r: CoherenceRow): boolean {
  const a = fold(answer);
  const t = rowTokens(r);
  if (!t.title.length) return t.who.some((w) => hit(a, w));
  const n = t.title.filter((w) => hit(a, w)).length;
  return n >= Math.min(2, t.title.length) || (n >= 1 && t.who.some((w) => hit(a, w)));
}

/** "what's open / who owes what / catch me up / status" — the catch-up ask, EN/FR/DE/PT/ES. */
export function isCatchUpAsk(text: string): boolean {
  return /(catch (me )?up|what'?s open|who owes|what'?s (pending|outstanding)|where (are|do) we stand|status|recap|anything blocking|ou en est|où en est|qui doit|quoi de neuf|fais(-| )moi le point|le point sur|was ist offen|wer schuldet|stand der dinge|o que (esta|está) (em aberto|pendente)|quem deve|ponto da situa|que (hay|queda) pendiente|quien debe|ponme al dia)/i.test(fold(String(text ?? "")));
}

/**
 * THE COHERENCE FLOOR (pure). `cards` = the board rows that carry a card under the answer (the room's
 * prepared rows); checked only for a catch-up ask. `today` = the user's YYYY-MM-DD.
 */
export function answerConflicts(
  answer: string,
  rows: CoherenceRow[],
  opts: { today: string; catchUp?: boolean; cards?: CoherenceRow[] },
): CoherenceConflict[] {
  const out: CoherenceConflict[] = [];
  const sentences = sentencesOf(answer);
  const state = rows.map(() => ({ waiting: false, settled: false, staged: false, todo: false, late: false }));
  for (const s of sentences) {
    const about = rowsOfSentence(s, rows);
    if (!about.length) continue;
    const w = WAITING.test(s), st = SETTLED.test(s), sg = STAGED.test(s), td = TODO.test(s);
    // One sentence holding both forms is a contrast ("was waiting, now settled") — never a conflict alone.
    for (const i of about) {
      if (w && !st) state[i].waiting = true;
      if (st && !w) state[i].settled = true;
      if (sg && !td) state[i].staged = true;
      if (td && !sg) state[i].todo = true;
      if (LATE.test(s)) state[i].late = true;
    }
  }
  rows.forEach((r, i) => {
    const s = state[i];
    if (s.waiting && s.settled) out.push({ kind: 'waiting-vs-settled', ref: r.ref, detail: `"${r.title}" is said to be still waiting AND to be settled/moving` });
    if (s.staged && s.todo) out.push({ kind: 'staged-vs-todo', ref: r.ref, detail: `"${r.title}" is said to be staged/ready AND still to be done` });
    else if (s.staged && !(r.prepared ?? []).length) out.push({ kind: 'staged-not-prepared', ref: r.ref, detail: `"${r.title}" is called staged/ready but the board shows nothing prepared on it` });
    if (r.staged && s.late) out.push({ kind: 'staged-called-overdue', ref: r.ref, detail: `"${r.title}" is a STAGED invite (prepared, not sent) — it has no due date and is never overdue or late` });
  });
  if (rows.some((r) => r.changeRequest)) {
    const said = legitimisesDetailChange(answer);
    if (said) out.push({ kind: 'legitimises-detail-change', detail: `"${said.slice(0, 120)}" — a request to change payment details is never paid, used, updated or acknowledged; say it must be verified by calling a contact the user already holds` });
  }
  const a = fold(answer);
  if (NOTHING_BLOCKING.test(a)) {
    const overdue = rows.filter((r) => r.direction !== 'none' && !r.staged && /^\d{4}-\d{2}-\d{2}/.test(String(r.due ?? '')) && String(r.due).slice(0, 10) < opts.today);
    const saysBlocking = BLOCKING_SAID.test(a.replace(NOTHING_BLOCKING, ' '));
    if (overdue.length || saysBlocking) {
      out.push({ kind: 'nothing-blocking', detail: overdue.length
        ? `it says nothing is blocking while ${overdue.map((r) => `"${r.title}"`).join(', ')} ${overdue.length === 1 ? 'is' : 'are'} overdue`
        : 'it says nothing is blocking and also names something overdue/blocking' });
    }
  }
  if (opts.catchUp && opts.cards?.length) {
    for (const c of opts.cards) {
      if (!namesRow(answer, c)) out.push({ kind: 'card-unnamed', ref: c.ref, detail: `the card "${c.title}" shows under the answer but the answer never names it` });
    }
  }
  return out;
}

/** The one re-ask directive naming the conflicts (prepended to the page on the single retry). */
export function coherenceDirective(conflicts: CoherenceConflict[], draft?: string): string {
  return `YOUR PREVIOUS DRAFT OF THIS ANSWER CONTRADICTED ITSELF OR THE BOARD (THE LIVE BOARD rows state who owes each item and what is prepared):\n` +
    conflicts.map((c) => `- ${c.detail}`).join('\n') +
    `\nFix ONLY these statements — keep the format, sections, order and length the user asked for and everything else the draft said. ` +
    `Each row is stated once, in the one state its board line gives; say "nothing blocking" only if no row is overdue.` +
    (draft ? `\n\nTHE DRAFT TO CORRECT:\n${draft}` : '');
}

/** Which conflicts a NON-catch-up answer is held to (the safety- and truth-critical ones only). */
export const ALWAYS_CHECKED: ReadonlySet<CoherenceConflict['kind']> = new Set(['legitimises-detail-change', 'waiting-vs-settled', 'staged-called-overdue']);

/**
 * W42 · A NAME IS SAID ONCE (pure): "on Acme ACME" — a name immediately followed by its own copy
 * (any case, optionally bracketed/quoted/parenthesised, or as a markdown link whose text is the name)
 * collapses to one. Only the given names (the room's own project/people names) are touched.
 */
export function collapseRepeatedNames(text: string, names: Array<string | null | undefined>): string {
  let out = String(text ?? '');
  for (const raw of names) {
    const name = String(raw ?? '').trim();
    if (name.length < 2) continue;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    // name + copy (plain, quoted, parenthesised) → name; name + [copy](link) → [name](link).
    out = out
      .replace(new RegExp(`(?<![\\p{L}\\p{N}])(${esc})\\s+\\[(${esc})\\]\\(([^)\\s]+)\\)`, 'giu'), (_m, _a, b, href) => `[${b}](${href})`)
      .replace(new RegExp(`(?<![\\p{L}\\p{N}])(${esc})\\s*(?:\\(\\s*${esc}\\s*\\)|["“«]\\s*${esc}\\s*["”»]|\\s${esc})(?![\\p{L}\\p{N}])`, 'giu'), (_m, a) => a);
  }
  return out;
}
