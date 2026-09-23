// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE GROUNDING (Aug 5 — the one-system arc, stage 1). "It should feel like Claude": one loop,
// ONE assembled context, surfaces as views. The room's panel used to be written by five subsystems
// reasoning over DIFFERENT slices of the truth at different times — the brief said "drafted" while
// a narration said "nothing's prepared", because no single assembly existed for them to share.
//
// This module is that assembly: everything the brain knows about ONE room, in one structured
// read + one rendered text block. Every reasoned call in room scope consumes THIS — the responder
// (brief/MOVE/offers), the chat's question path, the agent loop. A fact not in the grounding does
// not exist; a claim that contradicts the grounding cannot be authored, because every author read
// the same page. Adding a knowledge source = one section here, visible to ALL reasoning at once.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { readPlans, asRawResult } from '@/lib/store/item-plans';
import { assembleLedger } from '@/lib/entities/state';
import { renderGroundEvidence } from '@/lib/room/ground-evidence';
import { clipLedgerLine } from '@/lib/inbox/thread-now';
import { clipForPrompt, clipLabel, EXCERPT_MARK, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';
import { loadEvidencePool, matchEvidence, resolveCommitmentAddresses, SETTLE_MATCH, type Evidence, type EvidencePool } from '@/lib/work/evidence-nominator';
import { actorLabel } from '@/lib/evidence/actor';
import { deedWords } from '@/lib/evidence/sources';
import { getPersonEntities, type PersonEntity } from '@/lib/entities/people';
import { normalizeEmail } from '@/lib/core/email';
import { withdrawnReasonOf } from '@/lib/prepare/read';

export type RoomScope =
  | { kind: 'entity'; entityId: string }
  | { kind: 'item'; itemKind: 'inbox' | 'commitment' | 'meeting'; itemId: string };

export type BoardEntry = {
  ref: string;                 // 'inbox:<id>' | 'commit:<id>' — the deed-building handle
  id: string;
  kind: 'inbox' | 'commitment';
  title: string;
  who: string | null;
  due: string | null;
  judgedWork: string | null;   // the judge's cached verb (reply/chase/…/none) — same truth the deck uses
  judgedReason: string | null;
  prepared: string[];          // what actually exists on the item, LIVE — from THE ONE READER (W2.1)
  /** TIME TRUTH: prepared things that are past their own time (an expired invite) — reported, never claimed. */
  expired: string[];
  /** W5c · A CLAIM RENDERS: prepared things THE ONE READER hides for any OTHER reason (outside the
   *  stated window · a false completion claim · superseded) — stated WITHDRAWN on the line, never
   *  claimed, and counted in the brief's digest so a liveness change always recomposes. */
  withdrawn: string[];
  preparedBy: string | null;
  /** AN ITEM'S OWN DOCUMENT IS THE ITEM'S OWN CONTEXT (owner walk, Sep 10): the files that arrived
   *  WITH this item — name + a one-line gist. The brief once told the user to "send the debt notice
   *  back to them to finalize billing" about a document THEY had sent US, because the page carried
   *  the item's title and nothing about what came with it. Names + gist only (the page is read by
   *  every reasoner in room scope; the full text belongs to the drafter's own block). */
  attachments: string[];
  /** LATER EVIDENCE (W5a · invariant 7 reaches the room): the user's own record AFTER this item,
   *  with its counterparty — a meeting held/booked, mail sent, a transcript — as dated facts, from
   *  the same address-keyed nominator the judge reads (W2.5). The brief composer can never assert
   *  "missed / not done" against a deed the calendar holds. */
  evidence: string[];
};

// ── THE ROOM'S EVIDENCE POOL (W5a): ONE bounded pool per user, memoized briefly — the grounding is
// assembled on warm + open + ensure*, and the pool (≤3 reads) must be paid once per burst, exactly
// as the judge pays it (lib/work/judge.ts judgeEvidencePool). ──
const ROOM_EVIDENCE_LOOKBACK_DAYS = 60;
const ROOM_EVIDENCE_TTL_MS = 90_000;
const ROOM_EVIDENCE_CAL_HORIZON_DAYS = 21;
const ROOM_EVIDENCE_MAX_LINES = 4;
const _roomPools = new Map<string, { at: number; p: Promise<EvidencePool> }>();
function roomEvidencePool(client: SupabaseClient, userId: string): Promise<EvidencePool> {
  const now = Date.now();
  const hit = _roomPools.get(userId);
  if (hit && now - hit.at < ROOM_EVIDENCE_TTL_MS) return hit.p;
  if (_roomPools.size > 200) for (const [k, v] of _roomPools) if (now - v.at >= ROOM_EVIDENCE_TTL_MS) _roomPools.delete(k);
  const p = loadEvidencePool(client, userId, new Date(now - ROOM_EVIDENCE_LOOKBACK_DAYS * 86_400_000).toISOString())
    .catch(() => ({ emails: [], events: [], transcripts: [] } as EvidencePool));
  _roomPools.set(userId, { at: now, p });
  return p;
}

/** An evidence moment in the user's zone (TIME TRUTH). */
function atLocalRoom(iso: string, tz: string): string {
  try { return new Date(iso).toLocaleString('sv-SE', { timeZone: tz }).slice(0, 16); } catch { return iso.slice(0, 16).replace('T', ' '); }
}

/** THE EVIDENCE LINES — pure: one short dated fact per piece, newest first, bounded. Exported for
 *  the gate. A held meeting is stated as HELD; a booked one as booked; sent mail as sent.
 *  W8.7 THE ROOM SEES WHAT THE SETTLE SEES: matched with SETTLE_MATCH, so a TEAMMATE's mail is stated
 *  as theirs ("a teammate (<name>) SENT …", never the user's) and a deed done THROUGH AUGMTD (the
 *  commit-door ledger) as a dated deed. The legacy line shapes are unchanged. */
export function evidenceLinesOf(ev: Evidence[], tz: string): string[] {
  const q = (t: string) => `"${clipLabel(String(t || 'untitled'), 60)}"`;
  return [...ev].sort((a, b) => b.at.localeCompare(a.at)).slice(0, ROOM_EVIDENCE_MAX_LINES).map((e) => {
    if (e.type === 'calendar') return `meeting ${q(e.title)} ${e.status === 'held' ? 'HELD' : 'BOOKED (upcoming)'} ${atLocalRoom(e.at, tz)}`;
    if (e.type === 'transcript') return `meeting ${q(e.title)} RECORDED ${atLocalRoom(e.at, tz)}`;
    if (e.type === 'deed') return `the user ${deedWords(e).toUpperCase()} ${q(e.title)} through AUGMTD ${atLocalRoom(e.at, tz)}`;
    if (e.by === 'teammate') return `a teammate (${clipLabel(actorLabel(e.actor), 40)}) SENT ${q(e.title)} ${atLocalRoom(e.at, tz)}`;
    return e.by === 'user' ? `the user SENT ${q(e.title)} ${atLocalRoom(e.at, tz)}` : `received ${q(e.title)} from them ${atLocalRoom(e.at, tz)}`;
  });
}

/** THE EVIDENCE RULE for the board (one copy, beside the lines it governs). W8.7: a teammate's line
 *  is the user's SIDE acting — a delivery the team made, never narrated as the user's own. */
export const BOARD_EVIDENCE_RULE =
  'A LATER EVIDENCE line is the user\'s own record AFTER the item, with this counterparty (dated facts, ' +
  'resolved by address): a meeting HELD or mail SENT there is a deed that HAPPENED — never say it was ' +
  'missed, skipped or not done, never demand it again; if the item asked for that meeting or that ' +
  'message, treat it as settled unless the evidence itself says otherwise. A line naming a TEAMMATE is ' +
  'the user\'s side acting — say that teammate did it (never that the user did), and never demand it again.';

export type RoomGrounding = {
  roomKey: string;
  entity: {
    id: string; name: string; tracked: boolean;
    summary: string | null; momentum: string | null;
    /** THE WATCH-OUT (threads Phase 3): the synthesis's own blocking line. It used to render as a
     *  standalone amber block on the room's right pane — a warning shouted by a second voice beside
     *  the composed brief. A warning is SPEECH: it reaches the ONE composer through this field and
     *  is spoken as part of the position, or not at all. */
    blocking: string | null;
    whoOwesYou: string[]; whoOwesThem: string[];
    nextMove: { title: string; ref: string | null } | null;
    goals: string[]; rules: string[]; sig: string | null;
  } | null;
  board: BoardEntry[];
  /** THE LIVE ASKS — every open checklist standing in this room, the ENGINE's and a COWORKER's
   *  alike, read off their own durable query (never the transcript window: an ask older than the
   *  last handful of turns is still owed, and the composer went blind to it — owner walk, Sep 7).
   *  `who` = the coworker who asks; null = the chief of staff's own engine ask. */
  asks: Array<{ items: string[]; since: string | null; proceeded: boolean; turnId: string | null; key: string | null; who: string | null }>;
  /** THE GROUND EVIDENCE (owner walk, Sep 8) — the facts a person would CHECK before demanding a
   *  deed: who spoke last on each thread (the user's own sent mail included) and what actually
   *  sits on the calendar with this room's people. Code gathers; the mind concludes. Boundary-
   *  marked inside `text`, and digested into the brief's sig so new evidence recomposes. */
  groundEvidence: string[];
  transcript: string;          // recent turns, rendered (the dialogue read)
  ledgerRefs: Map<string, { label: string; href: string | null }>; // [L#]/[F#] → link (ask consumers)
  /** THE rendered grounding block — the one page every reasoned call reads. */
  text: string;
};

const hrefOfRef = (ref: string): string | null => {
  const [k, id] = ref.split(':');
  if (k === 'inbox') return `/item/${id}`;
  if (k === 'commit') return `/item/${id}?kind=commitment`;
  if (k === 'meeting') return `/item/${id}?kind=meeting`;
  return null;
};

/** THE BOARD'S PREPARED WORDS — spoken from THE ONE READER (stabilization W2.1: this file used to
 *  read source_data alone, so a coworker's pooled deliverable, a commitment's nudge or its INVITE
 *  were invisible to every reasoner — "nothing's prepared" beside a real card). Live artifacts
 *  become PREPARED words; expired invites are REPORTED, never claimed (TIME TRUTH). */
export function preparedWordsOf(st: Pick<import('@/lib/prepare/read').PreparedState, 'live' | 'expired' | 'all' | 'badge'>): { list: string[]; expired: string[]; withdrawn: string[]; by: string | null } {
  const word = (a: import('@/lib/prepare/read').PreparedArtifact): string => {
    if (a.decision && a.decision.options.length >= 2) return 'decision brief';
    switch (a.kind) {
      case 'reply_draft': return 'reply draft';
      case 'nudge_draft': return 'follow-up nudge draft';
      case 'invite': return a.sendReady === false ? 'calendar invite (needs a time)' : 'calendar invite';
      case 'forward': return 'forward';
      case 'paste_pack': return 'paste pack (words to copy)';
      default: return a.title ? `document "${clipLabel(a.title, 60)}"` : 'document';
    }
  };
  return {
    list: st.live.map(word),
    expired: st.expired.map((a) => `${word(a)} — proposed time already passed, NOT ready`),
    // Everything else the reader hides (expired has its own line above). The reason is THE ONE
    // READER's own word, so the composer states WHY the team is re-preparing it.
    withdrawn: st.all.filter((a) => !a.expired && (a.stale || a.outsideWindow || a.falseClaim || a.misaddressed))
      .map((a) => `${word(a)} — ${withdrawnReasonOf(a) ?? 'not ready'}`),
    by: st.badge && st.badge !== 'draft' ? st.badge : null,
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Q1 · THE VOICE COLLAPSES, AT THE SOURCE (docs/attention-plan.md PART III — Sep 18).
//
// The room's opening read "Clara is asking you to approve the shortlist" — in Clara's own voice.
// `lib/room/self-voice` collapses that AFTER composition, which fixes the sentence and leaves the
// cause standing: THIS page — the one every reasoner in room scope reads — rendered the speaker's
// own ask as "Clara asks", so every consumer (the responder, answerEntityQuestion, the converse
// loop) had to re-derive the same collapse or speak a third person that was itself.
//
// So the speaker is plumbed in HERE, and the page states whose ask it is in the first person. The
// post-hoc collapse becomes a BELT, not the fix; every consumer inherits the law for free, without
// a single edit, because they all read `text`.
//
// The seat is OPTIONAL by design: a caller with no speaker in hand renders exactly as before.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The speaker's own first name — the only token the ask renderer compares (the self-voice name
 *  test's own rule: a counterparty sharing a given name is a different person, but an ASK's author
 *  is one of our own seats, so the first name is the identity here). */
const firstNameOf = (n: string | null | undefined): string =>
  String(n ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';

/** THE ASK'S ATTRIBUTION LINE — first person when the asker IS the speaker reading this page. */
export function askAttribution(who: string | null | undefined, speaker: string | null | undefined): string {
  if (who && speaker && firstNameOf(who) === firstNameOf(speaker)) {
    return 'YOUR OWN ask to the user — "I ask"; never your own name in the third person';
  }
  return who ? `${who} asks` : 'the team asks';
}

export type GroundingOptions = {
  /** The CoS seat reading this page (lib/workers/cos-seat). Absent = no collapse, as before. */
  speaker?: string | null;
};

export async function assembleRoomGrounding(
  client: SupabaseClient, userId: string, scope: RoomScope, opts: GroundingOptions = {},
): Promise<RoomGrounding> {
  const speaker = opts.speaker ?? null;
  // ONE OBJECT, ONE DOOR (stabilization W7.2 — lib/room/door.ts): the scope IS the room. An ITEM
  // scope grounds on the item's own context and its own key — its board is the one item, so the
  // component note and the claims floor downstream are computed from what THAT door mounts. It
  // used to widen to the linked entity ("one conversation per deal"), which is how a commitment's
  // door composed a machine container's whole agenda under the commitment's title the moment
  // recognition-on-open wrote an UNTRACKED link. The entity's page is the ENTITY door's grounding.
  const entityId: string | null = scope.kind === 'entity' ? scope.entityId : null;
  const roomKey = scope.kind === 'item' ? `${scope.itemKind}:${scope.itemId}` : scope.entityId;

  // ── The parallel reads: entity + ledger, the linked items, the room's turns, the files,
  //    the standing production (THE ENTITY EDGE reverse read — workflows scoped to this work). ──
  // W5a: the evidence pool, the person registry and the user's zone start NOW (they need only the
  // user) and are awaited once the board's rows are in hand — no serial round trip added.
  const evidencePoolP = roomEvidencePool(client, userId);
  const registryP: Promise<PersonEntity[]> = getPersonEntities(client, userId).catch(() => [] as PersonEntity[]);
  const tzP: Promise<string> = (async () => { try { const { userTimezone } = await import('@/lib/utils/user-time'); return await userTimezone(client, userId); } catch { return 'UTC'; } })();
  const [entRes, ledgerRes, linksRes, turnsRes, filesRes, prodRes] = await Promise.all([
    entityId
      ? client.from('work_entities').select('id, name, tracked, summary, state, next_move, goals, rules, sig, people')
          .eq('id', entityId).eq('user_id', userId).maybeSingle()
      : Promise.resolve({ data: null }),
    entityId ? assembleLedger(client, userId, entityId) : Promise.resolve({ ledger: [] as Array<{ at: string; kind: string; who: string | null; text: string; ref: string }> }),
    entityId
      // Newest links first — the caps below must drop the OLDEST items, never arbitrary ones
      // (an unordered limit made board membership random on big rooms — the no-silent-caps law).
      ? client.from('entity_links').select('item_kind, item_id').eq('user_id', userId).eq('entity_id', entityId)
          .in('item_kind', ['inbox_item', 'commitment']).order('created_at', { ascending: false }).limit(80)
      : Promise.resolve({ data: scope.kind === 'item' ? [{ item_kind: scope.itemKind === 'inbox' ? 'inbox_item' : scope.itemKind, item_id: scope.itemId }] : [] }),
    (async () => {
      try {
        const { readRoomTurns } = await import('@/lib/room/turns');
        return await readRoomTurns(client, userId, roomKey, 10);
      } catch { return []; }
    })(),
    entityId
      ? client.from('knowledge_files').select('id, filename, summary')
          .eq('user_id', userId).eq('entity_id', entityId).order('indexed_at', { ascending: false }).limit(10)
      : Promise.resolve({ data: [] }),
    (async () => {
      if (!entityId) return [] as Array<{ name: string; scheduleLabel: string | null; status: string; lastRunAt: string | null; nextRunAt: string | null }>;
      try {
        const { workflowsScopedToEntity } = await import('@/lib/workflows/entity-edge');
        const scoped = await workflowsScopedToEntity(client, userId, entityId);
        if (!scoped.length) return [];
        const { data: wfs } = await client.from('workflows')
          .select('id, name, status, trigger, last_run_at, next_run_at')
          .in('id', scoped.map((s) => s.workflowId)).eq('user_id', userId);
        return ((wfs ?? []) as Array<{ name: string; status: string; trigger: { label?: string; cron?: string } | null; last_run_at: string | null; next_run_at: string | null }>)
          .map((w) => ({
            name: w.name,
            scheduleLabel: w.trigger?.label ?? (w.trigger?.cron ? `cron ${w.trigger.cron}` : null),
            status: w.status, lastRunAt: w.last_run_at, nextRunAt: w.next_run_at,
          }));
      } catch { return []; }
    })(),
  ]);

  // ── THE BOARD: the room's live items with their judged verbs AND their actual prepared state —
  // the one merge no prior consumer held (the source of every "drafted vs nothing-prepared"
  // contradiction). Same tables the deck and the cards read. ──
  const lrows = (linksRes.data ?? []) as Array<{ item_kind: string; item_id: string }>;
  const allInbox = lrows.filter((l) => l.item_kind === 'inbox_item');
  const allCommit = lrows.filter((l) => l.item_kind === 'commitment');
  const inboxIds = allInbox.map((l) => l.item_id).slice(0, 30);
  const commitIds = allCommit.map((l) => l.item_id).slice(0, 30);
  // No silent caps: what the board omits, the grounding DECLARES (oldest links are the ones cut).
  const boardOmitted = Math.max(0, allInbox.length - 30) + Math.max(0, allCommit.length - 30) + (lrows.length === 80 ? 1 : 0);
  const [inboxRes, commitRes, judgRes] = await Promise.all([
    // A DEED RESOLVES ITS ITEM — so the row that PROVES a settlement is exactly the row a
    // `status='pending'` filter removes (owner walk, Sep 8 — root cause C2a: the thread carrying the
    // user's own sent reply had already been completed by resolve-on-reply, so the ground evidence
    // could never see it). The read is unfiltered and RECENT-ACTIVITY-FIRST; the BOARD still keeps
    // only live work (filtered in code below) — the evidence keeps the rest.
    inboxIds.length
      ? client.from('inbox_items').select('id, work_title, status, source_data, last_activity_at')
          .in('id', inboxIds).eq('user_id', userId)
          .order('last_activity_at', { ascending: false, nullsFirst: false })
      : Promise.resolve({ data: [] }),
    commitIds.length
      ? client.from('commitments').select('id, description, counterparty, due_date, status, direction, thread_id, source, source_id, created_at').in('id', commitIds).eq('user_id', userId).eq('status', 'open')
      : Promise.resolve({ data: [] }),
    (inboxIds.length || commitIds.length)
      ? readPlans(client, userId, 'judgment', { keys: [...inboxIds.map((i) => `inbox:${i}`), ...commitIds.map((i) => `commitment:${i}`)] }).then(asRawResult)
      : Promise.resolve({ data: [] }),
  ]);
  const judgments = new Map<string, { work?: string; reason?: string }>();
  for (const j of (judgRes.data ?? []) as Array<{ entity_id: string; tasks: { verdict?: { work?: string; reason?: string } } }>) {
    if (j.tasks?.verdict) judgments.set(j.entity_id, j.tasks.verdict);
  }
  const board: BoardEntry[] = [];
  // ONE READER PER OBJECT (W2.1): every row's prepared state — inbox source_data AND the pool, for
  // inbox items AND commitments — in one batched read, the same derivation the deck and the machine
  // consume. The rows already in hand ride in (no second inbox query).
  const { preparedStatesFor } = await import('@/lib/prepare/read');
  const inboxRows = (inboxRes.data ?? []) as Array<Record<string, unknown>>;
  const commitRows = (commitRes.data ?? []) as Array<Record<string, unknown>>;
  const [prepStates, evidenceByRef] = await Promise.all([
    preparedStatesFor(client, userId, [
      ...inboxRows.map((it) => ({ kind: 'inbox' as const, id: String(it.id), row: { source_data: it.source_data, last_activity_at: (it.last_activity_at as string | null) ?? null } })),
      ...commitRows.map((c) => ({ kind: 'commitment' as const, id: String(c.id) })),
    ]),
    // ── LATER EVIDENCE per board item (W5a): the W3.1 nominator's pure match over the per-user pool,
    // counterparties resolved by ADDRESS (the registry · the thread's sender · the meeting's
    // attendees — never a name guess). Bounded: one pool, one registry, ≤4 batched reads. ──
    (async (): Promise<Map<string, string[]>> => {
      const out = new Map<string, string[]>();
      try {
        const [pool, registry, tz] = await Promise.all([evidencePoolP, registryP, tzP]);
        const nowISO = new Date().toISOString();
        const horizon = new Date(Date.now() + ROOM_EVIDENCE_CAL_HORIZON_DAYS * 86_400_000).toISOString();
        const bounded: EvidencePool = { ...pool, events: pool.events.filter((e) => e.at <= horizon) };
        const addresses = commitRows.length
          ? await resolveCommitmentAddresses(client, userId, commitRows.map((c) => ({
              id: String(c.id), counterparty: (c.counterparty as string | null) ?? null, thread_id: (c.thread_id as string | null) ?? null,
              source: (c.source as string | null) ?? null, source_id: (c.source_id as string | null) ?? null,
            })), registry)
          : new Map<string, string | null>();
        for (const c of commitRows) {
          const ev = matchEvidence(bounded, {
            kind: 'commitment', id: String(c.id), afterISO: String(c.created_at ?? ''),
            counterpartyEmail: addresses.get(String(c.id)) ?? null, threadId: (c.thread_id as string | null) ?? null,
            fulfiller: String(c.direction ?? '') === 'awaiting' ? 'counterparty' : 'user', description: String(c.description ?? ''),
          }, nowISO, SETTLE_MATCH);
          if (ev.length) out.set(`commit:${String(c.id)}`, evidenceLinesOf(ev, tz));
        }
        for (const it of inboxRows) {
          const sd = (it.source_data ?? {}) as Record<string, unknown>;
          const from = typeof sd.from_address === 'string' && sd.from_address ? normalizeEmail(sd.from_address) : null;
          const ev = matchEvidence(bounded, {
            kind: 'inbox', id: String(it.id), afterISO: String(it.last_activity_at ?? sd.received_at ?? ''),
            counterpartyEmail: from, threadId: (sd.thread_id as string | null) ?? null, fulfiller: 'user',
            description: String(it.work_title ?? sd.subject ?? ''),
          }, nowISO, SETTLE_MATCH);
          if (ev.length) out.set(`inbox:${String(it.id)}`, evidenceLinesOf(ev, tz));
        }
      } catch { /* evidence is an enhancement of the page, never a blocker */ }
      return out;
    })(),
  ]);
  // The room's threads + its people — the two handles THE GROUND EVIDENCE needs (gathered as the
  // board is built, so the evidence read costs no extra pass over the same rows).
  const threadRefs: Array<{ title: string; threadId: string | null }> = [];
  const participants: string[] = [];
  for (const it of inboxRows) {
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    const prep = preparedWordsOf(prepStates.get(`inbox:${String(it.id)}`)!);
    threadRefs.push({
      title: clipLabel(String(it.work_title || sd.subject || 'this thread'), 70),
      threadId: (sd.thread_id as string) ?? null,
    });
    for (const p of [sd.from_name, sd.from_address]) if (typeof p === 'string' && p.trim()) participants.push(p);
    // THE BOARD IS LIVE WORK ONLY — a resolved item contributed its evidence above and stops here.
    if (String(it.status ?? 'pending') !== 'pending') continue;
    const j = judgments.get(`inbox:${String(it.id)}`);
    // The item's own documents — read from the same stored records the Files tab renders. No
    // extraction here (the board is a fast read): what has text speaks its gist, what does not is
    // still NAMED, because the name alone already forbids "they never sent it".
    const attachments = await (async () => {
      try {
        const { readItemAttachments, attachmentFactLines } = await import('@/lib/inbox/attachment-context');
        return attachmentFactLines(await readItemAttachments(client, userId, sd, String(it.id)));
      } catch { return [] as string[]; }
    })();
    board.push({
      ref: `inbox:${String(it.id)}`, id: String(it.id), kind: 'inbox',
      title: clipLabel(String(it.work_title || sd.subject || 'Email'), 90),
      who: (sd.from_name as string) || (sd.from_address as string) || null,
      due: ((sd.understanding as { deadline?: string } | undefined)?.deadline) ?? null,
      judgedWork: j?.work ?? null, judgedReason: j?.reason ? clipLabel(j.reason, 120) : null,
      prepared: prep.list, expired: prep.expired, withdrawn: prep.withdrawn, preparedBy: prep.by, attachments,
      evidence: evidenceByRef.get(`inbox:${String(it.id)}`) ?? [],
    });
  }
  for (const c of commitRows) {
    const j = judgments.get(`commitment:${String(c.id)}`);
    // A COMMITMENT'S PREPARED WORK LIVES IN THE POOL — the board read `[]` here for months, so a
    // pooled nudge, deliverable or invite on a commitment was structurally invisible to reasoners.
    const cprep = preparedWordsOf(prepStates.get(`commitment:${String(c.id)}`)!);
    board.push({
      ref: `commit:${String(c.id)}`, id: String(c.id), kind: 'commitment',
      title: clipLabel(String(c.description ?? ''), 90),
      who: (c.counterparty as string) ?? null,
      due: (c.due_date as string) ?? null,
      judgedWork: j?.work ?? null, judgedReason: j?.reason ? clipLabel(j.reason, 120) : null,
      prepared: cprep.list, expired: cprep.expired, withdrawn: cprep.withdrawn, preparedBy: cprep.by, attachments: [],
      evidence: evidenceByRef.get(`commit:${String(c.id)}`) ?? [],
    });
    if (typeof c.counterparty === 'string' && c.counterparty.trim()) participants.push(c.counterparty);
  }

  // ── THE GROUND EVIDENCE: the world's own record, read as facts (see lib/room/ground-evidence.ts).
  // Gathered here so EVERY reasoned call in room scope inherits it at once — the responder, the
  // chat's question path, the agent loop — which is the whole promise of the one grounding. ──
  const entPeople = Array.isArray((entRes.data as Record<string, unknown> | null)?.people)
    ? ((entRes.data as Record<string, unknown>).people as unknown[]).map(String).filter(Boolean)
    : [];
  const groundEvidence = await (async () => {
    try {
      const { assembleGroundEvidence } = await import('@/lib/room/ground-evidence');
      return await assembleGroundEvidence(client, userId, {
        threads: threadRefs,
        participants: [...participants, ...entPeople].slice(0, 40),
      });
    } catch { return [] as string[]; }
  })();

  // ── Live asks + the transcript (the dialogue read, one renderer). ──
  type TurnRow = { id?: string; key?: string; role: string; text: string; author?: { name?: string } | null; component?: { key?: string; state?: { items?: unknown[]; proceeded?: boolean } } | null; created_at?: string; createdAt?: string };
  const turns = (turnsRes ?? []) as TurnRow[];
  const askOf = (t: TurnRow): RoomGrounding['asks'][number] => ({
    items: (t.component!.state!.items as unknown[]).map(String).filter(Boolean).slice(0, 4),
    since: (t.createdAt ?? t.created_at) ? String(t.createdAt ?? t.created_at).slice(0, 10) : null,
    proceeded: !!t.component?.state?.proceeded,
    // THE EDITOR (plan AJ): the composer reconciles asks against the board — it needs the
    // handle to SETTLE a stale one, not just read it.
    turnId: t.id ? String(t.id) : null,
    key: t.key ? String(t.key) : null,
    who: t.author?.name ? String(t.author.name) : null,
  });
  const isAsk = (t: TurnRow): boolean =>
    t.component?.key === 'input_checklist' && Array.isArray(t.component.state?.items) && !!t.component.state!.items!.length;
  // ONE AGENDA PER ROOM (owner walk, Sep 7): the asks come from THEIR OWN read, not from the
  // transcript's last-N window — a coworker's checklist can stand open for weeks while the
  // conversation moves on, and a windowed read makes the composer blind to a gap the page is
  // still rendering right under its brief. Live turns only (archived_at); pre-migration falls
  // back to the window, which is the behaviour this replaces.
  const asks: RoomGrounding['asks'] = await (async () => {
    try {
      let { data, error } = await client.from('room_turns')
        .select('id, text, component, author, created_at, dedupe_key')
        .eq('user_id', userId).eq('room_key', roomKey).not('component', 'is', null)
        .is('archived_at', null).order('created_at', { ascending: false }).limit(40);
      if (error) return turns.filter(isAsk).map(askOf);
      const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        id: r.id as string, role: 'system', text: String(r.text ?? ''),
        component: r.component as TurnRow['component'], author: r.author as TurnRow['author'],
        created_at: r.created_at as string, key: (r.dedupe_key as string | null) ?? undefined,
      })) as TurnRow[];
      return rows.filter(isAsk).map(askOf).reverse().slice(0, 6);
    } catch { return turns.filter(isAsk).map(askOf); }
  })();
  // W5c · THE NARRATION FOLLOWS ITS ARTIFACT, INTO THE MIND TOO: a `prep:*` narration ("Clara
  // prepared the calendar invite — review it and approve to send") whose item holds NO live artifact
  // on the board is a claim no card renders — the rail folds it, and the composer must not read it
  // as the present either (found live, Sep 23: the brief said "I've prepared a calendar invite"
  // beside a hidden out-of-window invite). The record keeps the turn; the page just doesn't speak it.
  const unbackedPrep = (t: TurnRow): boolean => {
    const m = /^prep:((?:commit|inbox):.+)$/.exec(String(t.key ?? ''));
    if (!m) return false;
    const entry = board.find((b) => b.ref === m[1]);
    return !!entry && entry.prepared.length === 0;
  };
  const transcript = turns.filter((t) => !unbackedPrep(t)).slice(-8).map((t) => {
    const who = t.role === 'user' ? 'user' : t.author?.name ? t.author.name.split(' ')[0] : 'assistant';
    return `[${who}] ${clipForPrompt(String(t.text).replace(/\s+/g, ' '), 180)}`;
  }).join('\n');

  // ── The entity view + the ONE rendered page. ──
  const ent = entRes.data as Record<string, unknown> | null;
  const st = ((ent?.state ?? {}) as { summary?: string; momentum?: string; blocking?: string | null; whoOwes?: { you?: string[]; them?: string[] } });
  const nm = ((ent?.next_move ?? null) as { title?: string; entityRef?: string | null } | null);
  const entity: RoomGrounding['entity'] = ent ? {
    id: String(ent.id), name: String(ent.name), tracked: !!ent.tracked,
    summary: st.summary ?? (ent.summary as string | null) ?? null,
    momentum: st.momentum ?? null,
    blocking: (typeof st.blocking === 'string' && st.blocking.trim()) ? st.blocking.trim() : null,
    whoOwesYou: Array.isArray(st.whoOwes?.you) ? st.whoOwes!.you!.slice(0, 3) : [],
    whoOwesThem: Array.isArray(st.whoOwes?.them) ? st.whoOwes!.them!.slice(0, 3) : [],
    nextMove: nm?.title ? { title: nm.title, ref: nm.entityRef ?? null } : null,
    goals: Array.isArray(ent.goals) ? (ent.goals as string[]) : [],
    rules: Array.isArray(ent.rules) ? (ent.rules as string[]) : [],
    sig: (ent.sig as string) ?? null,
  } : null;

  const ledger = (ledgerRes as { ledger: Array<{ at: string; kind: string; who: string | null; text: string; ref: string }> }).ledger ?? [];
  const ledgerRefs = new Map<string, { label: string; href: string | null }>();
  const ledgerLines = ledger.slice(0, 22).map((l, i) => {
    const id = `L${i + 1}`;
    ledgerRefs.set(id, { label: clipLabel(l.text, 60), href: hrefOfRef(l.ref) });
    // THE WATERMARK SURVIVES THE CLIP (Sep 8, found on the served page as `[L8] … — NOW (20`): the
    // NOW clause is appended LAST, so a fixed head-cut ate it on the longest — most consequential —
    // lines, and every reasoner reading this page went on demanding a settled deed. ONE clipper
    // (lib/inbox/thread-now.ts) keeps the clause whole and yields the head instead.
    return `[${id}] ${(l.at || '').slice(0, 10)} · ${l.kind}${l.who ? ` · ${l.who}` : ''}: ${clipLedgerLine(l.text, 200)}`;
  });

  const fileLines = ((filesRes.data ?? []) as Array<{ id: string; filename: string; summary: string | null }>).map((f, i) => {
    const id = `F${i + 1}`;
    ledgerRefs.set(id, { label: f.filename, href: null });
    return `[${id}] ${f.filename}${f.summary ? ` — ${clipForPrompt(String(f.summary), 100)}` : ''}`;
  });

  const boardLines = board.map((b) =>
    `- [${b.ref}] (${b.kind}) "${b.title}"${b.who ? ` · with ${b.who}` : ''}${b.due ? ` · due ${b.due}` : ''}` +
    `${b.judgedWork ? ` · judged: ${b.judgedWork}` : ' · not yet judged'}` +
    `${b.prepared.length ? ` · PREPARED: ${b.prepared.join(' + ')}${b.preparedBy ? ` (by ${b.preparedBy})` : ''}` : ' · nothing prepared yet'}` +
    // TIME TRUTH: a past-time invite is stated as expired on the line itself — never "prepared".
    `${b.expired.length ? ` · EXPIRED (not ready): ${b.expired.join(' + ')}` : ''}` +
    // W5c: a hidden artifact is stated WITHDRAWN — the team re-prepares it; nothing about it is ready.
    `${b.withdrawn.length ? ` · WITHDRAWN (not ready — we are re-preparing it; never say it is prepared, below, or ready): ${b.withdrawn.join(' + ')}` : ''}` +
    // The documents that came WITH the item, with their direction stated on the line itself.
    `${b.attachments.length ? `\n  · ATTACHED TO IT (${b.who ? `${b.who} sent these TO the user` : 'sent TO the user'} — received and stored): ${b.attachments.join(' | ')}` : ''}` +
    // W5a: the user's own record AFTER the item, with this counterparty — on the line itself, so no
    // reader can consume the judged verb without the deed that may have settled it.
    `${b.evidence.length ? `\n  · LATER EVIDENCE: ${b.evidence.join(' | ')}` : ''}`);

  const body = [
    entity ? `THE WORK: "${entity.name}"${entity.tracked ? ' (a tracked project)' : ' (recognized, untracked)'}` : `THE WORK: a standalone item`,
    entity?.summary ? `WHERE IT STANDS: ${entity.summary}${entity.momentum ? ` [${entity.momentum}]` : ''}` : null,
    // The blocker sits with the position it belongs to — the composer speaks it INSIDE the position,
    // never as a second alarm (the standalone amber block died with the right pane).
    entity?.blocking ? `WATCH-OUT (what is blocking this work right now): ${clipForPrompt(entity.blocking, 300)}` : null,
    entity?.whoOwesYou.length ? `THE USER OWES: ${entity.whoOwesYou.join('; ')}` : null,
    entity?.whoOwesThem.length ? `OWED TO THE USER: ${entity.whoOwesThem.join('; ')}` : null,
    entity?.nextMove ? `THE SYNTHESIZED NEXT MOVE: ${entity.nextMove.title}` : null,
    entity?.goals.length ? `GOALS: ${entity.goals.join(' · ')}` : null,
    entity?.rules.length ? `RULES: ${entity.rules.join(' · ')}` : null,
    board.length ? `THE LIVE BOARD (each item: judged work + what is ACTUALLY prepared — these are the only truths about preparedness).\nA document listed as ATTACHED TO IT is IN OUR POSSESSION and was sent to the user BY the counterparty: never say it is missing or was not received, never ask for it to be resent, and never propose sending the counterparty their own document back.\n${board.some((b) => b.evidence.length) ? `${BOARD_EVIDENCE_RULE}\n` : ''}${boardLines.join('\n')}${boardOmitted ? `\n(NOTE: ~${boardOmitted} older linked item${boardOmitted === 1 ? '' : 's'} not shown — never claim this list is everything.)` : ''}` : null,
    // THE GROUND WINS: the world's record sits DIRECTLY UNDER the board it may contradict, so no
    // reader can consume the judged verbs without also reading what has actually happened since —
    // and so it survives every clip a consumer applies to the tail of this page.
    renderGroundEvidence(groundEvidence),
    prodRes.length ? `STANDING PRODUCTION (scheduled workflows serving this work — deliverables arrive on their own; never propose building what already runs):\n${prodRes.map((w) => `- "${w.name}"${w.scheduleLabel ? ` — ${w.scheduleLabel}` : ''}${w.status !== 'active' ? ` [${w.status}]` : ''}${w.lastRunAt ? ` · last ran ${String(w.lastRunAt).slice(0, 10)}` : ' · never run yet'}${w.nextRunAt ? ` · next ${String(w.nextRunAt).slice(0, 10)}` : ''}`).join('\n')}` : null,
    asks.length ? `OPEN ASKS TO THE USER (each one is STANDING on the page under your brief — an ask you walk past is a second voice):\n${asks.map((a) => `- ${askAttribution(a.who, speaker)}, since ${a.since ?? '?'}${a.proceeded ? ' (user said go ahead)' : ''}: ${a.items.join('; ')}`).join('\n')}` : null,
    ledgerLines.length ? `HISTORY (newest first, reference as [L#]):\n${ledgerLines.join('\n')}` : null,
    fileLines.length ? `FILES on this work (reference as [F#]):\n${fileLines.join('\n')}` : null,
    transcript ? `THE CONVERSATION (recent turns):\n${transcript}` : null,
  ].filter(Boolean).join('\n\n');
  // THE EXCERPT-HONESTY LAW rides the page's HEAD (W2.7): a clipped line carries the mark, and the
  // page declares the rule ABOVE everything — so no consumer's tail-cut of this page can strip it.
  const text = body.includes(EXCERPT_MARK) ? `(${EXCERPT_RULE})\n\n${body}` : body;

  return { roomKey, entity, board, asks, groundEvidence, transcript, ledgerRefs, text };
}
