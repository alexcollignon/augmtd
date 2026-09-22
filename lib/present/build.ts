// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE COLLECTION BUILDERS (Wave 1, Sep 22 — docs/component-map.md §3 + §6).
//
// ONE builder per collection kind, ZERO AI. Each reads THE SAME query its chat executor reads —
// literally the same exported reader — and renders the OTHER half of it: `modelText` for the model,
// typed `CollectionRow`s for the kit. The inventory that motivated this found, in nine of eleven
// prose-only answers, a fully typed row array sitting a few lines above the `.map().join('\n')`
// that destroyed it; the extraction is the whole fix.
//
// THE FRAMING IS ARITHMETIC. Every sentence this file composes is counted by code from the rows it
// just built ("You have 4 workflows — 3 active, 1 paused."). The model never writes it, so on the
// fast path the framing can BE the turn's `say` with nothing model-facing in it. One composer per
// kind, so localisation is one seam.
//
// A ROW CARRIES FACTS, NEVER PROSE, NEVER AN ID THE USER READS. Ids ride `row.id` / `row.facts`
// for doors and verbs; a gate sweeps the built spec for uuids in `title`/`meta`/`framing`.
//
// THE PREDICATE IS NOT FORKED. A workflow row carries the INPUTS of `asksForMaterial`
// (components/workflows/run-material-sheet.tsx — a `'use client'` module a server file must not
// import) — `hasInputStations` · `hasReactionDoors` · `acceptsMaterial` — and the host calls the
// ONE predicate it already imports. Copying the rule here would be the fork the predicate exists
// to prevent.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  COLLECTION_MAX_ROWS, countByStatus,
  type CollectionKind, type CollectionRow, type CollectionSpec, type RowTone,
} from '@/lib/present/collection';
import { clipLabel } from '@/lib/utils/clip-for-prompt';

type Params = Record<string, string | number | boolean>;

const asParams = (p?: Record<string, string | number | boolean> | undefined): Params => ({ ...(p ?? {}) });
const str = (p: Params, k: string): string | undefined => (typeof p[k] === 'string' ? (p[k] as string).trim() || undefined : undefined);
const num = (p: Params, k: string): number | undefined => (typeof p[k] === 'number' && Number.isFinite(p[k] as number) ? (p[k] as number) : undefined);

/** "3 things" / "One thing" — the counted head of a framing sentence. Pure. */
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** THE CAP IS NEVER SILENT: the rows served, and how many were left behind. Pure. */
export function capRows<T>(all: T[]): { kept: T[]; more: number } {
  return { kept: all.slice(0, COLLECTION_MAX_ROWS), more: Math.max(0, all.length - COLLECTION_MAX_ROWS) };
}

/** A meta line is joined from KNOWN facts only — an absent fact is omitted, never invented. Pure. */
export const metaLine = (bits: Array<string | null | undefined>): string | null =>
  bits.map((b) => (typeof b === 'string' ? b.trim() : '')).filter(Boolean).join(' · ') || null;

// ─── workflows ────────────────────────────────────────────────────────────────────────────────

const WORKFLOW_TONE: Record<string, RowTone> = { active: 'active', paused: 'paused', draft: 'draft' };

export type WorkflowRowSource = {
  id: string;
  name: string;
  status: string;
  trigger: { type: string; cron?: string; label?: string };
  last_run_at: string | null;
  ownerName: string | null;
  /** The material-door facts (see the header) — undefined = unread, which claims nothing. */
  hasInputStations?: boolean;
  hasReactionDoors?: boolean;
  acceptsMaterial?: boolean;
};

/** PURE: typed workflow rows → collection rows. The schedule and last-run WORDS are the executor's
 *  own (`formatSchedule` / `formatLastRun`), so the card and the model say the same thing. */
export function workflowRows(
  rows: WorkflowRowSource[],
  labels: { schedule: (t: { type: string; cron?: string; label?: string }) => string; lastRun: (iso: string | null) => string },
): CollectionRow[] {
  return rows.map((w) => {
    const status = String(w.status || '').toLowerCase();
    return {
      id: w.id,
      title: w.name,
      status: { word: status || 'unknown', tone: WORKFLOW_TONE[status] ?? 'neutral' },
      meta: metaLine([w.ownerName, labels.schedule(w.trigger ?? { type: 'manual' }), labels.lastRun(w.last_run_at)]),
      owner: w.ownerName ?? null,
      state: status || 'draft',
      facts: {
        ...(w.hasInputStations === undefined ? {} : { hasInputStations: w.hasInputStations }),
        ...(w.hasReactionDoors === undefined ? {} : { hasReactionDoors: w.hasReactionDoors }),
        ...(w.acceptsMaterial === undefined ? {} : { acceptsMaterial: w.acceptsMaterial }),
      },
    };
  });
}

/** PURE. "You have 4 workflows — 3 active, 1 paused." */
export function framingWorkflows(rows: CollectionRow[], more = 0): string {
  const total = rows.length + more;
  if (!total) return 'No workflows set up yet.';
  const tail = countByStatus(rows);
  const head = `You have ${plural(total, 'workflow')}`;
  // The breakdown is only worth saying when it splits the set — "1 workflow — 1 active" is noise.
  const words = new Set(rows.map((r) => r.status?.word).filter(Boolean));
  return words.size > 1 && !more ? `${head} — ${tail}.` : `${head}.`;
}

// ─── documents ────────────────────────────────────────────────────────────────────────────────

export type DocumentRowSource = {
  fileId: string;
  filename: string;
  summary: string | null;
  similarity: number;
  topCitation: string;
};

/** PURE: KB search groups → collection rows. The meta line is the top citation, clipped by THE LABEL
 *  clipper (`clipLabel`): it is a one-line card META a PERSON reads, not a prompt excerpt, so it ends
 *  at a word boundary and wears a plain ellipsis — the prompt marker inside a meta line is chrome, and
 *  chrome inside a card row reads as a defect (A LABEL IS NOT AN EXCERPT, Sep 21).
 *  STATE: a chunk hit IS proof of indexing — the search reads `knowledge_chunks`, so a file that
 *  answered cannot be pending. An un-indexed file simply never appears here. */
export function documentRows(groups: DocumentRowSource[]): CollectionRow[] {
  return groups.map((g) => ({
    id: g.fileId,
    title: g.filename,
    // THE CITATION IS THE STATUS (Sep 22 — the DM's receipt layer). A documents collection is only
    // ever built from the groups an answer was GROUNDED IN (`search_knowledge_base`'s own
    // kbCtx.groups, one read two renderings) — so the true word for these rows is not "indexed"
    // (every file in Knowledge is indexed; it said nothing about THIS answer) but "cited". The
    // machine-readable `state` is unchanged, so the host's verbs are exactly what they were.
    status: { word: 'cited', tone: 'neutral' as RowTone },
    meta: metaLine([clipLabel((g.summary || g.topCitation || '').replace(/\s+/g, ' '), 120)]),
    owner: null,
    state: 'indexed',
    facts: { source: 'knowledge_base' },
  }));
}

/** PURE. 'From your Knowledge — 3 documents mention "pricing".'
 *
 *  THE FRAMING NAMES THE SOURCE (Sep 22): these rows are the files the coworker's answer was built
 *  on, so the sentence says where they came from. Arithmetic over the rows, never the model's
 *  phrasing; the query is the USER'S OWN WORD, quoted back, never paraphrased. */
export function framingDocuments(rows: CollectionRow[], query: string, more = 0): string {
  const total = rows.length + more;
  const q = query.trim();
  if (!total) return q ? `Nothing in your documents matches "${q}".` : 'Nothing matching in your documents.';
  return q
    ? `From your Knowledge — ${plural(total, 'document')} mention "${q}".`
    : `From your Knowledge — ${plural(total, 'document')}.`;
}

// ─── recordings ───────────────────────────────────────────────────────────────────────────────

export type RecordingRowSource = {
  id: string;
  title: string;
  dateLabel: string;
  duration_minutes: number | null;
  actionItems: string[];
  attendees: Array<{ email: string; name?: string }>;
};

/** PURE: recorded meetings → collection rows. Every fact is counted, never described. */
export function recordingRows(rows: RecordingRowSource[]): CollectionRow[] {
  return rows.map((m) => ({
    id: m.id,
    title: m.title || 'Untitled recording',
    status: { word: 'ready', tone: 'done' as RowTone },
    meta: metaLine([
      m.dateLabel,
      m.duration_minutes ? `${m.duration_minutes} min` : null,
      m.actionItems.length ? plural(m.actionItems.length, 'action item') : null,
      m.attendees.length ? plural(m.attendees.length, 'attendee') : null,
    ]),
    owner: null,
    state: 'ready',
    facts: { actionItems: m.actionItems.length, attendees: m.attendees.length },
  }));
}

/** PURE. "3 recordings in the last 7 days." */
export function framingRecordings(rows: CollectionRow[], sinceLabel: string, more = 0): string {
  const total = rows.length + more;
  const when = sinceLabel ? ` in the last ${sinceLabel}` : '';
  if (!total) return `Nothing recorded${when}.`;
  return `${plural(total, 'recording')}${when}.`;
}

// ─── calendar ─────────────────────────────────────────────────────────────────────────────────

export type CalendarDaySource = {
  dayStr: string;
  weekday: string;
  busy: Array<{ start: string; end: string; title: string; allDay: boolean; id?: string; startISO?: string; endISO?: string }>;
};

/** "Tue 23 Sep" — the SAME weekday–date pairing the schedule window computed; this file never
 *  derives a weekday from a date or a date from a weekday (the incident that wrote the law).
 *  EXPORTED (Wave 2, Sep 22) so the event card's builder wears the same chip rather than a second
 *  copy of this function — one day label, one place it is spelled. */
export const dayChip = (d: { dayStr: string; weekday: string }): string => {
  const [, mm, dd] = d.dayStr.split('-');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = MONTHS[Math.max(0, Math.min(11, Number(mm) - 1))] ?? '';
  return `${(d.weekday || '').slice(0, 3)} ${Number(dd)} ${month}`.trim();
};

/** PURE: the schedule window's days → one row per event (all-day rows carry the day, not a clock).
 *  A proposed free slot renders as its own `free` row — and ONLY when slots were actually proposed:
 *  an empty day is not an offer. Times come from the struct, in the user's zone, already computed. */
export function calendarRows(
  days: CalendarDaySource[],
  slots: Array<{ startISO: string; endISO: string; dayStr: string; weekday: string; label: string }> = [],
): CollectionRow[] {
  const rows: CollectionRow[] = [];
  for (const d of days) {
    for (const b of d.busy) {
      rows.push({
        id: b.id || `${d.dayStr}:${b.start}:${b.title}`,
        title: b.title,
        status: b.allDay ? { word: 'all day', tone: 'attention' } : { word: b.start, tone: 'neutral' },
        meta: metaLine([dayChip(d), b.allDay ? 'all day' : `${b.start}–${b.end}`]),
        owner: null,
        state: b.allDay ? 'allday' : 'event',
        facts: {
          ...(b.id ? { eventId: b.id } : {}),
          ...(b.startISO ? { startISO: b.startISO } : {}),
          ...(b.endISO ? { endISO: b.endISO } : {}),
          day: d.dayStr,
        },
      });
    }
  }
  for (const s of slots) {
    rows.push({
      id: `free:${s.startISO}`,
      title: s.label,
      status: { word: 'free', tone: 'active' },
      meta: metaLine([dayChip({ dayStr: s.dayStr, weekday: s.weekday })]),
      owner: null,
      state: 'free',
      facts: { startISO: s.startISO, endISO: s.endISO, day: s.dayStr },
    });
  }
  return rows;
}

/** PURE. "Tue 23 Sep: 3 meetings." / "Mon 22 – Fri 26 Sep: 7 meetings." / the honest empty line. */
export function framingCalendar(
  rows: CollectionRow[], days: CalendarDaySource[], opts: { hasCalendar: boolean }, more = 0,
): string {
  if (!opts.hasCalendar) return 'No calendar is connected here, so I can\'t say what\'s booked.';
  const first = days[0], last = days[days.length - 1];
  const span = !first ? '' : (last && last.dayStr !== first.dayStr) ? `${dayChip(first)} – ${dayChip(last)}` : dayChip(first);
  const events = rows.filter((r) => r.state !== 'free').length + more;
  const free = rows.filter((r) => r.state === 'free').length;
  if (!events) return free ? `${span}: nothing booked — ${plural(free, 'free slot')}.` : `${span}: nothing booked.`;
  return free
    ? `${span}: ${plural(events, 'meeting')}, ${plural(free, 'free slot')}.`
    : `${span}: ${plural(events, 'meeting')}.`;
}

// ─── THE ONE ENTRY POINT ──────────────────────────────────────────────────────────────────────

/**
 * Build one collection from the user's own objects. Zero AI, one read per kind, `null` when the
 * kind cannot be served here (an unknown kind, or a read that failed — a half-built card is a
 * promise the product can't keep).
 *
 * `params` IS the re-read key: `GET /api/collections` calls exactly this with the persisted
 * pointer, so a rehydrated card re-derives its rows and can never show a state that stopped being
 * true (the bulk-deed precedent).
 */
export async function buildCollection(
  client: SupabaseClient,
  userId: string,
  kind: CollectionKind,
  params?: Record<string, string | number | boolean>,
): Promise<CollectionSpec | null> {
  const p = asParams(params);
  try {
    if (kind === 'workflows') return await buildWorkflows(client, userId, p);
    if (kind === 'documents') return await buildDocuments(client, userId, p);
    if (kind === 'recordings') return await buildRecordings(client, userId, p);
    if (kind === 'calendar') return await buildCalendar(client, userId, p);
    return null;
  } catch {
    return null;
  }
}

async function buildWorkflows(client: SupabaseClient, userId: string, p: Params): Promise<CollectionSpec | null> {
  const { readTaskRows, formatSchedule, formatLastRun } = await import('@/lib/tools/worker-tasks');
  const agentId = str(p, 'agentId') ?? null;
  const rows = await readTaskRows(agentId, userId, client as never);
  const facts = await materialFacts(client, userId, rows.map((r) => r.id));
  const built = workflowRows(
    rows.map((r) => ({
      id: r.id, name: r.name, status: r.status, trigger: r.trigger, last_run_at: r.last_run_at,
      ownerName: r.ownerName, ...(facts.get(r.id) ?? {}),
    })),
    { schedule: formatSchedule, lastRun: formatLastRun },
  );
  const { kept, more } = capRows(built);
  return {
    kind: 'workflows',
    framing: framingWorkflows(kept, more),
    rows: kept,
    ...(more ? { more } : {}),
    params: agentId ? { agentId } : { scope: 'all' },
    emptyLine: 'No workflows set up yet.',
  };
}

/** THE MATERIAL DOOR'S FACTS, batched (never N reads for N rows) and DEFENSIVE: `workflows.triggers`
 *  is additive and may be absent, and a select naming a missing column fails the WHOLE read — so the
 *  door read falls back to the legacy `trigger` column rather than blanking the collection. */
async function materialFacts(
  client: SupabaseClient, userId: string, ids: string[],
): Promise<Map<string, { hasInputStations: boolean; hasReactionDoors: boolean; acceptsMaterial: boolean }>> {
  const out = new Map<string, { hasInputStations: boolean; hasReactionDoors: boolean; acceptsMaterial: boolean }>();
  if (!ids.length) return out;
  try {
    const { normalizeTriggers } = await import('@/lib/workflows/trigger-sources');
    const { INPUTS_KIND } = await import('@/lib/workflows/inputs');
    let rows: Array<{ id: string; steps?: unknown; trigger?: unknown; triggers?: unknown }> = [];
    const full = await client.from('workflows').select('id, steps, trigger, triggers').eq('user_id', userId).in('id', ids);
    if (full.error || !full.data) {
      const legacy = await client.from('workflows').select('id, steps, trigger').eq('user_id', userId).in('id', ids);
      rows = (legacy.data ?? []) as typeof rows;
    } else rows = full.data as typeof rows;

    const { data: trays } = await client.from('item_plans').select('entity_id, tasks')
      .eq('user_id', userId).eq('kind', INPUTS_KIND).in('entity_id', ids);
    const accepts = new Map<string, boolean>();
    for (const t of (trays ?? []) as Array<{ entity_id: string; tasks: unknown }>) {
      const tasks = (t.tasks ?? null) as { acceptMaterial?: unknown } | null;
      accepts.set(String(t.entity_id), tasks?.acceptMaterial === true);
    }

    for (const w of rows) {
      const steps = Array.isArray(w.steps) ? (w.steps as Array<{ type?: string }>) : [];
      out.set(String(w.id), {
        hasInputStations: steps.some((s) => s?.type === 'input'),
        hasReactionDoors: normalizeTriggers({ trigger: w.trigger, triggers: w.triggers }).doors.length > 0,
        acceptsMaterial: accepts.get(String(w.id)) === true,
      });
    }
  } catch { /* unread facts claim NOTHING — the rows serve without them */ }
  return out;
}

async function buildDocuments(client: SupabaseClient, userId: string, p: Params): Promise<CollectionSpec | null> {
  const query = str(p, 'query') ?? '';
  if (!query) return null;   // the documents collection is a SEARCH; there is no chief listing read
  const { searchKnowledgeGrouped } = await import('@/lib/knowledge/search');
  const groups = await searchKnowledgeGrouped(userId, query, 8, client, { maxChunksPerFile: 2, threshold: 0.2 });
  return documentSpec(groups, query);
}

/** The spec from groups ALREADY READ (the dispatch path holds them from buildKBContext — one read,
 *  two renderings; the re-read route goes through `buildCollection` above). Pure but for the types. */
export function documentSpec(groups: DocumentRowSource[], query: string): CollectionSpec {
  const { kept, more } = capRows(documentRows(groups));
  return {
    kind: 'documents',
    framing: framingDocuments(kept, query, more),
    rows: kept,
    ...(more ? { more } : {}),
    params: { query },
    emptyLine: `Nothing in your documents matches "${query}".`,
  };
}

async function buildRecordings(client: SupabaseClient, userId: string, p: Params): Promise<CollectionSpec | null> {
  const { readMeetingContext } = await import('@/lib/tools/get-meeting-context');
  const days = num(p, 'days');
  const since = str(p, 'since') ?? (days ? `${days}d` : '7d');
  const withPerson = str(p, 'query');
  const read = await readMeetingContext(
    { since, include: 'both', include_upcoming: false, ...(withPerson ? { with_person: withPerson } : {}) },
    userId, client,
  );
  return recordingSpec(read.meetings, { since, withPerson });
}

export function recordingSpec(
  meetings: RecordingRowSource[], opts: { since: string; withPerson?: string },
): CollectionSpec {
  const { kept, more } = capRows(recordingRows(meetings));
  const sinceLabel = sinceWords(opts.since);
  return {
    kind: 'recordings',
    framing: framingRecordings(kept, sinceLabel, more),
    rows: kept,
    ...(more ? { more } : {}),
    params: { since: opts.since, ...(opts.withPerson ? { query: opts.withPerson } : {}) },
    emptyLine: `Nothing recorded in the last ${sinceLabel}.`,
  };
}

/** "7d" → "7 days". Pure; an unparseable window says "30 days" exactly as the executor defaults. */
export function sinceWords(since: string): string {
  const m = /^(\d+)d$/.exec(String(since || '').trim());
  return m ? `${Number(m[1])} days` : '30 days';
}

async function buildCalendar(client: SupabaseClient, userId: string, p: Params): Promise<CollectionSpec | null> {
  const { readCalendar } = await import('@/lib/tools/check-calendar');
  const from = str(p, 'from');
  const to = str(p, 'to');
  const read = await readCalendar({ ...(from ? { from_date: from } : {}), ...(to ? { to_date: to } : {}) }, userId, client);
  if ('refusal' in read) return null;
  return calendarSpec(read.win.days, { hasCalendar: read.win.hasCalendar, from: read.fromDayStr, to: read.toDayStr });
}

export function calendarSpec(
  days: CalendarDaySource[],
  opts: { hasCalendar: boolean; from: string; to: string; slots?: Array<{ startISO: string; endISO: string; dayStr: string; weekday: string; label: string }> },
): CollectionSpec {
  const { kept, more } = capRows(calendarRows(days, opts.slots ?? []));
  return {
    kind: 'calendar',
    framing: framingCalendar(kept, days, { hasCalendar: opts.hasCalendar }, more),
    rows: kept,
    ...(more ? { more } : {}),
    params: { from: opts.from, to: opts.to },
    emptyLine: opts.hasCalendar ? 'Nothing booked in that window.' : 'No calendar is connected here.',
  };
}
