// ── Home simplification L1 — SERVER-SIDE bundling of the "what needs you" atoms into human-sized units.
// The grouping DECISION lives here (one clean home), the client just renders by the key we hand it.
//
// DETERMINISTIC by design (the same discipline as the initiative machine: reason ONCE at labeling, group
// CHEAPLY — never a freeform AI clustering pass, which is exactly what merged distinct clients before). An
// atom bundles by the HIGHEST-priority key it carries whose group has ≥2 members:
//   1. INITIATIVE (the deal/client, reasoned upstream) — the broadest cohesive unit; distinct initiatives
//      → distinct keys → NEVER merge, by construction.
//   2. MEETING source — a meeting's commitments group together even when they carry no initiative label
//      (coverage for meeting-driven users). Fallback below initiative so an initiative never splits.
//   3. THREAD — items on one email thread (a minor fallback for un-labelled correspondence).
//
// Returns { atomId → { key, label } } for every atom in a ≥2 bundle; atoms not in the dictionary are
// singles. PRESENTATION grouping only — nothing is reclassified or dropped; the client re-counts the atoms
// PRESENT after this session's dismissals, so a bundle that drops to one live item renders as a plain row.

export type BundleAtom = {
  id: string;
  initiative?: string | null;
  meetingId?: string | null;
  meetingLabel?: string | null;
  threadId?: string | null;
  subject?: string | null;
};
export type BundleRef = { key: string; label: string };

const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const cleanSubject = (s?: string | null) => (s ? s.replace(/^\s*(re|fwd|fw|enc)\s*:\s*/i, '').trim() : '');

// Candidate bundle keys for an atom, in PRIORITY order (initiative > meeting > thread).
function candidatesOf(a: BundleAtom): BundleRef[] {
  const out: BundleRef[] = [];
  if (a.initiative) { const k = normKey(a.initiative); if (k) out.push({ key: `i:${k}`, label: a.initiative }); }
  if (a.meetingId) out.push({ key: `m:${a.meetingId}`, label: a.meetingLabel || 'Meeting follow-ups' });
  if (a.threadId) out.push({ key: `t:${a.threadId}`, label: cleanSubject(a.subject) || 'This thread' });
  return out;
}

export function computeBundles(atoms: BundleAtom[]): Record<string, BundleRef> {
  // Raw occurrence count per candidate key (an atom counts toward every key it carries) + the fullest label.
  const count = new Map<string, number>();
  const labelByKey = new Map<string, string>();
  for (const a of atoms) {
    if (!a.id) continue;
    for (const c of candidatesOf(a)) {
      count.set(c.key, (count.get(c.key) ?? 0) + 1);
      const cur = labelByKey.get(c.key);
      if (!cur || c.label.length > cur.length) labelByKey.set(c.key, c.label);
    }
  }
  // Pass 1: assign each atom to its highest-priority candidate whose raw count ≥2.
  const assigned = new Map<string, string>(); // id → key
  for (const a of atoms) {
    if (!a.id) continue;
    const c = candidatesOf(a).find((c) => (count.get(c.key) ?? 0) >= 2);
    if (c) assigned.set(a.id, c.key);
  }
  // Pass 2: keep only keys that ended up with ≥2 ASSIGNED atoms (a key can lose members to a higher-priority key).
  const finalCount = new Map<string, number>();
  for (const key of assigned.values()) finalCount.set(key, (finalCount.get(key) ?? 0) + 1);
  const out: Record<string, BundleRef> = {};
  for (const [id, key] of assigned) {
    if ((finalCount.get(key) ?? 0) >= 2) out[id] = { key, label: labelByKey.get(key) || key };
  }
  return out;
}
