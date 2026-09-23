// ════════════════════════════════════════════════════════════════════════════════════════════════
// DRAFT CHURN — the pure classifiers behind scripts/census-draft-churn.ts (W9.1). Read-only facts
// about what the engine re-bought and whether it ever wrote over the user's hand. Pure; the census
// does the IO, the gate + unit tests call these directly.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { isHandHeld, type HandKind } from '@/lib/prepare/hand';

type PF = { emailId?: string | null; receivedAt?: string | null } | null | undefined;
export type LaneRow = { id?: string; created_at: string; metadata?: Record<string, unknown> | null };

const sameGround = (a: PF, b: PF): boolean => {
  if (!a?.receivedAt || !b?.receivedAt) return false;           // unresolvable ground proves nothing
  if (a.emailId && b.emailId) return a.emailId === b.emailId;
  return a.receivedAt === b.receivedAt;
};

/** DEFINITE CLOCK REGENERATIONS in one pool lane (one item · one lane — a commitment's nudge rows,
 *  an item's paste packs): a row that a LATER row replaced ON THE SAME GROUND, and that was never
 *  filed as superseded (the lanes filed ground moves / truth withdrawals / supply as `version_of`;
 *  only the 24h clock left the prior row unmarked). Rows must belong to one lane. */
export function clockRegenerationsInLane(rows: LaneRow[]): number {
  const sorted = [...rows].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  let n = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i].metadata ?? {};
    const next = sorted[i + 1].metadata ?? {};
    if (cur.version_of) continue;                                 // filed with a reason — legitimate
    if (cur.sent_at) continue;                                    // done work, not replaced
    if (sameGround(cur.prepared_from as PF, next.prepared_from as PF)) n++;
  }
  return n;
}

/** A single source_data artifact (only the newest survives there): a PROBABLE clock regeneration
 *  when the engine wrote it inside the window more than 24h after the inbound it stands on, and the
 *  thread shows no activity past that inbound. An upper bound — a first preparation delayed by the
 *  budget reads the same — and the census labels it so. */
export function probableClockRegen(
  art: { generated_at?: unknown; prepared?: unknown; prepared_from?: PF } | null | undefined,
  opts: { windowStartMs: number; lastActivityAt?: string | null },
): boolean {
  if (!art || art.prepared !== 'pass') return false;
  const gen = Date.parse(String(art.generated_at ?? '')) || 0;
  const ground = Date.parse(String(art.prepared_from?.receivedAt ?? '')) || 0;
  if (!gen || !ground || gen < opts.windowStartMs) return false;
  const act = Date.parse(String(opts.lastActivityAt ?? '')) || 0;
  if (act && act > ground + 5000) return false;                   // the thread moved — a ground re-prep
  return gen - ground > 24 * 3_600_000;
}

/** A VOID HAND STAMP — the artifact carries the user's stamp but its content no longer hashes to
 *  it: something wrote over the user's words. After W9.1 this must stay 0 outside the user's own
 *  fresh-version doors (which file the edit first); the census reports it as the regression probe. */
export function voidHandStamp(kind: HandKind, stamp: unknown, payload?: unknown): boolean {
  const s = (stamp ?? null) as { edited_by_user_at?: unknown } | null;
  if (!s || typeof s.edited_by_user_at !== 'string' || !s.edited_by_user_at) return false;
  return !isHandHeld(kind, stamp, payload);
}
