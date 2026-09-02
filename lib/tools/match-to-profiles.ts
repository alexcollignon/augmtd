// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE WORKFLOW DOOR onto the generic matcher: `match_to_profiles`.
//
// A relay of two small steps, not one mega-block: a SOURCE step brings the items in (any tool that
// can append the match-items fence), and THIS step matches them against a folder of profile
// documents and writes the report. It knows nothing about what the items are — the source's own
// `kindLabel` drives every heading.
//
// Every law lives in lib/matching/*; this file is the config surface, the fence read, and the run
// budget.
//
// THE FENCE IS THE EXACT HAND-OVER AND ALWAYS WINS. When the previous step ships none, the step is
// still composable: ONE cheap extraction reads the items out of that step's prose (lib/matching/
// extract-items.ts), every extracted item is code-checked against the source text, and the report
// SAYS SO in its header. `accept_unstructured: false` restores the strict refusal.
//
// THE BUDGET IS SPOKEN, NEVER SILENT: a run that cannot judge every qualified item inside its wall
// clock stops and says how many it left behind (the leftBehind idiom), and the seen-set stamps only
// what was actually judged — so the next run picks the remainder up.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseMatchItemsFence, type MatchItem } from '@/lib/matching/items';
import { extractItemsFromText, sourceTextOf } from '@/lib/matching/extract-items';
import {
  runProfileMatching, renderMatchReport, loadProfileIndex, seenScope, matchStrings, kindNounOf,
  normalizeMatchLanguage, type MatchLanguage,
} from '@/lib/matching/match-profiles';

export interface MatchToProfilesConfig {
  /** The KB folder holding one profile document per candidate. Required. */
  profiles_folder?: string;
  /** THE USER'S OWN NOUN for what that folder holds — "member companies", "open roles", "clients".
   *  Optional. Set, it replaces the generic profile word in the report's profile-side headings,
   *  VERBATIM and in whatever language the report speaks (it is the user's word, not ours to
   *  translate). Unset, the report reads exactly as it always did. */
  folder_noun?: string;
  /** Cap on profiles the judge may claim per item. Default 5. */
  max_matches_per_item?: number;
  /** The seen-set (an item surfaces once). Default true — turn it off only for repeat testing. */
  dedupe?: boolean;
  /** Drop anything below this grade before rendering. Default "possible" (keep both grades). */
  min_grade?: 'possible' | 'strong';
  /** The report's language. Omit to follow the workflow's own output language; German if neither
   *  is set (every row authored before the locale pass keeps its behaviour untouched). */
  language?: MatchLanguage | string;
  /** THE USER'S OWN WORDS for what a good match means — what to prefer, what to rule out, how to
   *  rank. Rides into the judge VERBATIM under its own bounded header. It steers selection and
   *  ranking; it can never authorise a match the profile's own text cannot evidence (the grounding
   *  check and the concession floor run afterwards, unchanged, whatever the criteria say). */
  criteria?: string;
  /** THE EXTRACTION FALLBACK. Default TRUE: a previous step that ships no structured hand-over has
   *  its items read out of its text by ONE cheap call, with the provenance disclosed in the report.
   *  Set false to restore the strict refusal (a run that must only ever match an exact hand-over). */
  accept_unstructured?: boolean;
}

/** Judge calls in flight. Four keeps a weekly run inside its budget without hammering the tier. */
const JUDGE_CONCURRENCY = 4;
/** Wall clock for the judging phase, well inside a 300s route. */
const JUDGE_BUDGET_MS = 240_000;

const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export interface MatchToProfilesContext {
  userId: string;
  supabase: SupabaseClient;
  previousOutputs: Array<{ output: unknown }>;
  workflowId?: string;
  /** THE WORKFLOW'S OWN VOICE — output_config.output_language, handed down by the run loop. The
   *  step's own `language` config outranks it; anything this module cannot write falls to German. */
  outputLanguage?: string;
}

/**
 * THE LANGUAGE LADDER, in one place: the step's explicit config → the workflow's output language →
 * German. A code this module has no string table for (say 'pt') is not a half-translated report —
 * it lands on the default, exactly as an absent value does.
 */
export function resolveMatchLanguage(
  config: Pick<MatchToProfilesConfig, 'language'>, outputLanguage?: string,
): MatchLanguage {
  if (config.language !== undefined && config.language !== null && String(config.language).trim()) {
    return normalizeMatchLanguage(config.language);
  }
  return normalizeMatchLanguage(outputLanguage);
}

/** The fence, read from the NEAREST previous output that carries one (the last one wins, mirroring
 *  the gate sentinel: a pipeline may hold several sources, the closest is meant). */
export function readItemsFromOutputs(
  outputs: Array<{ output: unknown }>,
): { items: MatchItem[]; kindLabel: string; kind?: string } | null {
  for (let i = outputs.length - 1; i >= 0; i--) {
    const text = typeof outputs[i]?.output === 'string' ? (outputs[i].output as string) : '';
    const block = text ? parseMatchItemsFence(text) : null;
    if (block) return { items: block.items, kindLabel: block.kindLabel, kind: block.kind };
  }
  return null;
}

export async function executeMatchToProfiles(
  config: Record<string, unknown>,
  ctx: MatchToProfilesContext,
): Promise<string> {
  const c = config as MatchToProfilesConfig;
  const folderName = String(c.profiles_folder ?? '').trim();
  const maxMatchesPerItem = Math.min(num(c.max_matches_per_item, 5), 10);
  const minGrade = c.min_grade === 'strong' ? 'strong' : 'possible';
  // Only an explicit false turns dedupe off — a missing/garbled config must never silently
  // re-surface every item the reader has already been told about.
  const dedupe = c.dedupe !== false;
  const language = resolveMatchLanguage(c, ctx.outputLanguage);
  const S = matchStrings(language);

  if (!folderName) return S.noFolderConfigured;

  const outputs = ctx.previousOutputs ?? [];
  // THE FENCE IS ALWAYS PREFERRED: when a source ships an exact hand-over, extraction never runs and
  // no provenance line is printed — a structured hand-over needs no disclaimer.
  let parsed = readItemsFromOutputs(outputs);
  let provenance: string | undefined;

  if (!parsed) {
    if (c.accept_unstructured === false) return S.noFence;
    const sourceText = sourceTextOf(outputs);
    // An EMPTY previous output has nothing to read: it refuses exactly as it always did, and never
    // pays for a call to discover that.
    if (!sourceText.trim()) return S.noFence;
    const extracted = await extractItemsFromText(sourceText, { admin: ctx.supabase, userId: ctx.userId }, { language });
    // Nothing the source text can account for — the honest refusal, naming the fix. An extraction
    // that found nothing must never become an empty report pretending it looked.
    if (!extracted.items.length) return S.noFence;
    parsed = { items: extracted.items, kindLabel: S.extractedKindLabel };
    provenance = S.extractedProvenance(extracted.items.length);
  }

  // Even a refusal names the items in the report's own language when the fence says what they are.
  const kindWord = kindNounOf(parsed.kind, parsed.kindLabel, S);
  if (!parsed.items.length) return S.emptyFence(kindWord);

  const index = await loadProfileIndex(ctx.supabase, ctx.userId, folderName);
  if (!index.byProfileId.size) return S.noFolder(folderName);

  const report = await runProfileMatching({
    admin: ctx.supabase, userId: ctx.userId,
    items: parsed.items, kindLabel: parsed.kindLabel, kind: parsed.kind, folderName, index,
    maxMatchesPerItem, minGrade, language, provenance,
    criteria: typeof c.criteria === 'string' ? c.criteria : undefined,
    profileNoun: c.folder_noun,
    useSeenSet: dedupe, seenScopeKey: seenScope(ctx.workflowId),
    concurrency: JUDGE_CONCURRENCY, budgetMs: JUDGE_BUDGET_MS,
  });

  // Everything filtered, nothing judged: say so plainly rather than shipping an empty report. The
  // provenance still rides along — how the items arrived is true whether or not any survived.
  if (!report.judged.length && !report.qualify.uncovered.length) {
    return [provenance, S.nothingNew(kindWord, report.qualify.alreadySeen)].filter(Boolean).join('\n\n');
  }

  return renderMatchReport(report);
}
