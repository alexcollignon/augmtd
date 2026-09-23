// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE SIG HELPER (stabilization W2.5 DEPENDENCY-KEYED CACHES, R4 — docs/stabilization-plan.md).
//
// R4, verbatim: "24 hand-bumped *_VERSION keys; judge sig omits entity.sig." Every AI cache in the
// house answers the same question — "has anything this verdict READ changed?" — and each one
// hand-concatenated its own string, so a forgotten input (the entity's re-synthesized state) meant
// a stale verdict served until the day rolled.
//
// THE LAW: a cache key is `sigOf({version, deps})` — the prompt/law VERSION (from lib/core/versions)
// plus EVERY input the cached answer depends on. Deterministic, zero IO, isomorphic (no node crypto —
// client bundles may import it). Canonical by construction:
//   • object keys are sorted (the order a caller lists deps in never moves the sig);
//   • a `Set` is a SET — its members are sorted (order-independent);
//   • an array is a SEQUENCE — its order is part of the identity;
//   • null / undefined / '' / false are distinct values (an absent fact never collides with a false one).
// Output: `<version>.<hash>` — compact, colon-free (sigs are embedded in colon-delimited keys, e.g.
// the judge's `<JUDGE_VERSION>:<day>:<deps>` whose day slot the parked-serve comparison blanks).
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type SigValue =
  | string | number | boolean | null | undefined
  | SigValue[]
  | Set<string | number>
  | { [k: string]: SigValue };

/** Canonical, type-tagged serialization — the ONLY thing the hash ever sees. */
export function canonicalSig(v: SigValue): string {
  if (v === undefined) return 'u';
  if (v === null) return 'n';
  if (typeof v === 'string') return `s${v.length}:${v}`;
  if (typeof v === 'number') return `d${Number.isFinite(v) ? String(v) : 'NaN'}`;
  if (typeof v === 'boolean') return v ? 'T' : 'F';
  if (v instanceof Set) return `{${[...v].map((x) => canonicalSig(x)).sort().join(',')}}`;
  if (Array.isArray(v)) return `[${v.map(canonicalSig).join(',')}]`;
  const keys = Object.keys(v).sort();
  return `(${keys.map((k) => `${k.length}:${k}=${canonicalSig(v[k])}`).join(',')})`;
}

/** cyrb53 — a fast, well-distributed 53-bit string hash (non-cryptographic; cache keys only). */
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** THE ONE SIG: `<version>.<hash of the canonical deps>`. */
export function sigOf(args: { version: string | number; deps: Record<string, SigValue> }): string {
  return `${args.version}.${cyrb53(canonicalSig(args.deps)).toString(36)}`;
}

/** The version half of a sigOf output (the prefix before the first '.'). */
export const sigVersion = (sig: string | null | undefined): string => String(sig ?? '').split('.')[0];
