// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE EXTRACTION FALLBACK — the matcher becomes composable with ANY previous step.
//
// The fence (lib/matching/items.ts) is the exact hand-over and is ALWAYS preferred: when a source
// step ships one, nothing in this file runs. But most steps are not fence-bearing — a web fetch, an
// RSS read, an AI step that wrote a list in prose — and until now a matcher behind one of those
// refused outright. This module reads the items out of that prose ONCE, cheaply, and says so.
//
// TWO HONESTY RULES, both enforced in CODE and neither negotiable:
//
//   RULE 1 — NOTHING IS INVENTED. Every extracted item must share distinctive tokens with the source
//     text it claims to come from (the staging law's grounding idiom, the SAME implementation the
//     evidence check uses). An item the source text cannot account for is DROPPED and counted —
//     never softened, never rendered.
//
//   RULE 2 — THE READER IS TOLD. The report's header carries a provenance line naming how the items
//     arrived and how many there were, in the report's own language. An extracted list never
//     masquerades as a structured hand-over.
//
// The extractor never names what the items ARE: an unnamed list gets the string table's generic
// noun ("items" / "Einträge"), never a guessed collective the model made up.
//
// Cost shape: at most ONE classification-tier call per invocation, hard-capped at EXTRACT_CAP items.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { logAIUsage } from '@/lib/ai/log-usage';
import { parseModelJSON } from '@/lib/ai/parse-json';
import { clipForPrompt, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';
import type { MatchItem } from './items';
import { foldText, distinctiveTokens, matchStrings, type MatchLanguage } from './match-profiles';

/** The hard cap. A prose list longer than this is a source that should be shipping a fence. */
export const EXTRACT_CAP = 50;
/** How much of the previous step's text the one call reads. */
const SOURCE_CLIP = 24_000;

export interface ExtractResult {
  items: MatchItem[];
  /** Items the model claimed and the token check refused — the honesty channel, counted not hidden. */
  dropped: number;
  /** True when the cap cut the list short. */
  capped: boolean;
  calls: number;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));

/**
 * RULE 1, in code. An extracted item is accounted for by the source when either
 *   • its folded title appears VERBATIM in the folded source (the model copied a line), or
 *   • it shares at least two distinctive tokens with the source.
 * Both readings use the SAME primitives as the evidence check — one implementation of "distinctive",
 * never a second opinion about what a shared word is.
 */
export function itemAccountedFor(item: { title?: string; description?: string }, sourceText: string): boolean {
  const source = foldText(sourceText);
  if (!source) return false;
  const title = foldText(item.title ?? '');
  if (title.split(' ').filter(Boolean).length >= 2 && source.includes(title)) return true;
  const sourceTokens = new Set(distinctiveTokens(sourceText));
  const claimed = distinctiveTokens(`${item.title ?? ''} ${item.description ?? ''}`);
  return claimed.filter((t) => sourceTokens.has(t)).length >= 2;
}

/** A stable id for an item that has none. Same title in the next run = same id, so the seen-set and
 *  the dedupe law keep working on an extracted list exactly as on a fenced one. */
export function extractedIdOf(title: string, description: string): string {
  const basis = foldText(`${title} ${description}`).slice(0, 200);
  let h = 2166136261;
  for (let i = 0; i < basis.length; i++) { h ^= basis.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `x:${(h >>> 0).toString(36)}`;
}

/** Shape whatever the model returned into MatchItems, dropping anything the source cannot account
 *  for. Exported so a gate can inject a fabricated row and prove it never survives. */
export function coerceExtracted(
  rows: unknown, sourceText: string, kindLabel: string,
): { items: MatchItem[]; dropped: number; capped: boolean } {
  const list = Array.isArray(rows) ? rows : [];
  const items: MatchItem[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const raw of list) {
    if (items.length >= EXTRACT_CAP) break;
    if (!raw || typeof raw !== 'object') { dropped++; continue; }
    const r = raw as Record<string, unknown>;
    const title = str(r.title).trim();
    const description = str(r.description).trim() || title;
    if (!title && !description) { dropped++; continue; }
    if (!itemAccountedFor({ title, description }, sourceText)) { dropped++; continue; }
    const id = str(r.id).trim() || extractedIdOf(title, description);
    if (seen.has(id)) continue;
    seen.add(id);
    const value = typeof r.value === 'number' && Number.isFinite(r.value) ? r.value : null;
    const deadline = str(r.deadline).trim();
    items.push({
      id, title: title || description.slice(0, 120), description,
      kindLabel,
      url: str(r.url).trim() || undefined,
      value, valueUnknown: value === null,
      deadline: deadline && Number.isFinite(Date.parse(deadline)) ? deadline : null,
    });
  }
  return { items, dropped, capped: list.length > EXTRACT_CAP };
}

/** The text the extractor reads: the LAST previous output that has any prose at all (the nearest
 *  source is meant — the same rule the fence reader follows). */
export function sourceTextOf(outputs: Array<{ output: unknown }>): string {
  for (let i = outputs.length - 1; i >= 0; i--) {
    const t = typeof outputs[i]?.output === 'string' ? (outputs[i].output as string) : '';
    if (t.trim()) return t;
  }
  return '';
}

/**
 * ONE cheap call over the previous step's text. Returns zero items on any failure — an AI outage is
 * not "the step delivered nothing", it is no answer, and the caller falls back to the honest refusal
 * the fence path would have given.
 */
export async function extractItemsFromText(
  sourceText: string,
  deps: { admin: SupabaseClient; userId: string },
  opts: { language?: MatchLanguage | string } = {},
): Promise<ExtractResult> {
  const s = matchStrings(opts.language);
  const out: ExtractResult = { items: [], dropped: 0, capped: false, calls: 0 };
  if (!sourceText.trim()) return out;

  const prompt = `The text below is one step's output inside an automated pipeline. Read the DISTINCT THINGS it lists — opportunities, openings, announcements, records, entries — so a later step can match each one against a folder of documents.

## THE TEXT
${clipForPrompt(sourceText, SOURCE_CLIP)}

## RULES
1. COPY, NEVER COMPOSE. Every title and description must come from the text above. Never add an entry the text does not contain, never merge two entries into one, never split one into two.
2. If the text lists no distinct things — it is a summary, a single narrative, an error message, an empty result — return an empty array. That is a correct answer.
3. Return at most ${EXTRACT_CAP} entries, in the order the text lists them.
4. Fill "url", "value" (a plain number, no currency symbol) and "deadline" (ISO date) ONLY when the text states them for that entry. Omit the field otherwise — never guess, never carry a value from a neighbouring entry.
5. "description" is what the entry actually asks for or offers, in the text's own language.

${EXCERPT_RULE}

Respond with ONLY a JSON array, no prose:
[{"title":"<from the text>","description":"<from the text>","url":"<optional>","value":123,"deadline":"YYYY-MM-DD"}]`;

  let rows: unknown = [];
  try {
    const { client, model, endpoint, tier } = await getAIClient(deps.userId, 'classification', deps.admin);
    const res = await aiCreate(client, {
      model, messages: [{ role: 'user', content: prompt }], max_tokens: 4000, temperature: 0.1,
    });
    out.calls = 1;
    logAIUsage(deps.admin, {
      userId: deps.userId, source: 'profile_matching', provider: endpoint.provider, model, tier,
      taskType: 'classification', usage: res.usage,
    }).catch(() => {});
    rows = parseModelJSON(res.choices?.[0]?.message?.content ?? '', [] as unknown[]);
  } catch (e) {
    console.error('[matching] item extraction failed:', (e as Error).message);
    return out;
  }

  const shaped = coerceExtracted(rows, sourceText, s.extractedKindLabel);
  if (shaped.dropped) {
    console.warn(`[matching] extraction dropped ${shaped.dropped} item(s) the source text does not account for`);
  }
  return { ...out, ...shaped };
}
