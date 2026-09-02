// ════════════════════════════════════════════════════════════════════════════════════════════════
// "TRY IT ON THE LAST RUN'S ITEMS" — the matching step, shown before it is trusted.
//
// A LEAN PREVIEW, and the leanness is the design: it takes the FIRST 3 items the last run's
// previous step actually handed over, shortlists and judges them with the step's CURRENT config,
// and returns what it found. That is all it does.
//
// WHAT IT DELIBERATELY NEVER DOES — a preview that touched any of these would be a run wearing a
// button's clothes:
//   · it never stamps the seen-set (a previewed item must still reach the real report),
//   · it never writes a report, an artifact, a run row or a thread,
//   · it never extracts items out of prose. NO FENCE, NO PREVIEW: the extraction fallback is a
//     paid AI call and a provenance claim; a preview that silently bought one would be showing the
//     user a different machine than the one that runs on Monday. It says so instead.
//
// COST CEILING: 3 items = at most 3 classification-tier judge calls per click.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { readItemsFromOutputs, resolveMatchLanguage, type MatchToProfilesConfig } from '@/lib/tools/match-to-profiles';
import { readProfileManifest } from './manifest';
import {
  loadProfileIndex, shortlistProfiles, judgeMatches, normalizeMatchLanguage,
} from './match-profiles';

/** How many items one click may judge. A preview is a taste, never a run. */
export const PREVIEW_ITEM_CAP = 3;

export interface PreviewMatch {
  name: string;
  grade: 'strong' | 'possible';
  rationale: string;
}

export interface PreviewItem {
  id: string;
  title: string;
  matches: PreviewMatch[];
  /** How many profiles the shortlist put in front of the judge — the honest denominator. */
  shortlisted: number;
}

export interface PreviewResult {
  ok: boolean;
  /** The spoken reason when ok === false. Never a stack trace, always a next step. */
  message?: string;
  items: PreviewItem[];
  /** How many items the previous step handed over in total (the preview judged the first N). */
  totalItems: number;
}

export interface PreviewDeps {
  admin: SupabaseClient;
  userId: string;
  /** The workflow's steps, exactly as stored. */
  steps: Array<{ id?: string; type?: string; tool?: string; config?: Record<string, unknown> }>;
  /** The step being previewed. */
  stepId: string;
  /** The most recent run's step outputs, newest run only. Empty/absent = nothing to preview. */
  stepOutputs: Array<{ step_id?: string; output?: unknown }>;
  /** The workflow's own output language — the second rung of the step's language ladder. */
  outputLanguage?: string;
}

const say = (message: string): PreviewResult => ({ ok: false, message, items: [], totalItems: 0 });

/**
 * THE CORE, extracted from the route so a gate can drive every refusal without a request. Every
 * honest dead end is a spoken sentence naming what to do next, never an exception.
 */
export async function previewMatchStep(deps: PreviewDeps): Promise<PreviewResult> {
  const idx = deps.steps.findIndex((s) => s.id === deps.stepId);
  if (idx < 0) return say('That step is no longer part of this workflow.');
  const step = deps.steps[idx];
  const config = (step.config ?? {}) as MatchToProfilesConfig;

  const folderName = String(config.profiles_folder ?? '').trim();
  if (!folderName) return say('Choose the folder of files first — there is nothing to match against yet.');

  if (idx === 0) return say('This step is first in the workflow, so nothing hands it any items to try.');
  const prev = deps.steps[idx - 1];

  if (!deps.stepOutputs.length) return say('This workflow has not run yet, so there are no items to try it on.');
  // The output of the step ABOVE the matcher — by id, so a reordered pipeline can never preview
  // the wrong step's output.
  const prevOutput = deps.stepOutputs.find((o) => o.step_id === prev.id);
  if (!prevOutput) return say('The last run never reached the step above this one.');

  const parsed = readItemsFromOutputs([{ output: prevOutput.output }]);
  // NO EXTRACTION FALLBACK HERE — said plainly rather than paid for silently.
  if (!parsed) {
    return say(
      'The last run\'s previous step provided no structured items. Turn on "Structured output" on ' +
      'that step to try this one on its real hand-over.',
    );
  }
  if (!parsed.items.length) return say('The last run\'s previous step handed over 0 items.');

  const items = parsed.items.slice(0, PREVIEW_ITEM_CAP);
  const language = resolveMatchLanguage(config, deps.outputLanguage);

  const index = await loadProfileIndex(deps.admin, deps.userId, folderName);
  if (!index.byProfileId.size) return say(`No files were found in the knowledge folder "${folderName}".`);
  const facts = (await readProfileManifest(deps.admin, deps.userId, folderName))?.profiles ?? [];

  const maxMatches = Number(config.max_matches_per_item ?? 5);
  const minGrade = config.min_grade === 'strong' ? 'strong' : 'possible';

  const out: PreviewItem[] = [];
  for (const item of items) {
    const shortlist = await shortlistProfiles(item, facts, { admin: deps.admin, userId: deps.userId, index });
    const res = await judgeMatches(item, shortlist, { admin: deps.admin, userId: deps.userId }, {
      maxMatches: Number.isFinite(maxMatches) && maxMatches > 0 ? Math.min(maxMatches, 10) : 5,
      language: normalizeMatchLanguage(language),
      criteria: typeof config.criteria === 'string' ? config.criteria : undefined,
    });
    const kept = minGrade === 'strong' ? res.matches.filter((m) => m.grade === 'strong') : res.matches;
    out.push({
      id: item.id,
      title: item.title || item.id,
      shortlisted: res.shortlisted,
      matches: kept.map((m) => ({ name: m.name, grade: m.grade, rationale: m.rationale })),
    });
  }

  return { ok: true, items: out, totalItems: parsed.items.length };
}
