// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE VERDICT'S CONSEQUENCES (promise fix — "the judgment must move the posture, never just
// decorate the room"). ONE module every limb calls after judging: the ambient pass, the backlog
// sweep, and any future surface. Two consequences, both derived from THE verdict alone:
//
//   1. RESOLUTION — work='none' with a disposition ('expired' | 'answered') resolves the item:
//      expired → dismissed (no_longer_relevant), answered → completed (already_handled). Logged to
//      the activity ledger (undoable via /api/restore, same as a manual dismiss), narrated into
//      the item's room as a keyed turn, and the Home brief cache busted so the deck reflects it.
//
//   2. ARTIFACT HYGIENE — prepared artifacts that CONTRADICT the verdict are stripped (they're
//      derived state; the judged pass regenerates the right kind): a reply draft on a non-reply
//      verdict, a nudge draft on a non-chase verdict. One current artifact per intent, always
//      agreeing with the ONE judgment.
//
//   THE USER'S HAND WINS (W9.1b): neither consequence ever DELETES an artifact the user edited.
//   Every strip here goes through THE ONE ENGINE STRIP (lib/prepare/hand-store.ts
//   `stripSourceArtifacts`): machine words strip as before; a hand-held artifact is FILED into the
//   version chain and narrated once into the room WITH the user's words (it has no live card under
//   the new verdict — the room turn is where they still find it). A failed filing keeps it in place.
//
// Non-fatal by design: a failed consequence never breaks the caller; the verdict itself is
// already cached and honest.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkVerdict, JudgeInput } from './judge';
import { clip } from '@/lib/room/turns';
// ONE OPEN-STATUS CONSTANT (W2.2) — never a local list.
import { isOpenCommitmentStatus } from '@/lib/core/statuses';
import type { HandField } from '@/lib/prepare/hand';

/** The consequence's public names for the stripped source_data fields (unchanged vocabulary). */
const STRIP_NAME: Record<HandField, string> = { draft: 'reply_draft', nudge_draft: 'nudge_draft', prepared_invite: 'prepared_invite', prepared_forward: 'prepared_forward' };

export type VerdictConsequence = { resolved: boolean; stripped: string[]; /** W9.1b: hand-held artifacts filed (never deleted) */ filed: string[] };

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE EVENT LINE CARRIES THE OUTCOME, NOT THE ARGUMENT (owner walk, Sep 8 — root cause C5).
// Live, verbatim shape: `…"Acme Workflow" a I marked it done` — a raw `.slice(120)` cut the judgment's
// reason mid-word and ran it straight into the next sentence with no separator. Two laws, both in
// code here: (1) every clip is the house WORD-BOUNDARY clip; (2) the muted event line is ONE SHORT
// LINE about the outcome — the full reasoning belongs to Activity and to the judgment record, not
// to the stream (THE ONE-NARRATOR event grammar: deltas, not transcripts).
// ════════════════════════════════════════════════════════════════════════════════════════════════
const NARRATION_MAX = 140;   // the composed event line's ceiling
const NARRATION_TITLE = 48;  // the subject inside it

// ════════════════════════════════════════════════════════════════════════════════════════════════
// DELTAS, NOT EVENTS — A DRAIN SPEAKS ONCE (proactive-reach W4 census, fix #4). Found live: eight
// identical "Marked X done — already settled" lines inside ONE minute, 44 of them standing across
// the account. Each was individually true and collectively a transcript of our backlog run — the
// exact grammar the one-narrator law outlaws.
//
// THE LAW: per room, per day, resolutions COALESCE. The first writes its line; every later one the
// same day UPDATES IT IN PLACE (the keyed-dedupe idiom) into a composed count. The roll-up's
// members live in the house store (`item_plans`, kind `verdict_resolve_roll`), never parsed back
// out of the rendered sentence.
// ════════════════════════════════════════════════════════════════════════════════════════════════
const ROLL_KIND = 'verdict_resolve_roll';
const ROLL_MAX_REFS = 6;

export type ResolvedEntry = { title: string; expired: boolean; href: string };

/** THE ONE composed resolution line — singular keeps its sentence, plural becomes a count. */
export function composeResolutionLine(entries: ResolvedEntry[]): string {
  if (entries.length === 0) return '';
  if (entries.length === 1) {
    const e = entries[0];
    return clip(e.expired
      ? `Filed "${clip(e.title, NARRATION_TITLE)}" — out of date. Undo from Activity.`
      : `Marked "${clip(e.title, NARRATION_TITLE)}" done — already settled. Undo from Activity.`, NARRATION_MAX);
  }
  const n = entries.length;
  const allExpired = entries.every((e) => e.expired);
  const allAnswered = entries.every((e) => !e.expired);
  const body = allExpired ? `Filed ${n} items that were out of date`
    : allAnswered ? `Marked ${n} items done — they had already settled themselves`
      : `Settled ${n} items that had already resolved themselves`;
  return clip(`${body} — undo from Activity.`, NARRATION_MAX);
}

/**
 * THE PARK LINE, COMPOSED — never the judge's own prose. Only the verdict's structured fields reach
 * it: the subject, the date it comes back, and (when the item itself names one) who it waits on.
 * The judge's reason is a reasoning artefact written for the judge; it belongs to the activity
 * record, whole, and to nothing the user reads in the stream.
 */
export function composeRevisitLine(title: string, after: string, who?: string | null): string {
  const whoName = String(who ?? '').trim();
  const waiting = whoName ? ` — waiting on ${clip(whoName, 40)}` : '';
  return clip(`Set "${clip(title, NARRATION_TITLE)}" aside until ${after}${waiting}. Say the word if you want it now.`, NARRATION_MAX);
}

export async function applyVerdictConsequences(
  client: SupabaseClient, userId: string, input: JudgeInput, verdict: WorkVerdict,
): Promise<VerdictConsequence> {
  const out: VerdictConsequence = { resolved: false, stripped: [], filed: [] };
  try {
    // ── 0. FAILURE HONESTY (W2): a FAILED judgment moves nothing. It is not a verdict — resolving
    // an item or stripping a prepared draft on the back of an AI outage would destroy real work.
    if (verdict.failed) return out;

    // ── 0b. ASK–VERDICT COHERENCE (plan AJ, owner's find: a "reply draft" ask survived the
    // verdict's move to `decide` and sat beside a brief claiming everything prepared — three
    // subsystems, three claims). An ask lives WITH the verdict that spawned it: when the judged
    // work-class no longer takes requires (or the verdict carries none), the item's requires-asks
    // settle (component stripped, ledger text kept). Deterministic — no model in the loop. ──
    // Class-scoped on purpose: a reply/send_file/produce verdict WITHOUT requires may still have
    // a live coworker ask (delegate needsInput) that is genuinely the user's to answer — only a
    // verdict whose WORK CLASS takes no inputs at all settles the item's asks.
    if (verdict.work !== 'none' && !['reply', 'send_file', 'produce'].includes(verdict.work)) {
      try {
        const { settleAsksForItem } = await import('@/lib/room/turns');
        // why 'verdict' — a class change retires the ask; an undo of a LATER resolution never revives it.
        await settleAsksForItem(client, userId, input.kind === 'commitment' ? 'commitment' : 'inbox_item', input.id, { why: 'verdict' });
      } catch { /* coherence is an enhancement — the verdict still applies */ }
    }

    // ── 0c. W14.2 · A HIDDEN ASK IS NOT A LIVE ONE (census Sep 24: 3 engine asks every label of which
    // the moot predicate refuses — the rail hid them, the table kept them live, nothing archived
    // them). On EVERY verdict write the item's engine asks the machine now hides (the same
    // `askIsMoot` + `verdictRequireLabels` facts) ARCHIVE — never deleted, stamped `mooted`. ──
    try {
      const { archiveMootAsksForItem } = await import('@/lib/room/ask-lifecycle');
      await archiveMootAsksForItem(client, userId, { kind: input.kind === 'commitment' ? 'commitment' : 'inbox', id: input.id }, verdict);
    } catch { /* the sweep's lane is the net */ }

    // ── 1. RESOLUTION from a dispositioned none. ──
    if (verdict.work === 'none' && (verdict.resolution === 'expired' || verdict.resolution === 'answered')) {
      const now = new Date().toISOString();
      const expired = verdict.resolution === 'expired';
      if (input.kind === 'inbox') {
        const { data: it } = await client.from('inbox_items').select('id, status, work_title, source_data')
          .eq('id', input.id).eq('user_id', userId).maybeSingle();
        if (it && it.status === 'pending') {
          // THE OUTCOME LEDGER (W3.2): captured BEFORE the drafts strip — the judge found the work
          // already answered (done elsewhere — it was real) or out of date (expired).
          const { capturePending, logPendingOutcomes } = await import('@/lib/prepare/outcome');
          const pendingPrep = await capturePending(client, userId, { kind: 'inbox', id: input.id });
          // Resolved work carries no prepared drafts — machine words strip; the user's hand is FILED.
          const { stripSourceArtifacts } = await import('@/lib/prepare/hand-store');
          const strip = await stripSourceArtifacts(client, userId, {
            itemId: input.id, sd: (it.source_data ?? {}) as Record<string, unknown>, fields: ['draft', 'nudge_draft'], why: 'resolved',
          });
          const sd = strip.sd;
          if (!strip.kept.length) delete sd.prepared_by;
          out.filed.push(...strip.filed);
          await client.from('inbox_items').update({
            status: expired ? 'dismissed' : 'completed',
            source_data: { ...sd, resolved_at: now, resolution_reason: expired ? 'no_longer_relevant' : 'already_handled' },
          }).eq('id', input.id).eq('user_id', userId);
          out.resolved = true;
          await logPendingOutcomes(client, userId, pendingPrep, {
            base: expired ? 'expired' : 'done_elsewhere', itemKind: 'inbox', itemId: input.id,
            door: 'judge_resolution', source: (it.source_data ?? null) as Record<string, unknown> | null,
          }).catch(() => 0);
          // Law 3 (experience spec): the resolved item's asks settle with it — AWAITED (W14.2: a
          // fire-and-forget settle died with the function on a verdict dismiss; census C3).
          await import('@/lib/room/turns').then(({ settleAsksForItem }) => settleAsksForItem(client, userId, 'inbox_item', input.id)).catch(() => 0);
          await narrateAndLog(client, userId, input, String(it.work_title ?? ''), verdict, expired);
        }
      } else {
        const { data: c } = await client.from('commitments').select('id, status, description')
          .eq('id', input.id).eq('user_id', userId).maybeSingle();
        if (c && isOpenCommitmentStatus(String(c.status))) {
          const { capturePending, logPendingOutcomes } = await import('@/lib/prepare/outcome');
          const pendingPrep = await capturePending(client, userId, { kind: 'commitment', id: input.id });
          await client.from('commitments').update({
            status: expired ? 'dismissed' : 'done',
            resolved_at: now, resolved_reason: expired ? 'no_longer_relevant' : 'already_handled',
          }).eq('id', input.id).eq('user_id', userId);
          out.resolved = true;
          await logPendingOutcomes(client, userId, pendingPrep, {
            base: expired ? 'expired' : 'done_elsewhere', itemKind: 'commitment', itemId: input.id, door: 'judge_resolution',
          }).catch(() => 0);
          await import('@/lib/room/turns').then(({ settleAsksForItem }) => settleAsksForItem(client, userId, 'commitment', input.id)).catch(() => 0);
          await narrateAndLog(client, userId, input, String(c.description ?? ''), verdict, expired);
        }
      }
      if (out.resolved) {
        import('@/lib/home/bust-brief').then(({ softBustBrief }) => softBustBrief(client, userId)).catch(() => {});
        // ── LAW 4 · ONE CONVERSATION, ONE OBLIGATION: the judge just settled this item; if the same
        // human exchange also lives on another thread (the counterparty switched address), that copy
        // must not keep standing as an independent debt. Bounded, best-effort, once per settle. ──
        try {
          const { cascadeConversationSettlement } = await import('@/lib/inbox/conversation-identity');
          const threadId = input.kind === 'inbox'
            ? ((await client.from('inbox_items').select('source_data').eq('id', input.id).eq('user_id', userId).maybeSingle())
              .data?.source_data as { thread_id?: string } | null)?.thread_id ?? null
            : ((await client.from('commitments').select('thread_id').eq('id', input.id).eq('user_id', userId).maybeSingle())
              .data?.thread_id as string | null) ?? null;
          if (threadId) {
            await cascadeConversationSettlement(client, userId, {
              threadId, settledAt: now,
              via: expired ? 'the judge filed it as out of date' : 'the judge found it already settled',
            });
          }
        } catch { /* non-fatal */ }
      }
      return out; // resolved → no artifact hygiene needed (drafts stripped with the resolve)
    }

    // ── 1b. DELIBERATE TIME (W4) — a revisit verdict PARKS, never resolves: the item stays
    // pending (it returns on its date via the judge), the deck demotes it as a plain none, and
    // the room hears WHY it left the desk (a keyed turn, updated in place — never a stutter).
    if (verdict.work === 'none' && verdict.revisit?.after && !verdict.resolution) {
      try {
        const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
        let title = '';
        let who: string | null = null;
        if (input.kind === 'inbox') {
          const { data: it } = await client.from('inbox_items').select('work_title, source_data').eq('id', input.id).eq('user_id', userId).maybeSingle();
          title = String(it?.work_title ?? '');
          const sd = (it?.source_data ?? {}) as Record<string, unknown>;
          who = (sd.from_name as string) || (sd.from_address as string) || null;
        } else {
          const { data: c } = await client.from('commitments').select('description, counterparty').eq('id', input.id).eq('user_id', userId).maybeSingle();
          title = String(c?.description ?? '');
          who = (c?.counterparty as string) || null;
        }
        const roomKey = await roomKeyForItem(client, userId, input.kind === 'inbox' ? 'inbox' : 'commitment', input.id);
        await writeRoomTurn(client, userId, roomKey, {
          role: 'system',
          // THE REASON NEVER PIPES RAW (W4 census fix #5). Live, verbatim: "…aside until 2026-09-20
          // — no concrete action is owed by the us. I'll bring it now…" — the judge's internal reason,
          // written for the judge, cut at 60 characters mid-word and mid-thought. The reason belongs
          // to the RECORD (the activity entry + the judgment itself, whole); the room line is COMPOSED
          // from the verdict's own structured fields, in the team voice, and says only the consequence.
          text: composeRevisitLine(title, verdict.revisit.after, who),
          refs: [{ label: clip(title, 60), href: input.kind === 'inbox' ? `/item/${input.id}` : `/item/${input.id}?kind=commitment` }],
          dedupeKey: `revisit:${input.kind}:${input.id}`,
        });
        // THE WHOLE REASON LIVES IN THE RECORD — boundary-clipped, never cut mid-word.
        try {
          const { logActivity } = await import('@/lib/activity/log');
          await logActivity(client, userId, {
            type: 'work_parked',
            title: `Set aside until ${verdict.revisit.after}: ${clip(title, 80)}`,
            entityType: input.kind === 'inbox' ? 'inbox_item' : 'commitment', entityId: input.id,
            metadata: { via: 'verdict', revisitAfter: verdict.revisit.after, reason: clip(verdict.reason, 300) },
          });
        } catch { /* the ledger is a receipt, never a gate */ }
      } catch { /* narration is an enhancement */ }
      // fall through to artifact hygiene — a parked item's stale artifacts strip with the verdict
    }

    // ── 2. ARTIFACT HYGIENE — prepared work must agree with the verdict. ──
    if (input.kind === 'inbox') {
      const { data: it } = await client.from('inbox_items').select('id, source_data')
        .eq('id', input.id).eq('user_id', userId).maybeSingle();
      const sd0 = (it?.source_data ?? {}) as Record<string, unknown>;
      const draftOk = verdict.work === 'reply' || verdict.work === 'send_file';
      const contradicting: HandField[] = [];
      if (!draftOk && (sd0.draft as Record<string, unknown>)?.body) contradicting.push('draft');
      if (verdict.work !== 'chase' && (sd0.nudge_draft as Record<string, unknown>)?.body) contradicting.push('nudge_draft');
      // The W1 verbs' artifacts obey the same law: a prepared invite/forward that no longer matches
      // the verdict strips (the judged pass regenerates the right kind).
      if (verdict.work !== 'schedule' && sd0.prepared_invite) contradicting.push('prepared_invite');
      if (verdict.work !== 'forward' && sd0.prepared_forward) contradicting.push('prepared_forward');
      // THE ONE ENGINE STRIP — a hand-held artifact is FILED (version chain + one narration with the
      // user's words), never deleted; a failed filing keeps it where it is.
      let sd = { ...sd0 };
      let changed = false;
      if (it && contradicting.length) {
        const { stripSourceArtifacts } = await import('@/lib/prepare/hand-store');
        const strip = await stripSourceArtifacts(client, userId, { itemId: input.id, sd: sd0, fields: contradicting, why: 'plan_changed' });
        sd = strip.sd;
        out.stripped.push(...strip.stripped.map((f) => STRIP_NAME[f]));
        out.filed.push(...strip.filed.map((f) => STRIP_NAME[f]));
        changed = strip.stripped.length > 0;
      }
      if (changed) {
        if (!(sd.draft as Record<string, unknown>)?.body && !(sd.nudge_draft as Record<string, unknown>)?.body
          && !sd.prepared_invite && !sd.prepared_forward) delete sd.prepared_by;
        await client.from('inbox_items').update({ source_data: sd }).eq('id', input.id).eq('user_id', userId);
      }
      // ── THE NARRATION FOLLOWS ITS ARTIFACT — UNGATED (found live, Aug 14: the draft died
      // through another door a day earlier, `changed` stayed false here, and "Clara drafted the
      // reply — it's ready to review" survived its draft into a decide verdict as a standing lie).
      // A prep narration may survive ONLY while the CURRENT verdict's lane still holds its
      // artifact; otherwise it deletes — idempotent, and the pass re-narrates the current lane
      // the next time it prepares. (Commitment narrations live on pool rows whose writers
      // replace them keyed — this door covers the inbox sd lanes + the pool-backed verbs.) ──
      let narrationBacked = false;
      if (verdict.work === 'reply' || verdict.work === 'send_file') narrationBacked = !!(sd.draft as Record<string, unknown>)?.body;
      else if (verdict.work === 'chase') narrationBacked = !!(sd.nudge_draft as Record<string, unknown>)?.body;
      else if (verdict.work === 'schedule') narrationBacked = !!sd.prepared_invite;
      else if (verdict.work === 'forward') narrationBacked = !!sd.prepared_forward;
      else if (verdict.work === 'produce' || verdict.work === 'decide') {
        const { data: poolArt } = await client.from('item_deliverables').select('id')
          .eq('user_id', userId).eq('kind', 'email').eq('entity_id', input.id)
          .in('task_id', ['prepare-pass', 'decision-brief']).limit(1).maybeSingle();
        narrationBacked = !!poolArt;
      }
      if (!narrationBacked) {
        // W14.2 · ARCHIVE, NEVER DELETE (the narration is the record; the pass re-narrates the current
        // lane, and W13.5's key release lets that re-narration land live).
        const { prepNarrationKeys } = await import('@/lib/prepare/narration');
        await client.from('room_turns').update({ archived_at: new Date().toISOString() })
          .eq('user_id', userId).in('dedupe_key', prepNarrationKeys('inbox', input.id)).is('archived_at', null)
          .then(() => {}, () => {});
      }
    }
  } catch { /* non-fatal */ }
  return out;
}

async function narrateAndLog(
  client: SupabaseClient, userId: string, input: JudgeInput, title: string,
  verdict: WorkVerdict, expired: boolean,
): Promise<void> {
  try {
    const { logActivity } = await import('@/lib/activity/log');
    await logActivity(client, userId, {
      type: expired ? 'dismissed' : 'marked_done',
      title: `${expired ? 'Filed (out of date)' : 'Resolved (already settled)'}: ${clip(title, 80)}`,
      entityType: input.kind === 'inbox' ? 'inbox_item' : 'commitment', entityId: input.id,
      // THE WHOLE REASON LIVES HERE — the record keeps what the stream must not carry.
      metadata: { via: 'verdict', resolution: verdict.resolution, reason: clip(verdict.reason, 300) },
    });
  } catch { /* non-fatal */ }
  await narrateResolution(client, userId, input, title, expired);
}

/**
 * THE ONE RESOLUTION NARRATION — the drain's coalesced line + the item's own narrations archived.
 * Exported so every machine settle (the verdict here, EVIDENCE SETTLES in lib/work/evidence-settle)
 * speaks through the same keyed turn: one room, one day, one line — never a second narrator.
 */
export async function narrateResolution(
  client: SupabaseClient, userId: string, input: JudgeInput, title: string, expired: boolean,
): Promise<void> {
  try {
    const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
    const roomKey = await roomKeyForItem(client, userId, input.kind === 'inbox' ? 'inbox' : 'commitment', input.id);

    // ── THE ITEM'S OWN NARRATIONS DIE WITH IT (the narration-follows-its-artifact precedent): the
    // work it was preparing/parking is settled, so the lines about that preparation are record, not
    // news. They archive here, at the resolution seam — never left to a fold rule to hide. ──
    await archiveItemNarrations(client, userId, input, roomKey);

    // ── THE DRAIN SPEAKS ONCE — one keyed turn per room per day, updated in place. ──
    const { userTimezone, localNow } = await import('@/lib/utils/user-time');
    const day = localNow(await userTimezone(client, userId)).dateStr;
    const rollKey = `${roomKey}:${day}`;
    const entry: ResolvedEntry = {
      title: clip(title, NARRATION_TITLE), expired,
      href: input.kind === 'inbox' ? `/item/${input.id}` : `/item/${input.id}?kind=commitment`,
    };
    let entries: ResolvedEntry[] = [entry];
    try {
      const { data: prior } = await client.from('item_plans').select('tasks')
        .eq('user_id', userId).eq('kind', ROLL_KIND).eq('entity_id', rollKey).maybeSingle();
      const held = ((prior?.tasks as { entries?: ResolvedEntry[] } | null)?.entries ?? [])
        .filter((e) => e && typeof e.title === 'string' && e.href !== entry.href);
      entries = [...held, entry];
      await client.from('item_plans').upsert({
        user_id: userId, kind: ROLL_KIND, entity_id: rollKey,
        tasks: { entries: entries.slice(-50), day }, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,kind,entity_id' });
    } catch { /* the store is the memory, never the gate — a single line still lands */ }

    await writeRoomTurn(client, userId, roomKey, {
      role: 'system',
      // ONE LINE, ONE OUTCOME — the reason is recorded on the activity entry above (and on the
      // judgment itself); the stream says what happened and where to undo it.
      text: composeResolutionLine(entries),
      refs: entries.slice(-ROLL_MAX_REFS).map((e) => ({ label: clip(e.title, 60), href: e.href })),
      dedupeKey: `verdict-resolve:${day}`,
    });
  } catch { /* non-fatal */ }
}

/** The keyed narrations that belong to ONE item — archived when that item resolves. Pre-migration
 *  (no `archived_at` column) degrades to a delete, exactly as the room's own Clear does. */
async function archiveItemNarrations(
  client: SupabaseClient, userId: string, input: JudgeInput, roomKey: string,
): Promise<void> {
  try {
    const keys = [
      `prep:${input.kind}:${input.id}`,
      // The prep WRITER (lib/prepare/pass.ts) keys on the work-spine id, whose commitment segment
      // is `commit:` — not the judge-input kind `commitment:`. Both spellings must archive, or a
      // commitment's prep line outlives its settled deed (found by the Sep 17 retro-sweep census).
      ...(input.kind === 'commitment' ? [`prep:commit:${input.id}`] : []),
      `revisit:${input.kind}:${input.id}`,
      `verdict-resolve:${input.kind}:${input.id}`, // the pre-coalesce per-item line
    ];
    const { error } = await client.from('room_turns')
      .update({ archived_at: new Date().toISOString() })
      .eq('user_id', userId).eq('room_key', roomKey).in('dedupe_key', keys).is('archived_at', null);
    if (error) {
      await client.from('room_turns').delete()
        .eq('user_id', userId).eq('room_key', roomKey).in('dedupe_key', keys);
    }
  } catch { /* narration hygiene is never fatal */ }
}
