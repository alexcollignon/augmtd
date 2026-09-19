// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DAY ANCHOR (docs/attention-plan.md — the Sep 18 instant-help correction, laws A1 × A4).
//
// The owner's morning Home: two WEEK-OLD rows floating alone in the whispers, both there only
// because their counterparties sit in his 15:30 today. The rows were not wrong — the adjacency IS
// their why-now — they were HOMELESS. A row whose whole reason to exist is "someone in your 15:30
// will ask about this" belongs UNDER that 15:30, not floating above it. One fact, one home.
//
// ── ONE DERIVATION, HANDED OVER (never re-derived) ──────────────────────────────────────────────
// The anchor is a SERVED FACT of the attention layer: the brief route's one choke point already
// seats the five rows and already holds the adjacency fact that seated them, so it — and only it —
// decides what is anchored. The day frame is a SEPARATE request (its own route, its own cache), so
// it cannot be handed the brief's in-memory set; re-deriving the whole attention layer there would
// be a SECOND budget over a second pool, and the first disagreement would have the day frame
// promising a meeting will raise something the Home is showing as floating.
//
// So the brief RECORDS what it served (the house's `item_plans` idiom, one row per user) and the
// day frame READS it. The record is the same sentence the Home is showing, not a re-computation of
// it. Two floors keep that honest:
//   • FRESHNESS — a record older than `DAY_ANCHOR_MAX_AGE_MS` is ignored outright. A stale anchor
//     would be the day frame speaking for a deck that has moved on.
//   • ABSENCE IS THE RENDER — no record, an unreadable one, or a row whose event is not on today's
//     frame yields NO raised rows. The meeting line renders exactly as it did before (A4).
// ════════════════════════════════════════════════════════════════════════════════════════════════

/* eslint-disable @typescript-eslint/no-explicit-any */
type DBClient = any;

/** One anchored row, in the words the Home is already showing for it. */
export type DayAnchor = {
  itemId: string;
  /** The calendar event this row's seat came from — the day frame files it under exactly this id. */
  eventId: string;
  /** The row's own leading words (the counterparty / title), clipped for a second line. */
  title: string;
  /** The served why-now clause — the SAME clause the whisper wears. Never re-authored here. */
  whyNow: string;
  /** The row's own door (the room-door law's verdict, decided at the serve). */
  href: string;
};

export const DAY_ANCHOR_KIND = 'day_anchors';
/** One record per user — the anchor set is a property of the day, not of any one item. */
export const DAY_ANCHOR_ENTITY = 'attention';
/** A deck older than this has moved on; its anchors are not facts about now. */
export const DAY_ANCHOR_MAX_AGE_MS = 15 * 60_000;
/** The whisper's second line is a whisper: a clipped title, never a paragraph. */
export const DAY_ANCHOR_TITLE_MAX = 64;

export function clipAnchorTitle(s: string | null | undefined, max = DAY_ANCHOR_TITLE_MAX): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).replace(/[\s,;:·–—-]+$/, '')}…`;
}

/**
 * THE WRITE (the brief's side). Best-effort and non-fatal by construction: an anchor that failed to
 * record costs the day frame a quiet second line, never the Home.
 */
export async function writeDayAnchors(
  client: DBClient, userId: string, anchors: DayAnchor[], now: Date = new Date(),
): Promise<void> {
  try {
    await client.from('item_plans').upsert({
      user_id: userId, kind: DAY_ANCHOR_KIND, entity_id: DAY_ANCHOR_ENTITY,
      tasks: { at: now.toISOString(), anchors },
      updated_at: now.toISOString(),
    }, { onConflict: 'user_id,kind,entity_id' });
  } catch { /* the day frame simply renders without raised rows — absence is the render */ }
}

/**
 * THE READ (the day frame's side). Returns the anchors the brief served, or an empty list — never
 * a guess, never a stale claim.
 */
export async function readDayAnchors(
  client: DBClient, userId: string, now: Date = new Date(),
): Promise<DayAnchor[]> {
  try {
    const { data } = await client.from('item_plans').select('tasks')
      .eq('user_id', userId).eq('kind', DAY_ANCHOR_KIND).eq('entity_id', DAY_ANCHOR_ENTITY)
      .maybeSingle();
    const t = (data?.tasks ?? null) as { at?: string; anchors?: unknown } | null;
    if (!t?.at) return [];
    const at = Date.parse(t.at);
    if (!Number.isFinite(at) || now.getTime() - at > DAY_ANCHOR_MAX_AGE_MS) return [];
    const rows = Array.isArray(t.anchors) ? t.anchors : [];
    return rows
      .map((r) => r as Partial<DayAnchor>)
      .filter((r): r is DayAnchor => !!r && typeof r.itemId === 'string' && typeof r.eventId === 'string'
        && typeof r.title === 'string' && typeof r.whyNow === 'string' && typeof r.href === 'string');
  } catch { return []; }
}

/** The day frame's own fold: the anchors belonging to ONE event, capped — a meeting line that grows
 *  without bound is the wall this arc exists to reverse. */
export const RAISED_PER_EVENT_MAX = 3;

export function anchorsForEvent(anchors: DayAnchor[], eventId: string): DayAnchor[] {
  return anchors.filter((a) => a.eventId === eventId).slice(0, RAISED_PER_EVENT_MAX);
}
