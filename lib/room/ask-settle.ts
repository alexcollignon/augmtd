// ════════════════════════════════════════════════════════════════════════════════════════════════
// W14.2 · THE SETTLE MARK — the pure, client-safe spelling of a settled ask (docs/laws-registry.md
// `asks-live-and-die-with-their-work`). A LEAF: zero imports. lib/room/turns.ts (reachable from client
// components through lib/inbox/commitment-mirrors) reads ONLY this file for the settle/restore, so the
// room-turn module never drags the server graph (the ask lane in lib/room/ask-lifecycle.ts is
// server-only and re-exports these).
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The re-keyed component of a SETTLED ask — no ask reader matches it (they all read
 *  `input_checklist`), so the affordance is gone everywhere, and the undo can find it again. */
export const SETTLED_ASK_KEY = 'input_checklist_settled';

export type AskComponent = { key?: string; refId?: string; state?: Record<string, unknown> } | null | undefined;

/** `inbox:<id>` / `commitment:<id>` — the ref a merged ask's `covers` and the settle mark carry. Pure. */
export function askRefOf(kind: 'inbox_item' | 'inbox' | 'commitment', id: string): string {
  return `${kind === 'commitment' ? 'commitment' : 'inbox'}:${id}`;
}

/** The settled spelling of an ask's component — key re-keyed, WHO settled it stamped. Pure. */
export function settledAskComponent(c: AskComponent, mark: { ref: string; at: string; why: string }): { key: string; refId?: string; state: Record<string, unknown> } {
  const state = { ...((c?.state ?? {}) as Record<string, unknown>), settled: { ref: mark.ref, at: mark.at, why: mark.why } };
  return { ...(c ?? {}), key: SETTLED_ASK_KEY, state };
}

/** The undo's spelling — the ask component exactly as it stood, minus the settle mark. Pure. */
export function restoredAskComponent(c: AskComponent): { key: string; refId?: string; state: Record<string, unknown> } {
  const state = { ...((c?.state ?? {}) as Record<string, unknown>) };
  delete state.settled;
  return { ...(c ?? {}), key: 'input_checklist', state };
}

/** Only an ask a RESOLUTION of this item settled comes back on its undo — never one the user
 *  answered, never one a verdict retired. Pure. */
export function restorableBy(c: AskComponent, ref: string): boolean {
  const s = (c?.state as { settled?: { ref?: string; why?: string } } | undefined)?.settled;
  return c?.key === SETTLED_ASK_KEY && s?.ref === ref && (s?.why ?? 'resolved') === 'resolved';
}

/** A released key's original spelling (`requires:x#archived:<at>` → `requires:x`). Pure. */
export function baseDedupeKey(key: string): string {
  return String(key ?? '').replace(/#archived:.*$/, '');
}
