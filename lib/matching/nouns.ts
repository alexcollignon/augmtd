// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SENTENCE AND THE FOLDER NOUN — the two words the matching step lets a user choose, and the
// ONE place their consequences are written.
//
// PURE BY CONSTRUCTION: no supabase, no AI client, no server graph. The Studio panel (a client
// component) and the report renderer (server) both import this file, so the words a user is
// PROMISED in the panel and the words the report actually prints come from the same strings. A
// preview that composed its own wording would be a promise nothing keeps.
//
// TWO NOUNS, TWO VERY DIFFERENT LIVES:
//   · the ITEM noun (see vocabularies.ts `itemNounFor`) is DISPLAY ONLY — derived, never stored,
//     never seen by a run.
//   · the FOLDER noun IS config (`folder_noun`) and it DOES reach the report — verbatim, because it
//     is the user's own word for what is in their folder, exactly like any label they author.
//     Unset → the report keeps its generic profile wording, byte for byte.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The languages the report — and therefore these templates — can be written in. */
export type NounLanguage = 'de' | 'en';

/** What the sentence says when the user has not named what is in the folder. */
export const DEFAULT_FOLDER_NOUN = 'files';

/** A label is a label, not an essay: one line, no markdown, bounded. */
export const FOLDER_NOUN_MAX = 40;

/**
 * THE DOOR. Everything that reaches config or a report passes through here: markdown stripped (a
 * bold noun would corrupt the heading it lands in), newlines collapsed (the report prints it inside
 * a single heading line), clipped at FOLDER_NOUN_MAX. Empty → undefined, which is the "keep today's
 * generic wording" answer everywhere downstream.
 */
export function coerceFolderNoun(v: unknown): string | undefined {
  const raw = typeof v === 'string' ? v : '';
  const flat = raw
    .replace(/[`*_#~\[\]]/g, '')     // markdown that would leak into a heading
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return undefined;
  return flat.length > FOLDER_NOUN_MAX ? flat.slice(0, FOLDER_NOUN_MAX).trimEnd() : flat;
}

// ─── THE HEADING TEMPLATES ───────────────────────────────────────────────────────────────────────
// The noun rides VERBATIM in both languages — it is the user's language choice, not ours to inflect
// or translate. These are the ONLY place the noun-bearing report wording is written, and the panel's
// consequence preview renders through the same functions.

/** "**Matching member companies:**" — the label above an item's match list. */
export const MATCHES_LABEL: Record<NounLanguage, (noun: string) => string> = {
  de: (noun) => `**Passende ${noun}:**`,
  en: (noun) => `**Matching ${noun}:**`,
};

/** "## Tenders with matching member companies" — the matched section's heading. */
export const MATCHED_SECTION: Record<NounLanguage, (kind: string, noun: string) => string> = {
  de: (kind, noun) => `## ${kind} mit passenden ${noun}`,
  en: (kind, noun) => `## ${kind} with matching ${noun}`,
};

/**
 * THE CONSEQUENCE PREVIEW, character-for-character. The panel shows what the report will actually
 * print — the same template, with only the markdown emphasis removed because the panel is not
 * markdown. A gate asserts this equals MATCHES_LABEL's own output stripped the same way.
 */
export function matchesHeadingPreview(noun: string, language: NounLanguage): string {
  return MATCHES_LABEL[language](noun).replace(/\*\*/g, '');
}

// ─── THE SENTENCE ────────────────────────────────────────────────────────────────────────────────
// The panel is a fill-in-the-blank sentence whose blanks are controls. The CONNECTIVES live here so
// the rendered panel and the gate's plain-text reading can never drift apart.

export const SENTENCE = {
  a: 'For each ',
  b: ' from the previous step, find up to ',
  c: ' matching ',
  d: ' from the folder ',
  e: ', keeping only matches it can prove with a quote from the file.',
} as const;

export interface SentenceParts {
  /** Derived from the step above — display only (see vocabularies.ts). */
  itemNoun: string;
  maxMatches: number;
  /** The user's `folder_noun`, already through the door. Absent → DEFAULT_FOLDER_NOUN. */
  folderNoun?: string;
  /** The configured folder name. Absent → the placeholder the panel shows. */
  folderName?: string;
}

/** The folder-name blank when nothing is chosen yet — a blank the sentence admits to. */
export const FOLDER_NAME_PLACEHOLDER = '…';

/** The sentence as one plain string — what the panel reads out, what a gate can assert. */
export function matchSentenceText(p: SentenceParts): string {
  return (
    SENTENCE.a + p.itemNoun +
    SENTENCE.b + String(p.maxMatches) +
    SENTENCE.c + (p.folderNoun?.trim() || DEFAULT_FOLDER_NOUN) +
    SENTENCE.d + (p.folderName?.trim() || FOLDER_NAME_PLACEHOLDER) +
    SENTENCE.e
  );
}
