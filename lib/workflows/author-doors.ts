// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE AUTHORING RESOLVERS — ONE HOME (THE RELAY CANVAS — law 1: ONE SCHEMA, FOUR DOORS)
//
// Two primitives are authored BY A MODEL through two doors each (describe-it / coworker chat):
// the EVENT DOORS (`authorDoors`, W1) and the INPUTS TRAY (`authorInputs`, W2). Both live here so
// the two authoring doors cannot drift from each other OR from the two primitives: one ladder
// idiom (registry/roster → exact → unique containment → REFUSAL WITH A SPOKEN NOTE), one notes
// channel, one "the model says NAMES, code resolves IDS" law.
//
// ── THE DOORS HALF (W1) ─────────────────────────────────────────────────────────────────────────
//
// Describe-it (generate-config) and coworker chat (create_task/update_task) both let a MODEL author
// event doors. A model-emitted door is a WISH, never a fact: this module is the single place a wish
// becomes a stored `ReactionDoor` — so the two authoring doors cannot drift, and neither can invent
// a source the registry doesn't have or bind a workflow the user doesn't own.
//
// THE LADDER (each rung either yields a door or DROPS it with a note the surface can speak — the
// needs_person_note idiom: a gap is STATED, never silently shipped):
//   1. registry:   `source` must be a TRIGGER_SOURCES key. Unknown → dropped.
//   2. feature:    a door whose source needs an OFF workspace feature is a dead door → dropped.
//                  (features unknown → the rule abstains, exactly like readinessOf.)
//   3. condition:  a judged source (needsWhen) with a blank `when` → dropped (nothing to judge).
//   4. binding:    a `workflow` door arrives by NAME (the resolve-member precedent — the model
//                  NEVER emits ids). Exact name → unique containment. Ambiguous or no match →
//                  dropped. A workflow bound to ITSELF is refused (law 5's circular floor).
//   5. schedule:   law 6 — at most ONE schedule, and it lives on `trigger`. A schedule-shaped entry
//                  in triggers[] is dropped, noted, never merged into a door.
// Survivors go through `normalizeTriggers` (THE ONE READER) so what we store is exactly what every
// consumer reads back — dedupe and shape discipline in one place.
//
// Storage discipline mirrors the workflows PATCH: normalized array, or NULL when empty (the fire
// doors discover candidates with `triggers is not null`).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkspaceFeatures } from '@/lib/workspace/types';
import {
  TRIGGER_SOURCES, isTriggerSourceKey, triggerSource, normalizeTriggers, doorLabel,
  type ReactionDoor,
} from '@/lib/workflows/trigger-sources';
import type { WorkflowInputDoc } from '@/lib/workflows/inputs';

export interface AuthoredDoors {
  /** Normalized, registry-checked, resolution-complete. Empty = author no doors. */
  doors: ReactionDoor[];
  /** One line per DROPPED wish, in the user's words — the surface speaks these. */
  notes: string[];
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** THE DOOR CATALOGUE, rendered FROM THE REGISTRY (law 3 — no hardcoded source list in prose).
 *  Shared by generate-config's system prompt and the chat tools' argument descriptions, so the
 *  two authoring doors are taught the same words by construction. */
export function renderDoorCatalogue(): string {
  return TRIGGER_SOURCES.map((s) => {
    const shape = s.needsWhen
      ? '"when": the condition in plain words (judged against each arriving event)'
      : '"workflow_name": the exact name of one of the user\'s existing tasks';
    return `- "${s.key}" — ${s.label}. Give ${shape}.`;
  }).join('\n');
}

/** The one-line version for a tool argument description. */
export function doorCatalogueOneLine(): string {
  return TRIGGER_SOURCES.map((s) => `"${s.key}" (${s.label.toLowerCase()})`).join(', ');
}

interface WorkflowRow { id: string; name: string }

async function listUserWorkflows(
  supabase: SupabaseClient, userId: string,
): Promise<WorkflowRow[] | null> {
  try {
    const { data, error } = await supabase
      .from('workflows')
      .select('id, name')
      .eq('user_id', userId)
      .in('status', ['active', 'paused', 'draft'])
      .limit(200);
    if (error) return null;
    return ((data ?? []) as Array<{ id: string; name: string | null }>)
      .filter((w) => !!w.id && !!w.name)
      .map((w) => ({ id: w.id, name: (w.name as string).trim() }));
  } catch {
    return null;
  }
}

interface NamedRow { id: string; name: string }
/** Why a spoken name yielded nothing — the two misses are DIFFERENT refusals and get different
 *  sentences ("I don't have one called X" vs "more than one of yours matches X"). */
type NameMatch<T extends NamedRow> = { hit: T } | { hit: null; miss: 'none' | 'ambiguous' };

/** THE ONE NAME LADDER, shared by every by-name resolution in this module: exact (case- and
 *  whitespace-insensitive) → unique containment → refusal. AMBIGUITY IS NEVER A GUESS — picking
 *  one of two same-named things silently binds the wrong object, and the user is never told. */
function resolveByName<T extends NamedRow>(rows: T[], spoken: string): NameMatch<T> {
  const want = norm(spoken);
  if (!want || !rows.length) return { hit: null, miss: 'none' };
  const exact = rows.filter((w) => norm(w.name) === want);
  if (exact.length === 1) return { hit: exact[0] };
  if (exact.length > 1) return { hit: null, miss: 'ambiguous' };
  const contains = rows.filter((w) => {
    const have = norm(w.name);
    return have.includes(want) || want.includes(have);
  });
  if (contains.length === 1) return { hit: contains[0] };
  return { hit: null, miss: contains.length > 1 ? 'ambiguous' : 'none' };
}

/** A spoken workflow name → one of the user's own workflows. Ambiguity is a REFUSAL (never guess
 *  which pipeline feeds which — a wrong binding fires the wrong work forever). */
export function matchWorkflowByName(rows: WorkflowRow[], spoken: string): WorkflowRow | null {
  return resolveByName(rows, spoken).hit;
}

function looksLikeSchedule(r: Record<string, unknown>): boolean {
  return str(r.type) === 'schedule' || str(r.source) === 'schedule' || !!str(r.cron);
}

/**
 * THE SANITISER. `raw` is whatever a model emitted (array, garbage, absent).
 * `existing` (optional) are doors already stored — passed by the additive update verbs so the
 * merge and the dedupe happen HERE, through the one reader, not at each call site.
 */
export async function authorDoors(
  raw: unknown,
  opts: {
    supabase: SupabaseClient;
    userId: string;
    existing?: ReactionDoor[];
    /** The workflow being edited — a door bound to itself is refused. */
    selfWorkflowId?: string | null;
    /** Unknown/absent → the feature rule abstains. */
    features?: WorkspaceFeatures | null;
  },
): Promise<AuthoredDoors> {
  const notes: string[] = [];
  const kept: ReactionDoor[] = [...(opts.existing ?? [])];
  const entries = Array.isArray(raw) ? raw : [];

  // The workflow roster is read ONCE, and only when a workflow door is actually asked for.
  let roster: WorkflowRow[] | null | undefined;
  const wantsWorkflow = entries.some(
    (e) => e && typeof e === 'object' && str((e as Record<string, unknown>).source) === 'workflow',
  );
  if (wantsWorkflow) roster = await listUserWorkflows(opts.supabase, opts.userId);

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;

    // (5) LAW 6 — one schedule, and it is not a door.
    if (looksLikeSchedule(r)) {
      notes.push('A workflow can hold only one schedule, so I kept the one on the task itself and dropped the extra timed trigger.');
      continue;
    }

    const source = str(r.source);
    // (1) THE REGISTRY IS THE CATALOGUE.
    if (!isTriggerSourceKey(source)) {
      if (source) notes.push(`I can't start a task from "${source}" yet — that door doesn't exist, so I left it out.`);
      continue;
    }
    const def = triggerSource(source)!;

    // (2) A door on an off feature is a door that can never open.
    if (opts.features && def.feature && opts.features[def.feature] === false) {
      notes.push(`"${def.label}" isn't available in this workspace, so I left that door out.`);
      continue;
    }

    const door: ReactionDoor = { type: 'reaction', source: def.key };
    const label = str(r.label);
    if (label) door.label = label;

    if (def.needsWhen) {
      // (3) Nothing to judge = no door.
      const when = str(r.when);
      if (!when) {
        notes.push(`I left out the "${def.label.toLowerCase()}" door — tell me what has to be true about it and I'll add it.`);
        continue;
      }
      door.when = when;
    } else {
      // (4) NAMES ARE THE MODEL'S JOB, IDS ARE CODE'S.
      const spoken = str(r.workflow_name);
      if (!spoken) {
        notes.push('I left out the "another workflow delivers" door — name the task that should feed this one.');
        continue;
      }
      if (roster === undefined) roster = await listUserWorkflows(opts.supabase, opts.userId);
      if (roster === null) {
        notes.push(`I couldn't check your task list, so I left the "${spoken}" door out — add it in Studio.`);
        continue;
      }
      const hit = matchWorkflowByName(roster, spoken);
      if (!hit) {
        notes.push(`I couldn't find a task called "${spoken}" — pick the one that should feed this in Studio.`);
        continue;
      }
      if (opts.selfWorkflowId && hit.id === opts.selfWorkflowId) {
        notes.push('A task can\'t be triggered by itself — I left that door out.');
        continue;
      }
      door.workflow_id = hit.id;
      if (!door.label) door.label = `When "${hit.name}" delivers`;
    }

    kept.push(door);
  }

  // THE ONE READER has the last word: shape + dedupe, exactly as every consumer reads it back.
  return { doors: normalizeTriggers({ triggers: kept }).doors, notes };
}

/** The storage value the workflows PATCH stores: the normalized array, or NULL when empty. */
export function doorsForStorage(doors: ReactionDoor[]): ReactionDoor[] | null {
  return doors.length ? doors : null;
}

/** One sentence for a surface that must SAY what got dropped (the needs_person_note idiom). */
export function doorNote(notes: string[]): string | null {
  return notes.length ? [...new Set(notes)].join(' ') : null;
}

/** A human list of doors, for tool output and confirmations. */
export function describeDoors(doors: ReactionDoor[]): string {
  return doors.length ? doors.map(doorLabel).join(' · ') : 'none';
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE INPUTS HALF (THE RELAY CANVAS, W2 — law 7: INPUTS ARE VISIBLE)
//
// Describe-it and coworker chat can PIN reference material by saying its name ("compare it against
// our Hiring Policy"). The model emits the USER'S WORDS for the document, never an id — exactly the
// workflow-name law above, for the same reason: a model-guessed uuid would silently mount somebody
// else's file as this workflow's standing rulebook.
//
// THE LADDER (per spoken name): the caller's OWN knowledge_files → exact → unique containment →
// REFUSAL WITH A NOTE. A resolved doc carries THE FILE'S OWN name, not the spoken rendering, so the
// tray never labels a real document with a name it does not have. (`writeWorkflowInputs` re-derives
// names and re-checks ownership at the store anyway — this is the SPOKEN half of the same law, and
// the only half that can explain itself.)
// ════════════════════════════════════════════════════════════════════════════════════════════════

export interface AuthoredInputs {
  /** Resolved, caller-owned, deduped. Empty = pin nothing. */
  docs: WorkflowInputDoc[];
  acceptMaterial: boolean;
  /** One line per REFUSED name, in the user's words — the surface speaks these. */
  notes: string[];
}

interface KbRow { id: string; name: string }

async function listUserDocs(
  supabase: SupabaseClient, userId: string,
): Promise<KbRow[] | null> {
  try {
    const { data, error } = await supabase
      .from('knowledge_files')
      .select('id, filename')
      .eq('user_id', userId)
      .order('indexed_at', { ascending: false })
      .limit(500);
    if (error) return null;
    return ((data ?? []) as Array<{ id: string; filename: string | null }>)
      .filter((f) => !!f.id && !!f.filename)
      .map((f) => ({ id: f.id, name: (f.filename as string).trim() }));
  } catch {
    return null;
  }
}

/**
 * THE INPUTS SANITISER. `raw.doc_names` are the user's words for documents; `raw.accept_material`
 * is the run-time material door. `existing` (the additive update verb) rides in so the merge and
 * the dedupe happen HERE, not at each call site.
 *
 * `acceptMaterial` defaults to whatever `existing`-side callers pass as `acceptMaterialDefault`
 * (undefined `accept_material` means "unsaid", never "off" — an unsaid flag must not silently
 * close a door the user opened in Studio).
 */
export async function authorInputs(
  raw: { doc_names?: unknown; accept_material?: unknown } | null | undefined,
  opts: {
    supabase: SupabaseClient;
    userId: string;
    existing?: WorkflowInputDoc[];
    acceptMaterialDefault?: boolean;
  },
): Promise<AuthoredInputs> {
  const notes: string[] = [];
  const docs: WorkflowInputDoc[] = [...(opts.existing ?? [])];
  const seen = new Set(docs.map((d) => d.kbFileId));

  const wantedRaw = Array.isArray(raw?.doc_names) ? raw!.doc_names as unknown[] : [];
  const wanted: string[] = [];
  const spokenSeen = new Set<string>();
  for (const n of wantedRaw) {
    const s = str(n);
    if (!s || spokenSeen.has(norm(s))) continue;
    spokenSeen.add(norm(s));
    wanted.push(s);
    if (wanted.length >= 20) break;
  }

  const acceptMaterial = typeof raw?.accept_material === 'boolean'
    ? raw!.accept_material as boolean
    : (opts.acceptMaterialDefault ?? false);

  if (wanted.length) {
    // The library is read ONCE, and only when a document is actually asked for.
    const roster = await listUserDocs(opts.supabase, opts.userId);
    if (roster === null) {
      notes.push('I couldn\'t check your documents, so I didn\'t pin any — add them in Studio.');
    } else {
      for (const spoken of wanted) {
        const m = resolveByName(roster, spoken);
        if (!m.hit) {
          notes.push(m.miss === 'ambiguous'
            ? `More than one of your documents matches "${spoken}" — pin the exact one in Studio.`
            : `I couldn't find a document called "${spoken}" in your knowledge base — upload it, then pin it in Studio.`);
          continue;
        }
        if (seen.has(m.hit.id)) continue;
        seen.add(m.hit.id);
        // THE FILE'S OWN NAME — never the spoken rendering.
        docs.push({ kbFileId: m.hit.id, name: m.hit.name });
        if (docs.length >= 20) break;
      }
    }
  }

  return { docs, acceptMaterial, notes };
}

/** One sentence for a surface that must SAY what it refused (the needs-note idiom, inputs side). */
export function inputNote(notes: string[]): string | null {
  return notes.length ? [...new Set(notes)].join(' ') : null;
}

/** The stored value, or NULL when there is nothing configured — `null` keeps meaning "never
 *  configured", exactly as readWorkflowInputs serves it (EMPTY IS DELETED). */
export function inputsForStorage(
  inputs: { docs: WorkflowInputDoc[]; acceptMaterial: boolean },
): { docs: WorkflowInputDoc[]; acceptMaterial: boolean } | null {
  // Rebuilt, never passed through: an AuthoredInputs carries `notes`, and the stored shape must be
  // exactly {docs, acceptMaterial} — a note is speech about the tray, never part of it.
  return (inputs.docs.length || inputs.acceptMaterial)
    ? { docs: inputs.docs, acceptMaterial: inputs.acceptMaterial }
    : null;
}

/** A human rendering of the tray, for tool output and confirmations. */
export function describeInputs(
  inputs: { docs: WorkflowInputDoc[]; acceptMaterial: boolean } | null | undefined,
): string {
  if (!inputs || (!inputs.docs.length && !inputs.acceptMaterial)) return 'none';
  const parts: string[] = [];
  if (inputs.docs.length) parts.push(inputs.docs.map((d) => d.name).join(' · '));
  if (inputs.acceptMaterial) parts.push('accepts material at run time');
  return parts.join(' · ');
}
