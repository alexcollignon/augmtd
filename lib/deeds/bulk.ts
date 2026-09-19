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
import { resolveMailTarget, subjectOf, type InboxItemRow } from './mail-target';
import { readUnsubscribeHeaders } from './mail-headers';
import {
  parseUnsubscribe, fireOneClickUnsubscribe, UNSUBSCRIBE_MAIL_SUBJECT, UNSUBSCRIBE_MAIL_BODY,
} from './unsubscribe';
import { deriveHeldMembers } from './held-members';
// THE WORDS live apart (client-safe, pure) — see `lib/deeds/words.ts`. The engine re-exports them so
// a server caller has ONE import, while the card can reach the composers without the server graph.
import {
  BULK_VERBS, BULK_DEED_KIND, MAX_DEED_ITEMS, MAX_UNSUBSCRIBE_HEADER_READS,
  composeIntro, composeUndoNote, tallyLine,
  type BulkVerb, type BulkDeed, type DeedItemRef, type BulkBreakdown,
  type DeedOutcome, type DeedOutcomeStatus,
} from './words';

export * from './words';

/* eslint-disable @typescript-eslint/no-explicit-any */
type DBClient = any;

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

  // ── THE MEMBER SET ────────────────────────────────────────────────────────────────────────────
  let items: DeedItemRef[] = [];
  let rows: InboxItemRow[] = [];

  if (verb === 'expire') {
    if (classKey) return { ok: false, error: 'commitments are never held in the ledger — name the commitments to close' };
    const ids = [...new Set((args.itemIds ?? []).map(String))].slice(0, MAX_DEED_ITEMS);
    const { data } = await client.from('commitments')
      .select('id, description, due_date, direction, counterparty, source, created_at, status')
      .eq('user_id', userId).in('id', ids).eq('status', 'open');
    const today = new Date().toISOString().slice(0, 10);
    items = ((data ?? []) as any[]).map((c) => ({
      itemId: String(c.id),
      subject: String(c.description ?? '(no description)').slice(0, 120),
      pastDue: isPastDue(c, today),
    }));
  } else {
    if (classKey) {
      const byClass = await deriveHeldMembers(client, userId, args.selfEmail ?? null);
      rows = (byClass.get(classKey) ?? []).slice(0, MAX_DEED_ITEMS).map((m) => ({
        id: m.id, source_data: m.source_data, work_title: m.work_title,
      }));
    } else {
      const ids = [...new Set((args.itemIds ?? []).map(String))].slice(0, MAX_DEED_ITEMS);
      // USER-SCOPED VALIDATION: a caller's id list can only ever reach this user's own pending rows.
      const { data } = await client.from('inbox_items')
        .select('id, user_id, connection_id, work_title, source_data')
        .eq('user_id', userId).eq('status', 'pending').in('id', ids);
      rows = (data ?? []) as InboxItemRow[];
    }
    items = rows.map((r) => ({ itemId: String(r.id), subject: subjectOf(r) }));
  }

  if (!items.length) return { ok: false, error: 'nothing to act on — that set is empty' };

  // ── THE BREAKDOWN, computed BEFORE the commit (A7: "the preview card states it before commit") ─
  const breakdown: BulkBreakdown = { total: items.length };

  if (verb === 'archive' || verb === 'trash') {
    let withMailbox = 0;
    for (const r of rows) {
      const t = await resolveMailTarget(client, userId, r);
      if (t) withMailbox++;
    }
    breakdown.withMailbox = withMailbox;
    breakdown.noMailbox = items.length - withMailbox;
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

/**
 * THE ONE COMMIT DOOR. Claims the deed atomically, walks its STORED member list per-item
 * best-effort, records an outcome per item, and writes one honest tally back onto the row.
 *
 * Per-item best-effort is the deed's shape, not a shortcut: one dead list server or one message
 * another device already moved must not abort the other twenty-nine, and every one of those
 * individual truths is recorded rather than averaged into a single "done".
 */
export async function commitBulkDeed(
  client: DBClient, userId: string, deedId: string,
): Promise<CommitResult> {
  const existing = await readBulkDeed(client, userId, deedId);
  if (!existing) return { ok: false, error: 'that deed is not on file' };

  // EXACTLY-ONCE: a committed deed returns its prior result rather than acting a second time.
  if (existing.committedAt) return { ok: true, deed: existing, alreadyCommitted: true };

  const claimedAt = new Date().toISOString();
  const { data: claimed } = await client.from('item_plans')
    .update({ tasks: { ...existing, committedAt: claimedAt }, updated_at: claimedAt })
    .eq('user_id', userId).eq('kind', BULK_DEED_KIND).eq('entity_id', deedId)
    .filter('tasks->>committedAt', 'is', null)
    .select('entity_id');
  if (!claimed || (claimed as unknown[]).length === 0) {
    // Someone else claimed it between the read and the update — theirs is the real result.
    const prior = await readBulkDeed(client, userId, deedId);
    return prior ? { ok: true, deed: prior, alreadyCommitted: true } : { ok: false, error: 'that deed is not on file' };
  }

  const outcomes: DeedOutcome[] = [];
  for (const ref of existing.items) {
    outcomes.push(await runOne(client, userId, existing.verb, ref));
  }

  const count = (s: DeedOutcomeStatus) => outcomes.filter((o) => o.status === s).length;
  const tally = {
    done: count('done'), partial: count('partial'), skipped: count('skipped'), failed: count('failed'),
    line: tallyLine(existing.verb, outcomes),
  };
  const committed: BulkDeed = { ...existing, committedAt: claimedAt, outcomes, tally };

  await client.from('item_plans')
    .update({ tasks: committed, updated_at: new Date().toISOString() })
    .eq('user_id', userId).eq('kind', BULK_DEED_KIND).eq('entity_id', deedId);

  // THE DEED ITSELF IS LOGGED, beside the per-item rows its doors already wrote. Not reversible as
  // one act (undo is per item, where the doors put it) — so it carries no reversible type.
  await logActivity(client, userId, {
    type: 'bulk_deed',
    title: `${existing.intro} ${tally.line}`,
    entityType: 'bulk_deed',
    entityId: existing.id,
    metadata: { verb: existing.verb, classKey: existing.classKey, ...tally },
  });

  return { ok: true, deed: committed, alreadyCommitted: false };
}

// ── the per-item lanes ──────────────────────────────────────────────────────────────────────────

async function loadItem(client: DBClient, userId: string, itemId: string): Promise<InboxItemRow | null> {
  const { data } = await client.from('inbox_items')
    .select('id, user_id, connection_id, work_title, source_data')
    .eq('id', itemId).eq('user_id', userId).maybeSingle();
  return (data as InboxItemRow | null) ?? null;
}

async function runOne(
  client: DBClient, userId: string, verb: BulkVerb, ref: DeedItemRef,
): Promise<DeedOutcome> {
  try {
    if (verb === 'expire') return await runExpire(client, userId, ref);
    const item = await loadItem(client, userId, ref.itemId);
    if (!item) return { itemId: ref.itemId, status: 'skipped', note: 'already resolved elsewhere' };
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
