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
// Non-fatal by design: a failed consequence never breaks the caller; the verdict itself is
// already cached and honest.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkVerdict, JudgeInput } from './judge';

export type VerdictConsequence = { resolved: boolean; stripped: string[] };

export async function applyVerdictConsequences(
  client: SupabaseClient, userId: string, input: JudgeInput, verdict: WorkVerdict,
): Promise<VerdictConsequence> {
  const out: VerdictConsequence = { resolved: false, stripped: [] };
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
        await settleAsksForItem(client, userId, input.kind === 'commitment' ? 'commitment' : 'inbox_item', input.id);
      } catch { /* coherence is an enhancement — the verdict still applies */ }
    }

    // ── 1. RESOLUTION from a dispositioned none. ──
    if (verdict.work === 'none' && (verdict.resolution === 'expired' || verdict.resolution === 'answered')) {
      const now = new Date().toISOString();
      const expired = verdict.resolution === 'expired';
      if (input.kind === 'inbox') {
        const { data: it } = await client.from('inbox_items').select('id, status, work_title, source_data')
          .eq('id', input.id).eq('user_id', userId).maybeSingle();
        if (it && it.status === 'pending') {
          const sd = { ...((it.source_data ?? {}) as Record<string, unknown>) };
          delete sd.draft; delete sd.nudge_draft; delete sd.prepared_by; // resolved work carries no prepared drafts
          await client.from('inbox_items').update({
            status: expired ? 'dismissed' : 'completed',
            source_data: { ...sd, resolved_at: now, resolution_reason: expired ? 'no_longer_relevant' : 'already_handled' },
          }).eq('id', input.id).eq('user_id', userId);
          out.resolved = true;
          // Law 3 (experience spec): the resolved item's asks settle with it.
          import('@/lib/room/turns').then(({ settleAsksForItem }) => settleAsksForItem(client, userId, 'inbox_item', input.id)).catch(() => {});
          await narrateAndLog(client, userId, input, String(it.work_title ?? ''), verdict, expired);
        }
      } else {
        const { data: c } = await client.from('commitments').select('id, status, description')
          .eq('id', input.id).eq('user_id', userId).maybeSingle();
        if (c && ['open', 'pending', 'in_progress'].includes(String(c.status))) {
          await client.from('commitments').update({
            status: expired ? 'dismissed' : 'done',
            resolved_at: now, resolved_reason: expired ? 'no_longer_relevant' : 'already_handled',
          }).eq('id', input.id).eq('user_id', userId);
          out.resolved = true;
          import('@/lib/room/turns').then(({ settleAsksForItem }) => settleAsksForItem(client, userId, 'commitment', input.id)).catch(() => {});
          await narrateAndLog(client, userId, input, String(c.description ?? ''), verdict, expired);
        }
      }
      if (out.resolved) {
        import('@/lib/home/bust-brief').then(({ softBustBrief }) => softBustBrief(client, userId)).catch(() => {});
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
        if (input.kind === 'inbox') {
          const { data: it } = await client.from('inbox_items').select('work_title').eq('id', input.id).eq('user_id', userId).maybeSingle();
          title = String(it?.work_title ?? '');
        } else {
          const { data: c } = await client.from('commitments').select('description').eq('id', input.id).eq('user_id', userId).maybeSingle();
          title = String(c?.description ?? '');
        }
        const roomKey = await roomKeyForItem(client, userId, input.kind === 'inbox' ? 'inbox' : 'commitment', input.id);
        await writeRoomTurn(client, userId, roomKey, {
          role: 'system',
          text: `Set "${title.slice(0, 60)}" aside until ${verdict.revisit.after}${verdict.revisit.reason ? ` — ${verdict.revisit.reason.slice(0, 110)}` : ''}. I'll bring it back then; say the word if you want it now.`,
          refs: [{ label: title.slice(0, 60), href: input.kind === 'inbox' ? `/item/${input.id}` : `/item/${input.id}?kind=commitment` }],
          dedupeKey: `revisit:${input.kind}:${input.id}`,
        });
      } catch { /* narration is an enhancement */ }
      // fall through to artifact hygiene — a parked item's stale artifacts strip with the verdict
    }

    // ── 2. ARTIFACT HYGIENE — prepared work must agree with the verdict. ──
    if (input.kind === 'inbox') {
      const { data: it } = await client.from('inbox_items').select('id, source_data')
        .eq('id', input.id).eq('user_id', userId).maybeSingle();
      const sd = { ...((it?.source_data ?? {}) as Record<string, unknown>) };
      let changed = false;
      const draftOk = verdict.work === 'reply' || verdict.work === 'send_file';
      if (!draftOk && (sd.draft as Record<string, unknown>)?.body) { delete sd.draft; out.stripped.push('reply_draft'); changed = true; }
      if (verdict.work !== 'chase' && (sd.nudge_draft as Record<string, unknown>)?.body) { delete sd.nudge_draft; out.stripped.push('nudge_draft'); changed = true; }
      // The W1 verbs' artifacts obey the same law: a prepared invite/forward that no longer matches
      // the verdict strips (the judged pass regenerates the right kind).
      if (verdict.work !== 'schedule' && sd.prepared_invite) { delete sd.prepared_invite; out.stripped.push('prepared_invite'); changed = true; }
      if (verdict.work !== 'forward' && sd.prepared_forward) { delete sd.prepared_forward; out.stripped.push('prepared_forward'); changed = true; }
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
        await client.from('room_turns').delete().eq('user_id', userId).eq('dedupe_key', `prep:inbox:${input.id}`).then(() => {}, () => {});
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
      title: `${expired ? 'Filed (out of date)' : 'Resolved (already settled)'}: ${title.slice(0, 80)}`,
      entityType: input.kind === 'inbox' ? 'inbox_item' : 'commitment', entityId: input.id,
      metadata: { via: 'verdict', resolution: verdict.resolution, reason: verdict.reason.slice(0, 140) },
    });
  } catch { /* non-fatal */ }
  try {
    const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
    const roomKey = await roomKeyForItem(client, userId, input.kind === 'inbox' ? 'inbox' : 'commitment', input.id);
    await writeRoomTurn(client, userId, roomKey, {
      role: 'system',
      text: expired
        ? `"${title.slice(0, 60)}" ran out of time — ${verdict.reason.slice(0, 120)} I filed it; undo from Activity if I'm wrong.`
        : `"${title.slice(0, 60)}" is already settled — ${verdict.reason.slice(0, 120)} I marked it done; undo from Activity if I'm wrong.`,
      refs: [{ label: title.slice(0, 60), href: input.kind === 'inbox' ? `/item/${input.id}` : `/item/${input.id}?kind=commitment` }],
      dedupeKey: `verdict-resolve:${input.kind}:${input.id}`,
    });
  } catch { /* non-fatal */ }
}
