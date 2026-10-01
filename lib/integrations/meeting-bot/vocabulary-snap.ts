/**
 * THE VOCABULARY SNAP (Oct 1) — a post-transcription correction of near-miss proper nouns: Whisper
 * hears a name the meeting's vocabulary carries but spells it its own way ("Akme" for "Acme",
 * "Globax" for "Globex", "SAM" for "Sam", "Jordan Veil" for "Jordan Vale"). The prompt + hotwords
 * (transcription-vocabulary.ts → the box) bias decoding; this is the deterministic floor after it,
 * app-side so it needs no box redeploy. Pure and client-safe — no I/O.
 *
 * STRICT BY CONSTRUCTION — a snap only REPLACES a span that is already a near-copy of a term; it
 * never inserts text, so a vocabulary term the audio never says (a decoy) cannot appear. A span
 * snaps only when ALL hold:
 *   · the term is in THIS meeting's vocabulary (the caller passes it; nothing global);
 *   · the span carries a proper-noun signal (a capitalised or all-caps token) and is not a common
 *     function word in any of the product's languages (COMMON below), nor itself another term;
 *   · the folded span (lower-case, no diacritics, letters/digits only) equals the folded term, or —
 *     for terms of 4+ letters with no digits — is within edit distance 1 (2 from 8+ letters) of it,
 *     measured on the merged spelling (c/k/q, ph/f, ch/k, s/z, doubles…), AND has the same phonetic key (first letter + consonant skeleton with c/k/q, ph/f, s/z… merged);
 *   · a span split or merged differently from the term ("North Wind" for "Northwind") must spell
 *     it exactly (merged spelling) with no common word inside — fuzzy matches are word-for-word only;
 *   · exactly one term matches the span (ambiguity → no snap).
 * Every snap is returned so the caller logs it ("from → to").
 */

export type VocabularySnap = { from: string; to: string };

/** High-frequency words (EN/PT/DE/FR/ES/IT) a capitalised sentence start must never lose to a name. */
const COMMON = new Set((
  'a an and are as at be but by for from had has have he her his i if in is it its me my no not of on or our she so than ' +
  'that the their them then there they this to us was we were what when which who will with you your yes okay ok same some ' +
  'acne game came name time come home make take like just also only even very well here where were more most much many ' +
  'o os as um uma uns umas de da do das dos e em na no nas nos ao aos à às por para com sem que se não sim mas mais muito ' +
  'eu tu ele ela nós vós eles elas meu minha seu sua isso isto aqui ali bom boa dia tudo todos todas fala falar ' +
  'der die das den dem des ein eine einen einem einer und oder aber nicht ist sind war ich du er sie es wir ihr mit von zu ' +
  'im am an auf für bei aus nach vor über unter hier dort ja nein gut tag acht macht ' +
  'le la les un une des du et ou mais pas est sont je tu il elle nous vous ils elles avec pour dans sur chez par ici oui non ' +
  'el los las y o pero es son yo con para en por sí ' +
  'il lo gli una e o ma non è sono io con per in su da sì'
).split(/\s+/).filter(Boolean));

const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** First letter + consonant skeleton with common cross-language spellings merged. */
/** Folded spelling with cross-language consonant spellings merged (vowels kept) — what distance runs on. */
function spelling(s: string): string {
  return fold(s).replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/qu/g, 'k').replace(/[cq]/g, 'k').replace(/x/g, 'ks')
    .replace(/z/g, 's').replace(/w/g, 'v').replace(/y/g, 'i').replace(/([^aeiou])h/g, '$1').replace(/(.)\1+/g, '$1');
}

export function phoneticKey(s: string): string {
  const t = spelling(s);
  if (!t) return '';
  const head = /[aeiou]/.test(t[0]) ? 'a' : t[0];
  const body = t.slice(1).replace(/[aeiouh]/g, '').replace(/(.)\1+/g, '$1');
  return head + body;
}

function distance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

type Term = { surface: string; folded: string; spelled: string; key: string; words: number; fuzzy: number };

function prepare(vocabulary: readonly string[]): Term[] {
  const out: Term[] = [];
  const seen = new Set<string>();
  for (const raw of vocabulary) {
    if (typeof raw !== 'string') continue;
    const surface = raw.replace(/\s+/g, ' ').trim();
    const folded = fold(surface);
    if (folded.length < 2 || seen.has(folded)) continue;
    seen.add(folded);
    const letters = folded.replace(/\d/g, '').length;
    const fuzzy = /\d/.test(folded) || letters < 4 ? 0 : letters >= 8 ? 2 : 1;
    out.push({ surface, folded, spelled: spelling(surface), key: phoneticKey(surface), words: surface.split(' ').length, fuzzy });
  }
  return out;
}

const PROPER = /^\p{Lu}/u;

/** Snap near-miss spellings of the meeting's vocabulary terms in one text. */
export function snapToVocabulary(text: string, vocabulary: readonly string[]): { text: string; snaps: VocabularySnap[] } {
  const terms = prepare(vocabulary);
  if (!terms.length || !text) return { text, snaps: [] };
  const termFolds = new Set(terms.map((t) => t.folded));
  const tokens = [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ s: m[0], start: m.index!, end: m.index! + m[0].length }));
  const snaps: VocabularySnap[] = [];
  let out = '';
  let cursor = 0;
  for (let i = 0; i < tokens.length;) {
    let verbatim: { term: Term; len: number } | null = null;
    const near: Array<{ term: Term; len: number }> = [];
    for (const term of terms) {
      for (const len of [term.words, term.words + 1, term.words - 1]) {
        if (len < 1 || i + len > tokens.length) continue;
        const span = tokens.slice(i, i + len);
        // Tokens must be adjacent words (a space or a hyphen/apostrophe between them, no sentence break).
        if (span.some((t, k) => k > 0 && !/^[\s'’-]{0,2}$/.test(text.slice(span[k - 1].end, t.start)))) continue;
        const surface = text.slice(span[0].start, span[len - 1].end);
        if (surface === term.surface) { verbatim ??= { term, len }; break; }
        if (!span.some((t) => PROPER.test(t.s))) continue;
        if (span.every((t) => COMMON.has(fold(t.s)))) continue;
        const f = fold(surface);
        if (f !== term.folded && termFolds.has(f)) continue; // the span is ANOTHER term — leave it
        const exact = f === term.folded;
        // A split/merged span ("Ak me", "North Wind") must spell the term exactly, word by word
        // un-common — a fuzzy match there would swallow a neighbouring word ("à Initek").
        if (len !== term.words && !(span.every((t) => !COMMON.has(fold(t.s))) && spelling(surface) === term.spelled)) continue;
        if (!exact && !(term.fuzzy && !/\d/.test(f) && distance(spelling(surface), term.spelled) <= term.fuzzy && phoneticKey(surface) === term.key)) continue;
        near.push({ term, len });
        break;
      }
    }
    // Already spelled right → keep it (and skip past it); one near match → snap; several → ambiguous, leave.
    const best = verbatim ?? (near.length === 1 ? near[0] : null);
    if (best) {
      const span = tokens.slice(i, i + best.len);
      const from = text.slice(span[0].start, span[best.len - 1].end);
      out += text.slice(cursor, span[0].start) + best.term.surface;
      cursor = span[best.len - 1].end;
      if (from !== best.term.surface) snaps.push({ from, to: best.term.surface });
      i += best.len;
    } else i++;
  }
  return { text: out + text.slice(cursor), snaps };
}

/** Snap every segment of a transcript; returns new segments (input untouched) + every snap made. */
export function snapSegments<T extends { text?: string | null }>(segments: readonly T[], vocabulary: readonly string[]): { segments: T[]; snaps: VocabularySnap[] } {
  const snaps: VocabularySnap[] = [];
  const out = segments.map((s) => {
    if (typeof s?.text !== 'string') return s;
    const r = snapToVocabulary(s.text, vocabulary);
    snaps.push(...r.snaps);
    return r.snaps.length ? { ...s, text: r.text } : s;
  });
  return { segments: out, snaps };
}
