// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE VERDICT — the single JUDGMENT authority (the "one brain, four windows" contract).
//
// The brains (person_state / initiative_state) store where things STAND (summary · momentum · whoOwes ·
// next move). This module derives the VERDICT every SURFACE reads to decide "how important" and "how's it
// going": `weight` (priority/leverage), `slipping` (the proactive signal), and it re-surfaces the ONE next
// move. It is PURE + DETERMINISTIC — no AI, no query — a single derivation over the stored state, so the
// deck, deep-dive, timeline, and projects can NEVER disagree about a person or a deal.
//
// CONTRACT: a surface is a READER + PRESENTER. It may filter/format (deck→card, timeline→station,
// project→header) but it MUST NOT re-derive priority/health/next-move. It calls one of these functions.
// Adding a judgment dimension = a field HERE, inherited by every surface for free.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type EntityVerdict = {
  weight: number;            // 0–100 priority (leverage/stakes) — the "Important" ordering, everywhere
  slipping: boolean;         // gone-quiet / stalled with something still open on YOU — the proactive signal
  momentum: string;          // straight from the brain
  summary: string | null;    // where it stands
  nextMove: { title: string; reason?: string | null; entityRef?: string | null } | null; // THE one next move
};

// A relationship's baseline leverage — an external counterparty you're building something with outranks a
// vendor or a broadcast. Tuned so momentum + owed-loops still dominate (below).
const REL_WEIGHT: Record<string, number> = { partner: 30, client: 30, prospect: 20, vendor: 12, colleague: 10, personal: 8, unknown: 0 };

export type PersonRow = {
  state: { relationship?: string; momentum?: string; summary?: string; whoOwes?: { you: string[]; them: string[] } } | null;
  next_touch: { title?: string; reason?: string; entityRef?: string | null } | null;
  quiet_days: number | null;
};

/** The verdict for ONE person, from their stored brain row. */
export function personVerdict(row: PersonRow): EntityVerdict {
  const s = row?.state ?? null;
  const mo = s?.momentum ?? 'active';
  let w = REL_WEIGHT[(s?.relationship ?? 'unknown').toLowerCase()] ?? 0;
  // Momentum: you're the bottleneck (you_owe) is the highest-leverage; a gone-quiet loop is next.
  if (mo === 'you_owe') w += 30; else if (mo === 'gone_quiet') w += 20; else if (mo === 'waiting_on_them') w += 6; else w += 12;
  const youOwe = (s?.whoOwes?.you?.length ?? 0) > 0;
  if (youOwe) w += 15;
  const slipping = mo === 'gone_quiet' && (youOwe || (row.quiet_days ?? 0) >= 14);
  const nt = row?.next_touch;
  return {
    weight: Math.min(100, w), slipping, momentum: mo, summary: s?.summary ?? null,
    nextMove: nt?.title ? { title: nt.title, reason: nt.reason ?? null, entityRef: nt.entityRef ?? null } : null,
  };
}

// An initiative's momentum leverage — needs-you (you owe the next step) is highest; a tracked deal counts more.
