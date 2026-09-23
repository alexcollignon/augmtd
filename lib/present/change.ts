// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CHANGE CONTRACT (stabilization W0.3b — the confirm card for a prepared state change)
//
// A pending change is an OBJECT with a lifecycle — pending → applied | dismissed | expired — and
// ONE question put to the reader: apply this, or not. That is exactly the shape the kit's
// `approval` kind already renders (open · busy · settled, one deed, one quiet way out), so this
// contract does NOT add a card kind: the host (components/home/change-card.tsx) mounts the kit's
// approval card with the change's own words. One object, one rendering, no new kind to preview.
//
// PURE and leaf: zero IO, zero React, imported by both halves.
//   · the SERVER half (lib/work/pending-change.ts) composes a `ChangeSpec` from the stored row —
//     the summary and lines are CODE's (lib/work/confirm-policy.ts `describeChange`).
//   · the CLIENT half renders it and owns the two doors (apply · dismiss), both at
//     `/api/changes/[id]/…`.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type ChangeStatus = 'pending' | 'applied' | 'dismissed' | 'expired';

/** Which tool-bearing lane prepared it — for the meta line, and for the record. */
export type ChangeLane = 'home_chat' | 'coworker_dm' | 'agentos_dm' | 'workflow';

export type ChangeSpec = {
  /** The pending-change row's id — the address of both doors. NEVER rendered. */
  id: string;
  /** The tool that would run on apply (for the record; the card shows words, not this). */
  tool: string;
  /** ONE sentence, composed by code. */
  summary: string;
  /** The detail lines the reader confirms against. Composed by code. */
  lines: string[];
  lane: ChangeLane;
  /** The coworker that prepared it, when one did ("Clara"). */
  preparedBy?: string | null;
  status: ChangeStatus;
  /** ISO — after this the door refuses and the card reads expired. */
  expiresAt: string;
  /** The executor's own sentence, once applied. */
  result?: string | null;
};

/** ONE VOCABULARY for the card's words — the host types none of its own. */
export const CHANGE_WORDS = {
  gateWord: 'Confirm change',
  apply: 'Apply',
  dismiss: 'Dismiss',
  applied: 'applied',
  dismissed: 'dismissed',
  expired: 'expired — ask again to prepare it afresh',
  gone: 'This change is no longer on file.',
} as const;

/** How long a prepared change stays applicable. A stale card must not apply yesterday's request. */
export const CHANGE_TTL_MS = 24 * 60 * 60 * 1000;

const LANE_LABEL: Record<ChangeLane, string> = {
  home_chat: 'from your chat',
  coworker_dm: 'from your conversation',
  agentos_dm: 'from your conversation',
  workflow: 'from a task run',
};

/** The meta line, composed by code: "Prepared by Clara from your conversation". */
export function changeMetaLine(spec: Pick<ChangeSpec, 'lane' | 'preparedBy'>): string {
  return `Prepared${spec.preparedBy ? ` by ${spec.preparedBy}` : ''} ${LANE_LABEL[spec.lane] ?? LANE_LABEL.home_chat} · nothing changes until you apply it`;
}

export function isChangeSpec(v: unknown): v is ChangeSpec {
  const s = v as ChangeSpec | null;
  return !!s && typeof s === 'object'
    && typeof s.id === 'string' && typeof s.tool === 'string'
    && typeof s.summary === 'string' && Array.isArray(s.lines)
    && typeof s.status === 'string' && typeof s.expiresAt === 'string';
}

/**
 * THE MODEL-FACING RESULT. It says PREPARED and AWAITING the click, and forbids the claim — so the
 * model can never tell the person a change is done that only a click can do. One sentence, code's.
 */
export function changeToolResult(spec: Pick<ChangeSpec, 'summary'>): string {
  return `PREPARED, NOT APPLIED: ${spec.summary}. A confirm card is now in front of the user; nothing changes ` +
    'until they click Apply on it. Tell them it is prepared and waiting for their confirmation on the card. ' +
    'Do NOT say it is done, updated, deleted, shared, running, remembered, posted or sent.';
}

/** The chat-lane sentence for the person (the chief's `say`) — code's, never the model's. */
export function changeSayLine(spec: Pick<ChangeSpec, 'summary'>): string {
  return `${spec.summary} — prepared. Apply it on the card below when you're ready; nothing changes until you do.`;
}

// ─── THE POINTER (lib/present/pointer.ts' law, one object over) ────────────────────────────────
// What persists on a message or a room turn is the change's id and nothing else. Its status moves
// (applied from another surface, expired by the clock), so a reloaded card RE-READS through
// `GET /api/changes/[id]` and can never offer Apply on a change already applied.

export type ChangeTurnPointer = { changeId: string };

export function changePointer(spec: Pick<ChangeSpec, 'id'>): ChangeTurnPointer {
  return { changeId: spec.id };
}

export type ChangeTurnComponent = { key: 'change_card'; refId: string; state: { changeId: string } };

/** The durable room turn for a prepared change. `refId` IS the change id. */
export function changeTurnComponent(spec: Pick<ChangeSpec, 'id'>): ChangeTurnComponent {
  return { key: 'change_card', refId: spec.id, state: { changeId: spec.id } };
}
