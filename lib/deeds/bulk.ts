// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE BULK DEED (docs/attention-plan.md, law A7) — the deed half of Wave 2.
//
// A7, in the constitution's own words: "Each ledger class carries its natural verb on the row …
// the confirmation is a BULK-DEED CARD IN THE THREAD (a member of the message grammar): what will
// happen, to how many, the undo note, ONE COMMIT DOOR. Floors: trash, never delete; the honest
// unsubscribe subset; every bulk deed is undoable and logged; parity — the same deed is sayable in
// the composer and routes through the same door."
//
// FIVE PROPERTIES, each structural rather than promised:
//
//   1 · THE PREVIEW IS A STORED FACT, NEVER CLIENT STATE. `prepareBulkDeed` derives the member set
//       ONCE, computes the breakdown ONCE, and persists both (item_plans kind 'bulk_deed'). The
//       card renders that row; the commit acts on that row. What was counted is what is done — a
//       ledger that shifted between the preview and the click cannot change the deed under the user.
//
//   2 · ONE COMMIT DOOR. There is no exported executor that acts on items without a deed row:
//       `commitBulkDeed(client, userId, deedId)` is the only way anything happens, and the routes
//       are thin wrappers over it. (Gate BD1 asserts this on source.)
//
//   3 · EXACTLY-ONCE. The commit claims the row atomically (`tasks->>committedAt is null`); a second
//       commit — a double click, a retried request — returns the FIRST result rather than acting
//       twice. The claim is taken BEFORE the work, the commit-door idiom: a crash mid-deed leaves a
//       committed row with a partial outcome list, which is the honest record, never a silent replay.
//
//   4 · THE DEEDS GO THROUGH THE EXISTING DOORS. Archive and trash resolve the inbox item through
//       `executeResolveInboxItem` — the SAME door the deck's Dismiss uses — so the resolution
//       stamps `resolved_at`, settles the item's asks, reconciles the mailbox label and writes the
//       `dismissed` activity row that `/api/restore` already knows how to reverse. Expire goes
//       through the expiry law's own `judgeCommitmentExpiry` → `applyExpiryVerdict`: if the verdict
//       is not `expired`, the commitment is SKIPPED AND COUNTED, never forced. No raw status write
//       to `commitments` exists in this module.
//
//   5 · TRASH, NEVER DELETE. The mailbox floor: `trashGmailThread` / `trashOutlookMessage` move a
//       message to the provider's own Trash, which the user can undo in their mailbox. There is no
//       permanent-delete primitive anywhere in `lib/deeds/` and no `.delete()` against `emails` or
//       any provider message. (Gate BD2 asserts this on source.)
//
// W8.6 · THE WHOLE GROUP (stabilization, Sep 23). "Archive the newest 200 of 1,223" was honest, and
// it was still a deed that stopped at 200. An archive/trash deed now acts on its WHOLE group (to the
// stated safety bound `MAX_DEED_ITEMS`, 5,000 — past it the label says so), and the ONE commit door
// walks the stored member list IN PAGES of `DEED_PAGE_SIZE`:
//   • the first commit is the same atomic claim (committedAt null → set); every later run of the same
//     deed takes a RUN LEASE by compare-and-set on (lease expired, cursor unchanged) — one runner at a
//     time, never two walking one page;
//   • progress (cursor, outcomes, what is left, why a run stopped) is persisted after EVERY page, so a
//     stopped run resumes where it stopped and a failed page reports what was done vs left;
//   • per item, the door acts only on a row that is still pending — a page re-walked after a crash
//     recognises its own finished work (same resolution reason, resolved after this deed's claim)
//     and never acts twice;
//   • ONE activity record per deed (type `bulk_deed`, updated in place as pages land) that
//     `/api/restore` reverses AS ONE: `undoBulkDeed` reopens every member this deed resolved (a
//     conditional, exactly-once claim on `undoneAt`). Unsubscribe logs as `bulk_unsubscribe` — it is
//     the sender's to reverse, so it carries no Undo — and keeps its own one-page bound (external
//     links, per sender); expire keeps one page too (one judged pass per member).
//
// THE ONE PLACE THIS MODULE REASONS: the `expire` verb, because the expiry law is reasoned by
// design ("a past due date NOMINATES; one cheap judged pass DISPOSES"). Every other verb is
// deterministic end to end, and both routes are zero-AI plumbing.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { randomUUID } from 'crypto';
import { executeResolveInboxItem } from '@/lib/tools/item-actions';
import { isPastDue, judgeCommitmentExpiry, applyExpiryVerdict } from '@/lib/commitments/expiry';
import { archiveGmailThread, trashGmailThread, sendGmailEmail } from '@/lib/google/gmail';
import { archiveOutlookMessage, trashOutlookMessage, sendOutlookEmail, persistOutlookTokens } from '@/lib/microsoft/outlook';
import { HELD_CLASSES, type HeldClassId } from '@/lib/home/attention';
import { logActivity } from '@/lib/activity/log';
import { reopenInboxItems, reopenCommitment } from '@/lib/activity/reopen';
import { updatePlan } from '@/lib/store/item-plans';
import { resolveMailTarget, subjectOf, type InboxItemRow } from './mail-target';
import { readUnsubscribeHeaders } from './mail-headers';
import {
  parseUnsubscribe, fireOneClickUnsubscribe, UNSUBSCRIBE_MAIL_SUBJECT, UNSUBSCRIBE_MAIL_BODY,
} from './unsubscribe';
import { deriveHeldMembers } from './held-members';
// THE WORDS live apart (client-safe, pure) — see `lib/deeds/words.ts`. The engine re-exports them so
// a server caller has ONE import, while the card can reach the composers without the server graph.
import {
  BULK_VERBS, BULK_DEED_KIND, MAX_UNSUBSCRIBE_HEADER_READS, DEED_PAGE_SIZE,
  composeIntro, composeUndoNote, tallyLine, deedBoundFor, deedComplete,
  type BulkVerb, type BulkDeed, type DeedItemRef, type BulkBreakdown,
  type DeedOutcome, type DeedOutcomeStatus, type DeedProgress,
} from './words';

export * from './words';

/* eslint-disable @typescript-eslint/no-explicit-any */
type DBClient = any;

/** One run's wall clock through the commit door — inside the route's 300s, with room to record. */
export const DEED_RUN_BUDGET_MS = 200_000;
/** The run lease: long enough for one page, short enough that a killed run frees the deed soon. */
export const DEED_LEASE_MS = 5 * 60_000;
/** Members acted on at once inside a page (a provider move + the resolve door each) — polite. */
export const DEED_ITEM_CONCURRENCY = 4;
/** A released lease — an ISO instant every `lt(now)` compare passes. */
const LEASE_FREE = '1970-01-01T00:00:00.000Z';
/** Ids per `.in()` read — a 5,000-id list is chunked, never one giant URL. */
const IN_CHUNK = 200;

/** Read rows by id in chunks (a whole-group id list never rides one `.in()`); errors are checked. */
async function readByIdsChunked<T>(ids: string[], read: (chunk: string[]) => Promise<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await read(ids.slice(i, i + IN_CHUNK));
    if (error) throw new Error('the members could not be read');
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

// ── PREPARE ─────────────────────────────────────────────────────────────────────────────────────

export type PrepareArgs = {
  verb: BulkVerb;
  /** Name a held class and the deed takes its whole membership (the spoken door's shape). */
  classKey?: HeldClassId | null;
  /** …or hand the exact ids (the ledger's own select-all / per-item picking). */
  itemIds?: string[];
  /** The user's own address — only used to skip self-attendance in the calendar adjacency fact. */
  selfEmail?: string | null;
};

export type PrepareResult = { ok: true; deed: BulkDeed } | { ok: false; error: string };

/** Which verbs a NAMED CLASS may carry. The class's own declared deed, plus the two reversible
 *  mail deeds that apply to any held mail. `expire` is absent by construction: commitments are
 *  never held (the ledger's pool excludes `source='commitment'`), so a class can never hold one. */
function verbsForClass(cls: HeldClassId): BulkVerb[] {
  const declared = HELD_CLASSES[cls].deed;
  const base: BulkVerb[] = ['archive', 'trash'];
  return (BULK_VERBS as readonly string[]).includes(declared) && !base.includes(declared as BulkVerb)
    ? [declared as BulkVerb, ...base]
    : base;
}

export async function prepareBulkDeed(
  client: DBClient, userId: string, args: PrepareArgs,
): Promise<PrepareResult> {
  const verb = args.verb;
  if (!(BULK_VERBS as readonly string[]).includes(verb)) return { ok: false, error: `unknown deed "${String(verb)}"` };

  const classKey = args.classKey ?? null;
  if (classKey && !HELD_CLASSES[classKey]) return { ok: false, error: `unknown ledger class "${classKey}"` };
  if (classKey && !verbsForClass(classKey).includes(verb)) {
    return {
      ok: false,
      error: `"${HELD_CLASSES[classKey].label}" cannot be ${verb}d — it carries ${verbsForClass(classKey).join(', ')}`,
    };
  }
  if (!classKey && !(args.itemIds ?? []).length) return { ok: false, error: 'a bulk deed needs a class or a list of items' };

  // W8.6 · THE WHOLE GROUP, to the verb's own stated bound (archive/trash: MAX_DEED_ITEMS; the
  // external/reasoned verbs: one page). The label law reads the SAME `deedBoundFor`.
  const bound = deedBoundFor(verb);

  // ── THE MEMBER SET ────────────────────────────────────────────────────────────────────────────
  let items: DeedItemRef[] = [];
  let rows: InboxItemRow[] = [];

  try {
    if (verb === 'expire') {
      if (classKey) return { ok: false, error: 'commitments are never held in the ledger — name the commitments to close' };
      const ids = [...new Set((args.itemIds ?? []).map(String))].slice(0, bound);
      const data = await readByIdsChunked<any>(ids, (chunk) => client.from('commitments')
        .select('id, description, due_date, direction, counterparty, source, created_at, status')
        .eq('user_id', userId).in('id', chunk).eq('status', 'open'));
      const today = new Date().toISOString().slice(0, 10);
      items = data.map((c) => ({
        itemId: String(c.id),
        subject: String(c.description ?? '(no description)').slice(0, 120),
        pastDue: isPastDue(c, today),
      }));
    } else {
      if (classKey) {
        // The class's members in the ledger's own newest-first order — the WHOLE group to the bound.
        const byClass = await deriveHeldMembers(client, userId, args.selfEmail ?? null);
        rows = (byClass.get(classKey) ?? []).slice(0, bound).map((m) => ({
          id: m.id, source_data: m.source_data, work_title: m.work_title,
        }));
      } else {
        const ids = [...new Set((args.itemIds ?? []).map(String))].slice(0, bound);
        // USER-SCOPED VALIDATION: a caller's id list can only ever reach this user's own pending rows.
        rows = await readByIdsChunked<InboxItemRow>(ids, (chunk) => client.from('inbox_items')
          .select('id, user_id, connection_id, work_title, source_data')
          .eq('user_id', userId).eq('status', 'pending').in('id', chunk));
      }
      items = rows.map((r) => ({ itemId: String(r.id), subject: subjectOf(r) }));
    }
  } catch {
    return { ok: false, error: 'the members could not be read — nothing was prepared' };
  }

  if (!items.length) return { ok: false, error: 'nothing to act on — that set is empty' };

  // ── THE BREAKDOWN, computed BEFORE the commit (A7: "the preview card states it before commit") ─
  const breakdown: BulkBreakdown = { total: items.length };

  if (verb === 'archive' || verb === 'trash') {
    // ONE PAGE of mailbox targets is read for the preview; the rest are REPORTED as checked when
    // their page runs (`unchecked`) — a 5,000-row preview must not cost 5,000 target reads.
    let withMailbox = 0;
    const checked = rows.slice(0, DEED_PAGE_SIZE);
    for (const r of checked) {
      const t = await resolveMailTarget(client, userId, r);
      if (t) withMailbox++;
    }
    breakdown.withMailbox = withMailbox;
    breakdown.noMailbox = checked.length - withMailbox;
    if (rows.length > checked.length) breakdown.unchecked = rows.length - checked.length;
  } else if (verb === 'unsubscribe') {
    let oneClick = 0, mailto = 0, needsClick = 0, none = 0, unread = 0;
    for (let i = 0; i < rows.length; i++) {
      if (i >= MAX_UNSUBSCRIBE_HEADER_READS) { unread++; continue; }
      const target = await resolveMailTarget(client, userId, rows[i]);
      if (!target) { none++; items[i].lane = 'none'; continue; }
      const headers = await readUnsubscribeHeaders(client, target);
      const t = parseUnsubscribe(headers.listUnsubscribe, headers.listUnsubscribePost);
      items[i].lane = t.lane;
      if (t.url) items[i].url = t.url;
      if (t.mailto) items[i].mailto = t.mailto;
      if (t.mailtoSubject) items[i].mailtoSubject = t.mailtoSubject;
      if (t.lane === 'one_click') oneClick++;
      else if (t.lane === 'mailto') mailto++;
      else if (t.lane === 'needs_click') needsClick++;
      else none++;
    }
    Object.assign(breakdown, { oneClick, mailto, needsClick, none, unread });
  } else {
    breakdown.pastDue = items.filter((i) => i.pastDue).length;
  }

  const className = classKey ? HELD_CLASSES[classKey].label : null;
  const deed: BulkDeed = {
    id: randomUUID(),
    verb, classKey, className, items, breakdown,
    intro: composeIntro(verb, items.length, className),
    undoNote: composeUndoNote(verb),
    createdAt: new Date().toISOString(),
    committedAt: null,
  };

  const { error } = await client.from('item_plans').insert({
    user_id: userId, kind: BULK_DEED_KIND, entity_id: deed.id, tasks: deed,
  });
  if (error) return { ok: false, error: 'the deed could not be saved — nothing was done' };
  return { ok: true, deed };
}

// ── READ ────────────────────────────────────────────────────────────────────────────────────────

export async function readBulkDeed(
  client: DBClient, userId: string, deedId: string,
): Promise<BulkDeed | null> {
  const { data } = await client.from('item_plans').select('tasks')
    .eq('user_id', userId).eq('kind', BULK_DEED_KIND).eq('entity_id', deedId).maybeSingle();
  return (data?.tasks as BulkDeed | undefined) ?? null;
}

// ── COMMIT ──────────────────────────────────────────────────────────────────────────────────────

export type CommitResult = { ok: true; deed: BulkDeed; alreadyCommitted: boolean } | { ok: false; error: string };

/** W8.6 · the page arithmetic (pure). */
export function deedPages(total: number, pageSize = DEED_PAGE_SIZE): number {
  return total <= 0 ? 0 : Math.ceil(total / Math.max(1, pageSize));
}

/** W8.6 · the progress record for a cursor (pure — the gate asserts its arithmetic). */
export function progressAt(total: number, cursor: number, stoppedBecause: string | null = null, pageSize = DEED_PAGE_SIZE): DeedProgress {
  const c = Math.max(0, Math.min(total, cursor));
  return {
    cursor: c, total,
    pagesDone: deedPages(c, pageSize), pagesTotal: deedPages(total, pageSize),
    left: total - c, complete: c >= total,
    stoppedBecause: c >= total ? null : stoppedBecause,
  };
}

/**
 * THE ONE COMMIT DOOR. Claims the deed atomically, walks its STORED member list page by page
 * (per-item best-effort inside a page), records an outcome per item, and persists the honest
 * progress after EVERY page. A deed larger than one run's budget stops cleanly and RESUMES through
 * this same door (the card calls it again) — never a second path, never a page walked twice.
 *
 * Per-item best-effort is the deed's shape, not a shortcut: one dead list server or one message
 * another device already moved must not abort the other twenty-nine, and every one of those
 * individual truths is recorded rather than averaged into a single "done".
 */
export async function commitBulkDeed(
  client: DBClient, userId: string, deedId: string, opts: { budgetMs?: number } = {},
): Promise<CommitResult> {
  const existing = await readBulkDeed(client, userId, deedId);
  if (!existing) return { ok: false, error: 'that deed is not on file' };

  // EXACTLY-ONCE: a COMPLETE deed (or an undone one) returns its prior result rather than acting again.
  if (deedComplete(existing) || existing.undoneAt) return { ok: true, deed: existing, alreadyCommitted: true };

  const now = new Date();
  const nowIso = now.toISOString();
  const leaseId = randomUUID();
  const leaseUntil = new Date(now.getTime() + DEED_LEASE_MS).toISOString();
  const total = existing.items.length;
  let deed: BulkDeed;

  if (!existing.committedAt) {
    // THE FIRST CLAIM — atomic, conditional on committedAt still being null (the commit-door idiom:
    // claim → fire → record). The run lease is taken in the same write.
    deed = { ...existing, committedAt: nowIso, leaseId, leaseUntil, outcomes: [], progress: progressAt(total, 0) };
    const { data: claimed } = await client.from('item_plans')
      .update({ tasks: deed, updated_at: nowIso })
      .eq('user_id', userId).eq('kind', BULK_DEED_KIND).eq('entity_id', deedId)
      .filter('tasks->>committedAt', 'is', null)
      .select('entity_id');
    if (!claimed || (claimed as unknown[]).length === 0) {
      // Someone else claimed it between the read and the update — theirs is the real result.
      const prior = await readBulkDeed(client, userId, deedId);
      return prior ? { ok: true, deed: prior, alreadyCommitted: true } : { ok: false, error: 'that deed is not on file' };
    }
  } else {
    // THE RESUME CLAIM — a committed deed with members left. Compare-and-set on BOTH the lease (free
    // or expired) and the cursor we read: a runner that is still walking, or one that moved the cursor
    // since our read, wins; we return the record as it stands and act on nothing.
    const cursor = existing.progress?.cursor ?? 0;
    if (existing.leaseUntil && existing.leaseUntil > nowIso) return { ok: true, deed: existing, alreadyCommitted: true };
    deed = { ...existing, leaseId, leaseUntil };
    const resumed = await updatePlan(client, userId, 'bulk_deed', deedId, deed, {
      updatedAt: nowIso,
      where: (q) => q.filter('tasks->>leaseUntil', 'lt', nowIso).filter('tasks->progress->>cursor', 'eq', String(cursor)),
    });
    if (resumed.error || resumed.updated === 0) {
      const prior = await readBulkDeed(client, userId, deedId);
      return prior ? { ok: true, deed: prior, alreadyCommitted: true } : { ok: false, error: 'that deed is not on file' };
    }
  }

  // ── THE PAGE WALK — over the STORED member list, from the stored cursor. ──
  const deadline = Date.now() + (opts.budgetMs ?? DEED_RUN_BUDGET_MS);
  const outcomes: DeedOutcome[] = [...(deed.outcomes ?? [])];
  let cursor = deed.progress?.cursor ?? 0;
  let stoppedBecause: string | null = null;
  while (cursor < total) {
    if (Date.now() > deadline) { stoppedBecause = 'this run’s time was spent — it resumes where it stopped'; break; }
    const page = existing.items.slice(cursor, cursor + DEED_PAGE_SIZE);
    const pageOutcomes = await runPage(client, userId, existing.verb, page, deed.committedAt ?? nowIso);
    outcomes.push(...pageOutcomes);
    cursor += page.length;
    // PERSIST THE PAGE — lease-guarded, so only the runner that holds the deed writes its record.
    deed = { ...deed, outcomes, progress: progressAt(total, cursor), leaseUntil: new Date(Date.now() + DEED_LEASE_MS).toISOString() };
    const saved = await writeDeedGuarded(client, userId, deedId, leaseId, deed);
    if (!saved) { stoppedBecause = 'a page’s record could not be saved — it resumes from the last saved page'; break; }
  }

  // ── THE HONEST TALLY — what was done, and what is left. ──
  const count = (st: DeedOutcomeStatus) => outcomes.filter((o) => o.status === st).length;
  const left = total - cursor;
  const tally = {
    done: count('done'), partial: count('partial'), skipped: count('skipped'), failed: count('failed'),
    left, line: tallyLine(existing.verb, outcomes),
  };
  deed = { ...deed, outcomes, tally, progress: progressAt(total, cursor, stoppedBecause), leaseUntil: LEASE_FREE };

  // THE DEED ITSELF IS LOGGED — ONE record per deed, written on its first run and updated in place as
  // later pages land. `bulk_deed` is reversible AS ONE through /api/restore (undoBulkDeed); an
  // unsubscribe logs as `bulk_unsubscribe` — the sender's to reverse, so it carries no Undo.
  const title = `${existing.intro} ${tally.line}${left ? ` · ${left.toLocaleString('en-US')} left` : ''}`;
  const metadata = { verb: existing.verb, classKey: existing.classKey, ...tally, total, deedId: existing.id };
  if (!deed.loggedAt) {
    const logged = await logActivity(client, userId, {
      type: existing.verb === 'unsubscribe' ? 'bulk_unsubscribe' : 'bulk_deed',
      title,
      entityType: 'bulk_deed',
      entityId: existing.id,
      metadata: { verb: existing.verb, classKey: existing.classKey, ...tally, total, deedId: existing.id },
    });
    if (logged) deed = { ...deed, loggedAt: new Date().toISOString() };
  } else {
    const { error: logErr } = await client.from('activity_events').update({ title: title.slice(0, 500), metadata })
      .eq('user_id', userId).eq('entity_type', 'bulk_deed').eq('entity_id', existing.id);
    if (logErr) console.error('[deeds] the deed’s activity record could not be updated:', logErr.message);
  }

  await writeDeedGuarded(client, userId, deedId, leaseId, deed);
  return { ok: true, deed, alreadyCommitted: false };
}

/** The lease-guarded write: only the runner holding `leaseId` may record the deed's progress. */
async function writeDeedGuarded(client: DBClient, userId: string, deedId: string, leaseId: string, deed: BulkDeed): Promise<boolean> {
  const w = await updatePlan(client, userId, 'bulk_deed', deedId, deed, {
    where: (q) => q.filter('tasks->>leaseId', 'eq', leaseId),
  });
  return !w.error && w.updated > 0;
}

/** One page, per-item best-effort, a few members at once, outcomes in the stored order. */
async function runPage(
  client: DBClient, userId: string, verb: BulkVerb, page: DeedItemRef[], claimedAt: string,
): Promise<DeedOutcome[]> {
  const out: DeedOutcome[] = new Array(page.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= page.length) return;
      out[i] = await runOne(client, userId, verb, page[i], claimedAt);
    }
  };
  // THE WALK IS OVER THE STORED LIST: `page` is a slice of `existing.items`, nothing else.
  await Promise.all(Array.from({ length: Math.min(DEED_ITEM_CONCURRENCY, page.length) || 1 }, worker));
  return out;
}

// ── UNDO (W8.6 · the batch undo — the deed's ONE activity record reverses as one) ────────────────

export type UndoResult =
  | { ok: true; reopened: number; skipped: number; alreadyUndone: boolean }
  | { ok: false; error: string };

/**
 * THE BATCH UNDO. Reverses every member THIS deed resolved, across every page it ran, through THE
 * ONE restore flip (lib/activity/reopen.ts). Exactly once: a conditional claim on `undoneAt`; a
 * second undo is a no-op. A running deed refuses (undo it once it stops — the card says so); an
 * unsubscribe refuses (the sender's to reverse). An undone deed never resumes.
 */
export async function undoBulkDeed(client: DBClient, userId: string, deedId: string): Promise<UndoResult> {
  const deed = await readBulkDeed(client, userId, deedId);
  if (!deed) return { ok: false, error: 'that deed is not on file' };
  if (deed.verb === 'unsubscribe') return { ok: false, error: 'an unsubscribe is the sender’s to reverse — it cannot be undone here' };
  if (!deed.committedAt) return { ok: false, error: 'that deed never ran — there is nothing to undo' };
  if (deed.undoneAt) return { ok: true, reopened: 0, skipped: 0, alreadyUndone: true };
  const nowIso = new Date().toISOString();
  if (deed.leaseUntil && deed.leaseUntil > nowIso) return { ok: false, error: 'that deed is still running — undo it once it stops' };

  const claim = await updatePlan(client, userId, 'bulk_deed', deedId, { ...deed, undoneAt: nowIso }, {
    updatedAt: nowIso, where: (q) => q.filter('tasks->>undoneAt', 'is', null),
  });
  if (claim.error) return { ok: false, error: 'the undo could not be claimed — nothing was changed' };
  if (claim.updated === 0) return { ok: true, reopened: 0, skipped: 0, alreadyUndone: true };

  // Every member the deed acted on, across ALL its pages (done, or done here but not in the mailbox).
  const acted = (deed.outcomes ?? []).filter((o) => o.status === 'done' || o.status === 'partial').map((o) => o.itemId);
  let reopened = 0, skipped = 0;
  if (deed.verb === 'expire') {
    for (const id of acted) {
      const r = await reopenCommitment(client, userId, id, { note: `undo of a bulk deed (${deedId})` });
      if (r.ok) reopened++; else skipped++;
    }
  } else {
    // Only rows still in the state THIS deed left them (its own resolution reason) reopen.
    const r = await reopenInboxItems(client, userId, acted, { onlyReasons: [resolutionReasonFor(deed.verb)] });
    reopened = r.reopened; skipped = r.skipped + r.failed;
  }
  await logActivity(client, userId, {
    type: 'restored', title: `Undid: ${deed.intro} ${reopened.toLocaleString('en-US')} put back`,
    entityType: 'bulk_deed', entityId: deedId, metadata: { reopened, skipped, verb: deed.verb },
  });
  return { ok: true, reopened, skipped, alreadyUndone: false };
}

/** The resolution reason each mail verb stamps through the resolve door — the undo's own filter. */
function resolutionReasonFor(verb: BulkVerb): string {
  return verb === 'trash' ? 'bulk_trashed' : 'bulk_archived';
}

// ── the per-item lanes ──────────────────────────────────────────────────────────────────────────

async function loadItem(client: DBClient, userId: string, itemId: string): Promise<(InboxItemRow & { status?: string }) | null> {
  const { data } = await client.from('inbox_items')
    .select('id, user_id, connection_id, work_title, source_data, status')
    .eq('id', itemId).eq('user_id', userId).maybeSingle();
  return (data as (InboxItemRow & { status?: string }) | null) ?? null;
}

async function runOne(
  client: DBClient, userId: string, verb: BulkVerb, ref: DeedItemRef, claimedAt: string,
): Promise<DeedOutcome> {
  try {
    if (verb === 'expire') return await runExpire(client, userId, ref);
    const item = await loadItem(client, userId, ref.itemId);
    if (!item) return { itemId: ref.itemId, status: 'skipped', note: 'already resolved elsewhere' };
    // W8.6 · EXACTLY ONCE PER MEMBER: the door acts only on a row that is still pending. A page
    // re-walked after a stopped run recognises ITS OWN finished work (this verb's resolution reason,
    // resolved after this deed's claim) and records it as done — the undo then covers it too.
    if (verb !== 'unsubscribe' && item.status && item.status !== 'pending') {
      const sd = (item.source_data ?? {}) as Record<string, unknown>;
      const ours = sd.resolution_reason === resolutionReasonFor(verb)
        && typeof sd.resolved_at === 'string' && sd.resolved_at >= claimedAt;
      return ours
        ? { itemId: ref.itemId, status: 'done', note: 'finished by an earlier run of this deed' }
        : { itemId: ref.itemId, status: 'skipped', note: 'already resolved elsewhere' };
    }
    if (verb === 'archive') return await runArchive(client, userId, item);
    if (verb === 'trash') return await runTrash(client, userId, item);
    return await runUnsubscribe(client, userId, item, ref);
  } catch (e) {
    return { itemId: ref.itemId, status: 'failed', note: e instanceof Error ? e.message : 'unknown failure' };
  }
}

/**
 * ARCHIVE — the in-app resolution through THE EXISTING DOOR, plus the mailbox mirror.
 *
 * The resolution is the deed; the mailbox move is its mirror. A mailbox that refuses (revoked
 * token, a thread already moved) yields `partial` and SAYS SO in the tally — never a silent "done"
 * that leaves thirty messages sitting in an inbox the user was told had been cleared.
 */
async function runArchive(client: DBClient, userId: string, item: InboxItemRow): Promise<DeedOutcome> {
  let mailbox: 'moved' | 'unreachable' | 'none' = 'none';
  const target = await resolveMailTarget(client, userId, item);
  if (target) {
    try {
      if (target.provider === 'gmail') await archiveGmailThread(target.encryptedTokens, target.gmailThreadId!);
      else await archiveOutlookMessage(target.encryptedTokens, target.outlookMessageId!, persistOutlookTokens(client, target.connection));
      mailbox = 'moved';
    } catch { mailbox = 'unreachable'; }
  }

  const res = await executeResolveInboxItem({ client, userId }, {
    itemId: String(item.id), resolution: 'dismiss', resolutionReason: 'bulk_archived',
  });
  if (!res.ok) return { itemId: String(item.id), status: 'failed', note: res.error ?? 'could not be resolved' };
  if (mailbox === 'unreachable') return { itemId: String(item.id), status: 'partial', note: 'cleared here; your mailbox refused the move' };
  return { itemId: String(item.id), status: 'done', note: mailbox === 'none' ? 'cleared here (no mailbox on this item)' : undefined };
}

/**
 * TRASH — the mailbox move IS the deed, so a refusal is a FAILURE and the item stays pending.
 * Resolving in-app after a failed move would hide a message that is still sitting in the inbox.
 *
 * THE FLOOR: `trashGmailThread` / `trashOutlookMessage` move to the provider's own Trash. Nothing
 * in `lib/deeds/` deletes anything, from any provider, ever.
 */
async function runTrash(client: DBClient, userId: string, item: InboxItemRow): Promise<DeedOutcome> {
  const target = await resolveMailTarget(client, userId, item);
  if (!target) return { itemId: String(item.id), status: 'skipped', note: 'no mailbox on this item' };
  try {
    if (target.provider === 'gmail') await trashGmailThread(target.encryptedTokens, target.gmailThreadId!);
    else await trashOutlookMessage(target.encryptedTokens, target.outlookMessageId!, persistOutlookTokens(client, target.connection));
  } catch (e) {
    return { itemId: String(item.id), status: 'failed', note: e instanceof Error ? e.message : 'your mailbox refused the move' };
  }
  const res = await executeResolveInboxItem({ client, userId }, {
    itemId: String(item.id), resolution: 'dismiss', resolutionReason: 'bulk_trashed',
  });
  return res.ok
    ? { itemId: String(item.id), status: 'done' }
    : { itemId: String(item.id), status: 'partial', note: 'moved to trash; the item could not be cleared here' };
}

/**
 * UNSUBSCRIBE — the honest subset, acting on the lane the PREVIEW already declared.
 *
 * The lane is read from the stored deed, not re-derived: the user approved a card that said
 * "9 automatic · 3 need a click", and the commit must not quietly promote one of those three.
 */
async function runUnsubscribe(
  client: DBClient, userId: string, item: InboxItemRow, ref: DeedItemRef,
): Promise<DeedOutcome> {
  const id = String(item.id);
  if (ref.lane === 'needs_click') {
    return { itemId: id, status: 'skipped', note: `needs a click from you: ${ref.url ?? 'the sender\'s page'}` };
  }
  if (ref.lane === 'one_click') {
    if (!ref.url) return { itemId: id, status: 'failed', note: 'the one-click URL was lost' };
    const r = await fireOneClickUnsubscribe(ref.url);
    return r.ok ? { itemId: id, status: 'done' } : { itemId: id, status: 'failed', note: r.error };
  }
  if (ref.lane === 'mailto') {
    if (!ref.mailto) return { itemId: id, status: 'failed', note: 'the unsubscribe address was lost' };
    const target = await resolveMailTarget(client, userId, item);
    if (!target) return { itemId: id, status: 'skipped', note: 'no mailbox to send the request from' };
    try {
      // AS THE USER, from their OWN mailbox — the sender's list software reads the From address, so
      // a request from anyone else unsubscribes nobody.
      const subject = ref.mailtoSubject || UNSUBSCRIBE_MAIL_SUBJECT;
      if (target.provider === 'gmail') {
        await sendGmailEmail({ encryptedTokens: target.encryptedTokens, to: ref.mailto, subject, body: UNSUBSCRIBE_MAIL_BODY });
      } else {
        await sendOutlookEmail({ encryptedTokens: target.encryptedTokens, to: ref.mailto, subject, body: UNSUBSCRIBE_MAIL_BODY });
      }
      return { itemId: id, status: 'done' };
    } catch (e) {
      return { itemId: id, status: 'failed', note: e instanceof Error ? e.message : 'the request could not be sent' };
    }
  }
  return { itemId: id, status: 'skipped', note: 'this sender offers no unsubscribe' };
}

/**
 * EXPIRE — commitments only, through the expiry law's OWN judged, undoable close.
 *
 * `judgeCommitmentExpiry` decides; `applyExpiryVerdict` acts ONLY on `expired` and writes the
 * `commitment_expired` activity row that `/api/restore` reverses. A `still_owed` or `unclear`
 * verdict is a SKIP with the judge's own reason attached — this module never forces a close, and
 * contains no write to `commitments` of its own.
 */
async function runExpire(client: DBClient, userId: string, ref: DeedItemRef): Promise<DeedOutcome> {
  const { data: c } = await client.from('commitments')
    .select('id, description, due_date, direction, counterparty, source, created_at, status')
    .eq('id', ref.itemId).eq('user_id', userId).maybeSingle();
  if (!c) return { itemId: ref.itemId, status: 'skipped', note: 'already resolved elsewhere' };
  if (c.status !== 'open') return { itemId: ref.itemId, status: 'skipped', note: 'already closed' };

  const today = new Date().toISOString().slice(0, 10);
  if (!isPastDue(c, today)) return { itemId: ref.itemId, status: 'skipped', note: 'not past due' };

  const verdict = await judgeCommitmentExpiry(client, userId, c, today);
  if (verdict.verdict !== 'expired') {
    return { itemId: ref.itemId, status: 'skipped', note: verdict.reason || `judged ${verdict.verdict}` };
  }
  const applied = await applyExpiryVerdict(client, userId, c, verdict);
  return applied
    ? { itemId: ref.itemId, status: 'done', note: verdict.reason || undefined }
    : { itemId: ref.itemId, status: 'failed', note: 'the expiry door refused the close' };
}
