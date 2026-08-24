// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE THROTTLE, NEVER A SHREDDER (THE RELAY CANVAS W3b — docs/relay-canvas-plan.md).
//
// The per-workflow ceiling on how many EVENT RUNS may START in one day. It is a THROTTLE, not a
// cap: at the limit a matched event is still recorded and still queued — it simply waits for the
// drain (see lib/workflows/reactions.ts). Nothing is ever lost; same-day compute is bounded.
//
// STORE (no migration — the `workflow_scope` / `workflow_owner` / `workflow_inputs` precedent):
// `item_plans` kind='workflow_limit', entity_id=<workflowId>, user_id=<the workflow's owner>,
// tasks = { dailyFires }.
//
// LAWS HELD HERE:
//   • ABSENT MEANS DEFAULT. There is no "unset" value stored anywhere: writing the default DELETES
//     the row, so the default can be changed platform-wide later without a migration and without a
//     million rows that pinned yesterday's number by accident.
//   • THE FLOORS ARE SYSTEM, THE NUMBER IS YOURS. 1–100. With queueing, "unlimited" only buys
//     unbounded same-day spend — the ceiling is deliberately not editable.
//   • OUT OF RANGE CLAMPS, NEVER REFUSES SILENTLY. `clampFireLimit` reports whether it clamped so
//     every door (PATCH, chat, generate-config) can SAY what it did with the number it was given.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';

export const FIRE_LIMIT_KIND = 'workflow_limit';

/** The default number of event runs a workflow may START in one day. */
export const FIRE_LIMIT_DEFAULT = 20;
export const FIRE_LIMIT_MIN = 1;
export const FIRE_LIMIT_MAX = 100;

export interface FireLimit {
  dailyFires: number;
  /** True when no row exists — the workflow is riding the platform default. */
  isDefault: boolean;
}

export const DEFAULT_FIRE_LIMIT: FireLimit = { dailyFires: FIRE_LIMIT_DEFAULT, isDefault: true };

/** Coerce anything to a usable limit, and SAY whether the given value had to be moved.
 *  A non-number (null, NaN, an object) is not a clamp — it is an absence, and absence is the
 *  default. NOTE: '' coerces to 0 and therefore lands on THE FLOOR (1), clamped — deliberate and
 *  gated ("THE FLOOR IS THE FLOOR"): a zero-ish value must never yield a 0 limit (that would be
 *  the shredder this module exists to kill), and every UI door guards '' before calling anyway.
 *  Only a real number outside the floors reports `clamped`. */
export function clampFireLimit(n: unknown): { value: number; clamped: boolean } {
  const raw = typeof n === 'string' ? Number(n.trim()) : n;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return { value: FIRE_LIMIT_DEFAULT, clamped: false };
  }
  const whole = Math.round(raw);
  if (whole < FIRE_LIMIT_MIN) return { value: FIRE_LIMIT_MIN, clamped: true };
  if (whole > FIRE_LIMIT_MAX) return { value: FIRE_LIMIT_MAX, clamped: true };
  return { value: whole, clamped: whole !== raw };
}

/** THE READ (one workflow). Never throws: a store read that fails degrades to the default — a
 *  throttle whose store is down must not become an outage or, worse, a shredder. */
export async function readFireLimit(
  admin: SupabaseClient, userId: string, workflowId: string,
): Promise<FireLimit> {
  try {
    const { data, error } = await admin.from('item_plans').select('tasks')
      .eq('user_id', userId).eq('kind', FIRE_LIMIT_KIND).eq('entity_id', workflowId)
      .maybeSingle();
    if (error || !data) return { ...DEFAULT_FIRE_LIMIT };
    const raw = (data.tasks ?? null) as { dailyFires?: unknown } | null;
    if (!raw || raw.dailyFires === undefined || raw.dailyFires === null) return { ...DEFAULT_FIRE_LIMIT };
    return { dailyFires: clampFireLimit(raw.dailyFires).value, isDefault: false };
  } catch {
    return { ...DEFAULT_FIRE_LIMIT };
  }
}

/** THE BATCH READ — the engine's one extra query per pass (never one per event). Workflows with
 *  no row are present in the map wearing the default, so a caller never has to remember the
 *  absent-means-default rule a second time. */
export async function readFireLimits(
  admin: SupabaseClient, userId: string, workflowIds: string[],
): Promise<Map<string, FireLimit>> {
  const out = new Map<string, FireLimit>();
  for (const id of workflowIds) out.set(id, { ...DEFAULT_FIRE_LIMIT });
  if (!workflowIds.length) return out;
  try {
    const { data, error } = await admin.from('item_plans').select('entity_id, tasks')
      .eq('user_id', userId).eq('kind', FIRE_LIMIT_KIND).in('entity_id', workflowIds);
    if (error) return out;
    for (const r of (data ?? []) as Array<{ entity_id: string; tasks: { dailyFires?: unknown } | null }>) {
      const v = r.tasks?.dailyFires;
      if (v === undefined || v === null) continue;
      out.set(String(r.entity_id), { dailyFires: clampFireLimit(v).value, isDefault: false });
    }
  } catch { /* the default map is the honest degradation */ }
  return out;
}

/** THE WRITE. Clamps, then stores — EXCEPT the default, which DELETES the row (absent = default).
 *  `clamped` rides back so the caller can speak the correction. */
export async function writeFireLimit(
  admin: SupabaseClient, userId: string, workflowId: string, raw: unknown,
): Promise<{ ok: true; fireLimit: FireLimit; clamped: boolean } | { ok: false; error: string }> {
  const { value, clamped } = clampFireLimit(raw);

  if (value === FIRE_LIMIT_DEFAULT) {
    const { error } = await admin.from('item_plans').delete()
      .eq('user_id', userId).eq('kind', FIRE_LIMIT_KIND).eq('entity_id', workflowId);
    if (error) return { ok: false, error: 'the daily limit could not be cleared' };
    return { ok: true, fireLimit: { ...DEFAULT_FIRE_LIMIT }, clamped };
  }

  const { error } = await admin.from('item_plans').upsert({
    user_id: userId, kind: FIRE_LIMIT_KIND, entity_id: workflowId,
    tasks: { dailyFires: value }, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,kind,entity_id' });
  if (error) return { ok: false, error: 'the daily limit could not be saved' };
  return { ok: true, fireLimit: { dailyFires: value, isDefault: false }, clamped };
}

/** The one sentence every door speaks when it moved a number the user gave it. */
export function fireLimitClampNote(given: unknown, value: number): string {
  return `Daily event-run limit set to ${value} (you asked for ${String(given)}; the range is ${FIRE_LIMIT_MIN}–${FIRE_LIMIT_MAX}).`;
}
