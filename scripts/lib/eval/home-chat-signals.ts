// W22.C → W26 — what rode beside a Home-chat answer (cards, deeds), read loosely so the core's shape
// changes never break an eval. Shared by scripts/eval-home-chat.ts and the engine's
// conversation.home-chat adapter (moved here verbatim from eval-home-chat.ts, W26).
import type { TurnSignals } from './home-chat-harness';

const CARD_KEYS = ['invite', 'emailDraft', 'bulkDeed', 'collection', 'event', 'change', 'workflowDraft', 'artifact', 'artifacts', 'files', 'options'];
/** What rode beside the answer — read loosely, so the rebuilt core's shape changes do not break the eval. */
export function signalsOf(turn: Record<string, unknown>): TurnSignals {
  const present = (v: unknown) => (Array.isArray(v) ? v.length > 0 : !!v);
  const cards = CARD_KEYS.filter((k) => present(turn[k]));
  const stage = turn.openStage as { stage?: string } | null | undefined;
  if (stage?.stage) cards.push(`openStage:${stage.stage}`);
  const sideEffects: string[] = [];
  const commit = turn.commit as { kind?: string } | null | undefined;
  if (commit) sideEffects.push(`commit:${commit.kind ?? 'unknown'}`);
  for (const a of (Array.isArray(turn.applied) ? turn.applied : []) as Array<{ tool?: string }>) sideEffects.push(`applied:${a?.tool ?? 'unknown'}`);
  const del = turn.delegated as { agentName?: string } | null | undefined;
  if (del) sideEffects.push(`delegated:${del.agentName ?? 'coworker'}`);
  return { cards, sideEffects };
}
