// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE READER IS "YOU" (W39 — walk, Oct 1: a workflow's description read "…from the user's documents").
//
// The app speaks TO its reader everywhere else ("your inbox", "you approved"); a workflow's name and
// description are model-authored and arrive in the builder's third-person system vocabulary ("the
// user", "the user's documents"). The builder prompt now asks for the second person, and this floor
// enforces it on every description that is WRITTEN (lib/workflows/generate-config) and every one that
// is SERVED (components/workflows/workflow-detail — stored rows predate the rule). English surface
// words only: the builder writes its descriptions in English; another language passes untouched.
// PURE and client-safe.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const RULES: Array<[RegExp, string]> = [
  [/\bthe user['’]s\b/g, 'your'],
  [/\bThe user['’]s\b/g, 'Your'],
  [/\bthe users['’]\b/g, 'your'],
  [/\bfor the user\b/g, 'for you'],
  [/\bto the user\b/g, 'to you'],
  [/\bwith the user\b/g, 'with you'],
  [/\bby the user\b/g, 'by you'],
  [/\bfrom the user\b/g, 'from you'],
  [/\bthe user\b/g, 'you'],
  [/\bThe user\b/g, 'You'],
];

/** A model-authored workflow line, spoken to its reader: "the user's documents" → "your documents". */
export function toReaderVoice(text: string | null | undefined): string {
  let out = String(text ?? '');
  for (const [re, to] of RULES) out = out.replace(re, to);
  // "you has/is" from a third-person verb is rare in a one-sentence description; mend the common two.
  return out.replace(/\byou has\b/g, 'you have').replace(/\bYou has\b/g, 'You have').replace(/\byou is\b/g, 'you are').replace(/\bYou is\b/g, 'You are');
}
