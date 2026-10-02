// W28 · THE SIGN-OFF IS THE USER'S, IN CODE. A drafted message the user sends is signed with the user's own
// name (their profile). Found by the W28 eval: drafts signed "Clara" (the drafting coworker), "Me", or a
// literal "[Your Name]". Only a closing line that is one of those WRONG identities is rewritten — a real
// signature the user wrote (or a name we do not know to be wrong) is never touched. Pure.
export function enforceUserSignOff(body: string, userName: string | null | undefined, wrongNames: string[] = []): string {
  const name = String(userName ?? '').trim();
  if (!name || /^me$/i.test(name)) return body;
  const first = name.split(/\s+/)[0];
  const wrong = new Set(['me', '[your name]', 'your name', '[name]', ...wrongNames.map((n) => n.trim().toLowerCase()).filter(Boolean),
    ...wrongNames.map((n) => n.trim().split(/\s+/)[0].toLowerCase()).filter(Boolean)]);
  const lines = String(body ?? '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (!l) continue;
    const bare = l.replace(/[*_]/g, '');
    // W42: a name PLACEHOLDER in any language ("[Ihr Name]", "[Votre nom]", "[o meu nome]", "[Su nombre]") is wrong too.
    const placeholder = /^\[[^\]]{0,24}\b(name|nom|nome|nombre|vorname)\b[^\]]{0,12}\]$/i.test(bare);
    if (wrong.has(bare.toLowerCase()) || placeholder) lines[i] = lines[i].replace(l, first);
    break;
  }
  return lines.join('\n');
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// W43 · THE SIGNATURE IS THE USER'S RECURRING LINES — NEVER A CODE (owner walk, Oct 2: a draft signed
// "<name>\n<7-char ref> <7-char ref>" — a reference code from another message taken as part of the
// signature; the same suffix shape rode several paste packs). The model writes the sign-off from the voice
// exemplars, and anything near an exemplar's tail could ride along. THE RULE, in code:
//   · the user's signature lines are DERIVED from their OWN sent mail only (is_from_user; the quoted chain
//     cut off — received mail never contributes), and a line counts only when it recurs in ≥2 samples;
//   · a CODE-LIKE line is never a signature line, recurring or not: a mixed letters+digits token, an
//     all-caps token without vowels, a phone-, IBAN- or long-number-like run;
//   · in a draft, after the sign-off (the closing cue or the user's name), only the name and the derived
//     recurring lines stand; code tokens are cut from the name line itself. Pure; tests/unit/w43-*.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const fold = (s: string): string => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();

/** One token is a CODE (a reference, an id), never a word of a signature. Pure. */
export function isCodeToken(raw: string): boolean {
  const t = String(raw ?? '').replace(/^[^\p{L}\p{N}+]+|[^\p{L}\p{N}]+$/gu, '');
  if (t.length < 5) return false;
  if (/[@/]|\.[a-z]{2,}/i.test(t)) return false;                                // an address or a link is not a code
  const letters = /\p{L}/u.test(t), digits = /\d/.test(t);
  if (letters && digits) return true;                                           // 7KQ2ZTX · ZP4K9WD · AB12CD
  if (/^\d{6,}$/.test(t)) return true;                                          // a long bare number
  if (/^\p{Lu}+$/u.test(t) && !/[AEIOUY]/i.test(t.normalize('NFD').replace(/[̀-ͯ]/g, ''))) return true; // PVWCR — no vowel, not a word
  return false;
}

/** A line that is a code, a phone/IBAN-like run or a long number — never a signature line. Pure. */
export function isCodeLikeLine(line: string): boolean {
  const l = String(line ?? '').trim();
  if (!l) return false;
  if (/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,}/.test(l)) return true;              // IBAN-like
  const digits = (l.match(/\d/g) ?? []).length;
  if (digits >= 8 && /^[+()\d\s./-]*\p{L}{0,12}[:.]?\s*[+()\d\s./-]+$/u.test(l)) return true; // phone/number run (with an optional short label)
  return l.split(/\s+/).some(isCodeToken);
}

const QUOTE_CUT = /^(?:>|on .{4,80}wrote:|le .{4,90}a écrit|am .{4,90}schrieb|em .{4,90}escreveu|no dia .{4,90}escreveu|-{2,}\s*original message|from:\s|de\s?:\s|von:\s|_{10,})/i;

/** The last non-empty lines of a sent message's OWN words (the quoted chain cut off). Pure. */
function ownTail(body: string, n: number): string[] {
  const lines = String(body ?? '').replace(/\r\n/g, '\n').split('\n');
  const cut = lines.findIndex((l) => QUOTE_CUT.test(l.trim()));
  const own = (cut >= 0 ? lines.slice(0, cut) : lines).map((l) => l.trim()).filter(Boolean);
  return own.slice(-n);
}

/**
 * THE USER'S SIGNATURE LINES — the tail lines that recur across ≥`minSamples` of the user's OWN sent
 * messages (each message counted once per line), code-like lines excluded. Pass only the user's own sent
 * bodies (plain text). Returned in their first-seen form. Pure.
 */
export function deriveSignatureLines(sentBodies: string[], opts: { minSamples?: number; tail?: number } = {}): string[] {
  const min = Math.max(2, opts.minSamples ?? 2);
  const counts = new Map<string, { n: number; form: string }>();
  for (const b of sentBodies) {
    const seen = new Set<string>();
    for (const line of ownTail(b, opts.tail ?? 8)) {
      const k = fold(line);
      if (!k || k.length > 80 || seen.has(k) || isCodeLikeLine(line)) continue;
      seen.add(k);
      const c = counts.get(k);
      if (c) c.n++; else counts.set(k, { n: 1, form: line });
    }
  }
  return [...counts.values()].filter((c) => c.n >= min).map((c) => c.form);
}

const CLOSING_CUE = /^(?:best(?: regards| wishes)?|kind regards|warm regards|regards|many thanks|thanks(?: again)?|thank you|cheers|sincerely|all the best|obrigad[oa]|cumprimentos|melhores cumprimentos|atenciosamente|abraços?|mit freundlichen grüßen|freundliche grüße|viele grüße|beste grüße|lg|cordialement|bien cordialement|bien à vous|amicalement|bonne journée|à bientôt|saludos|un saludo|atentamente)\b[,.!]?\s*$/iu;

/**
 * THE SIGN-OFF FLOOR: after the closing (the last closing cue, else the user's own name line), keep only
 * the user's name and their derived recurring signature lines; cut code tokens from the name line.
 * `signatureLines: null` = unknown (the read failed) → only code-like lines are dropped (fail-safe);
 * `[]` = known to have none → nothing but the name stands after the closing. Pure.
 */
export function cleanSignOff(body: string, opts: { name?: string | null; signatureLines?: string[] | null }): string {
  const text = String(body ?? '');
  if (!text.trim()) return text;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const name = fold(opts.name ?? '');
  const first = name.split(' ')[0] ?? '';
  const isNameLine = (l: string) => {
    const f = fold(l.replace(/[^\p{L}\p{N}\s'’.-]/gu, ' '));
    const bare = f.split(' ').filter((w) => !isCodeToken(w)).join(' ');
    return !!name && (bare === name || (first.length >= 2 && bare === first) || (bare.startsWith(name) && bare.length - name.length <= 2));
  };
  // The anchor: the user's name line among the last lines, else the last closing cue.
  let anchor = -1;
  const from = Math.max(0, lines.length - 12);
  for (let i = lines.length - 1; i >= from; i--) if (isNameLine(lines[i])) { anchor = i; break; }
  if (anchor < 0) for (let i = lines.length - 1; i >= from; i--) if (CLOSING_CUE.test(lines[i].trim())) { anchor = i; break; }
  const known = opts.signatureLines ?? null;
  const allowed = new Set((known ?? []).map(fold));
  const out: string[] = [];
  // W43.2 · the SIGNER's line stands: the first non-empty line after a closing cue that reads as a person's
  // name (1–4 capitalised words, no digits) — found by the EU eval: a profile name differing from the
  // mailbox's display name ("Probe Host EU" vs "Probe Host") left the draft signed "Best," with no name.
  const nameLike = (l: string) => { const t = l.trim(); return t.length <= 40 && !/\d/.test(t) && /^(?:\p{Lu}[\p{L}'’.-]*)(?:\s+\p{Lu}[\p{L}'’.-]*){0,3}$/u.test(t); };
  let signerKept = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (anchor < 0 || i < anchor) { out.push(l); continue; }
    if (!l.trim()) { out.push(l); continue; }
    if (i === anchor || isNameLine(l)) {
      // The name line keeps the name; a code token glued onto it is cut.
      out.push(l.split(/(\s+)/).filter((tok) => !isCodeToken(tok)).join('').trimEnd());
      continue;
    }
    if (CLOSING_CUE.test(l.trim())) { out.push(l); continue; }
    if (!signerKept && CLOSING_CUE.test(String(lines[anchor] ?? '').trim()) && nameLike(l) && !isCodeLikeLine(l)) { signerKept = true; out.push(l); continue; }
    if (/^p\.?\s?s\.?\b/i.test(l.trim())) { out.push(l); continue; }         // a postscript is words, not a signature
    if (isCodeLikeLine(l)) continue;
    if (known === null || allowed.has(fold(l))) out.push(l);
  }
  // No anchor: only trailing code-like lines at the very end go.
  if (anchor < 0) while (out.length && (isCodeLikeLine(out[out.length - 1]) || !out[out.length - 1].trim())) {
    if (!out[out.length - 1].trim()) { out.pop(); continue; }
    out.pop();
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
}
