// Lightweight, dependency-free language detection for the message a reply is being written TO.
//
// This is NOT a classification heuristic on sender/subject — it detects the LANGUAGE of a concrete
// piece of text (the incoming email body) so a reply can MIRROR the correspondent's language instead
// of defaulting to the user's voice-example language (which, for a PT-heavy user, otherwise leaks into
// every reply — the exact A2 bug). Scored by common-stopword frequency across the languages this user
// base actually corresponds in. Returns a human-readable language name to inject into the draft prompt,
// or null when the text is too short / ambiguous (the prompt then falls back to "match the message").
//
// Deterministic, fast, offline. Not perfect, but decisive for the common EN/PT/FR/ES/DE/IT cases and
// far more reliable than trusting the model to override a wall of same-language voice examples.

const STOPWORDS: Record<string, string[]> = {
  English: ['the', 'and', 'you', 'for', 'are', 'with', 'this', 'that', 'have', 'your', 'would', 'could', 'please', 'thanks', 'thank', 'best', 'regards', 'hello', 'from', 'about', 'will', 'can', 'we', 'our'],
  Portuguese: ['obrigado', 'obrigada', 'não', 'sim', 'você', 'para', 'com', 'uma', 'que', 'está', 'como', 'mais', 'muito', 'bem', 'olá', 'boa', 'caro', 'cara', 'cumprimentos', 'abraço', 'saudações', 'poderia', 'gostaria', 'prazo', 'reunião'],
  French: ['bonjour', 'merci', 'vous', 'pour', 'avec', 'une', 'que', 'est', 'nous', 'votre', 'cordialement', 'bien', 'très', 'suis', 'être', 'pouvez', 'pourriez', 'salut', 'madame', 'monsieur', 'demain', 'aujourd', 'réunion'],
  Spanish: ['gracias', 'usted', 'para', 'con', 'una', 'que', 'está', 'como', 'más', 'muy', 'bien', 'hola', 'saludos', 'estimado', 'estimada', 'podría', 'quisiera', 'reunión', 'mañana', 'nosotros', 'vuestro'],
  German: ['und', 'der', 'die', 'das', 'für', 'mit', 'ist', 'sie', 'ich', 'nicht', 'danke', 'bitte', 'sehr', 'geehrte', 'geehrter', 'grüße', 'freundlichen', 'hallo', 'guten', 'könnten', 'würde', 'besprechung'],
  Italian: ['grazie', 'lei', 'per', 'con', 'una', 'che', 'come', 'più', 'molto', 'bene', 'ciao', 'salve', 'gentile', 'cordiali', 'saluti', 'potrebbe', 'vorrei', 'buongiorno', 'riunione', 'domani', 'noi'],
};

/** Detect the language name of `text` (e.g. "English", "Portuguese"), or null if too short/ambiguous. */
export function detectLanguage(text: string | null | undefined): string | null {
  const t = (text || '').toLowerCase();
  if (!t) return null;
  // Tokenise on unicode word boundaries (keeps accented chars).
  const tokens = t.match(/[\p{L}]+/gu) || [];
  if (tokens.length < 4) return null; // too little signal
  const counts = new Set(tokens);
  let best: string | null = null;
  let bestScore = 0;
  let second = 0;
  for (const [lang, words] of Object.entries(STOPWORDS)) {
    let score = 0;
    for (const w of words) if (counts.has(w)) score++;
    if (score > bestScore) { second = bestScore; bestScore = score; best = lang; }
    else if (score > second) { second = score; }
  }
  // Require a real signal AND a clear margin over the runner-up so we don't force a wrong language on
  // an ambiguous short note (in which case the prompt's "match the message" wording still applies).
  if (bestScore < 2 || bestScore - second < 1) return null;
  return best;
}
