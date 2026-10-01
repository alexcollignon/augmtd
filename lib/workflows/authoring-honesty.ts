// ════════════════════════════════════════════════════════════════════════════════════════════════
// W37 · THE AUTHORING DOOR SAYS WHAT IT CANNOT BUILD. Found by the build.workflow eval: "enter each
// invoice into Xero and pay it if under €500" was authored as a "Supplier Invoice Entry & Auto-Pay"
// workflow — a faked capability, and no word to the user that the platform has no accounting or payment
// tool. The model judges WHICH asked-for parts no building block can do (`unsupported`, a few words each);
// the sentence the user reads is CODE'S, so its presence and its shape never drift. Pure, client-safe.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The draft card's sentence for the parts of a request the platform cannot do, or null. Pure. */
export function unsupportedNote(raw: unknown): string | null {
  const parts = (Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [])
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.replace(/["`\n]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.;:,]+$/, '').slice(0, 90))
    .filter((x) => x.length >= 3);
  const uniq = [...new Set(parts.map((p) => p.toLowerCase()))].map((l) => parts.find((p) => p.toLowerCase() === l)!).slice(0, 4);
  if (!uniq.length) return null;
  const list = uniq.length === 1 ? uniq[0] : `${uniq.slice(0, -1).join(', ')} and ${uniq[uniq.length - 1]}`;
  return `This platform can't do ${list} — there is no tool for ${uniq.length === 1 ? 'it' : 'them'} here, so I built the rest and left ${uniq.length === 1 ? 'that part' : 'those parts'} to you.`;
}
