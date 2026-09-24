// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SERVED VERDICT (stabilization W17 · law `no-waiting` — "first paint carries what is known").
//
// THE BUG, AS A CLASS (owner report, Sep 24): an item page whose ONE action widget is the decision
// ("Consent / Decline / Leave it with me") painted WITHOUT it, and the widget popped in seconds later.
// The machine state that CHOSE the decision widget was already on the view payload — it is derived
// from the item's cached judgment — but the decision's OPTIONS were not: the page asked
// GET /api/items/judge for them, and only after the view read had settled (a deliberate chain), and
// the judge loads the item's whole neighbourhood before it even looks at its cache (≈ 0.6–1.5s,
// seconds more on a sig miss). So the page knew WHICH widget it would show and still waited a second
// request to learn WHAT it said.
//
// THE FIX: the view door serves the cached judgment it already stands on (the same `judgment` plan row
// the machine reads — one indexed select beside wave 1), narrowed to what a surface may render:
// the verb, the component, the executor's face and the options' LABELS. The judge's private `reason`
// never ships (NO INTERNAL TEXT ON SCREEN — W7.3). The live judge still runs on the open, beside the
// view, as a refresh: its answer is the NEXT open's first paint unless nothing was painted yet.
//
// PURE and client-safe (zero imports): the view door narrows with it, the deep-dive reads its type,
// and scripts/smoke-no-waiting.ts gates it.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The judgment as a surface may hold it — never the reason. */
export type ServedVerdict = {
  work: string;
  component: string | null;
  executor: { kind: string; name?: string };
  /** The decision's routes (labels only), when the verdict is a decision. */
  options?: Array<{ label: string }>;
};

/** Narrow a stored judgment (`item_plans` kind 'judgment' → `tasks.verdict`) to what may be served.
 *  Anything malformed serves nothing (null) — a doubt never invents a verdict. */
export function servedVerdictOf(tasks: unknown): ServedVerdict | null {
  const v = (tasks && typeof tasks === 'object' ? (tasks as { verdict?: unknown }).verdict : null) as Record<string, unknown> | null | undefined;
  if (!v || typeof v !== 'object') return null;
  const work = typeof v.work === 'string' ? v.work.trim() : '';
  if (!work) return null;
  const ex = (v.executor && typeof v.executor === 'object' ? v.executor : {}) as { kind?: unknown; name?: unknown };
  const options = Array.isArray(v.options)
    ? (v.options as unknown[])
      .map((o) => (o && typeof o === 'object' ? String((o as { label?: unknown }).label ?? '').trim() : typeof o === 'string' ? o.trim() : ''))
      .filter(Boolean)
      .map((label) => ({ label }))
    : [];
  return {
    work,
    component: typeof v.component === 'string' ? v.component : null,
    executor: { kind: typeof ex.kind === 'string' ? ex.kind : 'user', ...(typeof ex.name === 'string' && ex.name ? { name: ex.name } : {}) },
    ...(options.length ? { options } : {}),
  };
}

/** The palette's lead, from the verdict (the SUMMONED-STAGE law: a lead, never a raised composer). */
export function relevanceOfWork(work: string | null | undefined): 'reply' | 'action' | 'awareness' | null {
  if (!work) return null;
  if (work === 'none') return 'awareness';
  if (work === 'reply' || work === 'send_file') return 'reply';
  return 'action';
}

/** The verbs whose preparation is a REPLY the email door drafts on open (the draft door's own gate). */
export const REPLY_WORKS: ReadonlySet<string> = new Set(['reply', 'send_file']);
