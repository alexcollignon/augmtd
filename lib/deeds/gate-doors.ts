// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE TWO GATE DOORS, ONCE (W3-A — docs/component-map.md §2a, Sep 22)
//
// ONE DEED ONE DOOR is already the law; what had never been true is ONE CALLER. The resume route
// was posted to from five hand-written `fetch` blocks (the room rail ×2, the deep-dive, the process
// drawer, the supply form) and the asks route from two — each with its own body spelling, its own
// idea of what a failure means, and in one case no failure handling at all (the rail's reject
// awaited nothing and told the reader nothing).
//
// So the doors live here, exactly once, CLIENT-SIDE:
//
//   resumeRun   → POST /api/workflows/runs/<id>/resume   (approve · reject · supply)
//   proceedAsk  → POST /api/room/asks  { action: 'proceed' }   (the never-blocking go-ahead)
//
// THE CONFLICT IS A FACT, NOT A FAILURE. The resume route answers 409 when the run is no longer
// parked — someone else decided, the subprocess resumed it, the sweep moved it. That is not "try
// again": it is the gate telling us the truth, and every host renders it as the settled state
// (GATE_SETTLED_ELSEWHERE) rather than a retry button that can only ever fail again. It is the one
// thing the old copies got wrong everywhere: the rail silently rolled back to "waiting on you", the
// deep-dive said "that decision did not land — try again", and only the drawer's toast was honest.
//
// PURE TRANSPORT: no React, no toast, no router. The caller owns what the surface then says.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { GateOutcome } from '@/lib/workflows/process-state';

/**
 * THE ONE RESULT SHAPE both doors answer in. A caller that only checks `ok` still behaves
 * correctly; a caller that wants the truth reads `reason`.
 *   ok        → the deed landed
 *   conflict  → the gate is no longer answerable (409). NOT a retry.
 *   denied    → 401/403/404 — indistinguishable by design (a refusal never confirms existence).
 *   failed    → transport or server error. The one case where "try again" is honest.
 */
export type DeedResult =
  | { ok: true }
  | { ok: false; reason: 'conflict'; message: string | null }
  | { ok: false; reason: 'denied' }
  /** `message` = the server's OWN sentence where it had a specific one (the supply door says "too
   *  long", "not indexed yet"). The server's word beats ours every time it has one. */
  | { ok: false; reason: 'failed'; message: string | null };

/** What the person may hand a parked input station — the resume door's own `input` shape. */
export type SupplyPayload = { text?: string; kbFileId?: string; pin?: boolean };

async function post(url: string, body: unknown): Promise<DeedResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch { return { ok: false, reason: 'failed', message: null }; }
  if (res.ok) return { ok: true };
  if (res.status === 401 || res.status === 403 || res.status === 404) return { ok: false, reason: 'denied' };
  // The server's own sentence is the honest one wherever it has a specific reason (the subprocess
  // 409 names the process it is waiting on; the supply door says "too long" / "not indexed yet").
  // A response carrying none leaves the caller with the vocabulary's own words.
  const j = await res.json().catch(() => null) as { error?: unknown } | null;
  const message = typeof j?.error === 'string' && j.error.trim() ? j.error.trim() : null;
  if (res.status === 409) return { ok: false, reason: 'conflict', message };
  return { ok: false, reason: 'failed', message };
}

/**
 * THE RESUME DOOR — every approve, every reject, every supply, from every surface.
 *
 * `note` is best-effort and NEVER a gate (the deep-dive's own law, lifted here so all surfaces
 * inherit it): it is spoken into the run's thread BEFORE the decision, so the thread reads in the
 * order it happened, and a slow or failed note must never cost the user their decision.
 */
export async function resumeRun(
  runId: string,
  opts: { approve: boolean; note?: string; input?: SupplyPayload },
): Promise<DeedResult> {
  // The door is named BEFORE the note is spoken, so that nothing — not even a `return` keyword —
  // sits between the note and the decision it belongs to (the handoff suite's H17h law, which
  // reads this function's own text).
  const door = `/api/workflows/runs/${runId}/resume`;
  const said = (opts.note ?? '').trim();
  if (said) {
    try {
      await fetch(`/api/workflows/runs/${runId}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: said }),
      });
    } catch { /* the decision is what matters — the note is a courtesy */ }
  }
  // A SUPPLY IS NEVER A REJECTION (W0.4): material rides with approve:true whatever the caller
  // spelled — the door reads the payload too, so the two can never disagree into a rejected run.
  return post(door, {
    approve: opts.input ? true : opts.approve,
    ...(opts.input ? { input: opts.input } : {}),
  });
}

/** What `resumeRun` was asked to do, in the ONE vocabulary — so a caller never re-derives the word. */
export function outcomeOf(opts: { approve: boolean; input?: SupplyPayload }): GateOutcome {
  if (opts.input) return 'supplied';
  return opts.approve ? 'approved' : 'rejected';
}

/**
 * THE GO-AHEAD DOOR — the engine ask's never-blocking proceed. The server stamps the turn
 * `proceeded`, writes the user's own visible go-ahead turn (a choice is never silent — P8) and
 * re-runs the one preparation engine.
 */
export async function proceedAsk(turnId: string): Promise<DeedResult> {
  return post('/api/room/asks', { turnId, action: 'proceed' });
}

/**
 * THE TYPE-IT DOOR (W4-B, Sep 22) — one missing thing, answered by typing the fact rather than
 * hunting for a file. The server stages it as that requirement's HAVE under the one requirement
 * key, drops the row from the checklist, settles the ask when it was the last one, and re-opens the
 * work. `label` MUST be a row the ask is carrying: the door is fail-closed and answers 404
 * otherwise (indistinguishable from an ask that isn't there — a refusal never confirms existence).
 *
 * THE ONLY CLIENT CALLER OF THE TYPED SUPPLY, exactly like the two doors above it.
 */
export async function supplyAskText(turnId: string, label: string, text: string): Promise<DeedResult> {
  return post('/api/room/asks', { turnId, action: 'supply', label, text });
}
