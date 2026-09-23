// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE OUTCOME LOG (proactive-team R1) — collect NOW, synthesize LATER. Every prepared artifact's
// fate is stamped at its resolution moment. Reuses learning_signals (signal_type 'action_taken',
// the curation-era channel) — no migration. Non-fatal by construction: an outcome that fails to log
// never touches the action that produced it.
//
// W3.2 · THE TWO-WAY LEDGER (stabilization program, Sep 22). The R1 ledger was ONE-SIDED: only the
// discard door ever wrote, so it heard every "no" and no "yes" — 30 rows, all discarded, while 38
// prepared replies had been overtaken by the user answering from their own mailbox. The taxonomy is
// now the whole fate space, and EVERY door that ends a prepared artifact writes its class:
//
//   accepted       — sent through our door exactly as prepared
//   edited         — sent through our door after the user changed it (+ a rough edit share)
//   discarded      — the user DISMISSED the item with the preparation unused (their "no")
//   done_elsewhere — the user HANDLED the work outside our door while our preparation sat pending:
//                    an external reply on the thread, a later deed the evidence judge accepted, a
//                    "mark done", the judge finding it already answered, a meeting already booked.
//                    THE WORK WAS REAL — we were right about it and slow/unused on the artifact.
//   expired        — the preparation lapsed with no action (an invite whose start passed, an
//                    obligation the expiry law closed)
//   superseded     — the ground moved (a newer inbound) and the pass re-prepared over it
//
// Each row carries: lane, the door that wrote it, the counterparty class (the EXISTING structural
// sender predicate — never a new one), item kind/id, and the artifact's age at its outcome.
// `ledger_v` marks the two-way era: THE FACTS READ ONLY v2 ROWS (a v1 "discarded" folded "mark
// done" into "no" — it cannot be trusted as a verdict).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { isAutomatedSenderStrong } from '@/lib/inbox/notice-demotion';

/** The two-way era. Rows below this version are the one-sided R1 history (quarantined from facts). */
export const OUTCOME_LEDGER_VERSION = 2;

export type PreparedOutcome = 'accepted' | 'edited' | 'discarded' | 'done_elsewhere' | 'expired' | 'superseded';
export const PREPARED_OUTCOMES: readonly PreparedOutcome[] = ['accepted', 'edited', 'discarded', 'done_elsewhere', 'expired', 'superseded'];

/** The artifact kinds — deliberately the SAME set THE ONE PREPARED READER speaks (lib/prepare/read.ts
 *  PreparedKind), so a captured artifact maps onto the ledger with no translation table to drift. */
export type PreparedArtifactKind = 'reply_draft' | 'nudge_draft' | 'invite' | 'forward' | 'deliverable' | 'paste_pack';

export type OutcomeLane = 'reply' | 'nudge' | 'invite' | 'forward' | 'produce' | 'paste_pack';
export const LANE_OF_ARTIFACT: Record<PreparedArtifactKind, OutcomeLane> = {
  reply_draft: 'reply',
  nudge_draft: 'nudge',
  invite: 'invite',
  forward: 'forward',
  deliverable: 'produce',
  paste_pack: 'paste_pack',
};

export type OutcomeSenderClass = 'automated' | 'human' | 'unknown';
export type OutcomeItemKind = 'inbox' | 'commitment' | 'meeting' | 'chat';

/** Every door that writes the ledger — the gate asserts each one by name. */
export type OutcomeDoor =
  | 'send_reply' | 'compose_send' | 'items_execute' | 'invite_send' | 'nudge_send'
  | 'resolve_inbox' | 'resolve_commitment' | 'reply_external' | 'evidence_settle'
  | 'judge_resolution' | 'expiry' | 'ground_move' | 'booked_floor' | 'conversation_cascade' | 'backfill';

/** The counterparty class from an item's own sender, through THE EXISTING structural predicate. */
export function senderClassOf(src: { from_address?: unknown; from_name?: unknown; subject?: unknown } | null | undefined): OutcomeSenderClass {
  if (!src) return 'unknown';
  const email = typeof src.from_address === 'string' ? src.from_address : null;
  const name = typeof src.from_name === 'string' ? src.from_name : null;
  if (!email && !name) return 'unknown';
  return isAutomatedSenderStrong(email, name, typeof src.subject === 'string' ? src.subject : null) ? 'automated' : 'human';
}

/** Hours between preparation and outcome (null when the preparation time is unknown). */
export function artifactAgeHours(preparedAt: string | null | undefined, at: number = Date.now()): number | null {
  const t = preparedAt ? Date.parse(preparedAt) : NaN;
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round(((at - t) / 3_600_000) * 10) / 10);
}

/** The signal_data a ledger row carries — pure, so the gate can assert the row shape. */
export function outcomeSignalData(args: {
  outcome: PreparedOutcome;
  artifact: PreparedArtifactKind;
  itemKind: OutcomeItemKind;
  itemId: string;
  editShare?: number;
  door?: OutcomeDoor;
  senderClass?: OutcomeSenderClass;
  preparedAt?: string | null;
  backfilled?: boolean;
}, now: number = Date.now()): Record<string, unknown> {
  const age = artifactAgeHours(args.preparedAt ?? null, now);
  return {
    action: `prepared_${args.outcome}`,
    artifact: args.artifact,
    lane: LANE_OF_ARTIFACT[args.artifact] ?? 'produce',
    item_kind: args.itemKind,
    item_id: args.itemId,
    door: args.door ?? null,
    sender_class: args.senderClass ?? 'unknown',
    ...(age !== null ? { artifact_age_hours: age } : {}),
    ...(typeof args.editShare === 'number' ? { edit_share: Math.round(Math.min(1, Math.max(0, args.editShare)) * 100) / 100 } : {}),
    ...(args.backfilled ? { backfilled: true } : {}),
    ledger_v: OUTCOME_LEDGER_VERSION,
  };
}

export async function logPreparedOutcome(
  client: SupabaseClient, userId: string,
  args: {
    outcome: PreparedOutcome;
    artifact: PreparedArtifactKind;
    itemKind: OutcomeItemKind;
    itemId: string;
    /** 0–1 rough share of the artifact the user changed (edited only; cheap token-level estimate). */
    editShare?: number;
    door?: OutcomeDoor;
    /** The counterparty class; pass `source` instead to derive it from the item's own sender. */
    senderClass?: OutcomeSenderClass;
    source?: { from_address?: unknown; from_name?: unknown; subject?: unknown } | null;
    /** When the artifact was prepared — the ledger records its age at outcome. */
    preparedAt?: string | null;
  },
): Promise<void> {
  try {
    await client.from('learning_signals').insert({
      user_id: userId,
      signal_type: 'action_taken',
      inbox_item_id: args.itemKind === 'inbox' ? args.itemId : null,
      signal_data: outcomeSignalData({ ...args, senderClass: args.senderClass ?? senderClassOf(args.source) }),
    });
  } catch { /* the outcome log never breaks the action it observes */ }
}

/** A cheap symmetric-difference estimate of how much of the prepared text the user changed —
 *  token overlap, no AI. 0 = sent verbatim, 1 = fully rewritten. */
export function estimateEditShare(prepared: string, sent: string): number {
  const tok = (s: string) => new Set(s.toLowerCase().replace(/<[^>]*>/g, ' ').split(/\s+/).filter((t) => t.length > 2));
  const a = tok(prepared), b = tok(sent);
  if (!a.size && !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : Math.min(1, Math.max(0, 1 - shared / union));
}

/** Plain-text, whitespace-normalised view (HTML-tolerant) — "was it sent as prepared?". */
export const normalizeForCompare = (s: string): string =>
  s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** accepted vs edited for a text artifact — the one comparison every send door uses. */
export function sendVerdict(prepared: string, sent: string): { outcome: 'accepted' | 'edited'; editShare?: number } {
  if (normalizeForCompare(prepared) === normalizeForCompare(sent)) return { outcome: 'accepted' };
  return { outcome: 'edited', editShare: estimateEditShare(prepared, sent) };
}

// ── THE RESOLUTION DOORS — capture what was pending, then stamp its fate. ────────────────────────
// A resolver captures the item's UNSENT prepared artifacts through THE ONE PREPARED READER BEFORE it
// flips the row (some doors strip the drafts in the same write), then — only once the close landed
// — stamps each one's fate. Stale/expired are the reader's own derived flags, never re-derived here.

export type PendingArtifact = { artifact: PreparedArtifactKind; preparedAt: string | null; stale: boolean; expired: boolean };

/** The base fate a resolving door asserts; the artifact's own flags refine it (pure). */
export type ResolutionFate = 'discarded' | 'done_elsewhere' | 'expired';

/** THE FATE LADDER (pure): a past-time artifact EXPIRED whatever closed the item; a superseded
 *  artifact (ground moved, not yet re-prepared) that the user then handled elsewhere was SUPERSEDED
 *  — the user's "no" (discarded) is about the item and stands whatever the artifact's state. */
export function fateOf(p: Pick<PendingArtifact, 'stale' | 'expired'>, base: ResolutionFate): PreparedOutcome {
  if (p.expired) return 'expired';
  if (p.stale && base !== 'discarded') return 'superseded';
  return base;
}

/** Everything still pending (unsent) for one item, through THE ONE READER. Never throws. */
export async function capturePending(
  client: SupabaseClient, userId: string, item: { kind: 'inbox' | 'commitment'; id: string },
): Promise<PendingArtifact[]> {
  try {
    const { preparedState } = await import('@/lib/prepare/read');
    const st = await preparedState(client, userId, { kind: item.kind === 'inbox' ? 'inbox_item' : 'commitment', id: item.id });
    return st.all.map((a) => ({ artifact: a.kind as PreparedArtifactKind, preparedAt: a.at ?? null, stale: !!a.stale, expired: !!a.expired }));
  } catch { return []; }
}

/** Stamp every captured artifact's fate (one row each). Never throws. */
export async function logPendingOutcomes(
  client: SupabaseClient, userId: string, pending: PendingArtifact[],
  args: {
    base: ResolutionFate; itemKind: 'inbox' | 'commitment'; itemId: string; door: OutcomeDoor;
    source?: { from_address?: unknown; from_name?: unknown; subject?: unknown } | null;
  },
): Promise<number> {
  let n = 0;
  for (const p of pending) {
    await logPreparedOutcome(client, userId, {
      outcome: fateOf(p, args.base), artifact: p.artifact, itemKind: args.itemKind, itemId: args.itemId,
      door: args.door, source: args.source ?? null, preparedAt: p.preparedAt,
    });
    n++;
  }
  return n;
}
