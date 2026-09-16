'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE ROOM SHELL (one-room R2 — docs/one-room-plan.md). The single page anatomy every
// execution surface renders: the CONVERSATION as the center of the page, the WORK on the STAGE
// beside it. Both doors — the /item deep-dive AND the project room — mount THIS component; the
// anatomy can never fork again. Narrow screens keep the STAGE (the workspace you act on); the
// conversation returns at lg.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React from 'react';

export function RoomShell({ conversation, stage, full = false }: {
  /** The center — the durable room conversation (the rail). Null while its view loads. */
  conversation: React.ReactNode | null;
  /**
   * The side panel — the mounted workspace (message + composer, document, the launcher).
   *
   * NULL IS A REAL STATE (threads Phase 3): the project thread has no docked pane any more — its
   * filed truth is SUMMONED into the drawer, and a stage mounts only while an artifact is focused.
   * With no stage the conversation is the whole room (and stays visible below lg, where the
   * two-column split used to hide it entirely).
   */
  stage: React.ReactNode | null;
  /** Full-viewport mode (the project room owns the whole screen; the deep-dive fills its host). */
  full?: boolean;
}) {
  const hasStage = stage !== null && stage !== undefined && stage !== false;
  return (
    <div className={`w-full ${full ? 'h-[100dvh]' : 'h-full'} min-h-0 flex flex-row bg-neutral-50 p-2 gap-2`}>
      <section className={hasStage
        ? 'hidden lg:flex flex-1 min-w-0 flex-col h-full min-h-0'
        : 'flex flex-1 min-w-0 flex-col h-full min-h-0'}>
        {conversation ?? <div className="flex-1 rounded-2xl bg-white shadow-sm animate-pulse" />}
      </section>
      {/* relative: the SUMMONED STAGE (draft review overlay) positions against this pane. */}
      {!hasStage ? null : (
      <aside className="relative flex flex-1 lg:flex-none lg:w-[52%] lg:min-w-[460px] lg:max-w-[760px] min-w-0 flex-col h-full min-h-0 rounded-2xl bg-white shadow-sm overflow-hidden">
        {stage}
      </aside>
      )}
    </div>
  );
}
