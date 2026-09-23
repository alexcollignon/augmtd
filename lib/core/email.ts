// lib/core/email.ts — THE ONE EMAIL-ADDRESS MODULE (W1.6 SHARED PRIMITIVES).
//
// Before this file, ~12 call sites each defined their own local `EMAIL_RE` with subtly different
// shapes (whole-string validation vs prose extraction, punctuation trimming, TLD-length rules).
// Some of those differences are LOAD-BEARING (a strict send-time validator vs a loose extractor
// scanning free text) so this module keeps them as distinct named exports rather than collapsing
// everything onto one "best" pattern — collapsing would silently change behavior at call sites that
// depend on the looser/stricter shape. See docs/stabilization-plan.md PART III W1.6.

/** Loose whole-string validator: only `@` and whitespace are excluded, no TLD-length rule.
 *  Matches the historical `coworker-email.ts` / `forward-email.ts` shape. */
const LOOSE_WHOLE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Strict whole-string validator: excludes common delimiter/punctuation chars too, and requires an
 *  alphabetic TLD of 2+ chars. Matches the historical `emails/send` / `invites/send` /
 *  `compose/send` shape used right before a real send. */
const STRICT_WHOLE_RE = /^[^\s<>",;:]+@[^\s<>",;:]+\.[a-z]{2,}$/i;

/** Loose single-match extractor (no anchors): pulls one address-shaped substring out of free text.
 *  Matches the historical `prepare-action.ts` / `item-context.ts` / `resolve-connection.ts` /
 *  `compose/draft` shape. */
const LOOSE_EXTRACT_RE = /[^\s<>"]+@[^\s<>"]+\.[^\s<>"]+/;

/** Standard global extractor with an alphabetic 2+ char TLD. Matches the historical
 *  `standalone-reply.ts` / `converse/hands.ts` shape. */
const STANDARD_EXTRACT_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Global extractor excluding common delimiter punctuation, case-insensitive TLD. Matches the
 *  historical `invite-from-conversation.ts` shape. */
const DELIM_EXTRACT_RE = /[^\s<>",;:]+@[^\s<>",;:]+\.[a-z]{2,}/gi;

/** Trailing punctuation a prose extraction can accidentally swallow ("email me at x@y.com."). */
const TRAILING_PUNCT_RE = /[.,;:!?)\]]+$/;

/** Whole-string validate, loose shape (no TLD-length rule). Use for internal/coworker-address
 *  lists where the historical behavior accepted single-char TLDs. */
export function isEmail(s: string): boolean {
  return LOOSE_WHOLE_RE.test(s);
}

/** Whole-string validate, strict shape (delimiter-excluding, 2+ alpha TLD). Use right before a
 *  real send / calendar invite, matching the historical send-route validators. */
export function isEmailStrict(s: string): boolean {
  return STRICT_WHOLE_RE.test(s);
}

/** Extract the first address-shaped substring from free text, loose shape, no trimming.
 *  Matches historical `compose/draft`, `resolve-connection.ts` behavior. */
export function firstEmailIn(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.match(LOOSE_EXTRACT_RE)?.[0] ?? null;
}

/** Extract the first address-shaped substring from free text, loose shape, WITH trailing
 *  punctuation stripped ("x@y.com." -> "x@y.com"). Matches historical `item-context.ts` behavior. */
export function firstEmailTrimmed(text: string | null | undefined): string | null {
  const hit = firstEmailIn(text);
  return hit ? hit.replace(TRAILING_PUNCT_RE, '') : null;
}

/** Whole-string test using the loose extraction pattern (unanchored — a substring test, not a
 *  strict validator). Matches historical `prepare-action.ts` `.test()` usages. */
export function looksLikeEmail(s: string): boolean {
  return LOOSE_EXTRACT_RE.test(s);
}

/** Extract every address-shaped substring using the loose (no-TLD-rule) pattern, globally.
 *  Matches historical `prepare-action.ts` line-394 `new RegExp(EMAIL_RE.source, 'g')` usage. */
export function allEmailsLoose(text: string | null | undefined): string[] {
  if (!text) return [];
  return text.match(new RegExp(LOOSE_EXTRACT_RE.source, 'g')) ?? [];
}

/** Extract every address-shaped substring, standard shape (2+ alpha TLD), lower-cased + deduped.
 *  Matches historical `standalone-reply.ts` behavior. NOTE: `lib/converse/hands.ts` restates this
 *  exact pattern locally on purpose (out of fence for this wave — DO NOT TOUCH list) and should
 *  fold onto this export in a later wave. */
export function emailsIn(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...new Set((text.match(STANDARD_EXTRACT_RE) ?? []).map((a) => a.toLowerCase()))];
}

/** Extract every address-shaped substring, delimiter-excluding shape, case-insensitive.
 *  Matches historical `invite-from-conversation.ts` behavior. */
export function emailsInDelimited(text: string | null | undefined): string[] {
  if (!text) return [];
  return text.match(DELIM_EXTRACT_RE) ?? [];
}

/** Trim + lowercase — the common normalization repeated at most filter call sites. */
export function normalizeEmail(s: string): string {
  return String(s ?? '').trim().toLowerCase();
}
