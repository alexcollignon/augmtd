// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE STATES MODULE (just-works P7b) — both state vocabularies, their meaning, and their visual
// tokens, owned in ONE place. Every surface (Home, Timeline, Projects portfolio, entity room, Gantt,
// meetings) imports from here — same dot, same meaning, everywhere.
//
// TWO LEVELS, ONE DIRECTION:
//   • ITEM states are FACTS — mechanical, set by user actions + the reconcilers
//     (todo / waiting / done / dismissed; overdue is a time overlay, not a state).
//   • PROJECT (entity) states are JUDGMENT — synthesized by the brain from the members' facts and
//     events (momentum + lifecycle + priority). Never hand-edited; always re-derived. An entity's
//     state can never contradict its members for long — the sig-gated synthesis re-reads them.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type StateToken = { dot: string; text: string; label: string };

// ── ITEM state (fact) — the ledger/Gantt/board palette. ──
export type ItemStateKey = 'todo' | 'waiting' | 'in_progress' | 'done' | 'dismissed';
export const ITEM_STATE: Record<ItemStateKey, StateToken> = {
  todo:        { dot: 'bg-indigo-500',  text: 'text-indigo-600',  label: 'To do' },
  waiting:     { dot: 'bg-amber-400',   text: 'text-amber-600',   label: 'Pending' },
  in_progress: { dot: 'bg-indigo-400',  text: 'text-indigo-600',  label: 'In progress' },
  done:        { dot: 'bg-emerald-500', text: 'text-emerald-600', label: 'Done' },
  dismissed:   { dot: 'bg-neutral-300', text: 'text-neutral-500', label: 'Dismissed' },
};
export const itemStateOf = (s: string): StateToken => ITEM_STATE[s as ItemStateKey] ?? ITEM_STATE.todo;
// Overdue is a TIME overlay on an open item, not a state of its own — one tone everywhere.
export const OVERDUE_TONE = { dot: 'bg-rose-500', text: 'text-rose-600', label: 'Overdue' } as const;

// ── PROJECT momentum (judgment) — the entity brain's verdict. ──
export type MomentumKey = 'active' | 'needs_you' | 'waiting' | 'gone_quiet' | 'stalled';
export const MOMENTUM: Record<MomentumKey, StateToken> = {
  needs_you:  { dot: 'bg-rose-500',    text: 'text-rose-600',    label: 'Needs you' },
  gone_quiet: { dot: 'bg-amber-500',   text: 'text-amber-600',   label: 'Gone quiet' },
  stalled:    { dot: 'bg-amber-500',   text: 'text-amber-600',   label: 'Stalled' },
  waiting:    { dot: 'bg-blue-400',    text: 'text-blue-600',    label: 'Waiting' },
  active:     { dot: 'bg-emerald-500', text: 'text-emerald-600', label: 'Active' },
};
export const momentumOf = (m: string): StateToken => MOMENTUM[m as MomentumKey] ?? MOMENTUM.active;

// ── PROJECT lifecycle (a human/lifecycle decision, distinct from momentum). ──
export type LifecycleKey = 'active' | 'done' | 'archived';
export const LIFECYCLE: Record<LifecycleKey, StateToken> = {
  active:   { dot: 'bg-emerald-500', text: 'text-emerald-600', label: 'Active' },
  done:     { dot: 'bg-neutral-400', text: 'text-neutral-500', label: 'Done' },
  archived: { dot: 'bg-neutral-300', text: 'text-neutral-400', label: 'Archived' },
};
