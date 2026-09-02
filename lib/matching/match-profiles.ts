// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE MATCHER — a list of items (the fence) → the profiles in a knowledge-base folder best placed
// to take them on. Generic by construction: it knows only "items" and "profiles", never what they
// are. What they ARE is one string the source hands over (`kindLabel`), and every heading is driven
// by it.
//
// Two laws own this module (they are the reason it is worth having at all):
//
//   LAW 1 — A MATCH IS A CLAIM WITH EVIDENCE. A profile appears on an item only with a rationale
//     grounded in that profile's OWN text, code-checked after the model speaks (the staging law's
//     quote idiom). An ungrounded match is dropped and logged, never softened. Zero matches is an
//     honest answer — the judge may refuse, and refusal is not a failure.
//
//   LAW 2 — QUALITY OVER QUANTITY, IN CODE. Dedupe and the coverage gate are DETERMINISTIC and run
//     before any AI. An item surfaces once (the seen-set); an item whose deadline has already
//     passed is not an opportunity.
//
// Cost shape: exactly one classification-tier call per QUALIFIED item, with the whole shortlist
// batched inside it. Unqualified items never reach a model.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { logAIUsage } from '@/lib/ai/log-usage';
import { parseModelJSON } from '@/lib/ai/parse-json';
import { clipForPrompt, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';
import { searchKnowledgeChunks } from '@/lib/knowledge/search';
import { fetchAllRows } from '@/lib/utils/fetch-all';
import { keysOf, factsOf, type MatchItem } from './items';
import { KIND_NOUNS, FACT_LABELS, CPV_DIVISIONS } from './vocabularies';
import { MATCHES_LABEL, MATCHED_SECTION, coerceFolderNoun } from './nouns';
import { readProfileManifest, type ProfileFacts } from './manifest';

// ─── THE STRING TABLE ────────────────────────────────────────────────────────────────────────────
// Every human-visible word this module can print or say, in ONE place, PER LANGUAGE. The report was
// German-only until the locale pass; the table is now keyed by language and `rationaleLanguage`
// rides inside it, so the judge's prose, the "Beleg"/"Evidence" label and every heading move
// together — a report can never be half-translated. `{kind}` is always the source's own kindLabel —
// never a hardcoded noun, and never translated by us (it is the SOURCE's word).
//
// Adding a language = one more entry in STRINGS. Nothing else in this module changes.

/** The languages the report can be written in. Extend the union and STRINGS together. */
export type MatchLanguage = 'de' | 'en';

export const MATCH_LANGUAGES: MatchLanguage[] = ['de', 'en'];

/** The default is German: every row authored before the locale pass keeps its exact behaviour
 *  without an edit. An unknown/absent code falls here rather than guessing. */
export const DEFAULT_MATCH_LANGUAGE: MatchLanguage = 'de';

export function normalizeMatchLanguage(v: unknown): MatchLanguage {
  const s = String(v ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return (MATCH_LANGUAGES as string[]).includes(s) ? (s as MatchLanguage) : DEFAULT_MATCH_LANGUAGE;
}

const S_DE = {
  /** The language the judge writes its rationales in — it must be the report's language. */
  rationaleLanguage: 'German',
  /** Number/date formatting locale — part of the report's voice, not a separate setting. */
  locale: 'de-DE',
  itemsFallback: 'Einträge',
  // ── THE SEMANTIC LOOKUPS (see ./vocabularies.ts) — a source hands over a CODE, the table holds
  //    the word. An id absent from these maps falls back to whatever the source shipped, so an
  //    unknowing source is never worse off than it was.
  kindNoun: KIND_NOUNS.de,
  factLabel: FACT_LABELS.de,
  tagLabel: CPV_DIVISIONS.de,
  notShortlisted: '(nicht auf der Shortlist)',
  noFolderConfigured: 'Für diesen Schritt wurde kein Profilordner konfiguriert. Es wurde nichts bewertet.',
  reportTitle: (kind: string, date: string) => `# Radar: ${kind} — Stand ${date}`,
  headerCounts: (kind: string, scanned: number, judged: number, matched: number) =>
    `**${scanned} ${kind}** aus dem vorherigen Schritt geprüft · **${judged} bewertet** · **${matched} mit Zuordnung**.`,
  headerFiltered: (seen: number, expired: number, uncovered: number) =>
    `Ausgefiltert: ${seen} bereits gemeldet · ${expired} Frist abgelaufen · ${uncovered} ohne Profil-Abdeckung.`,
  /** THE CONCENTRATION LINE — always printed when there is at least one match. */
  concentration: (distinct: number, matches: number, topShare: number) =>
    `Verteilung: ${distinct} verschiedene Profile auf ${matches} Zuordnungen; auf die drei ` +
    `häufigsten entfallen ${topShare} %.`,
  leftBehind: (n: number) =>
    `> ⚠️ **${n} weitere Einträge wurden in diesem Lauf nicht bewertet** (das Bewertungsbudget dieses Laufs war ` +
    `erschöpft). Sie sind nicht abgeschlossen und erscheinen im nächsten Lauf erneut.`,
  matchedSection: (kind: string) => `## ${kind} mit passenden Profilen`,
  // ── THE USER'S OWN NOUN for what is in the folder (config `folder_noun`). Unset → the two lines
  //    above/below are used and the report is byte-identical to what it always printed.
  matchedSectionWithNoun: MATCHED_SECTION.de,
  matchesLabelWithNoun: MATCHES_LABEL.de,
  noMatchTitle: 'Keine Zuordnung in diesem Lauf',
  noMatchBody: 'Für keinen geprüften Eintrag ließ sich ein Profil belegbar zuordnen. Die geprüften Einträge stehen unten.',
  matchesLabel: '**Passende Profile:**',
  evidenceLabel: (quote: string) => `_Beleg aus dem Profil: „${quote}"_`,
  gradeStrong: 'starke Passung',
  gradePossible: 'mögliche Passung',
  tailTitle: 'Geprüft, keine eindeutige Zuordnung',
  tailIntro: '_Diese Einträge wurden maschinell keinem Profil zugeordnet — bitte gegenlesen._',
  tailNoFit: (n: number) => `${n} Profile geprüft, keine belegbare Passung`,
  tailNoCoverage: 'Der Bereich wird von keinem Profil im Ordner abgedeckt',
  labelDeadline: 'Frist',
  labelValue: 'Wert',
  labelLink: 'Link',
  labelSecondaryLink: 'Unterlagen',
  daysLeft: (n: number) => ` (noch ${n} Tage)`,
  /** The judge prompt's deadline line — a duration, not a date. */
  deadlineIn: (n: number) => `in ${n} Tagen`,
  valueUnknown: 'Wert nicht veröffentlicht',
  none: '—',
  footer: (folder: string) =>
    `_Maschinell erstellt aus den Einträgen des vorherigen Schritts und den Profildokumenten im Ordner ` +
    `"${folder}". Jede Zuordnung ist ein Vorschlag mit Beleg aus dem jeweiligen Profil — vor jeder ` +
    `Ansprache zu prüfen._`,
  // Honest refusals — spoken, never silent.
  noFence:
    'Der vorherige Schritt hat keine strukturierten Einträge geliefert. Aktivieren Sie "Strukturierte Ausgabe" ' +
    'auf dem vorhergehenden Quellschritt (z. B. get_pt_tenders), damit dieser Schritt weiß, was er abgleichen soll. ' +
    'Es wurde nichts bewertet.',
  emptyFence: (kind: string) => `Der vorherige Schritt hat 0 ${kind} geliefert. Es wurde nichts bewertet.`,
  noFolder: (folder: string) =>
    `Im Wissensordner "${folder}" wurden keine Profildokumente gefunden. Es wurde nichts bewertet.`,
  nothingNew: (kind: string, seen: number) =>
    `Keine neuen ${kind} in diesem Lauf (${seen} bereits in einem früheren Lauf gemeldet). Es wurde nichts bewertet.`,
  // ── THE EXTRACTION FALLBACK: what the reader is told when there was no structured handover and
  //    the items were READ OUT OF PROSE. It is a provenance claim, never a silent upgrade.
  /** The collective noun for items nobody named — never guessed by the extractor. */
  extractedKindLabel: 'Einträge',
  extractedProvenance: (n: number) =>
    `> ℹ️ **${n} Einträge wurden von der KI aus dem Text des vorherigen Schritts gelesen** — aktivieren Sie ` +
    `"Strukturierte Ausgabe" auf dem Quellschritt für eine exakte Übergabe.`,
};

/** The shape every language must fill — derived from the German table so a missing string is a
 *  compile error, never a silently German word inside an English report. */
export type MatchStrings = typeof S_DE;

const S_EN: MatchStrings = {
  rationaleLanguage: 'English',
  locale: 'en-GB',
  itemsFallback: 'entries',
  kindNoun: KIND_NOUNS.en,
  factLabel: FACT_LABELS.en,
  tagLabel: CPV_DIVISIONS.en,
  notShortlisted: '(not on the shortlist)',
  noFolderConfigured: 'No profile folder is configured for this step. Nothing was assessed.',
  reportTitle: (kind: string, date: string) => `# Radar: ${kind} — as of ${date}`,
  headerCounts: (kind: string, scanned: number, judged: number, matched: number) =>
    `**${scanned} ${kind}** checked from the previous step · **${judged} assessed** · **${matched} matched**.`,
  headerFiltered: (seen: number, expired: number, uncovered: number) =>
    `Filtered out: ${seen} already reported · ${expired} deadline passed · ${uncovered} not covered by any profile.`,
  concentration: (distinct: number, matches: number, topShare: number) =>
    `Spread: ${distinct} distinct profiles across ${matches} matches; the top 3 account for ${topShare}%.`,
  leftBehind: (n: number) =>
    `> ⚠️ **${n} further entries were not assessed in this run** (this run's assessment budget was ` +
    `used up). They are not closed and will appear again in the next run.`,
  matchedSection: (kind: string) => `## ${kind} with matching profiles`,
  matchedSectionWithNoun: MATCHED_SECTION.en,
  matchesLabelWithNoun: MATCHES_LABEL.en,
  noMatchTitle: 'No match in this run',
  noMatchBody: 'No profile could be matched to any of the entries checked with evidence. The entries checked are listed below.',
  matchesLabel: '**Matching profiles:**',
  evidenceLabel: (quote: string) => `_Evidence from the profile: "${quote}"_`,
  gradeStrong: 'strong fit',
  gradePossible: 'possible fit',
  tailTitle: 'Checked, no clear match',
  tailIntro: '_These entries were not matched to a profile by the machine — please review._',
  tailNoFit: (n: number) => `${n} profiles checked, no fit that could be evidenced`,
  tailNoCoverage: 'This area is not covered by any profile in the folder',
  labelDeadline: 'Deadline',
  labelValue: 'Value',
  labelLink: 'Link',
  labelSecondaryLink: 'Documents',
  daysLeft: (n: number) => ` (${n} days left)`,
  deadlineIn: (n: number) => `in ${n} days`,
  valueUnknown: 'value not published',
  none: '—',
  footer: (folder: string) =>
    `_Generated automatically from the previous step's entries and the profile documents in the ` +
    `folder "${folder}". Every match is a suggestion with evidence from the profile in question — ` +
    `to be checked before any outreach._`,
  noFence:
    'The previous step delivered no structured entries. Turn on "Structured output" on the preceding ' +
    'source step (e.g. get_pt_tenders) so this step knows what to match against. Nothing was assessed.',
  emptyFence: (kind: string) => `The previous step delivered 0 ${kind}. Nothing was assessed.`,
  noFolder: (folder: string) =>
    `No profile documents were found in the knowledge folder "${folder}". Nothing was assessed.`,
  nothingNew: (kind: string, seen: number) =>
    `No new ${kind} in this run (${seen} already reported in an earlier run). Nothing was assessed.`,
  extractedKindLabel: 'items',
  extractedProvenance: (n: number) =>
    `> ℹ️ **${n} items read from the previous step's text by AI** — enable structured output on the ` +
    `source step for exact hand-over.`,
};

const STRINGS: Record<MatchLanguage, MatchStrings> = { de: S_DE, en: S_EN };

/** THE ONE SELECTOR. Anything unknown lands on the default — a garbled config must never produce a
 *  half-translated report. */
export function matchStrings(language?: unknown): MatchStrings {
  return STRINGS[normalizeMatchLanguage(language)];
}

/** The German table, kept as the module's default voice for callers that never pass a language. */
const S = S_DE;

// ─── THE SEMANTIC RENDERERS ──────────────────────────────────────────────────────────────────────
// Three tiny readers, all obeying ONE rule: a code this build can say is said in the report's
// language; a code it cannot say never becomes half a translation — it degrades to exactly what the
// source shipped. That degradation is why an old fence keeps rendering as it always did.

/** Heading positions want the noun capitalised. German nouns already are; this is a no-op there. */
const capitalize = (s: string): string => (s ? s[0].toLocaleUpperCase() + s.slice(1) : s);

/** The collective noun, in the report's language when the semantic kind is one we know. */
export function kindNounOf(kind: string | undefined, kindLabel: string, s: MatchStrings): string {
  return (kind && s.kindNoun[kind]) || kindLabel;
}

/** A fact's printed label: the registry's word for a semantic key, the key itself otherwise. */
export function factLabelOf(key: string, s: MatchStrings): string {
  return s.factLabel[key] ?? key;
}

/**
 * The tag labels for an item — ALL OR NOTHING. Every code must resolve, or the item falls back to
 * the tag strings the source shipped. Half a translated tag line is worse than an untranslated one,
 * and silently dropping an unknown sector is worse than both.
 */
export function tagsOf(item: MatchItem, s: MatchStrings): string[] {
  const codes = item.tagCodes ?? [];
  if (codes.length) {
    const labels = codes.map((c) => s.tagLabel[c]);
    if (labels.every(Boolean)) return [...new Set(labels)];
  }
  return item.tags ?? [];
}

// ─── Knobs ───────────────────────────────────────────────────────────────────────────────────────

// ─── THE NEUTRAL TIEBREAKER ──────────────────────────────────────────────────────────────────────
// Found by the bias audit: with the deterministic lane's real signals exhausted (equal shared-key
// counts, equal rank), the final tiebreaker was `name.localeCompare` — so on EVERY item the same
// alphabetically-early profiles took the last seats of the shortlist window, and the same handful
// of names reached the judge week after week. Alphabetical order is not a matching signal; it is a
// standing advantage handed to whoever is called "A…".
//
// The replacement spreads ties ACROSS items instead of concentrating them: a per-(profile, item)
// hash. Within one item the order is arbitrary but FIXED (a re-run of the same item produces the
// same shortlist — reproducibility is not sacrificed); across items it is uncorrelated with the
// name, so a different subset of tied profiles wins the window on each tender.
//
// FNV-1a, 32-bit — a hash, not a random: no seed, no clock, no state.
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The deterministic, name-blind ordering key for one profile within one item's shortlist.
 *
 * The item id is hashed FIRST and its HASH, not its text, is mixed with the profile id.
 * Measured, not assumed: hashing the two ids concatenated left near-identical item ids (the
 * shape real sources emit, one sequence number apart) producing correlated orders, so a small
 * set of profiles still took first place across a week's items. Pre-hashing decorrelates them.
 * Over 60 items and 40 tied profiles: 33 different profiles take first place, all 40 take a
 * shortlist seat, and the top three hold ~10% of seats against a 7.5% uniform floor.
 */
export const tieBreakKey = (profileId: string, itemId: string): number =>
  fnv1a(`${profileId} ${fnv1a(itemId)}`);

export const SHORTLIST_CAP = 12;
/** Of the shortlist cap, how many seats the deterministic key hits may take before semantic recall
 *  gets its share. A pure-key shortlist would only ever re-state the manifest back to the judge. */
const DETERMINISTIC_CAP = 8;
const PROFILE_CLIP = 900;
/** How much of the user's own matching criteria rides into a judge call. Generous — the criteria are
 *  the user's steering and must not be quietly halved — but bounded, so a pasted essay can never
 *  crowd the profiles (the thing the evidence law reads) out of the prompt. */
const CRITERIA_CLIP = 4000;
const MAX_MATCHES = 5;

// ─── The seen-set (law 2: an item surfaces once) ─────────────────────────────────────────────────

export const MATCH_SEEN_KIND = 'match_seen';
export const MATCH_SEEN_VERSION = 1;
/** How long an id keeps suppressing its item. Longer than any realistic deadline, short enough that
 *  the row stays small; an item re-published months later is genuinely news again. */
export const SEEN_WINDOW_DAYS = 60;

export interface SeenSet {
  version: number;
  /** id → the ISO day it was first surfaced. The stamp is what makes the window prunable. */
  ids: Record<string, string>;
}

const emptySeen = (): SeenSet => ({ version: MATCH_SEEN_VERSION, ids: {} });

/** The seen-set is scoped to the WORKFLOW when there is one — two matchers on one account must not
 *  silence each other's items — and to the user otherwise. */
export const seenScope = (workflowId?: string | null): string => (workflowId || 'me');

export async function readSeenSet(admin: SupabaseClient, userId: string, scope = 'me'): Promise<SeenSet> {
  try {
    const { data, error } = await admin.from('item_plans').select('tasks')
      .eq('user_id', userId).eq('kind', MATCH_SEEN_KIND).eq('entity_id', scope).maybeSingle();
    if (error) { console.error('[matching] seen-set read failed:', error.message); return emptySeen(); }
    const t = data?.tasks as SeenSet | undefined;
    if (!t || typeof t.ids !== 'object' || t.ids === null) return emptySeen();
    return { version: t.version ?? MATCH_SEEN_VERSION, ids: t.ids };
  } catch { return emptySeen(); }
}

/** Prune to the rolling window. A stampless legacy id is treated as expiring now, never as forever
 *  — an id that can't prove its age must not suppress an item indefinitely. */
export function pruneSeen(seen: SeenSet, now = new Date()): SeenSet {
  const floor = now.getTime() - SEEN_WINDOW_DAYS * 86_400_000;
  const ids: Record<string, string> = {};
  for (const [id, at] of Object.entries(seen.ids ?? {})) {
    const t = Date.parse(at);
    if (Number.isFinite(t) && t >= floor) ids[id] = at;
  }
  return { version: MATCH_SEEN_VERSION, ids };
}

export function seenIdsOf(seen: SeenSet, now = new Date()): Set<string> {
  return new Set(Object.keys(pruneSeen(seen, now).ids));
}

/** Stamp the ids this run surfaced. Merge-then-prune: one row per (user, scope), bounded window. */
export async function markSeen(
  admin: SupabaseClient, userId: string, ids: string[], now = new Date(), scope = 'me',
): Promise<SeenSet> {
  const prior = pruneSeen(await readSeenSet(admin, userId, scope), now);
  const stamp = now.toISOString();
  for (const id of ids) if (id && !prior.ids[id]) prior.ids[id] = stamp;
  const { error } = await admin.from('item_plans').upsert({
    user_id: userId, kind: MATCH_SEEN_KIND, entity_id: scope,
    tasks: prior as never, updated_at: stamp,
  }, { onConflict: 'user_id,kind,entity_id' });
  if (error) throw new Error(`seen-set write failed: ${error.message}`);
  return prior;
}

// ─── The deterministic gate ──────────────────────────────────────────────────────────────────────

export interface QualifyOptions {
  /** The union of every profile's join keys. Omit (or leave empty) to skip the coverage gate. */
  profileKeys?: Iterable<string>;
  /** Ids already surfaced in the rolling window (law 2). */
  seenIds?: Set<string>;
  now?: Date;
}

export interface QualifyResult {
  /** Passed everything — these are the items the judge will pay for. */
  qualified: MatchItem[];
  /** Real items that touch no key any profile covers. They still reach the report's tail: the
   *  machine's blind spot stays visible instead of disappearing. */
  uncovered: MatchItem[];
  scanned: number;
  alreadySeen: number;
  deadlinePassed: number;
}

const parseDate = (s: string | null | undefined): Date | null => {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
};

const daysUntil = (d: Date | null, now: Date): number | null =>
  d ? Math.floor((d.getTime() - now.getTime()) / 86_400_000) : null;

/**
 * Dedupe · expiry · coverage — all before any AI (law 2). A value floor, a window, a category
 * filter are the SOURCE step's job; by the time items reach here they are already the ones the
 * user asked for.
 */
export function qualifyItems(items: MatchItem[], opts: QualifyOptions = {}): QualifyResult {
  const now = opts.now ?? new Date();
  const keys = opts.profileKeys ? new Set(opts.profileKeys) : null;
  const seen = opts.seenIds ?? new Set<string>();

  const res: QualifyResult = { qualified: [], uncovered: [], scanned: items.length, alreadySeen: 0, deadlinePassed: 0 };
  for (const item of items) {
    if (seen.has(item.id)) { res.alreadySeen++; continue; }
    const left = daysUntil(parseDate(item.deadline), now);
    // A deadline already past is a notification, not an opportunity. A missing deadline qualifies:
    // the item is real, the date is simply absent.
    if (left !== null && left < 0) { res.deadlinePassed++; continue; }
    if (keys && keys.size) {
      const k = keysOf(item);
      // An item carrying NO keys cannot be excluded by a key gate — it goes to the judge, where the
      // profiles' own words decide.
      if (k.length && !k.some((x) => keys.has(x))) { res.uncovered.push(item); continue; }
    }
    res.qualified.push(item);
  }
  return res;
}

// ─── The profile folder ──────────────────────────────────────────────────────────────────────────

export interface ProfileIndex {
  folderId: string | null;
  folderName: string;
  byFileId: Map<string, { profileId: string; filename: string }>;
  byProfileId: Map<string, { fileId: string; filename: string; name: string; text: string }>;
}

/** The profile id a document announces. A filename that LEADS WITH AN ID ("1234 Acme Lda.md") joins
 *  a manifest row without a second query; a plain filename is its own id, so a bare folder of
 *  profiles works with no convention at all. */
export function profileIdOfFilename(filename: string): string {
  const m = /^(\d+)[\s_-]/.exec(filename ?? '');
  if (m) return m[1];
  return (filename ?? '').replace(/\.[a-z0-9]{1,6}$/i, '').trim() || filename;
}

export function profileNameOfFilename(filename: string): string {
  return (filename ?? '').replace(/^\d+[\s_-]+/, '').replace(/\.[a-z0-9]{1,6}$/i, '').trim() || filename;
}

/** One read of the profile folder: the fileId↔profileId join AND the profile texts. */
export async function loadProfileIndex(
  admin: SupabaseClient, userId: string, folderName: string,
): Promise<ProfileIndex> {
  const idx: ProfileIndex = { folderId: null, folderName, byFileId: new Map(), byProfileId: new Map() };

  const { data: folders } = await admin.from('drive_folders').select('id, name').eq('user_id', userId);
  const folder = (folders ?? []).find((f: { name: string }) => f.name?.toLowerCase() === folderName.toLowerCase());
  if (!folder) return idx;
  idx.folderId = (folder as { id: string }).id;

  // NO SILENT CAP: PostgREST answers at most 1000 rows however the query is written, and a profile
  // collection is exactly the kind of folder that passes 1000 (the AHK directory holds 1,002). A
  // capped read would disqualify the tail of the alphabet from every match, invisibly.
  const files = await fetchAllRows<{ id: string; filename: string; extracted_text: string | null }>(
    (from, to) => admin.from('knowledge_files')
      .select('id, filename, extracted_text')
      .eq('user_id', userId).eq('folder_id', idx.folderId)
      .order('id', { ascending: true }).range(from, to),
  );

  for (const f of files ?? []) {
    const row = f as { id: string; filename: string; extracted_text: string | null };
    const profileId = profileIdOfFilename(row.filename ?? '');
    if (!profileId) continue;
    idx.byFileId.set(row.id, { profileId, filename: row.filename });
    idx.byProfileId.set(profileId, {
      fileId: row.id, filename: row.filename,
      name: profileNameOfFilename(row.filename ?? ''),
      text: row.extracted_text ?? '',
    });
  }
  return idx;
}

// ─── The shortlist ───────────────────────────────────────────────────────────────────────────────

export interface ProfileCandidate {
  profileId: string;
  name: string;
  facts: ProfileFacts | null;
  /** 'keys' = a manifest join hit (force-included) · 'semantic' = KB recall over the profile text. */
  via: 'keys' | 'semantic';
  sharedKeys: string[];
  similarity: number;
  fileId?: string;
  /** The profile's own text — the ONLY thing a rationale may be grounded in. */
  profileText: string;
}

/** What an item is asking for, in the words a profile might echo. */
export function itemQueryText(item: MatchItem): string {
  return [
    item.description,
    item.title,
    (item.tags ?? []).join(', '),
    factsOf(item).map(([, v]) => v).join(' · '),
  ].filter((s) => s && s.trim()).join('\n');
}

/**
 * Deterministic key hits (force-included, ranked) topped up with semantic recall over the profile
 * documents, capped at SHORTLIST_CAP. The two lanes are complementary by design: the manifest knows
 * the category, the embeddings know the sentence. With NO manifest the semantic lane is the whole
 * shortlist — a bare folder of profiles matches.
 */
export async function shortlistProfiles(
  item: MatchItem,
  facts: ProfileFacts[],
  deps: { admin: SupabaseClient; userId: string; index: ProfileIndex },
  opts: { cap?: number } = {},
): Promise<ProfileCandidate[]> {
  const cap = opts.cap ?? SHORTLIST_CAP;
  const index = deps.index;
  const wanted = new Set(keysOf(item));
  const byId = new Map<string, ProfileFacts>();
  for (const f of facts) byId.set(f.profileId, f);

  const picked = new Map<string, ProfileCandidate>();
  const textOf = (profileId: string) => index.byProfileId.get(profileId)?.text ?? '';

  // Lane 1 — the manifest's own answer.
  if (wanted.size) {
    const hits = facts
      .map((f) => ({ f, shared: (f.keys ?? []).filter((k) => wanted.has(k)) }))
      .filter((x) => x.shared.length > 0)
      // Primary: how many of the item's keys the profile covers. Secondary: the manifest's rank
      // hint (now 0 for every member of the chamber directory — see profileManifestFrom). Last:
      // the neutral per-item hash, NEVER the name (see tieBreakKey above).
      .sort((a, b) =>
        b.shared.length - a.shared.length ||
        b.f.rank - a.f.rank ||
        tieBreakKey(a.f.profileId, item.id) - tieBreakKey(b.f.profileId, item.id));

    for (const { f, shared } of hits) {
      if (picked.size >= Math.min(DETERMINISTIC_CAP, cap)) break;
      // A profile with no indexed document has nothing a rationale could ground in (law 1) — it
      // would reach the judge only to be rejected by the evidence check.
      const text = textOf(f.profileId);
      if (!text.trim()) continue;
      picked.set(f.profileId, {
        profileId: f.profileId, name: f.name || index.byProfileId.get(f.profileId)?.name || f.profileId,
        facts: f, via: 'keys', sharedKeys: shared, similarity: 0,
        fileId: index.byProfileId.get(f.profileId)?.fileId, profileText: text,
      });
    }
  }

  // Lane 2 — what the profiles themselves say. searchKnowledgeChunks (not …Grouped) deliberately:
  // the grouped door carries an ALL-CAPS/code "entity gate" that a description full of procedure
  // codes trips, silently returning nothing.
  if (picked.size < cap && index.byFileId.size) {
    const query = itemQueryText(item).slice(0, 1200);
    if (query.trim().length > 10) {
      try {
        // Recall is over the WHOLE knowledge base and then filtered to the profile folder — on an
        // account whose KB holds much else, a tight limit would return only other files and leave
        // the semantic lane silently empty. Fetch wide, keep the first `cap` profile hits.
        const chunks = await searchKnowledgeChunks(deps.userId, query, Math.max(cap * 6, 120), deps.admin, 0.15);
        for (const c of chunks) {
          if (picked.size >= cap) break;
          const hit = index.byFileId.get(c.fileId);
          if (!hit || picked.has(hit.profileId)) continue;
          const text = textOf(hit.profileId);
          if (!text.trim()) continue;
          const f = byId.get(hit.profileId) ?? null;
          picked.set(hit.profileId, {
            profileId: hit.profileId,
            name: f?.name || index.byProfileId.get(hit.profileId)?.name || hit.filename,
            facts: f, via: 'semantic',
            sharedKeys: (f?.keys ?? []).filter((k) => wanted.has(k)),
            similarity: c.similarity, fileId: c.fileId, profileText: text,
          });
        }
      } catch (e) {
        // Recall degrading must never take the deterministic lane down with it.
        console.error('[matching] semantic shortlist failed:', (e as Error).message);
      }
    }
  }

  return [...picked.values()].slice(0, cap);
}

// ─── The evidence law (law 1) ────────────────────────────────────────────────────────────────────

export const foldText = (s: string) =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9äöüß\s]/gi, ' ').replace(/\s+/g, ' ').trim();

/** DE · PT · EN function words plus the words every organisation profile shares. A token from this
 *  set proves nothing about a match, so it can never carry a rationale's grounding. */
const STOP = new Set([
  'und', 'oder', 'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'eines', 'einem',
  'fur', 'mit', 'von', 'vom', 'bei', 'aus', 'auf', 'als', 'auch', 'sich', 'ist', 'sind', 'hat',
  'haben', 'wird', 'werden', 'kann', 'konnen', 'sowie', 'nicht', 'nach', 'uber', 'unter', 'durch',
  'zur', 'zum', 'diese', 'dieser', 'dieses', 'ihre', 'ihren', 'seine', 'was', 'wie', 'dass',
  'para', 'com', 'dos', 'das', 'nos', 'nas', 'por', 'que', 'uma', 'como', 'sua', 'seu', 'este',
  'esta', 'the', 'and', 'for', 'with', 'from', 'that', 'this', 'has', 'are', 'its',
  'unternehmen', 'firma', 'gesellschaft', 'empresa', 'company', 'lda', 'gmbh', 'sociedade',
  'servicos', 'services', 'dienstleistungen', 'leistungen', 'bereich', 'bereiche', 'erfahrung',
  'mitglied', 'portugal', 'lissabon', 'lisboa', 'porto', 'tatigkeit', 'branchen', 'tags',
  'standort', 'website', 'portal', 'quelle', 'stand', 'jahr', 'grundungsjahr', 'stammdaten',
  'einordnung', 'abgeleitet', 'deutschland', 'bezug', 'divisionen', 'grossenklasse', 'mitarbeiter',
]);

export function distinctiveTokens(s: string): string[] {
  return [...new Set(foldText(s).split(' '))].filter((t) => t.length >= 5 && !STOP.has(t));
}

/** A rationale that concedes the profile does not do this work. Found live on the first real week:
 *  the judge listed a waste-equipment TRADER for a landfill construction contract and said so in
 *  the rationale itself ("ist aber primär Händler …, nicht Bauunternehmer") while still grading it
 *  a possible fit. A claim that argues against itself is not a claim. Narrow by design: only
 *  self-refuting concessions. */
const CONCESSION_PATTERNS: RegExp[] = [
  /\bnicht\s+(als\s+)?(der\s+|ein\s+|eine\s+)?\w*(bauunternehm|hersteller|anbieter|dienstleist|lieferant|spezialist|experte)\w*/i,
  /\bist\s+aber\s+(primär|vorrangig|hauptsächlich|eher)\b/i,
  /\bführt\s+(selbst\s+)?keine\b/i,
  /\bkeine\s+(direkte|explizite|nachgewiesene|dokumentierte|eigene)\s+\w*(erfahrung|kompetenz|tätigkeit)/i,
  /\b(nur|lediglich|allenfalls)\s+als\s+(subunternehmer|unterauftragnehmer|zulieferer|lieferant)\b/i,
  /\bkerngeschäft\s+(liegt|ist)\s+(aber\s+)?(in\s+)?ein(em|er)\s+anderen\b/i,
  /\bbranchenfremd\b/i,
  // English mirrors (found live once reports ran in English — a hedge the German net can't see:
  // "…emphasizes technical equipment … rather than environmental remediation specifically").
  /\b(however|but)\b[^.]{0,120}\brather\s+than\b/i,
  /\brather\s+than\b[^.]{0,60}\bspecifically\b/i,
  /\b(is|are)\s+(primarily|mainly|mostly)\s+a\b[^.]{0,80}\b(?:not|rather)\b/i,
  /\bno\s+(direct|explicit|documented|stated|proven)\s+\w{0,20}\s?(experience|expertise|capability|activity)\b/i,
  /\bdoes\s+not\s+(itself\s+)?(perform|carry\s+out|provide|cover|mention|state)\b/i,
  /\bonly\s+as\s+a\s+(subcontractor|supplier|distributor|reseller|trader)\b/i,
  /\bcore\s+business\s+(is|lies)\s+(in\s+)?(a\s+)?(different|another)\b/i,
  /\boutside\s+(its|their)\s+(stated\s+)?(core\s+)?(scope|sector|field)\b/i,
];

export function concedesUnfitness(rationale: string): boolean {
  return CONCESSION_PATTERNS.some((re) => re.test(rationale));
}

export interface GroundingVerdict {
  grounded: boolean;
  via: 'quote' | 'tokens' | null;
  /** The distinctive tokens the rationale and the profile actually share. */
  shared: string[];
}

/**
 * A rationale is grounded when the profile's OWN text says so — a verbatim evidence phrase found in
 * the profile, or (the fallback) at least two distinctive tokens shared with it. The profile's own
 * NAME is subtracted first: "we picked Acme because Acme is a good fit" is a circle, not evidence.
 */
export function checkGrounding(
  rationale: string, evidence: string, profileText: string, profileName = '',
): GroundingVerdict {
  const profile = foldText(profileText);
  if (!profile) return { grounded: false, via: null, shared: [] };

  const ev = foldText(evidence);
  if (ev.split(' ').filter(Boolean).length >= 3 && profile.includes(ev)) {
    return { grounded: true, via: 'quote', shared: [] };
  }

  const nameTokens = new Set(distinctiveTokens(profileName));
  const claimed = distinctiveTokens(`${rationale} ${evidence}`).filter((t) => !nameTokens.has(t));
  const profileTokens = new Set(distinctiveTokens(profileText));
  const shared = claimed.filter((t) => profileTokens.has(t));
  return { grounded: shared.length >= 2, via: shared.length >= 2 ? 'tokens' : null, shared };
}

// ─── The judge ───────────────────────────────────────────────────────────────────────────────────

export interface ProfileMatch {
  profileId: string;
  name: string;
  grade: 'strong' | 'possible';
  rationale: string;
  evidence: string;
  groundedVia: 'quote' | 'tokens';
  badges: string[];
  rank: number;
  via: ProfileCandidate['via'];
  /** The profile's own page, when the folder's manifest knows one. The report links the name to it;
   *  without one the name prints plain (a manifest-less folder is unaffected). */
  url?: string;
}

export interface JudgeResult {
  matches: ProfileMatch[];
  /** Matches the model claimed and the evidence check refused — the honesty channel. */
  rejected: Array<{ profileId: string; name: string; rationale: string; reason: string }>;
  shortlisted: number;
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

const fmtEur = (n: number | null | undefined, s: MatchStrings = S): string =>
  n === null || n === undefined
    ? s.valueUnknown
    : new Intl.NumberFormat(s.locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

const fmtDate = (d: Date | null, s: MatchStrings = S): string =>
  d ? new Intl.DateTimeFormat(s.locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(d) : s.none;

function itemBlock(item: MatchItem, now: Date, s: MatchStrings): string {
  const left = daysUntil(parseDate(item.deadline), now);
  const tags = tagsOf(item, s);
  return [
    `${capitalize(kindNounOf(item.kind, item.kindLabel, s))}: ${item.title}`,
    item.description && item.description !== item.title ? item.description : null,
    ...factsOf(item).map(([k, v]) => `${factLabelOf(k, s)}: ${v}`),
    tags.length ? `Tags: ${tags.join(', ')}` : null,
    item.value !== null && item.value !== undefined
      ? `${s.labelValue}: ${fmtEur(item.value, s)}`
      : (item.valueUnknown ? `${s.labelValue}: ${s.valueUnknown}` : null),
    left !== null ? `${s.labelDeadline}: ${s.deadlineIn(left)}` : null,
  ].filter(Boolean).join('\n');
}

export interface JudgeOptions {
  maxMatches?: number;
  language?: MatchLanguage | string;
  /** The user's own words for what a good match means. Verbatim, bounded, never overriding law 1. */
  criteria?: string;
}

/**
 * THE JUDGE PROMPT, assembled in one exported pure function so a gate can read exactly what the
 * model is told — including whether the user's criteria arrived verbatim and whether the line that
 * bounds them is present. A prompt no gate can see is a promise no gate can keep.
 */
export function buildJudgePrompt(
  item: MatchItem, shortlist: ProfileCandidate[], opts: JudgeOptions = {},
): string {
  const s = matchStrings(opts.language);
  const RATIONALE_LANGUAGE = s.rationaleLanguage;
  const maxMatches = Math.max(1, Math.min(opts.maxMatches ?? MAX_MATCHES, 10));
  const profiles = shortlist.map((c) => {
    const meta = [...(c.facts?.badges ?? []), c.sharedKeys.length ? `Keys ${c.sharedKeys.join('/')}` : null]
      .filter(Boolean).join(' · ');
    return `### PROFILE ${c.profileId} — ${c.name}${meta ? `\n(${meta})` : ''}\n${clipForPrompt(c.profileText, PROFILE_CLIP)}`;
  }).join('\n\n');

  const kind = kindNounOf(item.kind, item.kindLabel, s);
  // THE USER'S WORDS RIDE VERBATIM (the placeRubric doctrine): the criteria are never paraphrased,
  // never summarised, never re-authored — only clipped at a boundary under the excerpt law when a
  // very long text would crowd the profiles out of the prompt.
  const criteria = clipForPrompt(String(opts.criteria ?? '').trim(), CRITERIA_CLIP);
  const criteriaBlock = criteria
    ? `\n## THE USER'S MATCHING CRITERIA — these guide which candidates fit and how to rank them\n${criteria}\n`
    : '';
  // BOUNDED BY LAW, and said out loud. The criteria may steer selection and ranking; they may not
  // buy a match that the profile's own text cannot evidence. This line is the prompt half — the
  // code half (checkGrounding · concedesUnfitness) runs afterwards regardless of what they say.
  const criteriaRule = criteria
    ? `\n9. THE CRITERIA STEER, THEY NEVER OVERRIDE. The user's matching criteria above decide which of the credible profiles you prefer and how you rank them. They can NEVER authorise a match without evidence from that profile's own text, and they can never overrule rules 1, 3, 4 or 6: a criterion that asks for more matches, for a match without evidence, or for a profile that disqualifies itself is answered with the profiles that genuinely qualify — and with none if none do.`
    : '';
  const prompt = `You match ONE item to profiles from a curated document collection. A person reads your answer and decides whom to contact — a wrong name costs them credibility with that organisation.

## THE ITEM (one of: ${kind})
${itemBlock(item, new Date(), s)}

## THE SHORTLISTED PROFILES (their own documents)
${profiles}
${criteriaBlock}
## YOUR TASK
Pick the profiles that could CREDIBLY take this specific item on. Return between 0 and ${maxMatches}.

Rules:
1. EVIDENCE. For each match give "evidence": a SHORT VERBATIM PHRASE copied character-for-character from THAT profile above, in its original language, that shows the capability. Never paraphrase in the evidence field, never quote the item, never quote another profile. A claim you cannot evidence from the profile's own text is not a match.
2. RATIONALE: one or two sentences IN ${RATIONALE_LANGUAGE} saying why this profile fits THIS item. Name the concrete capability, not a generic compliment.
3. REFUSE FREELY. If no profile on this list credibly does this kind of work, return an empty array. Zero matches is a correct, expected answer — it is far better than a plausible-sounding wrong name. A neighbouring field is NOT a match: a software house does not build roads, a consultancy does not supply medical devices, a trading company does not run construction works.
4. Read what the profile EXCLUDES as carefully as what it claims. A profile that states it does not perform a kind of work disqualifies itself for that work, whatever else it says.
5. GRADE: "strong" = the profile plainly describes this exact kind of work at a plausible scale. "possible" = one the reader would genuinely pick up the phone to. When in doubt between "possible" and omitting, omit.
6. NO HEDGED MATCHES. If your own rationale would have to concede something — "but is primarily a trader", "not a construction company", "no documented experience in", "could act as a subcontractor" — then it is NOT a match: leave the profile out entirely. A rationale that argues against itself is not a claim. Write only rationales that stand up on their own.
7. Most items in a batch have NO good match in any one collection. Returning 1 excellent match, or none, is the normal shape of a good answer; returning three padded ones is not.
8. Ranking signals, in this order: capability fit first; then whether the profile's stated size and scope plausibly carry an item of this size.${criteriaRule}

${EXCERPT_RULE}

Respond with ONLY a JSON array, no prose:
[{"profileId":"<id from the list>","grade":"strong","evidence":"<verbatim phrase from that profile>","rationale":"<1-2 sentences in ${RATIONALE_LANGUAGE}>"}]`;
  return prompt;
}

/**
 * ONE reasoned call per item over the whole shortlist. Classification tier — this is a bounded pick
 * from a listed set, not open generation. Returns 0–N matches; the model is told, explicitly and
 * twice, that returning none is a correct answer.
 *
 * WHATEVER THE PROMPT SAID, THE LAW RUNS AFTER IT: concedesUnfitness and checkGrounding below are
 * unconditional. The user's criteria can steer what the model proposes; they reach no further.
 */
export async function judgeMatches(
  item: MatchItem,
  shortlist: ProfileCandidate[],
  deps: { admin: SupabaseClient; userId: string },
  opts: JudgeOptions = {},
): Promise<JudgeResult> {
  const s = matchStrings(opts.language);
  const maxMatches = Math.max(1, Math.min(opts.maxMatches ?? MAX_MATCHES, 10));
  const out: JudgeResult = { matches: [], rejected: [], shortlisted: shortlist.length, calls: 0, promptTokens: 0, completionTokens: 0 };
  if (!shortlist.length) return out;

  const byId = new Map(shortlist.map((c) => [c.profileId, c]));
  const prompt = buildJudgePrompt(item, shortlist, opts);

  let rows: Array<Record<string, unknown>> = [];
  try {
    const { client, model, endpoint, tier } = await getAIClient(deps.userId, 'classification', deps.admin);
    const res = await aiCreate(client, {
      model, messages: [{ role: 'user', content: prompt }], max_tokens: 1200, temperature: 0.1,
    });
    out.calls = 1;
    out.promptTokens = res.usage?.prompt_tokens ?? 0;
    out.completionTokens = res.usage?.completion_tokens ?? 0;
    logAIUsage(deps.admin, {
      userId: deps.userId, source: 'profile_matching', provider: endpoint.provider, model, tier,
      taskType: 'classification', usage: res.usage,
    }).catch(() => {});
    rows = parseModelJSON(res.choices?.[0]?.message?.content ?? '', [] as typeof rows);
  } catch (e) {
    // An AI outage is not "no profile fits" — it is no answer. The caller sees zero matches and the
    // failure in the log; nothing is ever written as a verdict.
    console.error(`[matching] judge failed for ${item.id}:`, (e as Error).message);
    return out;
  }

  const seen = new Set<string>();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (out.matches.length >= maxMatches) break;
    const profileId = String(r?.profileId ?? '').trim();
    const cand = byId.get(profileId);
    const rationale = String(r?.rationale ?? '').trim();
    const evidence = String(r?.evidence ?? '').trim();
    if (!cand) {
      if (profileId) out.rejected.push({ profileId, name: s.notShortlisted, rationale, reason: 'invented profile id' });
      continue;
    }
    if (seen.has(profileId)) continue;
    seen.add(profileId);
    if (!rationale) { out.rejected.push({ profileId, name: cand.name, rationale, reason: 'empty rationale' }); continue; }

    if (concedesUnfitness(rationale)) {
      out.rejected.push({ profileId, name: cand.name, rationale, reason: 'the rationale concedes the profile does not do this work' });
      continue;
    }
    const verdict = checkGrounding(rationale, evidence, cand.profileText, cand.name);
    if (!verdict.grounded) {
      out.rejected.push({ profileId, name: cand.name, rationale, reason: 'rationale not grounded in the profile document' });
      continue;
    }
    out.matches.push({
      profileId, name: cand.name,
      grade: r?.grade === 'strong' ? 'strong' : 'possible',
      rationale, evidence,
      groundedVia: verdict.via ?? 'tokens',
      badges: cand.facts?.badges ?? [],
      rank: cand.facts?.rank ?? 0,
      via: cand.via,
      url: cand.facts?.url,
    });
  }

  // Presentation order within ONE item: grade first, then the manifest hint, then the same neutral
  // per-item hash the shortlist uses. Candidacy is already decided here — but the name a reader
  // sees FIRST is read as the recommendation, so the last alphabetical thumb comes off this list
  // too.
  out.matches.sort((a, b) =>
    Number(b.grade === 'strong') - Number(a.grade === 'strong') ||
    b.rank - a.rank ||
    tieBreakKey(a.profileId, item.id) - tieBreakKey(b.profileId, item.id));
  return out;
}

// ─── The report ──────────────────────────────────────────────────────────────────────────────────

export interface MatchedItem {
  item: MatchItem;
  matches: ProfileMatch[];
  rejected: JudgeResult['rejected'];
  shortlisted: number;
}

export interface MatchReport {
  generatedAt: Date;
  /** The source's display label — the fallback when `kind` names nothing this build can say. */
  kindLabel: string;
  /** The source's semantic kind id, when it shipped one. */
  kind?: string;
  folderName: string;
  qualify: QualifyResult;
  /** Every judged item, matched or not. */
  judged: MatchedItem[];
  /** Qualified items the run never judged — a wall-clock budget or a cap ran out. NEVER silent: the
   *  report says so (the leftBehind idiom), and the seen-set never stamps them. */
  leftBehind: number;
  minGrade: 'possible' | 'strong';
  /** WHERE THE ITEMS CAME FROM, when it is not the plain structured handover — one line printed in
   *  the header. Absent on the fence path: a structured hand-over needs no disclaimer. */
  provenance?: string;
  /** The language the report is written in. Absent → the module default (German). */
  language?: MatchLanguage;
  /** THE USER'S OWN NOUN for what the folder holds ("member companies", "open roles"). Rides
   *  VERBATIM into the profile-side headings, in whatever language the report speaks — it is the
   *  user's word, not ours to translate. Absent → today's generic profile wording, byte for byte. */
  profileNoun?: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

// ─── THE CONCENTRATION HONESTY LINE ──────────────────────────────────────────────────────────────
// A matcher over a thousand profiles can quietly become a matcher over thirteen: the same names
// win every window, and the report — which only ever shows one item at a time — never says so. The
// header now states the spread of the run itself, ALWAYS when there is at least one match, never
// only when we deem it high. The Chamber sees the distribution and judges it; we do not grade it
// for them, and we do not hide a good number either.

export interface ConcentrationStats {
  /** Total match LINES across every judged item (one profile on two items counts twice). */
  matches: number;
  /** How many different profiles those lines name. */
  distinct: number;
  /** Share of all match lines held by the three most-matched profiles, 0–100, rounded. */
  topShare: number;
}

/** Pure, exported so a gate can check the arithmetic without a model or a database. */
export function concentrationOf(judged: MatchedItem[]): ConcentrationStats {
  const counts = new Map<string, number>();
  let matches = 0;
  for (const j of judged) {
    for (const m of j.matches) {
      matches++;
      counts.set(m.profileId, (counts.get(m.profileId) ?? 0) + 1);
    }
  }
  if (!matches) return { matches: 0, distinct: 0, topShare: 0 };
  const top3 = [...counts.values()].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0);
  return { matches, distinct: counts.size, topShare: Math.round((top3 / matches) * 100) };
}

function itemSection(mi: MatchedItem, now: Date, S: MatchStrings, profileNoun?: string): string[] {
  const it = mi.item;
  const left = daysUntil(parseDate(it.deadline), now);
  const out: string[] = [];
  const title = it.title.length > 110 ? `${it.title.slice(0, 107).trimEnd()}…` : it.title;
  out.push(`### ${title || it.id}`);
  out.push('');
  for (const [k, v] of factsOf(it)) out.push(`- **${factLabelOf(k, S)}:** ${v}`);
  if (it.value !== null && it.value !== undefined) out.push(`- **${S.labelValue}:** ${fmtEur(it.value, S)}`);
  else if (it.valueUnknown) out.push(`- **${S.labelValue}:** ${S.valueUnknown}`);
  if (it.deadline) out.push(`- **${S.labelDeadline}:** ${fmtDate(parseDate(it.deadline), S)}${left !== null ? S.daysLeft(left) : ''}`);
  const tags = tagsOf(it, S);
  if (tags.length) out.push(`- **Tags:** ${tags.join('; ')}`);
  out.push(`- **${S.labelLink}:** ${it.url ?? S.none}`);
  if (it.secondaryUrl) out.push(`- **${S.labelSecondaryLink}:** ${it.secondaryUrl}`);
  out.push('');
  if (it.description && it.description !== title) { out.push(it.description); out.push(''); }

  out.push(profileNoun ? S.matchesLabelWithNoun(profileNoun) : S.matchesLabel);
  out.push('');
  for (const m of mi.matches) {
    const flags = [m.grade === 'strong' ? S.gradeStrong : S.gradePossible, ...m.badges].filter(Boolean).join(' · ');
    // THE NAME IS THE DOOR when the folder's manifest knows where the profile lives; a manifest
    // without a url (and a manifest-less folder) prints exactly the plain name it always printed.
    const named = m.url ? `[${m.name}](${m.url})` : m.name;
    out.push(`- **${named}** (${flags})`);
    out.push(`  ${m.rationale}`);
    if (m.evidence) out.push(`  ${S.evidenceLabel(m.evidence)}`);
  }
  out.push('');
  return out;
}

/**
 * The reader-facing report. Every heading is driven by the source's own `kindLabel`; the header
 * counts are the honesty floor (how much was scanned to reach this page), and the unmatched tail
 * exists so the machine's blind spots stay visible instead of disappearing.
 */
export function renderMatchReport(report: MatchReport, language?: MatchLanguage | string): string {
  const S = matchStrings(language ?? report.language);
  const now = report.generatedAt;
  const q = report.qualify;
  // The collective noun in the report's language — lowercase inside a sentence, capitalised where
  // it opens a heading. The source's own display label is the fallback, exactly as before.
  const kind = kindNounOf(report.kind, report.kindLabel, S);
  const kindTitle = capitalize(kind);
  const noun = coerceFolderNoun(report.profileNoun);
  const matched = report.judged.filter((j) => j.matches.length > 0);
  const noMatch = report.judged.filter((j) => j.matches.length === 0);

  const out: string[] = [];
  out.push(S.reportTitle(kindTitle, fmtDate(now, S)));
  out.push('');
  out.push(S.headerCounts(kind, q.scanned, report.judged.length, matched.length));
  out.push('');
  out.push(S.headerFiltered(q.alreadySeen, q.deadlinePassed, q.uncovered.length));
  out.push('');
  // THE SPREAD OF THIS RUN, stated in the header — see concentrationOf.
  const spread = concentrationOf(report.judged);
  if (spread.matches > 0) {
    out.push(S.concentration(spread.distinct, spread.matches, spread.topShare));
    out.push('');
  }
  // PROVENANCE BEFORE PRESENTATION: if these items were read out of prose rather than handed over,
  // the reader is told so at the top, before a single match.
  if (report.provenance) { out.push(report.provenance); out.push(''); }
  if (report.leftBehind > 0) { out.push(S.leftBehind(report.leftBehind)); out.push(''); }
  out.push('---');
  out.push('');

  if (!matched.length) {
    out.push(`## ${S.noMatchTitle}`);
    out.push('');
    out.push(S.noMatchBody);
    out.push('');
  } else {
    // THE USER'S NOUN, where a generic word for "the things in the folder" would otherwise stand.
    // It passes the door again here so a hand-built report object can never smuggle markdown or a
    // paragraph into a heading.
    out.push(noun ? S.matchedSectionWithNoun(kindTitle, noun) : S.matchedSection(kindTitle));
    out.push('');
    for (const mi of matched) out.push(...itemSection(mi, now, S, noun));
  }

  const tail = [
    ...noMatch.map((j) => ({ it: j.item, why: S.tailNoFit(j.shortlisted) })),
    ...q.uncovered.map((it) => ({ it, why: S.tailNoCoverage })),
  ];
  if (tail.length) {
    out.push('---');
    out.push('');
    out.push(`## ${S.tailTitle}`);
    out.push('');
    out.push(S.tailIntro);
    out.push('');
    for (const { it, why } of tail) {
      const left = daysUntil(parseDate(it.deadline), now);
      const value = it.value !== null && it.value !== undefined ? fmtEur(it.value, S) : (it.valueUnknown ? S.valueUnknown : null);
      out.push(
        `- **${it.title || it.id}**` +
        (value ? ` · ${value}` : '') +
        (it.deadline ? ` · ${S.labelDeadline} ${fmtDate(parseDate(it.deadline), S)}${left !== null ? S.daysLeft(left) : ''}` : '') +
        (tagsOf(it, S).length ? ` · ${tagsOf(it, S).join(', ')}` : '') + '  \n' +
        `  ${why}.` + (it.url ? ` [${S.labelLink}](${it.url})` : '') +
        (it.secondaryUrl ? ` · [${S.labelSecondaryLink}](${it.secondaryUrl})` : ''),
      );
    }
    out.push('');
  }

  out.push('---');
  out.push('');
  out.push(S.footer(report.folderName));
  out.push('');
  return out.join('\n');
}

// ─── The run ─────────────────────────────────────────────────────────────────────────────────────

export interface RunMatchingOptions {
  admin: SupabaseClient;
  userId: string;
  items: MatchItem[];
  kindLabel?: string;
  /** The source's semantic kind id, when the fence carried one. */
  kind?: string;
  /** The KB folder holding the profile documents. */
  folderName: string;
  /** Skip the seen-set entirely (fixtures, replays, a testing run). */
  useSeenSet?: boolean;
  /** Seen-set scope — the workflow id when there is one. */
  seenScopeKey?: string;
  /** Cap on profiles the judge may claim per item. */
  maxMatchesPerItem?: number;
  /** Drop anything below this grade before rendering. */
  minGrade?: 'possible' | 'strong';
  /** The report's (and the judge's) language. Unknown/absent → German, the pre-locale behaviour. */
  language?: MatchLanguage | string;
  /** Judge at most this many items — a cost brake for a replay, never a product default. */
  maxJudged?: number;
  /** Judge calls in flight at once. One item = one call, so this is the whole parallelism. */
  concurrency?: number;
  /** Wall-clock budget. When it runs out the run STOPS judging and says how many it left behind. */
  budgetMs?: number;
  /** A provenance line for the header (the extraction fallback's disclosure). */
  provenance?: string;
  /** The user's own noun for what the folder holds — verbatim into the profile-side headings. */
  profileNoun?: string;
  /** THE USER'S OWN WORDS for what a good match means — steering for the judge's selection and
   *  ranking, bounded by the evidence law it can never override. */
  criteria?: string;
  now?: Date;
  /** Pre-loaded index/facts (a caller that already read them). */
  index?: ProfileIndex;
  facts?: ProfileFacts[];
  onProgress?: (done: number, total: number, item: MatchItem) => void;
}

/** qualify → shortlist → judge → report, in one call. The seen-set is stamped only for the items
 *  that were actually judged: a run that never looked at an item must not silence it. */
export async function runProfileMatching(opts: RunMatchingOptions): Promise<MatchReport> {
  const now = opts.now ?? new Date();
  const language = normalizeMatchLanguage(opts.language);
  const index = opts.index ?? (await loadProfileIndex(opts.admin, opts.userId, opts.folderName));
  const facts = opts.facts
    ?? (await readProfileManifest(opts.admin, opts.userId, opts.folderName))?.profiles
    ?? [];

  const profileKeys = new Set<string>();
  for (const f of facts) for (const k of f.keys ?? []) profileKeys.add(k);

  const scope = opts.seenScopeKey ?? 'me';
  const seenIds = opts.useSeenSet === false
    ? new Set<string>()
    : seenIdsOf(await readSeenSet(opts.admin, opts.userId, scope), now);

  const qualify = qualifyItems(opts.items, { profileKeys, seenIds, now });
  const toJudge = opts.maxJudged ? qualify.qualified.slice(0, opts.maxJudged) : qualify.qualified;

  const judged: MatchedItem[] = [];
  let calls = 0, promptTokens = 0, completionTokens = 0;
  const deadlineAt = opts.budgetMs ? Date.now() + opts.budgetMs : Infinity;
  const queue = toJudge.slice();
  let done = 0;
  const lanes = Math.max(1, Math.min(opts.concurrency ?? 1, queue.length));
  const minGrade = opts.minGrade === 'strong' ? 'strong' : 'possible';

  await Promise.all(Array.from({ length: lanes }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      // The budget is checked BEFORE the spend, never mid-call: a started item always finishes, so
      // no half-judged row reaches the report.
      if (Date.now() >= deadlineAt) { queue.length = 0; break; }
      const shortlist = await shortlistProfiles(item, facts, { admin: opts.admin, userId: opts.userId, index });
      const res = await judgeMatches(item, shortlist, { admin: opts.admin, userId: opts.userId }, { maxMatches: opts.maxMatchesPerItem, language, criteria: opts.criteria });
      calls += res.calls; promptTokens += res.promptTokens; completionTokens += res.completionTokens;
      const matches = minGrade === 'strong' ? res.matches.filter((m) => m.grade === 'strong') : res.matches;
      judged.push({ item, matches, rejected: res.rejected, shortlisted: res.shortlisted });
      opts.onProgress?.(++done, toJudge.length, item);
    }
  }));

  // As handed over by the source — the parallel lanes finish out of order.
  const order = new Map(toJudge.map((t, i) => [t.id, i]));
  judged.sort((a, b) => (order.get(a.item.id) ?? 0) - (order.get(b.item.id) ?? 0));
  const leftBehind = qualify.qualified.length - judged.length;

  if (opts.useSeenSet !== false && judged.length) {
    await markSeen(opts.admin, opts.userId, judged.map((j) => j.item.id), now, scope);
  }

  return {
    generatedAt: now,
    kindLabel: opts.kindLabel || opts.items[0]?.kindLabel || matchStrings(language).itemsFallback,
    kind: opts.kind || opts.items[0]?.kind,
    folderName: opts.folderName,
    qualify, judged, leftBehind, minGrade, provenance: opts.provenance, language,
    profileNoun: coerceFolderNoun(opts.profileNoun),
    calls, promptTokens, completionTokens,
  };
}

/** The spoken refusals in the module's default voice (German), kept for callers that never pass a
 *  language. Anything language-aware reads `matchStrings(lang)` instead. */
export const MATCH_STRINGS = S;
