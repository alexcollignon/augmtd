// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE AUTHORSHIP REPAIR PLAN (W7.6) — PURE. scripts/repair-authorship.ts censuses and applies it; the
// unit tests + smoke-authorship pin it. Two questions, both answered from stored facts only:
//   1 · which stored `is_from_user = true` rows were NOT authored by the user (the Sent-folder stamp's
//       victims) — decided by THE SAME `authorshipOf` the sync now uses, with two HOLD-BACKS that keep
//       the repair conservative (a row is flipped only when it provably is not the user's):
//         · orphan connection — the row's mailbox is no longer connected, so its address is no longer
//           in the owned set; the user's own old mail must not flip for a disconnected account;
//         · possible alias — the from DISPLAY NAME is one of the user's own names: likely a send-as
//           alias the provider never reported to us. Names never AUTHOR anything (the self law); here a
//           name only HOLDS BACK a flip, and --include-possible-aliases overrides.
//   2 · which closes those rows CAUSED — so the owner can see the damage and (optionally) reopen
//       through THE ONE restore flip:
//         · resolved_reason 'replied' (resolve-on-reply, structural): the close was caused by the
//           misattribution when EVERY user-flagged message that could have closed it (thread match,
//           after the row was created, at or before it resolved) is misattributed;
//         · resolved_reason 'evidence:email' (the evidence settle stamps resolved_at = THE EVIDENCE'S
//           OWN TIME): a misattributed row with exactly that received_at (±1s) and no authored row at
//           that instant.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { authorshipOf, normAddress, type AuthorshipBasis } from './authorship';

export type StoredEmail = {
  id: string; from_address: string | null; from_name?: string | null; connection_id?: string | null;
  thread_id?: string | null; received_at: string | null; metadata?: Record<string, unknown> | null;
};
export type Misattribution = { id: string; basis: AuthorshipBasis; hold: null | 'orphan_connection' | 'possible_alias' };

const normName = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** PURE — classify the user's stored is_from_user rows under the law. Returns only the rows the law
 *  says are NOT authored (each with its hold-back, if any). */
export function planAuthorshipRepair(
  rows: StoredEmail[],
  facts: { ownAddresses: Iterable<string>; ownNames: Iterable<string>; liveConnectionIds: Iterable<string> },
): Misattribution[] {
  const own = new Set([...facts.ownAddresses].map(normAddress));
  const names = new Set([...facts.ownNames].map(normName).filter(Boolean));
  const live = new Set(facts.liveConnectionIds);
  if (!own.size) return []; // an unknown identity flips NOTHING
  const out: Misattribution[] = [];
  for (const r of rows) {
    const a = authorshipOf({ from_address: r.from_address, metadata: (r.metadata ?? null) as never }, own);
    if (a.authored) continue;
    const hold = r.connection_id && !live.has(r.connection_id) ? 'orphan_connection'
      : r.from_name && names.has(normName(r.from_name)) ? 'possible_alias'
      : null;
    out.push({ id: r.id, basis: a.basis, hold });
  }
  return out;
}

export type ClosedRow = { id: string; thread_id: string | null; created_at: string | null; resolved_at: string | null; resolved_reason: string | null };
export type FlaggedEmail = { id: string; thread_id: string | null; received_at: string | null };

const t = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);

/** PURE — did the misattributed rows cause this close? See the header for the two reasons. */
export function closeCausedByMisattribution(
  row: ClosedRow,
  userFlagged: FlaggedEmail[],
  misattributed: Set<string>,
): { caused: boolean; by: string[] } {
  const reason = String(row.resolved_reason ?? '');
  if (reason === 'replied') {
    if (!row.thread_id) return { caused: false, by: [] };
    const created = t(row.created_at), resolved = t(row.resolved_at);
    const candidates = userFlagged.filter((e) => e.thread_id === row.thread_id
      && (Number.isNaN(created) || t(e.received_at) > created)
      && (Number.isNaN(resolved) || t(e.received_at) <= resolved + 60_000));
    if (!candidates.length) return { caused: false, by: [] };
    const bad = candidates.filter((e) => misattributed.has(e.id));
    return bad.length === candidates.length ? { caused: true, by: bad.map((e) => e.id) } : { caused: false, by: [] };
  }
  if (reason === 'evidence:email') {
    const at = t(row.resolved_at);
    if (Number.isNaN(at)) return { caused: false, by: [] };
    const same = userFlagged.filter((e) => Math.abs(t(e.received_at) - at) <= 1000);
    if (!same.length) return { caused: false, by: [] };
    const bad = same.filter((e) => misattributed.has(e.id));
    return bad.length === same.length ? { caused: true, by: bad.map((e) => e.id) } : { caused: false, by: [] };
  }
  return { caused: false, by: [] };
}
