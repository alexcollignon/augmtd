// THE ONE THREAD COMPONENT (docs/threads-plan.md, Phase 2a) — the presentational kit the three
// chat surfaces port onto. Nothing here fetches, routes, or mutates: hosts pass data + callbacks.
export { ThreadShell } from './thread-shell';
export type { ThreadShellProps } from './thread-shell';
export { ThreadHeader, ThreadHeaderButton } from './thread-header';
export type { ThreadHeaderProps, ThreadState } from './thread-header';
export { ThreadTimeline } from './thread-timeline';
export type { ThreadTimelineProps } from './thread-timeline';
export { ThreadComposer } from './thread-composer';
export type { ThreadComposerProps } from './thread-composer';
export { ThreadCards, ThreadCardView } from './thread-cards';
export { SourceObjectCard } from './source-object-card';
export { AvatarStatus, FacePile, WorkRing, NeedsYouBadge, accentFor } from './avatar-status';
export type { AvatarStatusProps } from './avatar-status';
export * from './types';
