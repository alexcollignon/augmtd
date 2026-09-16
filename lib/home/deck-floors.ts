// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DECK FLOORS — the ONE lane-entry law (proactive-reach LAWS 1 · 5 · 6, docs/proactive-reach-plan.md).
//
// WHY THIS MODULE EXISTS (found live, Sep 13 — the serving-truth walk). Laws 1/2/3/5 all landed and
// their suites went green while THE SERVED HOME DID NOT MOVE. Three of the four causes were the same
// class wearing different clothes: **the deck derived its own lanes**, in the brief route, inline,
// from stored `rule_type`/`work_state`/`understanding` — so every floor the laws installed elsewhere
// (classifyItem's echo refusal, the judge's own verdict) was asked somewhere the deck never looked.
// A law enforced at N scattered seams misses the N+1th; the deck WAS the N+1th.
//
// So the lane-entry rule lives HERE, once, as pure functions the brief route calls and the standing
// gate (`scripts/smoke-deck-truth.ts`) asserts THE WORLD against. There is no second derivation of
// "does this row reach the deck" — the gate can only be green when the served deck is.
//
// PURE: no fetch, no AI, no clock beyond the caller's `todayISO`. Every fact is handed in.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { getUnderstanding } from '@/lib/inbox/item-understanding';
import { isNoMoveNotice, rawMailKindOf, isAutomatedSenderStrong } from '@/lib/inbox/notice-demotion';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type DeckItem = {
  id: string;
  user_id?: string | null;
  work_title?: string | null;
  work_state?: string | null;
  rule_type?: string | null;
  type_override?: string | null;
  source_data?: any;
};

/** The derived facts the floors need, supplied by the caller (the route derives them once per
 *  request; the gate derives them once per account — ONE shape, so they cannot disagree). */
export type DeckFloors = {
  /** Item ids whose CACHED judgment said "nothing to do here". */
  judgedNone: ReadonlySet<string>;
  /** THE ECHO FLOOR (LAW 5) — is this inbound the user's own outbound campaign coming back? */
  isEcho: (it: DeckItem) => boolean;
};

// ── THE BOUNDS, NAMED ONCE ──────────────────────────────────────────────────────────────────────
// NO SILENT CAPS (Aug 2: a genuinely overdue obligation ranked 61st of a 60-row cap and vanished —
// "a quiet thread is not a settled one"). The law was right and the numbers were not: found live
// Sep 13, the deck pool sat at EXACTLY its 250 bound and the action-notice lane held 105 eligible
// rows behind a cap of 30 — 75 real obligations dropped by a bound whose own comment promised it
// was "not a functional gate". A bound that saturates IS a gate. The numbers live here, the route
// and the standing gate both read them, and the gate FAILS when one of them binds again.
export const DECK_POOL_LIMIT = 800;
export const ACTION_NOTICE_LIMIT = 200;
export const REPLY_LIMIT = 100;

/** The sender address off a stored item — ONE reader (the route's old private copy is gone). */
export function fromEmailOf(sd: Record<string, unknown> | null | undefined): string | null {
  const raw = String(((sd ?? {}) as any).from_address || ((sd ?? {}) as any).from || '').toLowerCase();
  return raw.match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || (raw.includes('@') ? raw : null);
}

const subjectOf = (it: DeckItem): string | null =>
  ((it.source_data ?? {}) as any).subject ?? it.work_title ?? null;

/** Is this item's sender an automated/no-reply one? The SAME predicate the judge's sender floor
 *  uses — which is the whole reason the you_owe carve-out below exists. */
export function senderIsAutomated(it: DeckItem): boolean {
  const sd = (it.source_data ?? {}) as Record<string, unknown>;
  return isAutomatedSenderStrong(fromEmailOf(sd), (sd as any).from_name ?? null, subjectOf(it));
}

/**
 * THE RE-PROMOTE DOOR. `classifyItem` demotes an item (usually to 'fyi' for being cc-only); the deck
 * lets it back in when the UNDERSTANDING says the user is genuinely addressed with something they
 * owe AND a content rule fired. A false extra card ≪ a missed ask — the door stays.
 *
 * ⚠️ THE ECHO FLOOR OUTRANKS THE DOOR (found live, Sep 13): a reply into the user's own outbound
 * sequence is judged `role: addressed · ownership: you_owe · confidence 92` — precisely the shape
 * this door opens for — so the door was re-promoting every campaign echo straight back onto the
 * deck, undoing LAW 5 one row at a time. The floor is structural and sits ABOVE the door;
 * `isCampaignEcho` already short-circuits on the user's own `type_override`, so a human decision
 * still wins (the precedence chain: authoritative → refine → fallback).
 */
export function rePromotesToDeck(it: DeckItem, posture: string, floors: DeckFloors): boolean {
  if (posture === 'needs_reply' || posture === 'to_do') return !floors.isEcho(it);
  const rt = String(it.rule_type || '');
  if (rt !== 'needs_reply' && rt !== 'to_do') return false;
  if (floors.isEcho(it)) return false;
  const u = getUnderstanding(it as any);
  return !!u && (u.role === 'addressed' || u.ownership === 'you_owe' || u.relevance === 'action');
}

/**
 * Does a CACHED verdict demote its row off the deck?
 *
 * `work: 'none'` is the judge saying "nothing to do here" — and it says it whether or not it also
 * named a DISPOSITION. The old reading excluded dispositioned nones (`expired`/`answered`) on the
 * theory that apply-verdict had already resolved the row; when that hand-off does not land (a
 * failed pass, a budget kill, a row judged outside the pass), the deck went on speaking against its
 * own judge. Showing a settled row costs trust; the demotion is only a demotion — the row still
 * lives behind the door and the user's `type_override` still outranks it.
 */
export function verdictDemotes(v: { work?: string; resolution?: string } | null | undefined): boolean {
  return v?.work === 'none';
}

/**
 * THE NOTICE DEMOTION — every floor the deck listens to, asked in one place.
 *
 * W6's carve-out (a `you_owe` ACTION notice is never demoted by a judged-none) exists for exactly
 * ONE reason: the judge's SENDER FLOOR structurally refuses reply/chase work for an automated
 * sender, so "no email work" on a dunning notice is not "no work". That reason is a property of the
 * SENDER — so the carve-out is now bound to it. A human-sent obligation whose judge looked at it
 * and said `none` (the moment passed, the thread is settled) is demoted like any other: the deck
 * may not out-argue its own brain about a person's mail.
 */
export function noticeIsDemoted(it: DeckItem, floors: DeckFloors): boolean {
  if (it.type_override === 'needs_reply' || it.type_override === 'to_do') return false;
  const sd = (it.source_data ?? {}) as Record<string, unknown>;
  const u = getUnderstanding(it as any);
  const youOweAction = !!u && u.ownership === 'you_owe' && u.relevance === 'action';
  // The carve-out only shelters what the sender floor actually distorts.
  const sheltered = youOweAction && senderIsAutomated(it);
  return isNoMoveNotice({
    u, rawKind: rawMailKindOf(sd), fromEmail: fromEmailOf(sd),
    fromName: ((sd as any).from_name as string) || null,
    subject: (sd.subject as string) || it.work_title || null,
    workState: (it.work_state as string) || null,
    // THE ECHO FLOOR reaches the notice law too — one law, one shape, wherever it is asked.
    campaignEcho: floors.isEcho(it),
  }) || (floors.judgedNone.has(it.id) && !sheltered);
}

/**
 * THE ONE PREDICATE — does this item reach the deck as an actionable row? The brief route composes
 * its lanes from the two functions above; this is their conjunction, and it is what the standing
 * gate asserts the world against.
 */
export function deckEligible(it: DeckItem, posture: string, floors: DeckFloors): boolean {
  return rePromotesToDeck(it, posture, floors) && !noticeIsDemoted(it, floors);
}

/**
 * THE JUDGMENT READ — every candidate's cached verdict, NO SILENT CAP.
 *
 * The route used to read `candIds.slice(0, 300)`: on a real account (4,779 pending items) the
 * judge's word simply never reached the tail, so a row the brain had settled kept leading the deck
 * because nobody asked. The PostgREST `.in()` list is chunked instead — the fetchAllRows lesson,
 * the repo's oldest one, applied to a filter list rather than a result page.
 *
 * Zero AI: this reads CACHED verdicts only, exactly as the deck always has.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJudgedNone(client: any, userId: string, itemIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const CHUNK = 150; // bounded by PostgREST's URL length, never by a guess about how much matters
  for (let i = 0; i < itemIds.length; i += CHUNK) {
    const slice = itemIds.slice(i, i + CHUNK).map((id) => `inbox:${id}`);
    if (!slice.length) continue;
    try {
      const { data } = await client.from('item_plans').select('entity_id, tasks')
        .eq('user_id', userId).eq('kind', 'judgment').in('entity_id', slice);
      for (const j of (data ?? []) as Array<{ entity_id: string; tasks: { verdict?: { work?: string; resolution?: string } } }>) {
        if (verdictDemotes(j.tasks?.verdict)) out.add(String(j.entity_id).replace(/^inbox:/, ''));
      }
    } catch { /* the judge consult is an enhancement — the notice law still holds */ }
  }
  return out;
}

/** The item's code-verifiable time anchor (the understanding's own deadline) — the fact LAW 6 reads
 *  when it asks "does this row anchor a date that has already passed?". Never derived, never
 *  guessed: absent is absent. */
export function anchorOf(it: DeckItem): string | null {
  const d = getUnderstanding(it as any)?.deadline;
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
}
