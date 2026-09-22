// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE COLLECTION CONTRACT (Wave 1 — docs/component-map.md §6, THE PRESENTATION LAW)
//
// "A tool result is DATA, never the answer." When the answer to a question is a SET OF THE USER'S
// OWN OBJECTS — their workflows, documents, recordings, a day of their calendar — the answer is
// those objects, rendered as ONE card, with at most one framing sentence. This file is the ONE
// contract between the two halves that must never see each other's internals:
//
//   · the SERVER half (executors → the converse lane) emits a `CollectionSpec` — typed rows plus a
//     framing sentence COMPOSED BY CODE from the rows (counts and states are arithmetic, never the
//     model's to phrase). It carries no React, no handlers, no hrefs the client could not derive.
//   · the CLIENT half (the kit's `collection` card + its host) renders the spec and owns the verbs.
//
// PURE and leaf: zero IO, zero React, imported by both sides. Adding a collection KIND is one entry
// in `COLLECTION_KINDS` + a row builder on the server + (only if it has verbs) a verb map on the
// host — the card itself never changes.
//
// WHAT A ROW MAY CARRY: facts the server already holds. Never model prose, never an id rendered to
// the user, never a verb the row's state does not permit (the host derives verbs from `state`).
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The collections the product can present. A kind is a NOUN the user would say. */
export const COLLECTION_KINDS = ['workflows', 'documents', 'recordings', 'calendar'] as const;
export type CollectionKind = typeof COLLECTION_KINDS[number];

/** The tone of a row's status chip — semantic, never a colour name. */
export type RowTone = 'active' | 'paused' | 'draft' | 'attention' | 'done' | 'neutral';

export type CollectionRow = {
  /** The object's own id — for doors and verbs. NEVER rendered. */
  id: string;
  /** The object's name, as the user knows it. */
  title: string;
  /** One short status word + its tone ("paused", "draft", "indexed", "free"). */
  status?: { word: string; tone: RowTone } | null;
  /** ONE meta line, already joined by the server from known facts only
   *  ("Max · every Wednesday 09:00 · ran 5d ago"). Empty facts are omitted, never invented. */
  meta?: string | null;
  /** Who owns / produced it, when a face helps (a coworker's name — the host resolves the avatar). */
  owner?: string | null;
  /** The machine-readable state the HOST derives verbs from (never a label):
   *  workflows: 'active' | 'paused' | 'draft' · documents: 'indexed' | 'pending' | 'failed'
   *  recordings: 'ready' | 'processing' · calendar: 'event' | 'free' | 'allday'. */
  state: string;
  /** Kind-specific facts the host may need for a door (never rendered raw): e.g. a calendar row's
   *  `startISO`/`endISO`/`eventId`, a document's `source`, a workflow's `asksForMaterial`. */
  facts?: Record<string, string | number | boolean | null>;
};

export type CollectionSpec = {
  kind: CollectionKind;
  /** The framing sentence, COMPOSED BY CODE from the rows ("You have 4 workflows — 3 paused,
   *  1 draft."). The model never writes it; on the fast path it IS the turn's `say`. */
  framing: string;
  rows: CollectionRow[];
  /** How many rows exist beyond the ones served (the card says "and N more" with a door) — a cap is
   *  never silent. */
  more?: number;
  /** THE RE-READ KEY: what the host sends to `GET /api/collections` to re-derive the rows on
   *  rehydrate. A persisted card is a POINTER (kind + params), never a stale snapshot — the
   *  bulk-deed precedent: a reloaded card can never show a state that stopped being true. */
  params?: Record<string, string | number | boolean>;
  /** Shown instead of rows when there are none ("No workflows yet."). */
  emptyLine?: string;
};

/** Rows served inline before the card folds the rest behind "Show N more". */
export const COLLECTION_INLINE_ROWS = 6;
/** The most rows a spec may carry at all; beyond this the server counts them into `more`. */
export const COLLECTION_MAX_ROWS = 24;

export const isCollectionKind = (k: unknown): k is CollectionKind =>
  typeof k === 'string' && (COLLECTION_KINDS as readonly string[]).includes(k);

/** Structural validation at both ends — a malformed spec renders NOTHING (never a broken card). */
export function isCollectionSpec(v: unknown): v is CollectionSpec {
  const s = v as CollectionSpec | null;
  return !!s && isCollectionKind(s.kind) && typeof s.framing === 'string' && Array.isArray(s.rows)
    && s.rows.every((r) => !!r && typeof r.id === 'string' && typeof r.title === 'string' && typeof r.state === 'string');
}

/** "3 paused, 1 draft" — the counted tail of a framing sentence, in first-seen order. Pure. */
export function countByStatus(rows: CollectionRow[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) { const w = r.status?.word; if (w) counts.set(w, (counts.get(w) ?? 0) + 1); }
  return [...counts.entries()].map(([w, n]) => `${n} ${w}`).join(', ');
}
