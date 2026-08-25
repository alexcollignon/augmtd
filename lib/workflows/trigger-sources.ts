// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE TRIGGER SOURCE REGISTRY + THE ONE READER (THE RELAY CANVAS, W1 — docs/relay-canvas-plan.md)
//
// Law 3 — THE REGISTRY IS THE CATALOGUE: trigger sources are ROWS. The WHEN block, readiness, the
// fire doors, the dispatcher, generate-config and the chat tools all render from TRIGGER_SOURCES;
// adding a source is ONE ROW (the CAPABILITY_MAP invariant applied to triggers). Nothing outside
// this file may hardcode a source list.
//
// Law 6 — MANY DOORS, ONE RUN: `triggers[]` is any-of; each door fires its own run carrying the one
// thing that arrived. Constraint v1, STATED not hidden: at most ONE schedule (next_run_at is
// singular). normalizeTriggers enforces it structurally — the schedule lives on `primary`, and a
// second one is dropped, never silently merged into a door.
//
// ── THE STORAGE (additive, NO migration) ────────────────────────────────────────────────────────
//   `workflows.trigger`  stays AUTHORITATIVE for manual/schedule (and therefore for next_run_at —
//                        the dispatcher's clock is unchanged by this wave).
//   `workflows.triggers` (jsonb array, additive) carries the EVENT DOORS. The column may not exist
//                        yet in every environment: every read of it must be defensive (a select
//                        naming it can 42703; callers catch → legacy-only). normalizeTriggers
//                        itself tolerates the field being absent, null, or garbage.
//
// Legacy folds in: a pre-W1 `trigger = {type:'reaction', when, label}` reads as
// `primary {type:'manual'}` + ONE door `{source:'mail', when, label}` — today's reactions are
// mail-judged, so the fold preserves behavior exactly.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { WorkspaceFeatures } from '@/lib/workspace/types';

export type TriggerSourceKey = 'mail' | 'file' | 'meeting' | 'workflow';

// ── THE DOOR FILTERS (W5) ───────────────────────────────────────────────────────────────────────
// A door's `when` is JUDGED (one cheap AI pass per door per batch). A FILTER is DECIDED IN CODE,
// BEFORE the judge, against fields the event carries structurally. Three consequences, all
// deliberate:
//   · AND semantics — every filter must pass; filters gate CANDIDACY, so a filtered-out event never
//     costs a judge call (the spend win).
//   · A door with filters and NO `when` is FULLY DETERMINISTIC — zero AI, and it says so in its own
//     words ("matched the door's filters"). The judged `when` becomes optional refinement ON TOP.
//   · FAIL CLOSED — a filter whose field the event does not carry FAILS. A filter the event cannot
//     answer must never silently pass: "sender domain is acme.test" quietly matching an event with
//     no sender is exactly the wrong-fire this primitive exists to prevent.
// THE FIELD REGISTRY LIVES ON THE SOURCE ROW (law 3): surfaces, the sanitiser and normalizeTriggers
// all render/validate from `filterFields` — no hardcoded field list may exist anywhere else.

export type DoorFilterOp = 'is' | 'contains' | 'domain_is';

/** One deterministic condition on ONE event field. `value` is never blank (validated). */
export interface DoorFilter {
  field: string;
  op: DoorFilterOp;
  value: string;
}

/** A filterable field of a source, as a surface renders it. */
export interface FilterFieldDef {
  key: string;
  label: string;
  ops: DoorFilterOp[];
}

/** The operator's words, for any surface that must SAY a filter. One home. */
export const FILTER_OP_LABEL: Record<DoorFilterOp, string> = {
  is: 'is',
  contains: 'contains',
  domain_is: 'domain is',
};

export interface TriggerSourceDef {
  key: TriggerSourceKey;
  /** The door's sentence, as a person reads it in the WHEN block. */
  label: string;
  /** A heroicon (v2 outline) name the WHEN block maps — never a component (this module is shared). */
  icon: string;
  /** The workspace feature this door needs. null = always available. */
  feature: keyof WorkspaceFeatures | null;
  /** mail/file/meeting judge a CONDITION over content; `workflow` binds a workflow_id instead. */
  needsWhen: boolean;
  /** CAN AN EVENT OF THIS SOURCE EVER CARRY THE ENTITY IT BELONGS TO? (Aug 25.) The scope
   *  pre-filter in runDoors is FAIL-CLOSED — `!scopeEntity || event.entityId === scopeEntity` — so
   *  on a SCOPED workflow a source that cannot supply `entityId` can never fire at all. This is a
   *  fact about the seam, not about a workflow: mail reads entity_links before the doors run and
   *  the meeting seam looks its transcript's link up, while an upload is unfiled at fire time and a
   *  delivering RUN is not an atom. It lives on the registry row (law 3) so readiness can SAY it
   *  and nothing has to hardcode a source list. */
  carriesEntity: boolean;
  /** The deterministic fields this source's events carry. Absent/empty = no filters (structural
   *  sources): a filter on such a door is dropped by normalizeTriggers and by the sanitiser. */
  filterFields?: FilterFieldDef[];
}

export const TRIGGER_SOURCES: TriggerSourceDef[] = [
  { key: 'mail',     label: 'An email arrives',            icon: 'EnvelopeIcon',              feature: 'email',    needsWhen: true,
    carriesEntity: true,
    filterFields: [
      { key: 'from_address', label: 'Sender',  ops: ['is', 'domain_is'] },
      { key: 'subject',      label: 'Subject', ops: ['contains'] },
    ] },
  // An upload is UNFILED at fire time (the confirm seam supplies no entityId), so a scoped
  // workflow's file door can never match. Readiness says so out loud (rule 9).
  { key: 'file',     label: 'A file lands in Knowledge',   icon: 'DocumentPlusIcon',          feature: 'drive',    needsWhen: true,
    carriesEntity: false,
    filterFields: [
      { key: 'filename', label: 'File name', ops: ['contains'] },
      { key: 'ext',      label: 'Type',      ops: ['is'] },
    ] },
  { key: 'meeting',  label: 'A meeting is recorded',       icon: 'MicrophoneIcon',            feature: 'meetings', needsWhen: true,
    carriesEntity: true,
    filterFields: [
      { key: 'title', label: 'Title', ops: ['contains'] },
    ] },
  // `workflow` is STRUCTURAL composition — it matches by bound id, so it has nothing to filter.
  { key: 'workflow', label: 'Another workflow delivers',   icon: 'ArrowPathRoundedSquareIcon', feature: null,      needsWhen: false,
    carriesEntity: false },
];

const SOURCE_BY_KEY = new Map<string, TriggerSourceDef>(TRIGGER_SOURCES.map((s) => [s.key, s]));

export function triggerSource(key: string | null | undefined): TriggerSourceDef | null {
  return key ? (SOURCE_BY_KEY.get(key) ?? null) : null;
}

export function isTriggerSourceKey(key: unknown): key is TriggerSourceKey {
  return typeof key === 'string' && SOURCE_BY_KEY.has(key);
}

/** An EVENT DOOR. `when` = the judged condition (mail/file/meeting); `workflow_id` = the structural
 *  binding (`workflow` source — deterministic composition, never judged). */
export interface ReactionDoor {
  type: 'reaction';
  source: TriggerSourceKey;
  when?: string;
  label?: string;
  workflow_id?: string;
  /** Deterministic pre-judge conditions (W5). AND semantics; empty/absent = no filtering. */
  filters?: DoorFilter[];
}

// ── THE FILTER REGISTRY READERS + THE EVALUATION (pure, table-testable) ─────────────────────────

/** The fields a source can be filtered on. Surfaces render FROM THIS (law 3). */
export function filterFieldsFor(source: string | null | undefined): FilterFieldDef[] {
  return triggerSource(source)?.filterFields ?? [];
}

/** One raw filter → a valid `DoorFilter` for THIS source, or null (DROPPED, nothing invented).
 *  Unknown field, an op the field doesn't offer, or a blank value → null. */
export function parseFilter(source: string, raw: unknown): DoorFilter | null {
  const r = rec(raw);
  const field = str(r.field);
  const op = str(r.op);
  const value = str(r.value);
  if (!field || !op || !value) return null;
  const def = filterFieldsFor(source).find((f) => f.key === field);
  if (!def) return null;
  if (!(def.ops as string[]).includes(op)) return null;
  return { field, op: op as DoorFilterOp, value: value.slice(0, 200) };
}

function lower(s: string): string {
  return s.trim().toLowerCase();
}

/** The domain part of an address-ish string: strips a display name / `<>` wrapper, takes what
 *  follows the LAST `@`. '' when there is none. */
export function addressDomain(raw: string): string {
  const inAngle = raw.match(/<([^>]*)>/);
  const addr = lower(inAngle ? inAngle[1] : raw);
  const at = addr.lastIndexOf('@');
  return at >= 0 ? addr.slice(at + 1).replace(/[>\s]+$/, '') : '';
}

/** ONE filter against ONE event value. `undefined`/blank value → FALSE (fail closed, by law). */
export function filterPasses(f: DoorFilter, value: string | undefined | null): boolean {
  const have = typeof value === 'string' ? value.trim() : '';
  if (!have) return false;
  const want = lower(f.value);
  if (!want) return false;
  switch (f.op) {
    case 'is': return lower(have) === want;
    case 'contains': return lower(have).includes(want);
    case 'domain_is': {
      const domain = addressDomain(have);
      // The user may say "acme.test" or "@acme.test" — both mean the same domain.
      return !!domain && domain === want.replace(/^@/, '');
    }
    default: return false;
  }
}

/** THE GATE: every filter must pass (AND). No filters = pass (a door without filters is unchanged
 *  by W5). A field the event does not carry fails ITS filter — never a permissive default. */
export function doorFiltersPass(
  door: { filters?: DoorFilter[] } | null | undefined,
  event: { fields?: Record<string, string> | null } | null | undefined,
): boolean {
  const filters = door?.filters ?? [];
  if (!filters.length) return true;
  const fields = event?.fields ?? {};
  return filters.every((f) => filterPasses(f, fields[f.field]));
}

/** A human rendering of a door's filters ("Sender domain is acme.test · Subject contains X"). */
export function describeFilters(door: { source?: string; filters?: DoorFilter[] } | null | undefined): string {
  const filters = door?.filters ?? [];
  if (!filters.length) return '';
  const fields = filterFieldsFor(door?.source);
  return filters.map((f) => {
    const label = fields.find((d) => d.key === f.field)?.label ?? f.field;
    return `${label} ${FILTER_OP_LABEL[f.op]} ${f.value}`;
  }).join(' · ');
}

export interface PrimaryTrigger {
  type: 'manual' | 'schedule';
  cron?: string;
  timezone?: string;
  label?: string;
}

export interface NormalizedTriggers {
  primary: PrimaryTrigger;
  doors: ReactionDoor[];
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : undefined;
}

/** Parse ONE raw door. Unknown/absent source → null (DROPPED, nothing invented). */
function parseDoor(raw: unknown): ReactionDoor | null {
  const r = rec(raw);
  const source = r.source;
  if (!isTriggerSourceKey(source)) return null;
  const door: ReactionDoor = { type: 'reaction', source };
  const when = str(r.when);
  if (when) door.when = when;
  const label = str(r.label);
  if (label) door.label = label;
  const wfId = str(r.workflow_id);
  if (wfId) door.workflow_id = wfId;
  // W5 — filters are validated AGAINST THE REGISTRY: an unknown field/op (or a filter on a source
  // that has none) drops THAT FILTER, never the door. A dropped filter widens the door; it can
  // never invent a narrowing the user did not author.
  const filters = parseFilters(door.source, r.filters);
  if (filters.length) door.filters = filters;
  return door;
}

/** Parse a raw filter array for a source. Invalid entries dropped; capped (a door is a sentence,
 *  not a query builder). */
function parseFilters(source: TriggerSourceKey, raw: unknown): DoorFilter[] {
  if (!Array.isArray(raw)) return [];
  const out: DoorFilter[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const f = parseFilter(source, entry);
    if (!f) continue;
    const key = `${f.field}|${f.op}|${f.value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
    if (out.length >= 6) break;
  }
  return out;
}

/** The dedupe/identity rendering of a door's filters — order-insensitive, so two doors that filter
 *  the same way read as one however they were authored. */
function filterKey(door: ReactionDoor): string {
  return (door.filters ?? [])
    .map((f) => `${f.field}:${f.op}:${f.value.toLowerCase()}`)
    .sort()
    .join(',');
}

/**
 * THE ONE READER (spec THE SCHEMA): every consumer — dispatcher, readiness, reaction matching,
 * serving, Studio — reads this normalized shape, never the raw columns.
 *
 * Semantics:
 *  · `trigger.type === 'schedule'` → primary schedule (cron/timezone/label preserved verbatim).
 *  · `trigger.type === 'reaction'` (LEGACY) → primary manual + one `{source:'mail'}` door.
 *  · anything else / absent        → primary manual.
 *  · `triggers[]` parses defensively; unknown source keys are DROPPED; a schedule-shaped entry
 *    there is NOT promoted (law 6: one schedule, and it lives on `trigger`).
 *  · doors dedupe by (source, when, workflow_id) so a legacy fold + an authored copy read as one.
 */
export function normalizeTriggers(wf: { trigger?: unknown; triggers?: unknown } | null | undefined): NormalizedTriggers {
  const t = rec(wf?.trigger);
  const type = typeof t.type === 'string' ? t.type : '';

  let primary: PrimaryTrigger;
  if (type === 'schedule') {
    primary = { type: 'schedule' };
    const cron = str(t.cron); if (cron) primary.cron = cron;
    const tz = str(t.timezone); if (tz) primary.timezone = tz;
    const label = str(t.label); if (label) primary.label = label;
  } else {
    primary = { type: 'manual' };
    if (type !== 'reaction') { const label = str(t.label); if (label) primary.label = label; }
  }

  const doors: ReactionDoor[] = [];
  // THE LEGACY FOLD — a pre-W1 reaction trigger IS a mail door (that is all reactions ever were).
  if (type === 'reaction') {
    const door: ReactionDoor = { type: 'reaction', source: 'mail' };
    const when = str(t.when); if (when) door.when = when;
    const label = str(t.label); if (label) door.label = label;
    doors.push(door);
  }

  const raw = wf?.triggers;
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const door = parseDoor(entry);
      if (door) doors.push(door);
    }
  }

  const seen = new Set<string>();
  const deduped = doors.filter((d) => {
    // Filters are PART OF A DOOR'S IDENTITY: two mail doors with the same `when` but different
    // filters are two different doors, and folding them would silently delete one.
    const key = `${d.source}|${(d.when ?? '').toLowerCase()}|${d.workflow_id ?? ''}|${filterKey(d)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { primary, doors: deduped };
}

/** The registry label for a door, for any surface that must SAY what a door is. */
export function doorLabel(door: ReactionDoor): string {
  if (door.label) return door.label;
  const def = triggerSource(door.source);
  if (door.source === 'workflow') return def?.label ?? 'Another workflow delivers';
  if (door.when) return `When ${door.when}`;
  // W5 — a FULLY DETERMINISTIC door (filters, no judged condition) says what it actually matches.
  const filters = describeFilters(door);
  if (filters) return `${def?.label ?? 'On event'} · ${filters}`;
  return def?.label ?? 'On event';
}

/** The serving shape (ledger rows + workflow GET): normalized, registry-labelled, additive.
 *  `filters` rides only when a door has them — a door without them serves exactly as before. */
export function doorsForServing(wf: { trigger?: unknown; triggers?: unknown } | null | undefined):
  Array<{ source: TriggerSourceKey; label: string; filters?: DoorFilter[] }> {
  return normalizeTriggers(wf).doors.map((d) => (
    d.filters?.length
      ? { source: d.source, label: doorLabel(d), filters: d.filters }
      : { source: d.source, label: doorLabel(d) }
  ));
}
