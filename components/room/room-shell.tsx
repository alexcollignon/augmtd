'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE ROOM SHELL (one-room R2 — docs/one-room-plan.md). The single page anatomy every execution
// surface renders: the CONVERSATION is the room. Both doors — the /item deep-dive AND the project
// room — mount THIS component, so the anatomy can never fork again.
//
// THE SPLIT ASIDE IS RETIRED (law `one-component-one-behaviour`, Oct 2). The 52% stage beside the
// conversation used to hold a reply composer, a forward, an invite, a meeting compose and a focused
// deliverable — a second door to deeds whose one door is their INLINE card in the conversation, and a
// lookalike of the viewer that artifacts open in. Deeds are inline cards now; artifacts open in THE
// ONE VIEWER (components/shared/artifact-viewer.tsx). This shell has exactly one child: the room.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React from 'react';

export function RoomShell({ conversation, full = false }: {
  /** The center — the durable room conversation (the rail). Null while its view loads. */
  conversation: React.ReactNode | null;
  /** Full-viewport mode (the project room owns the whole screen; the deep-dive fills its host). */
  full?: boolean;
}) {
  return (
    <div className={`w-full ${full ? 'h-[100dvh] max-md:h-full' : 'h-full'} min-h-0 flex flex-row bg-neutral-50 p-2 gap-2`}>
      <section className="flex flex-1 min-w-0 flex-col h-full min-h-0">
        {conversation ?? <div className="flex-1 rounded-2xl bg-white shadow-sm animate-pulse" />}
      </section>
    </div>
  );
}
