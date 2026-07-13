// Shared, alias-aware PERSON identity helpers — the single notion of "same person" across the whole
// initiative machine (commitment counterparty resolution, calendar attendee → initiative bridging, etc.).
// Extracted verbatim from lib/commitments/extract.ts so there's ONE definition, not drifting copies.
// Fully agnostic: no hardcoded identities; matches by structural signals (email localpart, name tokens),
// never by a named string. When it can't confidently reduce to one person, callers treat it as unresolved.

export const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** The email localpart, lowercased and stripped to [a-z0-9] — "John.Smith@acme.com" → "johnsmith". */
export const emailLocalpart = (s: string): string | null => {
  const m = s.match(/^([^@\s]+)@/);
  return m ? m[1].toLowerCase().replace(/[^a-z0-9]/g, '') : null;
};

/** Word tokens of a display name, lowercased — "Jane M. Doe" → ["jane", "m", "doe"]. */
export const nameTokens = (s: string): string[] => norm(s).split(/[^a-z0-9]+/).filter(Boolean);

/** Does an email localpart plausibly denote this name? john.smith@ / jsmith@ / johnsmith@ ~ "John Smith". */
export const emailDenotesName = (local: string, name: string): boolean => {
  const t = nameTokens(name);
  if (!t.length || !local) return false;
  const joined = t.join('');
  const initials = t.map((w) => w[0]).join('');
  const firstLast = (t[0]?.[0] || '') + (t[t.length - 1] || '');
  return local === joined || local === initials || local === firstLast || t.some((w) => w.length > 2 && local.includes(w));
};

/**
 * Two attendee strings refer to the same person? exact, name-subset variant ("Jane" ⊆ "Jane Doe"), same
 * email localpart, or email↔name. Conservative: only true when it can confidently reduce to one person.
 */
export const sameAttendee = (a: string, b: string): boolean => {
  if (norm(a) === norm(b)) return true;
  const la = emailLocalpart(a), lb = emailLocalpart(b);
  if (la && lb) return la === lb;
  if (!la && !lb) {
    const ta = nameTokens(a), tb = nameTokens(b);
    if (!ta.length || !tb.length) return false;
    const setA = new Set(ta), setB = new Set(tb);
    return ta.every((w) => setB.has(w)) || tb.every((w) => setA.has(w));
  }
  return la ? emailDenotesName(la, b) : emailDenotesName(lb!, a);
};

/**
 * A STABLE canonical id for a person — email localpart when available, else the joined name tokens.
 * Used to key the person→initiative map. null when the string carries no usable signal. Two aliases of
 * the same person may still produce different canonical ids (email vs bare name); the resolver's fuzzy
 * fallback uses `sameAttendee` to bridge those, so this is a fast-path key, not the sole matcher.
 */
export const canonicalPerson = (s: string): string | null => {
  if (!s) return null;
  const local = emailLocalpart(s);
  if (local) return local;
  const t = nameTokens(s);
  return t.length ? t.join('') : null;
};
