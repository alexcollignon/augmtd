// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE PREPARED READER (stabilization W2.1 — invariant 5 ONE READER PER OBJECT · 8 A CLAIM
// RENDERS · 14 TIME TRUTH). Prepared artifacts live in three physical places — `source_data.draft`
// (reply drafts), `source_data.nudge_draft` / `prepared_invite` / `prepared_forward`, and
// `item_deliverables` (coworker/pass deliverables, commitment drafts, commitment INVITES, paste
// packs, decision briefs). Consumers must NEVER know that: they call preparedState() (or the
// batched preparedStatesFor()) and get one normalized, kind-true, time-true shape. Storage may stay
// plural; the knowledge of where things live — and what counts as LIVE — is singular, here.
//
// Before W2.1 three readers disagreed: lib/room/grounding.ts read source_data only (a coworker's
// pool deliverable was invisible to every reasoner), the deck chip took ANY pool row as "ready to
// send", and a commitment's pooled INVITE mapped to `reply_draft` — 70 pending commitment artifacts
// had no renderable kind and a real invite whose proposed time had passed still wore "ready".
//
// Consumers: /api/items/view · commitments nudge route · compose/draft · brief route · calm/attention
// receipts · the machine · the room grounding board · prepare-action · smokes.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { leanSelect, foldLean, foldLeanRows, hydrateBodies, isLeanSource, PREPARED_KEYS, ONE_READER_KEYS } from '@/lib/home/lean-source';
import type { SupabaseClient } from '@supabase/supabase-js';
import { inviteOutsideStatedWindow, vetDraft, signsAsOtherIdentity, mailboxIdentityOf, type MailboxIdentity, type ProposedFrom } from '@/lib/prepare/truth';
import { addresseeOfStamp, addresseeFromNudgeTitle, addresseeWithdrawn, loadUserForms, type Addressee } from '@/lib/prepare/addressee';
import type { UserForms } from '@/lib/commitments/extraction-truth';
import { isHandHeld, isPoolRowHandHeld, type HandKind } from '@/lib/prepare/hand';
import { STAGING_LAW_VERSION } from '@/lib/prepare/staging-law';

export type PreparedKind = 'reply_draft' | 'nudge_draft' | 'deliverable' | 'invite' | 'forward' | 'paste_pack';

/** THE PAYLOAD REF — where the artifact's editable payload lives (a door reads it by this, never by
 *  re-deriving the storage rule). */
export type PreparedPayloadRef =
  | { store: 'source_data'; field: 'draft' | 'nudge_draft' | 'prepared_invite' | 'prepared_forward' }
  | { store: 'pool'; rowId: string | null; taskId: string | null };

export type PreparedArtifact = {
  kind: PreparedKind;
  title: string | null;
  content: string;
  by: string | null;           // coworker name (attributed) or null (in-house)
  at: string | null;
  attachment: { fileId: string; filename: string; source?: string } | null;
  provenance: Record<string, string> | null;
  /** THE DECISION BRIEF's structured payload (trichotomy T2) — when present, the DECISION CARD
   *  is this artifact's ONE surface (options + trade-offs + recommendation render THERE; the
   *  prepared strip must not duplicate it as a second document — owner, Aug 12). */
  decision?: { options: Array<{ label: string; tradeoff?: string | null }>; recommendation: string | null; why: string | null } | null;
  /** THE PASTE PACK (Q8, attention-plan PART III): prepared WORDS for work whose deed is out of
   *  reach — the note says where they go. Present only on `kind: 'paste_pack'`; a pack is never
   *  send-shaped (there is no door here that could fire), which is the whole honesty of it. */
  note?: string | null;
  /** René sweep (Aug 13): an invite with no time / a forward with no recipient is NOT send-shaped —
   *  the send door hard-rejects it, so a Send primary would be a button that cannot fire. false =
   *  staged but missing what the send needs (the machine reads awaiting_input). Absent = ready. */
  sendReady?: boolean;
  /** THE GROUND LAW (Aug 13): the ground this artifact was prepared FROM (the newest inbound at
   *  prep time), read off the stored prepared_from stamp. */
  ground?: { emailId: string | null; receivedAt: string | null } | null;
  /** Derived at read time: the item's ground moved past this artifact — it is SUPERSEDED. The
   *  machine treats it as not-prepared; no surface offers it as current. */
  stale?: boolean;
  /** TIME TRUTH (W2.1): an invite whose proposed start is already in the past. Reported, never
   *  "ready" — a card can still show it as expired, a chip never claims it. */
  expired?: boolean;
  /** TIME TRUTH (W5a): an invite proposing a time OUTSIDE the window the item's own words state
   *  (code-verified via the ONE window parser). Never live — the pass re-prepares inside the window. */
  outsideWindow?: boolean;
  /** A CLAIM RENDERS (W5a): the artifact's words claim a deed (finished/sent/attached/delivered)
   *  the facts do not support — an OPEN obligation with nothing staged. Never live. */
  falseClaim?: boolean;
  /** W11.1 · THE MAILBOX SIGNS: a machine-written draft whose sign-off names ANOTHER of the user's
   *  mailboxes (not the one its thread lives in). Rides `falseClaim` (never live — the re-prepare
   *  trip re-drafts it under the scoped voice); this flag only words the reason. */
  wrongIdentity?: boolean;
  /** W13 · A STAGED FILE IS THE DELIVERABLE, OR IT ISN'T STAGED: a machine draft whose attachment is
   *  this item's BASE (the pre-existing version an ask for new work builds on — `base:<label>` in the
   *  pool) sends the old file as the answer. Rides `falseClaim` (never live); this flag words it. */
  baseAsAnswer?: boolean;
  /** W13.3 · THE FILE WAS MATCHED UNDER AN OLDER STAGING LAW: a machine doc-send draft (task
   *  `prepare-pass-docsend`) whose file match carries no current `stagingLaw` stamp. Rides
   *  `falseClaim` (never live) so the pass re-prepares the send through TODAY's verifier — the
   *  platform heals its own legacy sends; no operator list. */
  stagingStale?: boolean;
  /** TRUE ADDRESSEES (W7.3): who the words are FOR, stamped at production (a legacy nudge's title
   *  carries it). Served so a card can address its To from what the words were written for. */
  addressee?: Addressee | null;
  /** TRUE ADDRESSEES (W7.3): the addressee denotes the USER, or is not the item's current
   *  counterparty — the words greet the wrong person. Never live; the pass re-prepares. */
  misaddressed?: boolean;
  /** The invite's stored payload (pool invites; the source_data invite carries the same fields on
   *  its own row) — the card mounts from it, never from a fresh live grounding. */
  invite?: { title?: string; startISO?: string; endISO?: string; attendees?: string[]; description?: string; timezone?: string; proposed?: boolean; proposedFrom?: ProposedFrom; alternatives?: Array<{ startISO: string; endISO: string; note?: string }> } | null;
  /** Where the payload lives — see PreparedPayloadRef. */
  payload?: PreparedPayloadRef;
  /** THE USER'S HAND (W9.1): the stored content is the user's own edit (the stamp still hashes to
   *  it). The engine never overwrites a hand-held artifact; the truth floors never withdraw the
   *  user's own words. */
  hand?: { editedAt: string } | null;
  /** THE USER'S HAND vs THE GROUND LAW (W9.1): a hand-held artifact whose ground moved is NOT
   *  superseded (it stays live — the user's words are never hidden or replaced); it is MARKED, so
   *  the card can say "the thread moved since you edited this" and offer a fresh version. */
  staleUnderEdit?: boolean;
};

/** THE GROUND MOVED under an artifact — the ONE place the two laws meet: machine words are
 *  superseded (`stale`, not live); the user's words are marked (`staleUnderEdit`, still live). */
export function markGroundMoved(a: PreparedArtifact): void {
  if (a.hand) a.staleUnderEdit = true;
  else a.stale = true;
}

/** The hand stamp of a stored source_data artifact → the reader's `hand` (null when not held). */
const handOf = (kind: HandKind, stored: unknown): { editedAt: string } | null =>
  isHandHeld(kind, stored) ? { editedAt: String((stored as { edited_by_user_at: string }).edited_by_user_at) } : null;

/** THE ITEM'S OWN FACTS the truth floors judge against (W5a) — code's, read off the item row. */
export type ItemTruthFacts = {
  /** The item's own words (a commitment's description · an email's subject + body). */
  text: string | null;
  /** The item's own date (created_at · received_at) — the window parser's anchor. */
  anchorIso: string | null;
  /** The user OWES this and it is still open — the only case a completion claim can be false. */
  obligationOpen: boolean;
  /** TRUE ADDRESSEES (W7.3): the item's CURRENT counterparty (commitments) — what an addressed draft
   *  must agree with. Absent/null = only the not-the-user floor applies. */
  counterparty?: string | null;
  /** W11.1 · THE MAILBOX SIGNS: the mailbox this item's thread lives in and the user's OTHER
   *  mailboxes. Absent/null = the signature floor is off (one mailbox, or nothing resolvable). */
  mailbox?: { own: MailboxIdentity; others: MailboxIdentity[] } | null;
  /** W13 · the file ids staged as this item's BASE (pool rows `role: 'base'`) — a draft riding one is
   *  sending the old file as the answer, and its words' completion claims are unsupported. */
  baseFileIds?: string[] | null;
};

/** W13 · the item's BASE file ids, read off its pool rows (the unstage writer's `role: 'base'`). Pure. */
export function baseFileIdsOf(pool: Array<Record<string, unknown>>): string[] {
  const out: string[] = [];
  for (const d of pool) {
    const m = (d.metadata ?? {}) as { role?: unknown; attachment?: { fileId?: unknown } | null };
    if (m.role === 'base' && typeof m.attachment?.fileId === 'string') out.push(m.attachment.fileId);
  }
  return out;
}

// ── THE TRUTH STAMPS (W5a) — pure, exported for the gate and the sweeps. ──
/** Stamp `outsideWindow` (invites vs the item's stated window) and `falseClaim` (words that
 *  announce a deed on an open obligation with nothing staged) in place. A text-shaped artifact
 *  that carries an attachment is STAGED — its "attached" can be true, and the floor stays silent.
 *  Deliverables (documents) are the work itself and are never judged here. */
export function stampTruth<T extends PreparedArtifact>(arts: T[], facts: ItemTruthFacts | null | undefined): T[] {
  if (!facts) return arts;
  for (const a of arts) {
    if (a.kind === 'invite' && inviteOutsideStatedWindow(a.invite ?? null, facts.text, facts.anchorIso)) a.outsideWindow = true;
    // THE TRUTH FLOORS — ONE VET (W12.1 · EVERY DRAFT PASSES THE SAME TRUTH): lib/prepare/truth
    // `vetDraft` is the ONE function this reader, the evaluator and the compose door call. Machine
    // words only (the user's own edit is theirs to make):
    //   · THE COMPLETION CLAIM (W5a) — a deed announced on an open obligation with nothing staged.
    //   · THE ATTACHMENT CLAIM (W11.1) — "the attached interim report" with nothing attached. Speaks
    //     whoever owes what: a file either rides with the message or it does not (a PASTE PACK is
    //     exempt — it is pasted where the work lives, and its destination may carry the file).
    //   · THE INVERTED CHASE (W11.1) — chase-shaped words ("just a quick nudge…") on an OPEN
    //     obligation the USER owes: the counterparty is being chased for the user's own debt.
    //   · W13 · THE BASE IS NOT THE ANSWER — a draft whose attachment is the item's BASE sends the old
    //     file as the deliverable (withdrawn outright); and a base that rides along is not the WORK, so
    //     the completion/chase floors judge its words as if nothing were staged (`stagedIsWork`).
    const onBase = !!a.attachment && !!facts.baseFileIds?.includes(a.attachment.fileId);
    if ((a.kind === 'reply_draft' || a.kind === 'nudge_draft') && !a.hand && onBase) { a.falseClaim = true; a.baseAsAnswer = true; }
    //   · W13.3 · A LEGACY FILE MATCH IS RE-PROVEN, NOT TRUSTED — a machine doc-send whose file was
    //     matched under an older staging law is withdrawn; the pass re-runs it through today's law.
    if ((a.kind === 'reply_draft' || a.kind === 'nudge_draft') && !a.hand && a.stagingStale) a.falseClaim = true;
    if ((a.kind === 'reply_draft' || a.kind === 'nudge_draft' || a.kind === 'paste_pack') && !a.hand
      && vetDraft(a.content, { obligationOpen: facts.obligationOpen, staged: !!a.attachment, stagedIsWork: !!a.attachment && !onBase, attachmentFloor: a.kind !== 'paste_pack' })) a.falseClaim = true;
    //   · THE MAILBOX SIGNS — a machine draft signed as another of the user's mailboxes (the pre-W11.1
    //     global voice). Withdrawn so only THESE re-draft (no DRAFT_LAW_VERSION corpus re-draft).
    if ((a.kind === 'reply_draft' || a.kind === 'nudge_draft') && !a.hand && facts.mailbox
      && signsAsOtherIdentity(a.content, facts.mailbox)) { a.falseClaim = true; a.wrongIdentity = true; }
  }
  return arts;
}

// ── W11.1 · THE MAILBOX SIGNS — the facts' loader (bounded reads, zero AI, memoized per user) ──
/** Only a machine-written draft is ever judged by the signature floor. */
export const needsIdentityCheck = (arts: PreparedArtifact[]): boolean =>
  arts.some((a) => (a.kind === 'reply_draft' || a.kind === 'nudge_draft') && !a.hand && !!a.content);

const mailboxesMemo = new Map<string, { at: number; p: Promise<Map<string, MailboxIdentity> | null> }>();
/** The user's connected mailboxes (connection id → identity) — null when fewer than TWO distinct
 *  mailboxes exist (no other identity to sign as: the floor is off and costs nothing further). */
export function loadMailboxIdentities(client: SupabaseClient, userId: string): Promise<Map<string, MailboxIdentity> | null> {
  const hit = mailboxesMemo.get(userId);
  if (hit && Date.now() - hit.at < 60_000) return hit.p;
  const p = (async () => {
    const { data, error } = await client.from('connections').select('id, metadata, provider_account_id').eq('user_id', userId);
    if (error || !data) return null;
    const out = new Map<string, MailboxIdentity>();
    for (const c of data as Array<{ id: string; metadata?: { email?: string } | null; provider_account_id?: string | null }>) {
      const id = mailboxIdentityOf(c.metadata?.email || c.provider_account_id || null);
      if (id) out.set(String(c.id), id);
    }
    return new Set([...out.values()].map((m) => m.address)).size >= 2 ? out : null;
  })().catch(() => null);
  mailboxesMemo.set(userId, { at: Date.now(), p });
  return p;
}

/** The floor's facts for one thread's connection (null when unresolved — the floor stays silent). */
export function mailboxFactsFor(connId: string | null | undefined, boxes: Map<string, MailboxIdentity> | null): ItemTruthFacts['mailbox'] {
  if (!connId || !boxes) return null;
  const own = boxes.get(String(connId));
  if (!own) return null;
  return { own, others: [...boxes.entries()].filter(([k, v]) => k !== String(connId) && v.address !== own.address).map(([, v]) => v) };
}

/** Thread ids → the connection each lives in (the newest synced message's), one bounded read. */
async function connectionsOfThreads(client: SupabaseClient, userId: string, threadIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!threadIds.length) return out;
  try {
    const { fetchAllRows } = await import('@/lib/utils/fetch-all');
    const rows = await fetchAllRows<{ thread_id: string; connection_id: string }>((from, to) => client.from('emails')
      .select('thread_id, connection_id').eq('user_id', userId).in('thread_id', threadIds).not('connection_id', 'is', null)
      .order('received_at', { ascending: false }).range(from, to) as unknown as PromiseLike<{ data: Array<{ thread_id: string; connection_id: string }> | null; error: unknown }>);
    for (const r of rows) if (!out.has(String(r.thread_id))) out.set(String(r.thread_id), String(r.connection_id));
  } catch { /* unresolved → the floor stays silent */ }
  return out;
}

/** THE ADDRESSEE FLOOR (W7.3) — pure, in place. A send-shaped artifact (reply/nudge/paste pack) whose
 *  addressee denotes the user or contradicts the item's current counterparty is `misaddressed`.
 *  Unaddressed artifacts are untouched (absence is not a wrong address). */
export function stampAddressees<T extends PreparedArtifact>(arts: T[], facts: { counterparty?: string | null; user: UserForms } | null | undefined): T[] {
  if (!facts) return arts;
  for (const a of arts) {
    if (a.kind !== 'reply_draft' && a.kind !== 'nudge_draft' && a.kind !== 'paste_pack') continue;
    if (addresseeWithdrawn(a.addressee ?? null, { counterparty: facts.counterparty ?? null, user: facts.user })) a.misaddressed = true;
  }
  return arts;
}

/** Does any artifact carry an addressee the floor could judge? (the loader's cost gate) */
const hasAddressed = (arts: PreparedArtifact[]): boolean =>
  arts.some((a) => !!a.addressee && (a.kind === 'reply_draft' || a.kind === 'nudge_draft' || a.kind === 'paste_pack'));

/** THE NOTICE LAW AT THE READER (W5b hand-off, Sep 23): an item the notice law demotes (a list-mail
 *  header, an automated sender, a kind-only notification the brain says nobody owes a move on) may
 *  carry a reply/nudge draft that predates the demotion — a room must never offer "reply" on mail
 *  nobody replies to. ONE law (`isNoMoveNotice`), asked here so every consumer of the ONE reader
 *  inherits it; the human escape (type_override) is honored by the law's own caller convention. */
async function stripNoticeDrafts<T extends PreparedArtifact>(arts: T[], sd: unknown, workState: unknown): Promise<T[]> {
  if (!arts.some((a) => a.kind === 'reply_draft' || a.kind === 'nudge_draft')) return arts;
  try {
    const s = (sd ?? {}) as Record<string, unknown>;
    if (s.type_override === 'needs_reply' || s.type_override === 'to_do' || s.type_override === 'waiting_on') return arts;
    const [{ isNoMoveNotice, rawMailKindOf, listMailOf }, { coerceUnderstanding }] = await Promise.all([
      import('@/lib/inbox/notice-demotion'), import('@/lib/inbox/item-understanding'),
    ]);
    const noMove = isNoMoveNotice({
      u: coerceUnderstanding(s.understanding), rawKind: rawMailKindOf(s),
      fromEmail: typeof s.from_address === 'string' ? s.from_address : null,
      fromName: typeof s.from_name === 'string' ? s.from_name : null,
      subject: typeof s.subject === 'string' ? s.subject : null,
      workState: typeof workState === 'string' ? workState : null,
      listMail: listMailOf(s),
    });
    return noMove ? arts.filter((a) => a.kind !== 'reply_draft' && a.kind !== 'nudge_draft') : arts;
  } catch { return arts; }
}

type CommitFactsRow = { description?: unknown; created_at?: unknown; status?: unknown; direction?: unknown; counterparty?: unknown };
/** A commitment row → its truth facts (the user owes it only on `you_owe`; a chase's words about
 *  what THEY owe are never judged as the user's own deed — fail-safe). */
export function commitmentTruthFacts(row: CommitFactsRow | null | undefined): ItemTruthFacts | null {
  if (!row) return null;
  return {
    text: typeof row.description === 'string' ? row.description : null,
    anchorIso: typeof row.created_at === 'string' ? row.created_at : null,
    obligationOpen: String(row.status ?? '') === 'open' && String(row.direction ?? '') === 'you_owe',
    counterparty: typeof row.counterparty === 'string' ? row.counterparty : null,
  };
}
/** An inbox row's source_data → its truth facts. The completion floor stays OFF for inbox replies
 *  (a reply may truthfully recount a deed done on another thread — the house cannot verify it);
 *  only the window floor applies. */
export function inboxTruthFacts(sd: unknown): ItemTruthFacts | null {
  const s = (sd ?? null) as { subject?: unknown; body?: unknown; received_at?: unknown } | null;
  if (!s) return null;
  const text = [typeof s.subject === 'string' ? s.subject : '', typeof s.body === 'string' ? s.body.slice(0, 4000) : ''].filter(Boolean).join('\n');
  return { text: text || null, anchorIso: typeof s.received_at === 'string' ? s.received_at : null, obligationOpen: false };
}

type PreparedFrom = { emailId?: string | null; receivedAt?: string | null } | null;
type SourceData = {
  draft?: { body?: string; generated_at?: string; sent_at?: string; prepared_from?: PreparedFrom; attachment?: { fileId: string; filename: string; source?: string }; addressee?: unknown } | null;
  nudge_draft?: { body?: string; generated_at?: string; sent_at?: string; prepared_from?: PreparedFrom; addressee?: unknown } | null;
  // THE READER READS EVERYTHING (trichotomy T1 find: a fresh prepared invite existed and the
  // canonical reader missed it — every consumer under-reported preparedness for schedule/forward
  // items). Sent artifacts are done work, not pending preparation — they don't render here.
  prepared_invite?: { title?: string; start?: string; startISO?: string; endISO?: string; attendees?: string[]; description?: string; timezone?: string; proposed?: boolean; proposedFrom?: ProposedFrom; alternatives?: Array<{ startISO: string; endISO: string; note?: string }>; generated_at?: string; sent_at?: string; prepared_from?: PreparedFrom } | null;
  prepared_forward?: { to?: string[]; note?: string; generated_at?: string; sent_at?: string; prepared_from?: PreparedFrom } | null;
  prepared_by?: { worker?: string; at?: string } | null;
} | null | undefined;

const groundFrom = (pf: PreparedFrom | undefined): { emailId: string | null; receivedAt: string | null } | null =>
  pf?.receivedAt ? { emailId: pf.emailId ?? null, receivedAt: pf.receivedAt } : null;

// ── TIME TRUTH — pure, exported for the gate. ──
/** An invite whose proposed start is behind the clock. A timeless invite is not expired (it is
 *  `sendReady:false` — a different, honest word). */
export function inviteExpired(a: Pick<PreparedArtifact, 'kind' | 'invite'>, now: number = Date.now()): boolean {
  if (a.kind !== 'invite') return false;
  const t = Date.parse(String(a.invite?.startISO ?? ''));
  return Number.isFinite(t) && t < now;
}

/** THE LIVE PREDICATE — the one place that says what counts as prepared NOW: not superseded by a
 *  ground move, not past its own time, not outside the item's stated window, not claiming a deed
 *  the facts deny (W5a). (Sent artifacts never enter the list at all.) */
export function isLiveArtifact(a: PreparedArtifact): boolean {
  return !a.stale && !a.expired && !a.outsideWindow && !a.falseClaim && !a.misaddressed;
}

/** WHY an artifact is not live, in one word — null when it is live. The ONE vocabulary every
 *  reasoner-facing surface (the room board, the judge's pool block) speaks a withdrawn artifact in. */
export function withdrawnReasonOf(a: PreparedArtifact): string | null {
  if (a.outsideWindow) return 'outside the window they stated';
  if (a.wrongIdentity) return 'it was signed as another of your mailboxes';
  if (a.baseAsAnswer) return 'it attached the current version as if it were the finished work';
  if (a.stagingStale) return 'its file was matched under an older rule — re-checking it';
  if (a.falseClaim) return 'its words claimed work that is not done';
  if (a.misaddressed) return 'it was addressed to the wrong person';
  if (a.expired) return 'its proposed time already passed';
  if (a.stale) return 'superseded by a newer message';
  return null;
}

/**
 * W13.2 · NO SECOND DOOR FOR WORDS — the inbox item's STORED reply draft (`source_data.draft`) as THE
 * ONE READER judged it: why it is withdrawn, or null (live · hand-held · not in the reader's list —
 * an unreadable reader is never a withdrawal). The draft door serves the stored words only when this
 * is null; otherwise the door's regeneration decision (`decideRegeneration`'s `nonLive`) replaces them
 * through the one vet. Pure.
 */
export function storedDraftWithdrawal(all: PreparedArtifact[]): string | null {
  const a = all.find((x) => x.kind === 'reply_draft' && x.payload?.store === 'source_data' && x.payload.field === 'draft');
  if (!a || a.hand || isLiveArtifact(a)) return null;
  return withdrawnReasonOf(a);
}

/** W5c · THE RE-PREPARE KEY: the artifact KINDS on an item that exist but are NOT live. A lane's
 *  freshness guard ("a fresh X is already on it") must never count one of these as fresh — found
 *  live (Sep 23): the on-open trip fired for an out-of-window invite and a false-claim pack, and
 *  both lanes no-op'd because their 24h clock saw a young row, so the hidden artifact was never
 *  replaced and the room sat with nothing true to show. Pure; exported for the pass and the gate. */
export function nonLiveKindsOf(st: Pick<PreparedState, 'all'>): Set<PreparedKind> {
  // A kind that ALSO has a live artifact is not re-prepared on this account (the live one stands).
  const live = new Set(st.all.filter(isLiveArtifact).map((a) => a.kind));
  return new Set(st.all.filter((a) => !isLiveArtifact(a) && !live.has(a.kind)).map((a) => a.kind));
}

/** Stamp the derived time flag on every artifact (in place; returns the same array). */
export function stampExpiry<T extends PreparedArtifact>(arts: T[], now: number = Date.now()): T[] {
  for (const a of arts) if (inviteExpired(a, now)) a.expired = true;
  return arts;
}

/** The pure half — prepared artifacts already present ON an inbox row's source_data (no queries).
 *  The brief route uses this over rows it already holds; preparedState uses it after fetching.
 *  A SENT DRAFT IS NOT PREPARED WORK (owner walk, Sep 8): all four lanes read `sent_at`. */
export function preparedFromSourceData(sd: SourceData): PreparedArtifact[] {
  const out: PreparedArtifact[] = [];
  if (sd?.draft?.body && !sd.draft.sent_at) {
    out.push({
      kind: 'reply_draft', title: null, content: sd.draft.body,
      by: sd.prepared_by?.worker ?? null, at: sd.draft.generated_at ?? null,
      attachment: sd.draft.attachment ?? null, provenance: null,
      ground: groundFrom(sd.draft.prepared_from), payload: { store: 'source_data', field: 'draft' },
      addressee: addresseeOfStamp(sd.draft.addressee), hand: handOf('reply_draft', sd.draft),
    });
  }
  if (sd?.nudge_draft?.body && !sd.nudge_draft.sent_at) {
    // B3 (verb-lane sweep): the pass stamps prepared_by on the nudge lane too — reading null here
    // rendered the chase draft unattributed while every sibling lane said "by Clara".
    out.push({ kind: 'nudge_draft', title: null, content: sd.nudge_draft.body, by: sd.prepared_by?.worker ?? null, at: sd.nudge_draft.generated_at ?? null, attachment: null, provenance: null, ground: groundFrom(sd.nudge_draft.prepared_from), payload: { store: 'source_data', field: 'nudge_draft' }, addressee: addresseeOfStamp(sd.nudge_draft.addressee), hand: handOf('nudge_draft', sd.nudge_draft) });
  }
  if (sd?.prepared_invite && !sd.prepared_invite.sent_at) {
    const inv = sd.prepared_invite;
    const startISO = inv.startISO ?? inv.start;
    out.push({
      kind: 'invite', title: inv.title ?? 'Prepared invite',
      // B2 (verb-lane sweep): the writer stores startISO — reading `.start` served a timeless invite.
      content: [inv.title, startISO].filter(Boolean).join(' · ') || 'Calendar invite prepared',
      by: sd.prepared_by?.worker ?? null, at: inv.generated_at ?? null, attachment: null, provenance: null,
      sendReady: !!startISO,
      ground: groundFrom(inv.prepared_from),
      invite: { title: inv.title, startISO, endISO: inv.endISO, attendees: inv.attendees, description: inv.description, timezone: inv.timezone, proposed: inv.proposed, proposedFrom: inv.proposedFrom, alternatives: inv.alternatives },
      payload: { store: 'source_data', field: 'prepared_invite' }, hand: handOf('invite', inv),
    });
  }
  if (sd?.prepared_forward && !sd.prepared_forward.sent_at) {
    out.push({
      kind: 'forward', title: 'Prepared forward',
      content: [`To: ${(sd.prepared_forward.to ?? []).join(', ')}`, sd.prepared_forward.note].filter(Boolean).join('\n') || 'Forward prepared',
      by: sd.prepared_by?.worker ?? null, at: sd.prepared_forward.generated_at ?? null, attachment: null, provenance: null,
      sendReady: (sd.prepared_forward.to ?? []).length > 0,
      ground: groundFrom(sd.prepared_forward.prepared_from),
      payload: { store: 'source_data', field: 'prepared_forward' }, hand: handOf('forward', sd.prepared_forward),
    });
  }
  return stampExpiry(out);
}

/** THE ONE READER's pure LIVE verdict over an inbox row's own source_data (W7.5 — one reader per
 *  object): the artifacts preparedFromSourceData finds, run through the SAME truth floors the IO
 *  reader applies (window · completion claim · THE ADDRESSEE FLOOR when the user's forms are handed
 *  in), filtered by isLiveArtifact. A pure surface (the held ledger / triage deck) reads THIS, never
 *  the raw list — a raw list offered "draft ready" for a draft the reader withdraws as misaddressed.
 *  (Ground staleness needs the emails table and stays the IO reader's; the batched reader's
 *  last-activity approximation is applied here too when the row carries its clock.) */
export function liveFromSourceData(
  sd: unknown, opts: { user?: UserForms | null; lastActivityAt?: string | null } = {},
): PreparedArtifact[] {
  const arts = preparedFromSourceData(sd as SourceData);
  const lastAct = Date.parse(String(opts.lastActivityAt ?? '')) || 0;
  if (lastAct) for (const a of arts) {
    const pAt = Date.parse(String(a.ground?.receivedAt ?? '')) || 0;
    if (pAt && lastAct > pAt + 5000) markGroundMoved(a);
  }
  stampTruth(arts, inboxTruthFacts(sd));
  if (opts.user && hasAddressed(arts)) stampAddressees(arts, { counterparty: null, user: opts.user });
  return arts.filter(isLiveArtifact);
}

type PoolMeta = {
  agentName?: string; worker?: string; attachment?: { fileId: string; filename: string; source?: string };
  provenance?: Record<string, string>; version_of?: string; decisionBrief?: boolean; pastePack?: boolean;
  note?: string; options?: Array<string | { label?: string; tradeoff?: string | null }>;
  recommendation?: string | null; why?: string | null; prepared_from?: PreparedFrom;
  /** A commitment's pooled INVITE (lib/prepare/pass.ts prepareInviteDraft, task_id 'prepare-pass-invite'). */
  invite?: NonNullable<PreparedArtifact['invite']> | null;
  /** The execute door stamps the pool artifact spent here (mirror of source_data's sent_at). */
  sent_at?: string | null;
  /** TRUE ADDRESSEES (W7.3): who the words are for, stamped by the writer. */
  addressee?: unknown;
};

/** The PURE pool-row mapper — the other half of the one reader, shared by preparedState and the
 *  machine's batch derivation: forking this mapping is how a deck row and a deep-dive disagree
 *  about what's prepared. KIND-TRUE (W2.1): a row carrying `metadata.invite` IS an invite — it was
 *  read as a reply draft for weeks, so no commitment room could ever mount its card.
 *  René sweep (Aug 13): a commitment's `type:'draft'` row IS the chase/reply lane home — a
 *  ready-to-send nudge must not wear the document card; and stacked re-drafts collapse to the
 *  NEWEST (rows must arrive newest-first). Ask-journey D5: `file` rows are the user's own
 *  supplied inputs and `sent` rows are done work — neither is pending preparation. J3:
 *  version-history rows are the ledger, not the surface. */
export function poolRowsToArtifacts(rows: Array<Record<string, unknown>>, poolKind: 'email' | 'commitment'): PreparedArtifact[] {
  const out: PreparedArtifact[] = [];
  let sawCommitDraft = false;
  let sawInvite = false;
  for (const d of rows) {
    if (!d.content) continue;
    if (d.type === 'file' || d.type === 'sent') continue;
    const meta = (d.metadata ?? {}) as PoolMeta;
    if (meta.version_of) continue;
    if (meta.sent_at) continue;   // a sent artifact is done work — never pending preparation
    const payload: PreparedPayloadRef = { store: 'pool', rowId: (d.id as string) ?? null, taskId: (d.task_id as string) ?? null };
    const by = meta.agentName ?? meta.worker ?? null;
    const at = (d.created_at as string) ?? null;
    // THE INVITE reads FIRST (kind-true): the newest unsent invite is the one; older ones are ledger.
    if (meta.invite && typeof meta.invite === 'object') {
      if (sawInvite) continue;
      sawInvite = true;
      const inv = meta.invite;
      out.push({
        kind: 'invite', title: inv.title ?? (d.title as string) ?? 'Prepared invite',
        content: [inv.title, inv.startISO].filter(Boolean).join(' · ') || String(d.content),
        by, at, attachment: null, provenance: meta.provenance ?? null,
        sendReady: !!inv.startISO, ground: groundFrom(meta.prepared_from), invite: inv, payload,
        hand: isPoolRowHandHeld('invite', d) ? { editedAt: String((meta as { edited_by_user_at?: string }).edited_by_user_at) } : null,
      });
      continue;
    }
    // THE PASTE PACK reads next: it is neither a commitment's send-shaped draft nor a document to
    // review — it is words with a destination, and its note is the only thing that says so.
    if (meta.pastePack) {
      out.push({
        kind: 'paste_pack', title: (d.title as string) ?? null, content: String(d.content),
        by, at, attachment: null, provenance: meta.provenance ?? null, note: meta.note ?? null,
        ground: groundFrom(meta.prepared_from), payload, addressee: addresseeOfStamp(meta.addressee),
        hand: isPoolRowHandHeld('paste_pack', d) ? { editedAt: String((meta as { edited_by_user_at?: string }).edited_by_user_at) } : null,
      });
      continue;
    }
    const isCommitDraft = poolKind === 'commitment' && d.type === 'draft' && !meta.decisionBrief;
    if (isCommitDraft && sawCommitDraft) continue;
    if (isCommitDraft) sawCommitDraft = true;
    // TRUE ADDRESSEES (W7.3): the writer's stamp; a LEGACY nudge's own title ("Nudge — X") carries the
    // name its writer addressed (the same field) — read as a name-only addressee.
    const addressee = isCommitDraft ? (addresseeOfStamp(meta.addressee) ?? addresseeFromNudgeTitle(d.title as string)) : null;
    // W13.3 · the doc-send lane's file match must carry the CURRENT staging-law stamp to be trusted.
    const lawV = Number((meta as { stagingLaw?: unknown }).stagingLaw);
    const stagingStale = isCommitDraft && d.task_id === 'prepare-pass-docsend' && !!meta.attachment
      && (!Number.isFinite(lawV) || lawV < STAGING_LAW_VERSION);
    out.push({
      ...(addressee ? { addressee } : {}),
      ...(stagingStale ? { stagingStale: true } : {}),
      kind: isCommitDraft ? (String(d.title ?? '').startsWith('Nudge — ') ? 'nudge_draft' : 'reply_draft') : 'deliverable',
      title: (d.title as string) ?? null, content: String(d.content),
      ground: groundFrom(meta.prepared_from),
      hand: isPoolRowHandHeld('deliverable', d) ? { editedAt: String((meta as { edited_by_user_at?: string }).edited_by_user_at) } : null,
      by, at, attachment: meta.attachment ?? null, provenance: meta.provenance ?? null, payload,
      // Both metadata generations parse: label strings (the first live briefs) and
      // {label, tradeoff} objects (current writes).
      ...(meta.decisionBrief ? { decision: {
        options: (meta.options ?? []).map((o) => typeof o === 'string' ? { label: o } : { label: String(o.label ?? ''), tradeoff: o.tradeoff ?? null }).filter((o) => o.label),
        recommendation: meta.recommendation ?? null, why: meta.why ?? null,
      } } : {}),
    });
  }
  return stampExpiry(out);
}

/** The pool columns every reader selects — one list, so a batch and a single read can't drift. */
export const POOL_SELECT = 'id, task_id, type, title, content, metadata, created_at';

/** THE BADGE — 'draft' (in-house) or the preparer's name, from LIVE artifacts only (an expired
 *  invite alone earns no badge: a chip is a claim, and this one would be false about time). */
export function badgeOf(arts: PreparedArtifact[]): string | null {
  const live = arts.filter(isLiveArtifact);
  if (!live.length) return null;
  return live.find((a) => a.by)?.by ?? 'draft';
}

/** A single ✦ badge for an inbox row (pure, source_data only) — kept for the brief's inbox tokens. */
export function preparedBadge(sd: SourceData): string | null {
  return badgeOf(preparedFromSourceData(sd));
}

/** THE LEAD KIND — the one kind a chip words itself by (the machine's own precedence: a send-shaped
 *  artifact outranks a document, a decision brief leads as a decision). */
export function leadKindOf(arts: PreparedArtifact[]): PreparedKind | 'decision' | null {
  const live = arts.filter(isLiveArtifact);
  if (!live.length) return null;
  const order: PreparedKind[] = ['invite', 'forward', 'reply_draft', 'nudge_draft', 'paste_pack', 'deliverable'];
  const decision = live.find((a) => a.decision && a.decision.options.length >= 2);
  const send = order.map((k) => live.find((a) => a.kind === k && !a.decision)).find(Boolean);
  if (send && ['invite', 'forward', 'reply_draft', 'nudge_draft'].includes(send.kind)) return send.kind;
  if (decision) return 'decision';
  return send?.kind ?? null;
}

export type PreparedState = {
  /** Every unsent artifact, flags derived (stale · expired). Newest first. */
  all: PreparedArtifact[];
  /** The renderable ones — what a chip, a brief, a narration may CLAIM. */
  live: PreparedArtifact[];
  /** Reported, never ready: past-time invites. */
  expired: PreparedArtifact[];
  /** Superseded by a ground move. */
  stale: PreparedArtifact[];
  /** TIME TRUTH (W5a): invites proposing outside the item's stated window — never ready. */
  outsideWindow: PreparedArtifact[];
  /** A CLAIM RENDERS (W5a): words announcing a deed the facts deny — never ready. */
  falseClaim: PreparedArtifact[];
  /** TRUE ADDRESSEES (W7.3): words addressed to the user / to someone other than the counterparty. */
  misaddressed: PreparedArtifact[];
  /** A send-shaped artifact on this item already went out (the machine's `committed`). */
  sentStamp: boolean;
  /** 'draft' | preparer's name | null — from live artifacts only. */
  badge: string | null;
  /** The kind a chip words itself by. */
  leadKind: PreparedKind | 'decision' | null;
};

const dedupeAndSort = (out: PreparedArtifact[]): PreparedArtifact[] => {
  // W6 — IDENTICAL artifacts collapse to one (the triple-chip bug: three requirement labels once
  // staged the same file as three pool rows). Distinct drafts (different content) always survive.
  const seen = new Set<string>();
  const deduped = out.filter((a) => {
    const k = `${a.kind}:${a.attachment?.fileId ?? ''}:${a.title ?? ''}:${a.content.replace(/\s+/g, ' ').slice(0, 80)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return deduped.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
};

const toState = (all: PreparedArtifact[], sentStamp: boolean): PreparedState => {
  const sorted = dedupeAndSort(all);
  return {
    all: sorted,
    live: sorted.filter(isLiveArtifact),
    expired: sorted.filter((a) => a.expired),
    stale: sorted.filter((a) => a.stale),
    outsideWindow: sorted.filter((a) => a.outsideWindow),
    falseClaim: sorted.filter((a) => a.falseClaim),
    misaddressed: sorted.filter((a) => a.misaddressed),
    sentStamp,
    badge: badgeOf(sorted),
    leadKind: leadKindOf(sorted),
  };
};

const sentStampOf = (sd: SourceData, pool: Array<Record<string, unknown>>): boolean =>
  !!(sd?.draft?.sent_at || sd?.prepared_invite?.sent_at || sd?.prepared_forward?.sent_at || sd?.nudge_draft?.sent_at)
  || pool.some((d) => !!((d.metadata ?? {}) as PoolMeta).sent_at);

const EMPTY_STATE: PreparedState = { all: [], live: [], expired: [], stale: [], outsideWindow: [], falseClaim: [], misaddressed: [], sentStamp: false, badge: null, leadKind: null };

/** THE ONE READER — everything prepared for ONE item, across all storage places, with the exact
 *  ground check (one emails query). */
export async function preparedState(
  client: SupabaseClient, userId: string,
  item: { kind: 'inbox_item' | 'commitment'; id: string },
): Promise<PreparedState> {
  const out: PreparedArtifact[] = [];
  let sd: SourceData = null;
  let pool: Array<Record<string, unknown>> = [];
  // THE ITEM'S OWN FACTS (W5a) — what the truth floors judge against. One row read per kind.
  let facts: ItemTruthFacts | null = null;
  // W11.1 · THE MAILBOX SIGNS — where the item's thread lives (inbox: its own connection column;
  // commitment: its thread's synced mail), read only when a machine draft exists and the user has
  // more than one mailbox.
  let itemConnId: string | null = null;
  let itemThreadId: string | null = null;
  try {
    if (item.kind === 'inbox_item') {
      // THE HOT-PATH LAW (event-spine P0): the one reader's declared keys + `body` (the window floor
      // reads the item's words) — never `html_body` / `thread_history`.
      const { data: raw } = await client.from('inbox_items').select(leanSelect('work_state, connection_id', { keys: ONE_READER_KEYS, withBody: true })).eq('id', item.id).eq('user_id', userId).maybeSingle();
      const data = raw ? foldLean(raw as unknown as Record<string, unknown>, { keys: ONE_READER_KEYS, withBody: true }) as { source_data: unknown; work_state?: string | null; connection_id?: string | null } : null;
      sd = data?.source_data as SourceData;
      facts = inboxTruthFacts(sd);
      itemConnId = data?.connection_id ?? null;
      out.push(...await stripNoticeDrafts(preparedFromSourceData(sd), sd, data?.work_state));
    } else {
      const { data: c } = await client.from('commitments').select('description, created_at, status, direction, counterparty, thread_id').eq('id', item.id).eq('user_id', userId).maybeSingle();
      facts = commitmentTruthFacts(c as CommitFactsRow | null);
      itemThreadId = ((c as { thread_id?: string | null } | null)?.thread_id) ?? null;
    }
    // Deliverables hang off items under the plan-kind key ('email' for inbox-backed, 'commitment' for commitments).
    const poolKind = item.kind === 'inbox_item' ? 'email' : 'commitment';
    const { data: dels } = await client.from('item_deliverables')
      .select(POOL_SELECT)
      .eq('user_id', userId).eq('kind', poolKind).eq('entity_id', item.id)
      .order('created_at', { ascending: false }).limit(8);
    pool = (dels ?? []) as Array<Record<string, unknown>>;
    // W13 · the item's BASE files — the truth floors judge a draft riding one as not the work.
    { const bases = baseFileIdsOf(pool); if (facts && bases.length) facts = { ...facts, baseFileIds: bases }; }
    out.push(...(item.kind === 'inbox_item'
      ? await stripNoticeDrafts(poolRowsToArtifacts(pool, poolKind), sd, null)
      : poolRowsToArtifacts(pool, poolKind)));
    // THE GROUND LAW — stale is DERIVED here, never stored: an artifact whose ground predates
    // the item's newest inbound is SUPERSEDED (the counterparty's new message is their supply).
    // Unstamped/unresolvable artifacts are exempt (conservative — the pass re-stamps on rewrite).
    try {
      const { groundOf, groundMoved } = await import('@/lib/prepare/ground');
      const current = await groundOf(client, userId, { kind: item.kind === 'inbox_item' ? 'inbox' : 'commitment', id: item.id });
      if (current.receivedAt) for (const a of out) { if (groundMoved(a.ground, current)) markGroundMoved(a); }
    } catch { /* staleness is a protection, never a blocker */ }
    // TIME TRUTH + A CLAIM RENDERS (W5a): an invite outside the item's stated window and words that
    // announce an undone deed are derived FALSE here, at the one reader — never "ready" anywhere.
    if (facts && needsIdentityCheck(out)) {
      const boxes = await loadMailboxIdentities(client, userId);
      if (boxes) {
        const conn = itemConnId ?? (itemThreadId ? (await connectionsOfThreads(client, userId, [itemThreadId])).get(itemThreadId) ?? null : null);
        facts = { ...facts, mailbox: mailboxFactsFor(conn, boxes) };
      }
    }
    stampTruth(out, facts);
    // TRUE ADDRESSEES (W7.3): words addressed to the user, or to someone who is not the item's
    // counterparty, are derived WRONG here — never "ready" anywhere; the re-prepare trip replaces them.
    if (hasAddressed(out)) stampAddressees(out, { counterparty: facts?.counterparty ?? null, user: await loadUserForms(client, userId) });
  } catch { /* non-fatal — prepared work is an enhancement */ }
  return toState(out, sentStampOf(sd, pool));
}

/** THE BATCHED READER — a whole deck/board in two queries. The ground check here is the machine's
 *  documented APPROXIMATION (safe direction): an inbox artifact is stale when the row's
 *  `last_activity_at` postdates its stamp (+5s). Commitments carry no activity clock, so a pooled
 *  commitment artifact is never approximated stale here (the single reader does the exact check).
 *  Keys of the returned map: `inbox:<id>` / `commitment:<id>`. */
export async function preparedStatesFor(
  client: SupabaseClient, userId: string,
  items: Array<{ kind: 'inbox' | 'commitment'; id: string; /** prefetched row, when the caller holds it */ row?: { source_data?: unknown; last_activity_at?: string | null } }>,
): Promise<Map<string, PreparedState>> {
  const out = new Map<string, PreparedState>();
  if (!items.length) return out;
  const keyOf = (i: { kind: string; id: string }) => `${i.kind}:${i.id}`;
  try {
    const inboxNeedingRows = items.filter((i) => i.kind === 'inbox' && !i.row).map((i) => i.id);
    const inboxIds = items.filter((i) => i.kind === 'inbox').map((i) => i.id);
    const commitIds = items.filter((i) => i.kind === 'commitment').map((i) => i.id);
    const { fetchAllRows } = await import('@/lib/utils/fetch-all');
    const [inboxRes, poolEmail, poolCommit, commitFactsRes] = await Promise.all([
      inboxNeedingRows.length
        // THE HOT-PATH LAW: body-free; the one floor that reads the item's words (an invite's stated
        // window) gets them below, for exactly the rows carrying an invite.
        ? client.from('inbox_items').select(leanSelect('id, last_activity_at, connection_id', { keys: PREPARED_KEYS })).eq('user_id', userId).in('id', inboxNeedingRows)
            .then((r) => ({ data: foldLeanRows((r.data ?? []) as unknown as Array<Record<string, unknown>>, { keys: PREPARED_KEYS }) }))
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      inboxIds.length
        ? fetchAllRows<Record<string, unknown>>((from, to) => client.from('item_deliverables').select(`entity_id, ${POOL_SELECT}`)
            .eq('user_id', userId).eq('kind', 'email').in('entity_id', inboxIds)
            .order('created_at', { ascending: false }).range(from, to))
        : Promise.resolve([] as Array<Record<string, unknown>>),
      commitIds.length
        ? fetchAllRows<Record<string, unknown>>((from, to) => client.from('item_deliverables').select(`entity_id, ${POOL_SELECT}`)
            .eq('user_id', userId).eq('kind', 'commitment').in('entity_id', commitIds)
            .order('created_at', { ascending: false }).range(from, to))
        : Promise.resolve([] as Array<Record<string, unknown>>),
      // THE ITEM'S OWN FACTS for commitments (W5a) — one batched read, so the window and the
      // completion floors hold on a whole deck exactly as they hold on the single reader.
      commitIds.length
        ? client.from('commitments').select('id, description, created_at, status, direction, counterparty, thread_id').eq('user_id', userId).in('id', commitIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    ]);
    const commitFacts = new Map<string, ItemTruthFacts | null>();
    for (const r of (commitFactsRes.data ?? []) as Array<Record<string, unknown>>) commitFacts.set(String(r.id), commitmentTruthFacts(r as CommitFactsRow));
    const rows = new Map<string, { source_data?: unknown; last_activity_at?: string | null }>();
    for (const r of (inboxRes.data ?? []) as Array<Record<string, unknown>>) rows.set(String(r.id), r as never);
    const poolBy = new Map<string, Array<Record<string, unknown>>>();
    for (const r of [...poolEmail, ...poolCommit]) {
      const k = String(r.entity_id);
      const arr = poolBy.get(k) ?? [];
      arr.push(r); poolBy.set(k, arr);
    }
    // THE WINDOW FLOOR'S WORDS: a body-free row carrying an invite gets its body (bounded id read).
    await hydrateBodies(client, userId, items
      .filter((i) => i.kind === 'inbox')
      .map((i) => ({ id: i.id, source_data: (i.row ?? rows.get(i.id))?.source_data }))
      .filter((r) => isLeanSource(r.source_data) && preparedFromSourceData(r.source_data as SourceData).some((a) => a.kind === 'invite')));
    // TRUE ADDRESSEES (W7.3): who the user is — read ONCE for the whole batch, only when needed.
    let userForms: UserForms | null = null;
    const artsOf = new Map<string, PreparedArtifact[]>();
    for (const item of items) {
      const row = item.row ?? rows.get(item.id);
      const sd = (row?.source_data ?? null) as SourceData;
      const pool = poolBy.get(item.id) ?? [];
      artsOf.set(keyOf(item), item.kind === 'inbox'
        ? [...preparedFromSourceData(sd), ...poolRowsToArtifacts(pool, 'email')]
        : poolRowsToArtifacts(pool, 'commitment'));
    }
    // W11.1 · THE MAILBOX SIGNS — the batch's connections, read once, only for items carrying a machine
    // draft and only for a user with more than one mailbox (else nothing further is read).
    const connOf = new Map<string, string>();
    const checkKeys = items.filter((i) => needsIdentityCheck(artsOf.get(keyOf(i)) ?? []));
    const boxes = checkKeys.length ? await loadMailboxIdentities(client, userId) : null;
    if (boxes) {
      const inboxCheck = checkKeys.filter((i) => i.kind === 'inbox');
      const known = (i: { id: string; row?: unknown }) => ((i.row ?? rows.get(i.id)) as { connection_id?: string | null } | undefined)?.connection_id ?? null;
      for (const i of inboxCheck) { const c = known(i); if (c) connOf.set(keyOf(i), c); }
      const missing = inboxCheck.filter((i) => !connOf.has(keyOf(i))).map((i) => i.id);
      if (missing.length) {
        const { data: cr } = await client.from('inbox_items').select('id, connection_id').eq('user_id', userId).in('id', missing);
        for (const r of (cr ?? []) as Array<{ id: string; connection_id: string | null }>) if (r.connection_id) connOf.set(`inbox:${r.id}`, r.connection_id);
      }
      const commitThread = new Map<string, string>();
      for (const r of (commitFactsRes.data ?? []) as Array<{ id: string; thread_id?: string | null }>) if (r.thread_id) commitThread.set(String(r.id), String(r.thread_id));
      const tids = [...new Set(checkKeys.filter((i) => i.kind === 'commitment').map((i) => commitThread.get(i.id)).filter((t): t is string => !!t))];
      const byThread = await connectionsOfThreads(client, userId, tids);
      for (const i of checkKeys) if (i.kind === 'commitment') { const t = commitThread.get(i.id); const c = t ? byThread.get(t) : null; if (c) connOf.set(keyOf(i), c); }
    }
    for (const item of items) {
      const row = item.row ?? rows.get(item.id);
      const sd = (row?.source_data ?? null) as SourceData;
      const pool = poolBy.get(item.id) ?? [];
      const arts = artsOf.get(keyOf(item)) ?? [];
      // The staleness approximation (see the function doc): last_activity past the stamp.
      const lastAct = Date.parse(String(row?.last_activity_at ?? '')) || 0;
      if (lastAct) for (const a of arts) {
        const pAt = Date.parse(String(a.ground?.receivedAt ?? '')) || 0;
        if (pAt && lastAct > pAt + 5000) markGroundMoved(a);
      }
      const itemFacts = item.kind === 'inbox' ? inboxTruthFacts(sd) : commitFacts.get(item.id) ?? null;
      const bases = baseFileIdsOf(pool);
      const baseFacts = itemFacts && bases.length ? { ...itemFacts, baseFileIds: bases } : itemFacts;
      const facts = baseFacts && boxes && connOf.has(keyOf(item)) ? { ...baseFacts, mailbox: mailboxFactsFor(connOf.get(keyOf(item)), boxes) } : baseFacts;
      stampTruth(arts, facts);
      if (hasAddressed(arts)) {
        userForms ??= await loadUserForms(client, userId);
        stampAddressees(arts, { counterparty: facts?.counterparty ?? null, user: userForms });
      }
      out.set(keyOf(item), toState(arts, sentStampOf(sd, pool)));
    }
  } catch { /* the prepared state is an enhancement — rows render without it */ }
  for (const item of items) if (!out.has(keyOf(item))) out.set(keyOf(item), EMPTY_STATE);
  return out;
}

/** Everything prepared for ONE item, newest first, flags derived — the historical signature, now a
 *  thin wrapper over THE ONE READER. Callers wanting only the renderable set read `.live`. */
export async function getPrepared(
  client: SupabaseClient, userId: string,
  item: { kind: 'inbox_item' | 'commitment'; id: string },
): Promise<PreparedArtifact[]> {
  return (await preparedState(client, userId, item)).all;
}
