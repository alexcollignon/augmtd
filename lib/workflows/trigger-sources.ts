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
}

export const TRIGGER_SOURCES: TriggerSourceDef[] = [
  { key: 'mail',     label: 'An email arrives',            icon: 'EnvelopeIcon',              feature: 'email',    needsWhen: true },
  { key: 'file',     label: 'A file lands in Knowledge',   icon: 'DocumentPlusIcon',          feature: 'drive',    needsWhen: true },
  { key: 'meeting',  label: 'A meeting is recorded',       icon: 'MicrophoneIcon',            feature: 'meetings', needsWhen: true },
  { key: 'workflow', label: 'Another workflow delivers',   icon: 'ArrowPathRoundedSquareIcon', feature: null,      needsWhen: false },
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
  return door;
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
    const key = `${d.source}|${(d.when ?? '').toLowerCase()}|${d.workflow_id ?? ''}`;
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
  return def?.label ?? 'On event';
}

/** The serving shape (ledger rows + workflow GET): normalized, registry-labelled, additive. */
export function doorsForServing(wf: { trigger?: unknown; triggers?: unknown } | null | undefined):
  Array<{ source: TriggerSourceKey; label: string }> {
  return normalizeTriggers(wf).doors.map((d) => ({ source: d.source, label: doorLabel(d) }));
}
