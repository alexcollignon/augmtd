// ════════════════════════════════════════════════════════════════════════════════════════════════
// LAW 2 · THE EXPIRY LAW (THE PROACTIVE REACH ARC, docs/proactive-reach-plan.md — Sep 13).
//
// The commitment lane had exactly two outcomes: close on a fulfilling message, or nag forever.
// So a lapsed obligation — "be at the 09:00 kickoff on Aug 14", "send the deck before Friday's
// workshop" — kept its seat on the deck months after its moment passed. A deck that speaks one
// dead fact costs more trust than ten true ones earn (THE STANDING SENTENCE).
//
// The third outcome, built as the NOMINATE→JUDGE idiom the fulfillment law established:
//   • THE NOMINATION IS DETERMINISTIC (zero AI, in the sweep): status open + due_date < today in
//     the USER'S OWN timezone (the T-class clock law) + no fulfilling reply. Past-due is a FACT.
//   • THE DISPOSITION IS JUDGED. "Past due" is not proof of mootness — an unpaid invoice survives
//     its date, an ended meeting does not (the judge's own July law). One cheap reasoned pass
//     over the obligation's own words decides which kind of thing this is.
//   • ONLY `expired` CLOSES, with an auditable note, activity-logged and UNDOABLE (never a silent
//     delete). `still_owed`, `unclear`, and any AI failure change NOTHING — the fulfillment-law
//     asymmetry, verbatim: failure is never a verdict, and wrongly killing live work costs trust
//     while leaving it open costs nothing.
//
// Zero keyword lists, zero hardcoded senders/tokens/languages (THE AGNOSTIC CLAUSE): every fact
// the judge sees is derived from the user's own row at runtime.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { aiCall } from '@/lib/ai/call';
import { clipForPrompt, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';
import { settleMirrorRows } from '@/lib/inbox/commitment-mirrors';

// Bump on ANY change to the judging prompt/facts/scoping — a cached verdict from an older law must
// never satisfy the current one (the prompt-version-in-cache-sig law, learned three times now).
export const EXPIRY_LAW_VERSION = 2; // 2: THE SCHEDULED-SLOT RULE (a passed slot is dead; arranging anew is a NEW obligation)

export type ExpiryVerdict = {
  verdict: 'expired' | 'still_owed' | 'unclear';
  reason: string;
};

export type ExpiryCommitment = {
  id?: string;
  description: string;
  direction?: string | null;
  due_date?: string | null;
  counterparty?: string | null;
  source?: string | null;
  created_at?: string | null;
};

/** Whole days a commitment has been open, from its own created_at (a FACT the judges may use). */
export function openAgeDays(createdAt?: string | null, now: Date = new Date()): number | null {
  if (!createdAt) return null;
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

/**
 * THE NOMINATION (deterministic, zero AI): is this open commitment past its own stated date on the
 * USER'S clock? `todayStr` is the user's local YYYY-MM-DD (lib/utils/user-time localNow) — never
 * the server's day in disguise. An undated commitment can never be nominated: it has no moment to
 * have passed (it ages into the judges' facts instead — see openAgeDays).
 */
export function isPastDue(commitment: { due_date?: string | null }, todayStr: string): boolean {
  const due = String(commitment.due_date ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(due) && due < todayStr;
}

/**
 * THE DISPOSITION (one cheap reasoned pass): did this obligation's MOMENT pass, or is it a debt
 * that survives its date? Cached per (commitment, due_date) under the law version — the sweep
 * re-nominates the same rows every run and a non-closing verdict must not re-burn AI every 2h.
 * A re-anchored due date re-judges by construction (it rides the sig).
 */
export async function judgeCommitmentExpiry(
  client: SupabaseClient,
  userId: string,
  commitment: ExpiryCommitment,
  todayStr: string,
): Promise<ExpiryVerdict> {
  const description = clipForPrompt(String(commitment.description ?? '').replace(/\s+/g, ' '), 600);
  if (!description.trim()) return { verdict: 'unclear', reason: 'no description to judge' };
  const due = String(commitment.due_date ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return { verdict: 'unclear', reason: 'no stated date to have passed' };

  const cacheKey = commitment.id ? { entity: `commitment:${commitment.id}`, sig: `${EXPIRY_LAW_VERSION}:${due}` } : null;
  if (cacheKey) {
    try {
      const { data } = await client.from('item_plans').select('tasks')
        .eq('user_id', userId).eq('kind', 'expiry').eq('entity_id', cacheKey.entity).maybeSingle();
      const t = (data?.tasks ?? null) as { sig?: string; verdict?: ExpiryVerdict } | null;
      if (t?.sig === cacheKey.sig && t.verdict?.verdict) return t.verdict;
    } catch { /* cache is best-effort */ }
  }

  const daysPast = Math.max(0, Math.floor((Date.parse(`${todayStr}T12:00:00Z`) - Date.parse(`${due}T12:00:00Z`)) / 86_400_000));
  const age = openAgeDays(commitment.created_at);
  const owes = String(commitment.direction ?? 'you_owe') === 'awaiting' ? 'the counterparty owes it to the user' : 'the user owes it';
  try {
    const res = await aiCall<{ verdict?: string; reason?: string }>({
      userId, supabase: client, shape: { output: 'json' }, temperature: 0, maxTokens: 160,
      source: 'brain_synthesis',
      prompt:
        `Has this obligation's MOMENT PASSED, or is it still owed?\n` +
        // THE EXCERPT-HONESTY LAW: the description below is clipped by US at 600 chars. The rule rides
        // the HEADER, above the quote, so the quote's own tail can never carry it away.
        `${EXCERPT_RULE}\n` +
        `OBLIGATION: "${description}"\n` +
        `FACTS: ${owes}. It was due ${due}; today is ${todayStr} — ${daysPast} day(s) past due` +
        `${age !== null ? `; it has been open ${age} day(s)` : ''}` +
        `${commitment.counterparty ? `; the other party is "${String(commitment.counterparty).slice(0, 80)}"` : ''}` +
        `${commitment.source ? `; it came from a ${String(commitment.source).slice(0, 20)}` : ''}.\n` +
        `The law: "expired" ONLY when the thing owed was bound to a window that has CLOSED, so doing ` +
        `it now is pointless — being somewhere at a time that has passed, attending or preparing for ` +
        `an event that already happened, answering by a deadline that no longer exists, an input for ` +
        `a decision already taken. THE SCHEDULED-SLOT RULE: when the obligation IS a slot — being at, ` +
        `joining, calling, meeting or speaking at a named date and/or clock time — that slot has ` +
        `passed and the obligation to it is dead, whatever one may still want to arrange afterwards; ` +
        `a new arrangement is a NEW obligation, not this one. "still_owed" when the obligation ` +
        `SURVIVES its date — an unpaid bill or invoice, an undelivered report/document/file, an ` +
        `unanswered question, a decision or feedback not given, money or work owed: late, but still ` +
        `real; and an obligation to ARRANGE something with no slot named yet is still owed. A date ` +
        `passing is NOT by itself expiry.\n` +
        `When you cannot tell, say "unclear" — wrongly killing live work costs trust; leaving it open costs nothing.\n` +
        `JSON only: {"verdict":"expired|still_owed|unclear","reason":"<one sentence>"}`,
    });
    const v = String(res.json?.verdict ?? '').toLowerCase();
    const reason = String(res.json?.reason ?? '').slice(0, 200);
    const out: ExpiryVerdict = v === 'expired'
      ? { verdict: 'expired', reason: reason || 'its moment has passed' }
      : v === 'still_owed'
        ? { verdict: 'still_owed', reason: reason || 'the obligation survives its date' }
        : { verdict: 'unclear', reason: reason || 'model returned no usable verdict' };
    if (cacheKey) {
      await client.from('item_plans').upsert({
        user_id: userId, kind: 'expiry', entity_id: cacheKey.entity,
        tasks: { sig: cacheKey.sig, verdict: out }, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,kind,entity_id' }).then(() => {}, () => {});
    }
    return out;
  } catch (e) {
    // AI outage ≠ expiry: the row stays open and is re-checked next pass — deliberately NOT cached
    // (an outage verdict must never stick to a live obligation).
    console.error('[expiry] judge error:', e instanceof Error ? e.message : e);
    return { verdict: 'unclear', reason: 'expiry judge unavailable' };
  }
}

/**
 * THE ONE CONSEQUENCE APPLIER. ONLY `expired` closes — everything else (still_owed, unclear, a
 * failed judge) returns false and changes nothing. The close is undoable by construction: the
 * status flip is the same one /api/restore reverses, and the activity row carries the verdict's
 * own words as the auditable note.
 */
export async function applyExpiryVerdict(
  client: SupabaseClient,
  userId: string,
  commitment: { id: string; description: string; due_date?: string | null },
  verdict: ExpiryVerdict,
): Promise<boolean> {
  if (verdict.verdict !== 'expired') return false;
  // THE OUTCOME LEDGER (W3.2): a preparation still pending when the obligation lapsed EXPIRED.
  const { capturePending, logPendingOutcomes } = await import('@/lib/prepare/outcome');
  const pendingPrep = await capturePending(client, userId, { kind: 'commitment', id: commitment.id });
  const nowIso = new Date().toISOString();
  // Column-aware update (resolved_at/resolved_reason from 20260705d); retry status-only on older schemas.
  let err;
  ({ error: err } = await client.from('commitments')
    .update({ status: 'dismissed', resolved_at: nowIso, resolved_reason: 'expired', updated_at: nowIso })
    .eq('id', commitment.id).eq('user_id', userId).eq('status', 'open'));
  if (err) {
    ({ error: err } = await client.from('commitments')
      .update({ status: 'dismissed', updated_at: nowIso })
      .eq('id', commitment.id).eq('user_id', userId).eq('status', 'open'));
    if (err) return false;
  }
  await logPendingOutcomes(client, userId, pendingPrep, {
    base: 'expired', itemKind: 'commitment', itemId: commitment.id, door: 'expiry',
  }).catch(() => 0);
  // A historical mirror row (W2.3: no longer written) archives with it — never a hard delete — and
  // the room's asks settle: an obligation's ask must never outlive the obligation.
  await settleMirrorRows(client, userId, commitment.id, { reason: 'expired', stampAt: nowIso });
  import('@/lib/room/turns').then(({ settleAsksForItem }) => settleAsksForItem(client, userId, 'commitment', commitment.id)).catch(() => {});
  try {
    const { logActivity } = await import('@/lib/activity/log');
    await logActivity(client, userId, {
      // UNDOABLE: 'commitment_expired' is registered in REVERSIBLE_TYPE_ENTITY → /api/restore flips
      // it back to open. A machine closure the user cannot reverse is a silent delete.
      type: 'commitment_expired',
      title: `Expired${commitment.due_date ? ` (was due ${commitment.due_date})` : ''}: ${commitment.description}`,
      entityType: 'commitment', entityId: commitment.id,
      metadata: { reason: verdict.reason, dueDate: commitment.due_date ?? null, auto: true, law: EXPIRY_LAW_VERSION },
    });
  } catch { /* non-fatal */ }
  return true;
}
