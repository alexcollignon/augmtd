// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE MATCH-ITEMS FENCE — the generic handoff between a SOURCE step and a MATCHER step.
//
// A source step (any tool that brings a list of things into a pipeline) may append ONE fenced,
// versioned JSON block to its text output. A matcher step parses it back out of previousOutputs.
// Neither side knows what the other is: the fence is the whole contract, and it is the ONE owner of
// the shape — both sides import THIS file, never a copy of the type.
//
// ROBUSTNESS follows the GATE_VERDICT sentinel precedent (lib/workflows/execute-step.ts):
//   • the LAST occurrence wins — a pipeline may carry several source steps, the nearest is meant;
//   • a missing closing fence is tolerated (read to the end) rather than failing the run;
//   • malformed JSON, a wrong version, or a non-array payload returns null — never a throw, never a
//     half-parsed list;
//   • parsing is DEFENSIVE about item shape: an item without an id and a title is dropped, not
//     guessed at.
//
// THE FENCE NEVER REACHES A DELIVERABLE. It rides a source step's output, which is context; the
// matcher CONSUMES it and its own output carries no fence. Nothing downstream of the matcher can
// print it. `stripMatchItemsFences` exists for the one case where a source output is itself
// rendered somewhere a reader looks.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export const MATCH_ITEMS_VERSION = 1;
const FENCE_OPEN = '```match-items v1';
const FENCE_CLOSE = '```';
/** Matches an opening fence at any version, so a future version is DETECTED (and refused) rather
 *  than silently invisible. */
const FENCE_OPEN_ANY = /```match-items[ \t]+v(\d+)[ \t]*\r?\n/g;

/**
 * One thing a matcher can be asked to match: a tender, a job opening, a grant call, an RFP.
 *
 * The only required fields are the ones any matcher needs to reason and to print: an id it can
 * dedupe on, a title a reader recognises, a description the judge reads, and the collective noun
 * for what these things ARE.
 */
export interface MatchItem {
  /** Stable across runs — the dedupe key. A source that cannot promise stability must say so by
   *  omitting nothing else: an unstable id turns dedupe into noise. */
  id: string;
  /** A short scannable line. */
  title: string;
  /** What the item actually asks for — the text the judge reasons over. */
  description: string;
  /** The collective noun for these items AS A READER WOULD SAY THEM, plural: "Ausschreibungen",
   *  "Kandidaten", "Förderaufrufe". Every section heading a matcher prints is driven by this —
   *  UNLESS `kind` names a noun the matcher can say in the report's own language. */
  kindLabel: string;
  /** THE SEMANTIC KIND — a stable, language-free id ('tenders', 'candidates') beside the display
   *  label. A matcher that knows the id prints the noun in ITS report language; one that does not
   *  falls back to `kindLabel`. Optional: an old fence has none and behaves exactly as before. */
  kind?: string;
  /** The canonical/official link. */
  url?: string;
  /** A second link (documents, a portal, an application page). */
  secondaryUrl?: string;
  /** Monetary size where the item has one. null with valueUnknown:true = the source knows there is
   *  a value and it was not published — never rendered as a zero. */
  value?: number | null;
  valueUnknown?: boolean;
  /** ISO date the item closes, when it has one. */
  deadline?: string | null;
  /** Human-readable labels (sector, category) — display + a weak signal, never a gate. In the
   *  SOURCE's own language; a matcher prefers `tagCodes` when it can resolve every one of them. */
  tags?: string[];
  /** THE SEMANTIC TAGS — taxonomy codes behind `tags` (e.g. CPV divisions). A matcher renders them
   *  in the report's language; unknown codes send it back to `tags` whole (never half-translated).
   *  Optional and additive: `tags` remains the truth an unknowing consumer reads. */
  tagCodes?: string[];
  /**
   * Anything else the source knows. Two keys are CONVENTIONS the generic matcher reads:
   *   • `keys: string[]`   — deterministic join keys (a taxonomy code the source and a profile
   *                          manifest share, e.g. a CPV division). Used for the force-include lane
   *                          and the coverage gate. Absent → the matcher runs purely semantic.
   *   • `facts: Record<string,string>` — key→value lines the judge and the report print. A key from
   *                          the SEMANTIC REGISTRY (lib/matching/vocabularies.ts: buyer, procedure,
   *                          contractType, cpv, lots, noticeNo …) is rendered in the report's
   *                          language; any other key renders VERBATIM, so an arbitrary source that
   *                          ships its own words still works exactly as it always has.
   * Everything else rides along untouched.
   */
  meta?: Record<string, unknown>;
}

export interface MatchItemsBlock {
  version: number;
  /** The block's own collective label — what the matcher's headings say when `kind` is unknown. */
  kindLabel: string;
  /** The block's semantic kind id (see MatchItem.kind). Absent on every pre-semantic fence. */
  kind?: string;
  items: MatchItem[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));

/** Render the fence. Appended to a source step's TEXT output — the prose above it is untouched. */
export function renderMatchItemsFence(
  items: MatchItem[], opts: { kindLabel: string; kind?: string },
): string {
  const kindLabel = opts.kindLabel.trim() || 'Einträge';
  const kind = opts.kind?.trim() || undefined;
  const payload: MatchItemsBlock = {
    version: MATCH_ITEMS_VERSION,
    kindLabel,
    ...(kind ? { kind } : {}),
    items: items.map((i) => ({ ...i, kindLabel: i.kindLabel || kindLabel, ...(i.kind || kind ? { kind: i.kind || kind } : {}) })),
  };
  return `${FENCE_OPEN}\n${JSON.stringify(payload)}\n${FENCE_CLOSE}`;
}

function coerceItem(raw: unknown, kindLabel: string, kind?: string): MatchItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id).trim();
  const title = str(r.title).trim();
  const description = str(r.description).trim();
  // An item with neither an id nor anything to read is not an item.
  if (!id || (!title && !description)) return null;
  const value = typeof r.value === 'number' && Number.isFinite(r.value) ? r.value : null;
  return {
    id,
    title: title || description.slice(0, 120),
    description,
    kindLabel: str(r.kindLabel).trim() || kindLabel,
    kind: str(r.kind).trim() || kind || undefined,
    url: str(r.url).trim() || undefined,
    secondaryUrl: str(r.secondaryUrl).trim() || undefined,
    value,
    valueUnknown: r.valueUnknown === true || (value === null && r.value === null),
    deadline: str(r.deadline).trim() || null,
    tags: Array.isArray(r.tags) ? r.tags.map(str).map((s) => s.trim()).filter(Boolean) : undefined,
    tagCodes: Array.isArray(r.tagCodes) ? r.tagCodes.map(str).map((s) => s.trim()).filter(Boolean) : undefined,
    meta: r.meta && typeof r.meta === 'object' ? (r.meta as Record<string, unknown>) : undefined,
  };
}

/**
 * Parse the LAST fence in a text (the nearest source wins). Returns null when there is no fence,
 * when the version is not one this build understands, or when the payload is not a usable block.
 */
export function parseMatchItemsFence(text: string): MatchItemsBlock | null {
  if (!text) return null;
  FENCE_OPEN_ANY.lastIndex = 0;
  let last: { start: number; version: number } | null = null;
  for (let m = FENCE_OPEN_ANY.exec(text); m; m = FENCE_OPEN_ANY.exec(text)) {
    last = { start: m.index + m[0].length, version: Number(m[1]) };
  }
  if (!last) return null;
  if (last.version !== MATCH_ITEMS_VERSION) return null;

  // A missing closing fence is a truncated output, not a reason to lose the list: read to the end.
  const close = text.indexOf(`\n${FENCE_CLOSE}`, last.start);
  const body = (close === -1 ? text.slice(last.start) : text.slice(last.start, close)).trim();
  if (!body) return null;

  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  if (!Array.isArray(p.items)) return null;
  const kindLabel = str(p.kindLabel).trim() || 'Einträge';
  const kind = str(p.kind).trim() || undefined;
  const items = p.items.map((i) => coerceItem(i, kindLabel, kind)).filter((i): i is MatchItem => !!i);
  return { version: MATCH_ITEMS_VERSION, kindLabel, ...(kind ? { kind } : {}), items };
}

/** Remove every match-items fence from a text — for the rare surface that prints a source output
 *  raw. The matcher never needs this: it consumes the fence and emits none. */
export function stripMatchItemsFences(text: string): string {
  if (!text) return text;
  return text.replace(/```match-items[ \t]+v\d+[ \t]*\r?\n[\s\S]*?(?:\r?\n```|$)/g, '').trim();
}

/** The conventional deterministic join keys, read defensively off `meta`. */
export function keysOf(item: MatchItem): string[] {
  const raw = (item.meta as Record<string, unknown> | undefined)?.keys;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(str).map((s) => s.trim()).filter(Boolean))];
}

/** The conventional label→value display facts, read defensively off `meta`. */
export function factsOf(item: MatchItem): Array<[string, string]> {
  const raw = (item.meta as Record<string, unknown> | undefined)?.facts;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>)
    .map(([k, v]) => [k.trim(), str(v).trim()] as [string, string])
    .filter(([k, v]) => !!k && !!v);
}
