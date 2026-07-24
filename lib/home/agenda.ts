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
export type DoSource = 'reply' | 'notice' | 'commitment' | 'deal';
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
  // covers (P6a — the arbiter): plain item ids the next move RESOLVES; the deck renders those members
  // as evidence under the one action instead of parallel asks.
  nextMove: { title: string; entityRef: string | null; reason?: string; covers?: string[] } | null;
};

/** The member ids a bundle's next move covers — one Set for the render pass. */
export function coveredIds(state: BundleState | null | undefined): Set<string> {
  return new Set(state?.nextMove?.covers ?? []);
}
export type BundleRef = { key: string; label: string };
export type BundleName = { name: string; why?: string };
export type DoNode = { kind: 'bundle'; key: string; title: string; why?: string; items: DoItem[] } | { kind: 'single'; key: string; item: DoItem };
export type DeckEntry =
  | { key: string; kind: 'bundle'; title: string; why?: string; items: DoItem[]; state?: BundleState | null }
  | { key: string; kind: 'single'; item: DoItem }
  | { key: string; kind: 'priority'; p: Priority }
  | { key: string; kind: 'deal'; deal: SlippingDeal };
// (The Urgent/Important/Quick-wins lens type died with the lens sorts — Phase 3 F1: ordering is the
// REASONED priority only; a date is a fact the judge already weighed, never a sort rule.)

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

// ── ORDERING = THE REASONED PRIORITY (Phase 3 F1, the doctrine). The verdict WEIGHT is READ from the
// server's `itemWeights` — the entity synthesis's judged priority, which already weighed deadlines,
// stakes and momentum with the ledger in view. NO date-rule sorts, no effort/size heuristics: a fact
// may render (the overdue chip) but never order. Where the brain has NOT judged (an unlinked item),
// the weight is a NEUTRAL constant — absence of judgment is not judgment — and the stable base order
// (arrival/assembly) breaks ties mechanically.
const NEUTRAL_WEIGHT = 20;
export function entryWeight(e: DeckEntry, weights: Record<string, number>): number {
  if (e.kind === 'deal') return e.deal.weight;
  if (e.kind === 'bundle') return e.items.reduce((mx, it) => Math.max(mx, weights[it.entityId] ?? NEUTRAL_WEIGHT), 0);
  if (e.kind === 'single') return weights[e.item.entityId] ?? NEUTRAL_WEIGHT;
  return weights[e.p.itemId ?? ''] ?? NEUTRAL_WEIGHT;
}

export function orderEntries(entries: DeckEntry[], weights: Record<string, number> = {}): DeckEntry[] {
  return entries
    .map((e, i) => ({ e, i, w: entryWeight(e, weights) }))
    .sort((A, B) => (B.w - A.w) || (A.i - B.i))
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
  weights?: Record<string, number>;
  todayISO?: string; // injectable for tests; defaults to today
};

/** Build the ONE agenda every surface projects from. Pure; faithful to the deck's original assembly. */
// ── Deck-level NEAR-DUP fold (P5c): two visible rows saying the same thing (twin automated notices
// like a portal sending the same alert twice, re-synced copies) collapse to the most urgent one. Pure
// + client-safe (agenda runs in the browser — the server-side isNearDuplicate lives in a module that
// drags the AI graph, so this is its deliberately tiny twin: same-sender + near-identical title).
const normText = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
function nearDupRow(a: DoItem, b: DoItem): boolean {
  if ((a.primary ?? '') !== (b.primary ?? '')) return false; // different sender → different obligation
  const na = normText(a.ask), nb = normText(b.ask);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const ta = new Set(na.split(' ')), tb = new Set(nb.split(' '));
  let inter = 0; for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union > 0 && inter / union >= 0.8;
}
function foldNearDupItems(items: DoItem[]): DoItem[] {
  const kept: DoItem[] = [];
  for (const it of items) { if (!kept.some((k) => k.source === it.source && nearDupRow(k, it))) kept.push(it); }
  return kept;
}

export function buildAgenda(input: AgendaInput): Agenda {
  const sentencedIds = input.sentencedIds ?? new Set<string>();
  const w = input.weights ?? {};
  // Order atoms by the REASONED weight, not by type or date rules — a judged-heavy item must not fall
  // into the fold under neutral ones. Ties keep assembly order (mechanical, stable).
  const doItems = foldNearDupItems(
    [...input.replyItems, ...input.noticeItems, ...input.commitItems]
      .map((it, i) => ({ it, i, wt: w[it.entityId] ?? NEUTRAL_WEIGHT }))
      .sort((a, b) => (b.wt - a.wt) || (a.i - b.i))
      .map((x) => x.it),
  );
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
  const ordered = orderEntries(entries, w);
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
