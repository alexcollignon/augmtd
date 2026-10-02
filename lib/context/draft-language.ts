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

// ── W42 · THE FRAME FOLLOWS THE BODY (owner walk, Oct 2) ────────────────────────────────────────
// A French draft opened "Hi <name>," and closed "Best regards," around a French body — a model copying a
// template's frame. The greeting and sign-off are the body's language and the thread's register, IN CODE:
// a line that is ONLY a greeting (+ name) or ONLY a closing, in another language than the body, is
// rewritten to the body's own. Body sentences are never touched. Pure.

type Frame = { hi: { formal: string; informal: string }; bye: { formal: string; informal: string } };
const FRAMES: Record<string, Frame> = {
  English: { hi: { formal: 'Dear', informal: 'Hi' }, bye: { formal: 'Kind regards,', informal: 'Best,' } },
  French: { hi: { formal: 'Bonjour', informal: 'Bonjour' }, bye: { formal: 'Cordialement,', informal: 'Bien à toi,' } },
  German: { hi: { formal: 'Guten Tag', informal: 'Hallo' }, bye: { formal: 'Mit freundlichen Grüßen', informal: 'Viele Grüße' } },
  Portuguese: { hi: { formal: 'Bom dia', informal: 'Olá' }, bye: { formal: 'Com os melhores cumprimentos,', informal: 'Abraço,' } },
  Spanish: { hi: { formal: 'Buenos días', informal: 'Hola' }, bye: { formal: 'Saludos cordiales,', informal: 'Un saludo,' } },
  Italian: { hi: { formal: 'Buongiorno', informal: 'Ciao' }, bye: { formal: 'Cordiali saluti,', informal: 'A presto,' } },
};
/** A whole-line greeting: the greeting words, then an optional name, then , or ! (per language). */
const GREETING_LINE: Record<string, RegExp> = {
  English: /^(hi|hello|hey|dear|good (morning|afternoon|evening))\b\s*([^,!:.\n]{0,60}?)\s*[,!:]?$/i,
  French: /^(bonjour|bonsoir|salut|cher|chère|chers|madame|monsieur)\b\s*([^,!:.\n]{0,60}?)\s*[,!:]?$/i,
  German: /^(hallo|hi|liebe|lieber|guten (tag|morgen|abend)|sehr geehrte[r]?)\b\s*([^,!:.\n]{0,60}?)\s*[,!:]?$/i,
  Portuguese: /^(olá|ola|oi|bom dia|boa tarde|boa noite|caro|cara|prezado|prezada)\b\s*([^,!:.\n]{0,60}?)\s*[,!:]?$/i,
  Spanish: /^(hola|buenos días|buenos dias|buenas tardes|buenas noches|estimado|estimada|querido|querida)\b\s*([^,!:.\n]{0,60}?)\s*[,!:]?$/i,
  Italian: /^(ciao|buongiorno|buonasera|salve|gentile|caro|cara)\b\s*([^,!:.\n]{0,60}?)\s*[,!:]?$/i,
};
/** A whole-line closing (per language). */
const CLOSING_LINE: Record<string, RegExp> = {
  English: /^((best|kind|warm|many)( regards| wishes)?|regards|cheers|sincerely|yours sincerely|yours truly|thanks|thank you|many thanks|thanks again|all the best|talk soon)[,.!]?$/i,
  French: /^(cordialement|bien cordialement|bien à (vous|toi)|bien a (vous|toi)|amicalement|merci|merci beaucoup|bonne journée|bonne journee|salutations|sincères salutations|à bientôt|a bientot)[,.!]?$/i,
  German: /^(viele grüße|viele gruesse|beste grüße|liebe grüße|mit freundlichen grüßen|freundliche grüße|grüße|gruß|danke|vielen dank|bis bald)[,.!]?$/i,
  Portuguese: /^(cumprimentos|com os melhores cumprimentos|melhores cumprimentos|atenciosamente|abraço|abraços|um abraço|obrigado|obrigada|até breve|saudações)[,.!]?$/i,
  Spanish: /^(saludos|saludos cordiales|un saludo|atentamente|un abrazo|gracias|muchas gracias|hasta pronto)[,.!]?$/i,
  Italian: /^(cordiali saluti|distinti saluti|saluti|a presto|grazie|un saluto)[,.!]?$/i,
};

/** The body's language with the frame lines left out (so the frame cannot vote for itself). */
function bodyLanguageOf(lines: string[]): string | null {
  const inner = lines.filter((l) => {
    const t = l.trim();
    return t && !Object.values(GREETING_LINE).some((re) => re.test(t)) && !Object.values(CLOSING_LINE).some((re) => re.test(t));
  });
  return detectLanguage(inner.join('\n'));
}

/**
 * THE FRAME FLOOR (pure): rewrite a greeting/closing LINE written in another language than `target`
 * (or, with no target, than the body's own detected language) into that language's natural equivalent,
 * in the given register. The name after a greeting is kept. Returns the text unchanged when nothing
 * is foreign or the language is unknown.
 */
export function alignDraftFrame(text: string, target?: string | null, register?: 'formal' | 'informal' | null): string {
  const raw = String(text ?? '');
  if (!raw.trim()) return raw;
  const lines = raw.split('\n');
  const lang = (target && FRAMES[target]) ? target : bodyLanguageOf(lines);
  if (!lang || !FRAMES[lang]) return raw;
  const frame = FRAMES[lang];
  const reg = register === 'informal' ? 'informal' : register === 'formal' ? 'formal' : null;
  const filled = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.trim());
  if (!filled.length) return raw;
  // The greeting: the first non-empty line only.
  const g = filled[0];
  const gt = g.l.trim();
  if (!GREETING_LINE[lang].test(gt)) {
    for (const [other, re] of Object.entries(GREETING_LINE)) {
      if (other === lang) continue;
      const m = re.exec(gt);
      if (!m) continue;
      const name = (m[m.length - 1] ?? '').trim();
      // "Dear" reads formal, "Hi/Hey/Hallo/Ciao/Olá/Hola" informal, unless the thread's register says.
      const formalWord = /^(dear|cher|chère|chers|madame|monsieur|sehr geehrte|liebe|lieber|caro|cara|prezad|estimad|gentile|guten|bom dia|buenos|buongiorno)/i.test(m[1]);
      const word = frame.hi[reg ?? (formalWord ? 'formal' : 'informal')];
      lines[g.i] = g.l.replace(gt, `${word}${name ? ` ${name}` : ''},`);
      break;
    }
  }
  // The closing: any of the last four non-empty lines that is ONLY a closing, in another language.
  for (const { l, i } of filled.slice(-4)) {
    if (i === g.i) continue;
    const t = l.trim();
    if (CLOSING_LINE[lang].test(t)) continue;
    const foreign = Object.entries(CLOSING_LINE).some(([other, re]) => other !== lang && re.test(t));
    if (!foreign) continue;
    const warm = /^(best|cheers|thanks|talk soon|abraço|abraços|um abraço|un abrazo|a presto|à bientôt|a bientot|bis bald|liebe grüße|viele grüße|ciao)/i.test(t);
    lines[i] = l.replace(t, frame.bye[reg ?? (warm ? 'informal' : 'formal')]);
  }
  // The register: a FORMAL thread never gets an informal frame in its own language ("Hallo …" / "Viele Grüße"
  // answering "Mit freundlichen Grüßen"), and a bare-name greeting ("Ana,") gets its formal opener.
  if (reg === 'formal') {
    const informalHi = INFORMAL_HI[lang];
    const g2 = filled[0];
    const t2 = lines[g2.i].trim();
    const m = informalHi?.exec(t2);
    if (m) lines[g2.i] = lines[g2.i].replace(t2, `${frame.hi.formal}${m[2]?.trim() ? ` ${m[2].trim()}` : ''},`);
    else if (!Object.values(GREETING_LINE).some((re) => re.test(t2)) && /^\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+){0,2}\s*,$/u.test(t2)) lines[g2.i] = lines[g2.i].replace(t2, `${frame.hi.formal} ${t2.replace(/\s*,$/, '')},`);
    for (const { i } of filled.slice(-4)) {
      if (i === g2.i) continue;
      const t3 = lines[i].trim();
      if (INFORMAL_BYE[lang]?.test(t3)) lines[i] = lines[i].replace(t3, frame.bye.formal);
    }
  }
  return lines.join('\n');
}

const INFORMAL_HI: Record<string, RegExp> = {
  German: /^(hallo|hi|hey|moin)\b\s*([^,!:.\n]{0,60}?)\s*[,!:]?$/i,
  French: /^(salut|coucou|hello|hi)\b\s*([^,!:.\n]{0,60}?)\s*[,!:]?$/i,
  Portuguese: /^(oi|olá|ola|hi)\b\s*([^,!:.\n]{0,60}?)\s*[,!:]?$/i,
  Spanish: /^(hola|hey)\b\s*([^,!:.\n]{0,60}?)\s*[,!:]?$/i,
  Italian: /^(ciao|hey)\b\s*([^,!:.\n]{0,60}?)\s*[,!:]?$/i,
  English: /^(hey|hiya)\b\s*([^,!:.\n]{0,60}?)\s*[,!:]?$/i,
};
const INFORMAL_BYE: Record<string, RegExp> = {
  German: /^(viele grüße|viele gruesse|liebe grüße|beste grüße|lg|vg|bis bald|gruß|grüße)[,.!]?$/i,
  French: /^(bien à toi|bien a toi|bises|à bientôt|a bientot|à plus|a\+)[,.!]?$/i,
  Portuguese: /^(abraço|abraços|um abraço|beijos|beijinhos|até breve|até já|cumprimentos)[,.!]?$/i,
  Spanish: /^(un abrazo|abrazos|besos|hasta pronto|saludos)[,.!]?$/i,
  Italian: /^(a presto|un abbraccio|ciao)[,.!]?$/i,
  English: /^(cheers|best|talk soon|thanks|xx)[,.!]?$/i,
};

/**
 * W42 · AN HONORIFIC TAKES THE SURNAME (pure): "Sehr geehrter Herr Jonas" — a courtesy title before a FIRST
 * name. With the recipient's full name known the first name becomes the surname; with only a first name the
 * honorific goes and the formal opener of that language greets by first name. Untouched otherwise.
 */
export function fixHonorificName(text: string, recipientName: string | null | undefined): string {
  const raw = String(text ?? '');
  const name = String(recipientName ?? '').replace(/<[^>]*>/g, '').replace(/["']/g, '').trim();
  if (!raw.trim() || !name || name.includes('@')) return raw;
  const toks = name.split(/\s+/).filter(Boolean);
  const first = toks[0];
  const lines = raw.split('\n');
  const gi = lines.findIndex((l) => l.trim());
  if (gi < 0) return raw;
  const line = lines[gi].trim();
  const m = /^((?:sehr geehrte[r]?|liebe[r]?|dear|cher|chère|caro|cara|prezad[oa]|estimad[oa]|exm[oa]\.?)\s+)?(herr|frau|mr\.?|mrs\.?|ms\.?|monsieur|madame|senhor|senhora|sr\.?|sra\.?|señor|señora|signor|signora)\s+(\p{Lu}[\p{L}'-]+)\s*([,!:]?)$/iu.exec(line);
  if (!m || m[3].localeCompare(first, undefined, { sensitivity: 'base' }) !== 0) return raw;
  if (toks.length >= 2) {
    lines[gi] = lines[gi].replace(m[3], toks[toks.length - 1]);
    return lines.join('\n');
  }
  const hon = m[2].toLowerCase();
  const lang = /herr|frau/.test(hon) ? 'German' : /monsieur|madame/.test(hon) ? 'French' : /senhor|senhora/.test(hon) ? 'Portuguese'
    : /señor|señora|^sr|^sra/.test(hon) ? 'Spanish' : /signor/.test(hon) ? 'Italian' : 'English';
  lines[gi] = lines[gi].replace(line, `${FRAMES[lang].hi.formal} ${first},`);
  return lines.join('\n');
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
  register?: 'formal' | 'informal' | null,
): Promise<{ body: string; verified: boolean; refused: LanguageMiss | null; attempts: number }> {
  // W42: every generation passes THE FRAME FLOOR first — a foreign greeting/sign-off around a body in the
  // target language is rewritten in code (no revise pass spent, never refused for its frame alone);
  // with no target, the frame follows the body's own detected language.
  const first = alignDraftFrame(String(await generate(null) ?? '').trim(), target, register);
  if (!first || !target) return { body: first, verified: false, refused: null, attempts: 1 };
  const m1 = draftLanguageMiss(first, target);
  if (!m1) return { body: first, verified: draftLanguageVerified(first, target), refused: null, attempts: 1 };
  const second = alignDraftFrame(String(await generate(languageRevision(target, m1)).catch(() => '') ?? '').trim(), target, register);
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
