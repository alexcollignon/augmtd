// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE NAMING FLOOR — a machine-founded body of work never wears a message header as its name.
//
// Found live (a pilot's Home chat): a project stood in the registry called "About <X> Family
// Business AI Workshop?" — an email SUBJECT LINE, question mark and all. Recognition's founding
// door takes the name straight from the judge's `new_name` / `named_engagement`, and both are free
// text read off an item whose most salient string is its subject. A subject-shaped name is not a
// cosmetic problem: it is a WIDE name (many tokens, aboutness filler, punctuation) and every
// identity primitive in the house — namesOverlap, namesStatedIn, the focus match — reasons over a
// name's tokens, so a subject-shaped name matches far more text than the work it denotes.
//
// THE FLOOR, deterministic and conservative (never a model pass):
//   1. reply/forward heads come off by the house's ONE table (lib/inbox/campaign-echo REPLY_PREFIX —
//      reuse, never a second language list). A VOCABULARY, deliberately: a shape rule ("a short word
//      before a colon") would eat a real "Acme: Phase 2".
//   2. leading ABOUTNESS filler comes off ("About …", "Regarding …", and their PT/DE/FR forms), plus
//      ONE article directly behind it ("About the Acme workshop" → "Acme workshop") — an article is
//      only ever removed in the wake of a filler word, so "The Acme rollout" keeps its "The".
//   3. terminal punctuation and wrapping quotes come off ("…workshop?" → "…workshop").
// Every step is REFUSED when it would leave nothing substantive behind (a ≥3-character word must
// survive), and the whole thing falls back to the trimmed original rather than ever returning empty.
// Pure, no I/O, gate-testable.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { REPLY_PREFIX } from '@/lib/inbox/campaign-echo';

/** Aboutness heads — the words a subject line uses to announce its topic, in the four languages the
 *  corpus carries. Only ever stripped from the FRONT, and only while something substantive stays. */
const ABOUTNESS = new Set([
  'about', 'regarding', 'concerning', 'subject', 'ref', 'reference',
  'sobre', 'assunto', 'referente', 'acerca',
  'betreff', 'betrifft', 'bezueglich', 'bezüglich',
  'objet', 'concernant', 'propos',
]);

/** Articles — removed ONLY in the wake of an aboutness word (see the floor's clause 2). */
const ARTICLES = new Set([
  'the', 'a', 'an', 'o', 'os', 'as', 'um', 'uma', 'der', 'die', 'das', 'ein', 'eine',
  'le', 'la', 'les', 'un', 'une', 'des', 'du',
]);

const fold = (s: string): string => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Something a name can actually denote: at least one word of three characters or more. */
const hasSubstance = (s: string): boolean => /[\p{L}\p{N}]{3,}/u.test(s);

const stripEdges = (s: string): string =>
  s.replace(/^[\s"'“”«»‹›()[\]:;,.\-–—]+/u, '')
    .replace(/[\s"'“”«»‹›:;,.!?…\-–—]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();

/** THE FLOOR, as one function. Returns a name safe to store; never empty when given text. */
export function cleanEntityName(raw: string | null | undefined, maxLen = 80): string {
  const original = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!original) return '';
  let s = original;

  // 1 · reply/forward heads (the house table, applied until it stops matching).
  for (let prev = ''; s !== prev;) {
    prev = s;
    const next = s.replace(REPLY_PREFIX, '').trim();
    if (next !== s && hasSubstance(next)) s = next;
  }

  // 2 · leading aboutness filler, plus one article behind it.
  for (let guard = 0; guard < 3; guard++) {
    // "About the …" and "Betreff: …" are the same head — an aboutness word, colon or not.
    const m = /^([\p{L}]+)(?:\s*:\s*|\s+)(.+)$/u.exec(s);
    if (!m || !ABOUTNESS.has(fold(m[1]))) break;
    let rest = m[2].trim();
    const am = /^([\p{L}]+)\s+(.+)$/u.exec(rest);
    if (am && ARTICLES.has(fold(am[1]))) rest = am[2].trim();
    if (!hasSubstance(rest)) break;
    s = rest;
  }

  // 3 · edges: wrapping quotes and terminal punctuation ("…workshop?" is a question, not a name).
  const edged = stripEdges(s);
  if (hasSubstance(edged)) s = edged;

  const out = s.slice(0, maxLen).trim();
  return hasSubstance(out) ? out : original.slice(0, maxLen);
}

/** Does this name still read as a message header? (The sweep's proposal test and the gate's.) */
export function isSubjectShapedName(raw: string | null | undefined): boolean {
  const original = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!original) return false;
  return cleanEntityName(original) !== original;
}
