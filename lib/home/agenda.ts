// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE AGENDA SPINE (Living-Home S1, docs/living-home-plan.md) — ONE pure derivation of "what needs you"
// that every surface PROJECTS from: the deck renders `entries`, the day ring shows `rows` (what is
// visibly listed) with `atoms` (the items inside) as its volume, and the brief composer anchors its lead
// on `first`. Before this, the ring, the deck, and the prose each computed their own count/pick — so
// "8 need you" over 5 visible rows and a prose lead disagreeing with the deck hero were all possible.
// With one spine, disagreement is structurally impossible instead of patched count-by-count.
//
// Pure + isomorphic: no React, no supabase, no Date.now side inputs beyond the sort's `today` — safe to
// import from the client (home-view) and the server (the brief route, for compose-lead anchoring).
// ════════════════════════════════════════════════════════════════════════════════════════════════

// ── The atom + entry types (moved verbatim from components/home/home-view.tsx) ───────────────────
export type DoSource = 'reply' | 'notice' | 'commitment';
export type DoItem = {
  source: DoSource; key: string; entityId: string; href: string;
  primary?: string | null;   // sender / null (a commitment carries its who in `second`)
  ask: string;               // the actionable line (synthesized ask / summary / description)
  second?: string | null;    // subject / "You owe X · ↳ initiative" / "Action needed"
  when?: string | null; effort?: 'quick' | 'medium' | 'deep' | null; dueDate?: string | null;
  overdue?: boolean; dueToday?: boolean; initiative?: string | null; initiativeTotal?: number | null;
  relCue?: { label: string; tone: 'neutral' | 'amber' } | null; // ONE quiet Person-Brain cue
  prepared?: string | null;  // '✦' token: 'draft' (in-house) or a coworker's name — prepared work has arrived
};
export type Priority = {
  id: string; source: 'email' | 'meeting'; posture: 'needs_reply' | 'to_do' | 'waiting_on';
  title: string; context: string | null; href: string;
  itemId?: string; items?: { id: string; text: string }[]; overdue?: boolean;
  effort?: 'quick' | 'medium' | 'deep' | null; dueDate?: string | null;
  initiative?: string | null; initiativeTotal?: number | null;
};
export type SlippingDeal = { key: string; label: string; momentum: string; summary: string; weight: number; nextMove: { title: string; entityRef: string | null } | null };
export type Momentum = 'active' | 'needs_you' | 'waiting' | 'gone_quiet' | 'stalled';
export type BundleState = {
  momentum: Momentum;
  summary: string | null; quietDays: number | null;
  nextMove: { title: string; entityRef: string | null; reason?: string } | null;
};
export type BundleRef = { key: string; label: string };
export type BundleName = { name: string; why?: string };
export type DoNode = { kind: 'bundle'; key: string; title: string; why?: string; items: DoItem[] } | { kind: 'single'; key: string; item: DoItem };
export type DeckEntry =
  | { key: string; kind: 'bundle'; title: string; why?: string; items: DoItem[]; state?: BundleState | null }
  | { key: string; kind: 'single'; item: DoItem }
  | { key: string; kind: 'priority'; p: Priority }
  | { key: string; kind: 'deal'; deal: SlippingDeal };
export type DoSort = 'urgent' | 'important' | 'quick';

// ── Bundling (moved verbatim) — group flat atoms by the SERVER's bundle decision into ≥2 units;
// order-preserving (a bundle takes its most-urgent member's position); a bundle whose live membership
// drops to 1 renders as a plain row. ──
export function bundleDoItems(items: DoItem[], bundleMap: Record<string, BundleRef>, namesMap: Record<string, BundleName>): DoNode[] {
  const present = new Map<string, number>();
  for (const it of items) { const b = bundleMap[it.entityId]; if (b) present.set(b.key, (present.get(b.key) ?? 0) + 1); }
  const out: DoNode[] = [];
  const emitted = new Set<string>();
  for (const it of items) {
    const b = bundleMap[it.entityId];
    if (b && (present.get(b.key) ?? 0) >= 2) {
      if (emitted.has(b.key)) continue; // bundle already emitted at its most-urgent member's position
      emitted.add(b.key);
      const named = namesMap[b.key];
      out.push({ kind: 'bundle', key: `b-${b.key}`, title: named?.name || b.label, why: named?.why, items: items.filter((x) => bundleMap[x.entityId]?.key === b.key) });
    } else {
      out.push({ kind: 'single', key: it.key, item: it });
    }
  }
  return out;
}

// ── Urgency + lens ordering (moved verbatim) ─────────────────────────────────────────────────────
/** Stable urgency rank: overdue → due today → has a due date → undated. */
export function urgencyRank(it: DoItem, todayISO: string): number {
  if (it.overdue || (it.dueDate && it.dueDate < todayISO)) return 0;
  if (it.dueToday || it.dueDate === todayISO) return 1;
  if (it.dueDate) return 2;
  return 3;
}

// The verdict WEIGHT for a deck entry — READ from the server's `itemWeights` (the ONE judgment authority),
// never re-derived. A bundle takes its most-important member's weight.
export function entryWeight(e: DeckEntry, weights: Record<string, number>): number {
  if (e.kind === 'deal') return e.deal.weight;
  if (e.kind === 'bundle') return e.items.reduce((mx, it) => Math.max(mx, weights[it.entityId] ?? 0), 0);
  if (e.kind === 'single') return weights[e.item.entityId] ?? 0;
  return weights[e.p.itemId ?? ''] ?? 0;
}
function entryMetrics(e: DeckEntry, today: string, weights: Record<string, number>) {
  const weight = entryWeight(e, weights);
  // A slipping deal is undated but AGING — soft-urgent so it surfaces even in the Urgent lens.
  if (e.kind === 'deal') return { urg: 1, effort: 2, hasInit: true, size: 1, weight };
  if (e.kind === 'bundle') {
    const its = e.items;
    return { urg: its.some((i) => i.overdue) ? 0 : its.some((i) => i.dueToday) ? 1 : its.some((i) => i.dueDate) ? 2 : 3, effort: 3, hasInit: true, size: its.length, weight };
  }
  if (e.kind === 'single') {
    const it = e.item;
    return { urg: it.overdue ? 0 : it.dueToday ? 1 : it.dueDate ? 2 : 3, effort: it.effort === 'quick' ? 0 : it.effort === 'deep' ? 2 : 1, hasInit: !!it.initiative, size: 1, weight };
  }
  const p = e.p;
  const dueToday = !!(p.dueDate && p.dueDate === today);
  return { urg: p.overdue ? 0 : dueToday ? 1 : p.dueDate ? 2 : 3, effort: p.effort === 'quick' ? 0 : p.effort === 'deep' ? 2 : 1, hasInit: !!p.initiative, size: p.items?.length ?? 1, weight };
}

export function sortEntries(entries: DeckEntry[], mode: DoSort, weights: Record<string, number> = {}): DeckEntry[] {
  const today = new Date().toISOString().slice(0, 10);
  return entries
    .map((e, i) => ({ e, i, m: entryMetrics(e, today, weights) }))
    .sort((A, B) => {
      const a = A.m, b = B.m;
      // "Important" leads with the BRAIN VERDICT weight; the heuristic (project-tied, size) tiebreaks.
      const d = mode === 'urgent'
        ? a.urg - b.urg
        : mode === 'important'
          ? (b.weight - a.weight) || ((b.hasInit ? 1 : 0) - (a.hasInit ? 1 : 0)) || (b.size - a.size) || (a.urg - b.urg)
          : (a.effort - b.effort) || (a.size - b.size) || (a.urg - b.urg);
      return d || (A.i - B.i); // stable: preserve the base order on ties
    })
    .map((x) => x.e);
}

// ── THE AGENDA ───────────────────────────────────────────────────────────────────────────────────
export type Agenda = {
  /** The ordered deck — bundles + singles + priority cards + slipping deals, in the chosen lens order. */
  entries: DeckEntry[];
  /** What is VISIBLY listed — the number the ring/labels must show (a bundle is ONE row). */
  rows: number;
  /** The underlying item count (bundle members expanded; a priority card counts 1, like the server). */
  atoms: number;
  /** The canonical first thing — the deck hero AND the brief's lead anchor. */
  first: DeckEntry | null;
};

export type AgendaInput = {
  replyItems: DoItem[]; noticeItems: DoItem[]; commitItems: DoItem[];
  /** Priority cards, ALREADY live-filtered (session-cleared removed) — so rows/atoms stay honest. */
  priorityCards: Priority[];
  deals: SlippingDeal[];
  bundles: Record<string, BundleRef>;
  bundleNames: Record<string, BundleName>;
  bundleStates?: Record<string, BundleState | null>;
  /** Brief-sentenced item ids (minus tail) — those live in the prose, so they leave the deck (hero kept). */
  sentencedIds?: Set<string>;
  sort: DoSort;
  weights?: Record<string, number>;
  todayISO?: string; // injectable for tests; defaults to today
};

/** Build the ONE agenda every surface projects from. Pure; faithful to the deck's original assembly. */
export function buildAgenda(input: AgendaInput): Agenda {
  const todayISO = input.todayISO ?? new Date().toISOString().slice(0, 10);
  const sentencedIds = input.sentencedIds ?? new Set<string>();
  // Order atoms by URGENCY, not by type — a dated action must not fall into the fold under undated replies.
  const doItems = [...input.replyItems, ...input.noticeItems, ...input.commitItems]
    .map((it, i) => ({ it, i }))
    .sort((a, b) => urgencyRank(a.it, todayISO) - urgencyRank(b.it, todayISO) || a.i - b.i)
    .map((x) => x.it);
  const doNodes = bundleDoItems(doItems, input.bundles, input.bundleNames);
  const entries: DeckEntry[] = [
    ...doNodes.map((n): DeckEntry => n.kind === 'bundle'
      ? { key: n.key, kind: 'bundle', title: n.title, why: n.why, items: n.items, state: input.bundleStates?.[n.key.slice(2)] ?? null }
      : { key: n.key, kind: 'single', item: n.item }),
    ...input.priorityCards.map((p): DeckEntry => ({ key: p.id, kind: 'priority', p })),
    ...input.deals.map((d): DeckEntry => ({ key: `deal-${d.key}`, kind: 'deal', deal: d })),
  ].filter((e, i) =>
    // De-dup vs THE BRIEF: sentenced items live in the prose; keep the hero (i===0) for its inline action.
    i === 0 || !sentencedIds.size
    || (e.kind === 'single' ? !sentencedIds.has(e.item.entityId)
      : e.kind === 'priority' ? !(e.p.itemId && sentencedIds.has(e.p.itemId)) && !sentencedIds.has(e.p.id)
      : true));
  const ordered = sortEntries(entries, input.sort, input.weights ?? {});
  const atoms = doItems.length + input.priorityCards.length + input.deals.length;
  return { entries: ordered, rows: ordered.length, atoms, first: ordered[0] ?? null };
}

/** The agenda's atom order — ordered underlying item ids (bundle members expanded, deals skipped).
 *  The server uses this to hand the brief composer its action candidates in DECK order, so the prose
 *  lead ({A1}) and the deck hero are the same thing by construction. */
export function agendaAtomOrder(agenda: Agenda): string[] {
  const out: string[] = [];
  for (const e of agenda.entries) {
    if (e.kind === 'bundle') for (const it of e.items) out.push(it.entityId);
    else if (e.kind === 'single') out.push(e.item.entityId);
    else if (e.kind === 'priority') out.push(e.p.itemId ?? e.p.id);
    // deals carry no actionable atom — the watchlist covers them
  }
  return out;
}
