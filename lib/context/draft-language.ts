// ════════════════════════════════════════════════════════════════════════════════════════════════
// A DRAFT SPEAKS THE THREAD'S LANGUAGE (W18.B — owner walk, Sep 25).
//
// Found live: an English thread (language detected correctly) got a reply opening "Olá <name>!" and
// signing "Obrigado! / Os melhores cumprimentos"; the direction-variant of the same reply came out
// entirely Portuguese. The voice exemplars were the user's newest sent mail — the SAME Portuguese
// message three times, quoted history included — and the prompt told the model to match their
// "greeting style … and sign-off". It did, literally. Nothing checked the output: the prompt rule was
// the only floor, and a prompt rule is a hope, not a gate.
//
// The class fix has three parts, and this module owns the two that are not prompt text:
//   1. EXEMPLARS IN THE TARGET LANGUAGE ONLY — `selectExemplars`: top message only (never quoted
//      history), deduped by normalised body, and kept only when their own detected language IS the
//      target. None match → none shown (fewer examples beat a wrong-language one).
//   2. THE OUTPUT CHECK — `draftLanguageMiss` (zero AI): the body's detected language differs from the
//      target, OR a greeting/sign-off line carries another language's salutation words ("Olá",
//      "Obrigado", "Cumprimentos" on an English reply — the exact leak, which a whole-body detector
//      misses because the English middle outvotes it). `draftInLanguage` runs ONE revise pass with a
//      hard language instruction, and a draft still wrong after it is NOT served ('' — the callers'
//      existing honest not-prepared state; A CLAIM RENDERS: no surface claims a draft we refused).
//
// Fail-safe: with no detectable target language the check does not speak (nothing to verify
// against). A body too short to detect is not a miss by itself — only positive evidence of another
// language is. Pure, zero IO, client-safe.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { detectLanguage } from '@/lib/inbox/detect-language';
import { topMessageOf } from '@/lib/inbox/top-message';
import { plainBody } from '@/lib/core/text';

// ── 1 · EXEMPLARS ────────────────────────────────────────────────────────────────────────────────

export type ExemplarRow = { subject?: string | null; body: string | null; html_body: string | null };

/** The user's OWN words in a sent mail: plain text (HTML converted), top message only. */
export function exemplarTextOf(e: ExemplarRow): string {
  const raw = e.body && e.body.trim() ? plainBody(e.body) : plainBody(e.html_body || '');
  const top = topMessageOf(raw);
  return (top && top.trim() ? top : raw).trim();
}

/** Normalised identity of a body for dedupe — the same mail sent three times is ONE example. */
export function exemplarKey(text: string): string {
  return String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Pick at most `max` exemplar texts from candidate rows (already in preference order): top message
 * only, empty dropped, deduped by normalised body, and — when a target language is known — only
 * those whose detected language IS the target (an undetectable sample is dropped too: it cannot be
 * shown to be in the right language). No target → dedupe only. Pure.
 */
export function selectExemplars(rows: ExemplarRow[], opts: { language?: string | null; max: number }): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const target = opts.language || null;
  for (const r of rows) {
    if (out.length >= opts.max) break;
    const text = exemplarTextOf(r);
    if (!text) continue;
    const key = exemplarKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (target && detectLanguage(text) !== target) continue;
    out.push(text);
  }
  return out;
}

// ── 2 · THE OUTPUT CHECK ─────────────────────────────────────────────────────────────────────────

/** Salutation words — the greeting and sign-off vocabulary that leaks when a model copies an
 *  exemplar's frame. Unambiguous per language only (a word two languages share is left out). */
const SALUTATIONS: Record<string, string[]> = {
  English: ['hi', 'hello', 'dear', 'thanks', 'thank', 'regards', 'cheers', 'sincerely', 'best'],
  Portuguese: ['olá', 'obrigado', 'obrigada', 'cumprimentos', 'abraço', 'abraços', 'beijinhos', 'atenciosamente', 'prezado', 'prezada', 'saudações', 'melhores'],
  French: ['bonjour', 'bonsoir', 'merci', 'cordialement', 'amicalement', 'salutations', 'chère', 'cher'],
  Spanish: ['hola', 'gracias', 'estimado', 'estimada', 'atentamente', 'saludos', 'abrazo'],
  German: ['hallo', 'liebe', 'lieber', 'geehrte', 'geehrter', 'danke', 'grüße', 'gruß', 'viele'],
  Italian: ['ciao', 'gentile', 'grazie', 'cordiali', 'distinti', 'salve', 'buongiorno'],
};

/** The greeting and sign-off lines of a draft: the first non-empty line and the last four. */
function edgeLinesOf(text: string): string[] {
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 5) return lines;
  return [lines[0], ...lines.slice(-4)];
}

/** A salutation line in a language other than the target, or null. */
export function foreignSalutationIn(text: string | null | undefined, target: string): { line: string; language: string } | null {
  for (const line of edgeLinesOf(String(text ?? ''))) {
    const tokens = new Set(line.toLowerCase().match(/[\p{L}]+/gu) ?? []);
    const has = (lang: string) => (SALUTATIONS[lang] ?? []).some((w) => tokens.has(w));
    if (has(target)) continue; // a line that greets in the target language is fine
    for (const lang of Object.keys(SALUTATIONS)) {
      if (lang !== target && has(lang)) return { line, language: lang };
    }
  }
  return null;
}

export type LanguageMiss = { detected: string; line: string | null };

/** Whether a draft body is NOT in the target language — positive evidence only. Null target or a
 *  clean body → null. Pure. */
export function draftLanguageMiss(text: string | null | undefined, target: string | null | undefined): LanguageMiss | null {
  const t = String(text ?? '').trim();
  if (!t || !target) return null;
  const whole = detectLanguage(t);
  if (whole && whole !== target) return { detected: whole, line: null };
  const edge = foreignSalutationIn(t, target);
  if (edge) return { detected: edge.language, line: edge.line };
  return null;
}

/** The body is verified to be in the target language: detected AS the target, with no foreign
 *  salutation line. (Undetectable ≠ verified.) Pure. */
export function draftLanguageVerified(text: string | null | undefined, target: string | null | undefined): boolean {
  if (!target) return false;
  return detectLanguage(String(text ?? '')) === target && !draftLanguageMiss(text, target);
}

/** The hard instruction a revise pass carries — one wording. */
export function languageRevision(target: string, miss: LanguageMiss): string {
  return `LANGUAGE CORRECTION — your previous draft was not in ${target}` +
    (miss.line ? ` (this line is in ${miss.detected}: "${miss.line.slice(0, 80)}")` : ` (it was written in ${miss.detected})`) +
    `. Rewrite the WHOLE message in ${target} only — the greeting and the sign-off too, as their natural ` +
    `${target} equivalents. Do not copy any greeting, sign-off or phrase from the example emails.`;
}

/** The prompt sentence that frames voice exemplars — shape and warmth, never the words. */
export function exemplarRule(target: string | null | undefined): string {
  return target
    ? `The example emails teach SHAPE and WARMTH only — never copy their greeting, sign-off or phrases; ` +
      `write the greeting and sign-off as their natural ${target} equivalents.`
    : `The example emails teach SHAPE and WARMTH only — never copy their greeting, sign-off or phrases; ` +
      `write the greeting and sign-off in the language of the message you are writing.`;
}

/**
 * THE LANGUAGE-CHECKED GENERATION — generate; a draft with positive evidence of another language
 * gets ONE revise pass (the generator receives the hard instruction); still wrong → NOT served
 * (`body: ''`). No target → the first generation stands, unverified. The generator is the caller's
 * own drafter call, so every producer keeps its one prompt. Pure loop (the gate drives it with a
 * stubbed generator).
 */
export async function draftInLanguage(
  generate: (languageFix: string | null) => Promise<string>,
  target: string | null | undefined,
): Promise<{ body: string; verified: boolean; refused: LanguageMiss | null; attempts: number }> {
  const first = String(await generate(null) ?? '').trim();
  if (!first || !target) return { body: first, verified: false, refused: null, attempts: 1 };
  const m1 = draftLanguageMiss(first, target);
  if (!m1) return { body: first, verified: draftLanguageVerified(first, target), refused: null, attempts: 1 };
  const second = String(await generate(languageRevision(target, m1)).catch(() => '') ?? '').trim();
  const m2 = second ? draftLanguageMiss(second, target) : m1;
  if (second && !m2) return { body: second, verified: draftLanguageVerified(second, target), refused: null, attempts: 2 };
  return { body: '', verified: false, refused: m2 ?? m1, attempts: 2 };
}

/** W36 · THEIR FORM OF ADDRESS, READ IN CODE (eval sent.compose, EU: a German contact who wrote "Ihnen" was
 *  answered "kannst du" three runs in a row, the rule notwithstanding). The T–V distinction of the languages
 *  the product serves, read from the correspondents' own words: formal / informal / null (unknown or no
 *  such distinction). Case-sensitive for German, where capitalised Sie/Ihnen is the formal pronoun. Pure. */
export function addressRegisterOf(words: string): 'formal' | 'informal' | null {
  const t = String(words ?? '');
  const midSentenceSie = /[^.!?\n]\s+(Sie|Ihnen|Ihr|Ihre|Ihren|Ihrem|Ihrer)\b/.test(t);
  const formal = midSentenceSie || /\b(vous|votre|vos|usted|ustedes|o senhor|a senhora)\b/i.test(t);
  const informal = /\b(du|dich|dir|dein|deine|deinen|deinem|deiner|tu|toi|tes|tú)\b/i.test(t);
  if (formal && !informal) return 'formal';
  if (informal && !formal) return 'informal';
  return null;
}
