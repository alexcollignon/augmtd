// Unified, context-grounded "item understanding" — ONE reasoned judgment about an inbox item FROM
// THE USER'S SEAT, replacing scattered brittle checks (is_cc_only header-math, last-line stopword
// language detection) as the PRIMARY signal. It is PRODUCED inside the existing per-email
// classification AI pass (`processEmail` in lib/ai/email-processor.ts) — NOT a new heavy call — and
// stored on `inbox_items.source_data.understanding`. Every consumer reads it through `getUnderstanding`
// so relevance/role and language can never drift across the inbox, the brief, and the drafter.
//
// AGNOSTIC: the judgment comes from grounded reasoning over the real recipients + the user's own
// addresses + how the body addresses the user + the thread + its language — never a keyword/header
// heuristic. `is_cc_only` and the stopword `detectLanguage` become INPUTS/fallbacks, not deciders.
//
// This slice implements + wires ROLE + RELEVANCE + LANGUAGE. HANDLER + EFFORT are reserved in the
// schema for the next slice (declared, not yet populated). Missing understanding → non-fatal:
// consumers fall back to today's behavior.

/** The user's role on this item, reasoned from To/CC + how the body addresses them. */
export type ItemRole =
  | 'addressed'      // the user is the (or a) direct addressee — the ask lands on them
  | 'one_of_many'    // a group thread ("Dear Team", a broad To/CC) — the user isn't singled out
  | 'bystander';     // the user is only looped in for awareness (CC-only, kept informed)

/** What this item asks of the user, reasoned — supersedes the brittle work_state→needs_reply mapping. */
export type ItemRelevance =
  | 'reply'          // a real person expects a response FROM the user
  | 'action'         // the user must do something (not necessarily a reply — external/task)
  | 'awareness';     // informational for the user; no move expected from them

export type ItemUnderstanding = {
  role: ItemRole;
  relevance: ItemRelevance;
  /** ISO-ish language code of the thread the user would reply in (e.g. 'en', 'pt', 'fr'). Lowercased. */
  language: string | null;
  /**
   * REASONED bulk judgment: true when this is a mass/marketing/newsletter/promotional/automated
   * broadcast (→ "Newsletters & promotions"), false when it's real correspondence a person or business
   * directed at the user or their group (→ "For your awareness"). This is a SEMANTIC call the model
   * makes from the body — header signals (List-Unsubscribe, sender localpart) are unreliable/missing on
   * many real marketing senders (a brand like "Zumub"/"ASOS" with no automated localpart and no
   * captured unsubscribe header), so the AI's read is the primary signal; consumers OR it with the
   * header backstop. Optional: legacy items lack it → consumers fall back to the header signals alone.
   */
  bulk?: boolean;
  // --- reserved for the NEXT slice (declared so the shape is stable; not populated yet) ---
  handler?: unknown;
  effort?: unknown;
  /** Schema version, so a later change can be detected/backfilled. */
  _v?: number;
};

export const UNDERSTANDING_VERSION = 1;

const ROLES = new Set<ItemRole>(['addressed', 'one_of_many', 'bystander']);
const RELEVANCE = new Set<ItemRelevance>(['reply', 'action', 'awareness']);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyItem = { source_data?: any } | null | undefined;

/**
 * The single reader every consumer uses. Returns the stored understanding when present + valid,
 * else null (caller falls back to today's behavior). Tolerant of partial/legacy shapes.
 */
export function getUnderstanding(item: AnyItem): ItemUnderstanding | null {
  const sd = (item?.source_data ?? {}) as Record<string, unknown>;
  return coerceUnderstanding(sd.understanding);
}

/** Validate/normalize a raw understanding object (from the model or storage). null if unusable. */
export function coerceUnderstanding(raw: unknown): ItemUnderstanding | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const role = String(r.role || '').toLowerCase() as ItemRole;
  const relevance = String(r.relevance || '').toLowerCase() as ItemRelevance;
  if (!ROLES.has(role) || !RELEVANCE.has(relevance)) return null;
  // Language: accept a short code or a name; normalize a few common language names → codes so the
  // drafter always gets a clean, decisive value. Empty/unknown → null (drafter falls back).
  const language = normalizeLanguage(r.language);
  const out: ItemUnderstanding = { role, relevance, language, _v: UNDERSTANDING_VERSION };
  // bulk: accept a real boolean or the string forms "true"/"false" (models sometimes stringify). Absent
  // → left undefined so consumers fall back to the header/sender bulk backstop (legacy items).
  if (typeof r.bulk === 'boolean') out.bulk = r.bulk;
  else if (r.bulk === 'true' || r.bulk === 'false') out.bulk = r.bulk === 'true';
  if (r.handler !== undefined) out.handler = r.handler;
  if (r.effort !== undefined) out.effort = r.effort;
  return out;
}

/**
 * PRESERVE-ON-WRITE guard for every `inbox_items.source_data` write in the email sync.
 *
 * `source_data` is written by REPLACING the whole column (not a jsonb merge), so any rebuild path
 * that forgets `understanding` silently DROPS the reasoned {role, relevance, language} judgment —
 * and a re-synced item then mis-routes (e.g. an "awareness" email falls back to Newsletters). This
 * helper is applied at EVERY write so understanding is never lost:
 *   - `computed`  — a freshly-computed understanding from `processEmail` (full-classification paths).
 *   - `existingRow` — the current inbox_items row (any shape with `source_data.understanding`), so a
 *      rebuild/patch of an item that ALREADY had understanding keeps it (fast-path, safety-net,
 *      label-stamp, reply-reactivation, etc.).
 *   - falls back to whatever `newSourceData` may already carry.
 * Precedence: computed (fresh) > existing (preserve) > already-in-newSourceData. Non-fatal: when
 * none resolve to a valid understanding the key is simply omitted (a brand-new noted item is fine).
 *
 * Returns a NEW object (does not mutate its inputs).
 */
export function withPreservedUnderstanding(
  newSourceData: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  existingRow?: { source_data?: any } | null,
  computed?: ItemUnderstanding | null | undefined,
): Record<string, unknown> {
  const resolved =
    coerceUnderstanding(computed) ??
    getUnderstanding(existingRow) ??
    coerceUnderstanding((newSourceData as Record<string, unknown>)?.understanding);
  const out = { ...newSourceData };
  if (resolved) out.understanding = resolved;
  else delete out.understanding; // don't write a garbage/partial understanding
  return out;
}

/** True when the understanding says the item does NOT warrant a reply from the user. */
export function isAwarenessRelevance(u: ItemUnderstanding | null): boolean {
  if (!u) return false;
  return u.relevance === 'awareness' || u.role === 'bystander';
}

// Map a language NAME (from `detectLanguage`, which returns "English"/"Portuguese"/…) or a code the
// model may emit to a lowercase ISO-ish code, used everywhere downstream.
const NAME_TO_CODE: Record<string, string> = {
  english: 'en', portuguese: 'pt', french: 'fr', spanish: 'es', german: 'de',
  italian: 'it', dutch: 'nl', 'português': 'pt', 'français': 'fr', 'español': 'es',
  'deutsch': 'de', 'italiano': 'it',
};
// Reverse — for prompts that read better with a human name than a code.
const CODE_TO_NAME: Record<string, string> = {
  en: 'English', pt: 'Portuguese', fr: 'French', es: 'Spanish', de: 'German',
  it: 'Italian', nl: 'Dutch',
};

export function normalizeLanguage(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (NAME_TO_CODE[s]) return NAME_TO_CODE[s];
  // Already a 2-letter code.
  if (/^[a-z]{2}$/.test(s)) return s;
  // A longer string that starts with a known name (e.g. "portuguese (pt)").
  for (const [name, code] of Object.entries(NAME_TO_CODE)) if (s.startsWith(name)) return code;
  return null;
}

/** Human-readable language name for a code/name (for the draft prompt). null when unknown. */
export function languageName(code: string | null | undefined): string | null {
  if (!code) return null;
  const c = normalizeLanguage(code);
  if (!c) return null;
  return CODE_TO_NAME[c] || null;
}
