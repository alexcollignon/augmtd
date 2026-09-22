// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE TURN'S TOOL DEDUPE (Sep 21 — extracted from the coworker chat route, where THE CONSTANT KEY
// silently ate real work).
//
// THE INCIDENT: the key was `${name}:${input.query ?? input.filter ?? ''}`. Every tool whose
// discriminator is NOT literally `query`/`filter` — task_id, file_id, email_id, a whole generation
// brief — collapsed to ONE slot per user message. With `parallel_tool_calls:false` the model calls
// serially across rounds, so "pause all workflows" issued update_task(A) then update_task(B): B was
// `continue`d, never executed, never recorded, and handed A's success string. The reply then said
// "both are paused" in perfect good faith.
//
// TWO LAWS, stated here once:
//   1. THE KEY IS THE WHOLE ARGUMENT. A stable stringify over the normalized argument object — two
//      calls are the same call only when they ask for the same thing.
//   2. A MUTATION IS NEVER SERVED FROM CACHE. Read-only identical calls may dedupe (that is what
//      the guard was for — a model re-reading the same file forever); a write must always reach the
//      database, because the second write is the second deed. `mutates` is DERIVED from the one
//      capability registry, and an UNREGISTERED tool is treated as mutating (fail closed: dedupe is
//      an optimisation, a skipped write is a lie).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { CAPABILITY_MAP } from '@/lib/work/surface-registry';

/** Stable stringify — key order can never make two identical calls look different. */
function stable(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The dedupe key for one tool call: the tool NAME plus its WHOLE argument object. */
export function toolDedupeKey(name: string, input: unknown): string {
  return `${name}:${stable(input ?? {})}`;
}

/** Does this tool WRITE? Read from the registry's `mutates` flag; unregistered → yes (fail closed). */
export function isMutatingTool(name: string): boolean {
  const cap = CAPABILITY_MAP[name];
  if (!cap) return true;
  return cap.mutates === true;
}

/** May this call be served from the turn's cache instead of executing again? */
export function mayServeFromCache(name: string, seen: boolean): boolean {
  return seen && !isMutatingTool(name);
}
