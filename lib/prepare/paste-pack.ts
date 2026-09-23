// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PASTE PACK — prepare the words even when the DEED is out of reach
// (docs/attention-plan.md PART III, law Q8: "where the send/act is out of reach (external apps,
//  portals), the artifact is still staged — the message to paste, the 30-second pack").
//
// THE LAW THIS ENFORCES: preparation is not a synonym for sending. Every lane in the pass today ends
// at a commit door — a reply at the mailbox, an invite at the calendar, a forward at the send route
// — and when that door does not exist for this account or this item, the lane returns a silent
// `none` and the user gets NOTHING. But the hard half of the work was never the click. A pack is the
// finished words, honestly labelled as words: the user pastes them wherever the work actually lives
// (a portal, a chat app, a form, another company's system).
//
// THREE FLOORS:
//
//   1 · DETERMINISTIC ELIGIBILITY, ZERO AI. `pastePackEligibility` is pure. A verb whose commit door
//       IS reachable never packs — a mail-capable reply gets the real draft, on the real thread,
//       with the real Send. Two honest reasons qualify, and only two:
//         • FEATURE OFF — the workspace feature gating this verb's commit capability is off
//           (the sovereign tier: no connected mailbox exists, so no reply can ever be sent from
//           here). Derived from the ONE registry + the ONE TOOL_FEATURE map — never a second list.
//         • NO MAIL THREAD — a `reply` verdict on a COMMITMENT. The reply lane is mail-only by
//           construction (it reads the inbox row's own thread); a commitment carries no thread of
//           its own, so the lane's first query misses and the item has been preparing NOTHING.
//           Measured on the reference account: 4 standing `reply` commitments, all silent.
//
//   2 · THE ARTIFACT TRUTH HOLDS. The pack is drafted through the SAME drafter every other lane
//       uses, with the same discipline: it may claim only what is actually staged, and it never
//       invents a document, a date or a person.
//
//   3 · IT IS A PreparedArtifact, NOT A NEW SURFACE. The pack lands in the deliverable pool, so
//       `getPrepared` serves it to every surface that already reads prepared work — the deck badge,
//       the deep-dive, the machine's state derivation — with no consumer edited. A pack is
//       explicitly NOT send-shaped (the machine's SEND_KINDS excludes it): there is no button here
//       that could fire, and pretending otherwise would be a door that cannot open.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkspaceFeatures } from '@/lib/workspace/types';
import { TOOL_FEATURE } from '@/lib/workspace/tool-capabilities';
import { componentForWork, WORK_COMPONENTS, CAPABILITY_MAP } from '@/lib/work/surface-registry';
import { claimsUndoneWork, completionObjection, COMPLETION_HONESTY_RULE } from '@/lib/prepare/truth';

/** The pool task_id — one home, one key. */
export const PASTE_PACK_TASK = 'paste-pack';

/** Why a deed is out of reach. Vocabulary the pack's own note is composed from. */
export type PastePackReason = 'feature_off' | 'no_mail_thread';

/** The verbs whose preparation IS A MESSAGE, and nothing else. Everything else is excluded on
 *  purpose, and each exclusion is a claim about what the ordinary lane already gives:
 *    • `schedule` / `forward` — their artifacts are a time and a recipient list, not words to paste.
 *    • `produce` — its preparation is already a document in the pool; a pack would duplicate it.
 *    • `send_file` — its lane resolves and stages the FILE, which is strictly more than words;
 *      replacing that with a message would be a downgrade wearing a new name. */
const WORD_VERBS = new Set(['reply', 'chase']);

export type PastePackEligibility = { eligible: boolean; reason: PastePackReason | null; why: string };

/**
 * THE PREDICATE (pure, zero-AI, zero-IO). Given the judged verb, the item's kind and this
 * workspace's features, is this a piece of work whose DEED we cannot perform — and whose words we
 * should therefore still prepare?
 */
export function pastePackEligibility(
  input: { work: string; itemKind: 'inbox' | 'commitment'; features: Partial<WorkspaceFeatures> | null },
): PastePackEligibility {
  const no = (why: string): PastePackEligibility => ({ eligible: false, reason: null, why });
  if (!WORD_VERBS.has(input.work)) return no('not a words-shaped verb — its preparation is not a message');

  // THE FEATURE LADDER, read through the ONE registry: the verb's component names the capability
  // that COMMITS it, and that capability names the workspace feature it needs. TOOL_FEATURE answers
  // first (it is the source of truth for anything that is also a TOOL); the capability row's own
  // `feature` — its declared cross-reference — answers for the capabilities that are not chat tools
  // (`send_email` is one: it has no tool row, and reading only TOOL_FEATURE silently answered "no
  // feature gates this", which would have made the sovereign tier invisible to this predicate).
  const comp = componentForWork(input.work);
  const capability = comp ? (WORK_COMPONENTS.find((c) => c.key === comp)?.capability ?? null) : null;
  const feature = capability
    ? (capability in TOOL_FEATURE ? TOOL_FEATURE[capability] : CAPABILITY_MAP[capability]?.feature ?? null) ?? null
    : null;
  if (feature && input.features && (input.features as Record<string, boolean>)[feature] === false) {
    return { eligible: true, reason: 'feature_off', why: `this workspace has no ${feature} door — the words are still the work` };
  }

  // THE MAIL-ONLY LANE: a reply is drafted onto an inbox row's own thread. A commitment has none.
  if (input.work === 'reply' && input.itemKind === 'commitment') {
    return { eligible: true, reason: 'no_mail_thread', why: 'this obligation has no email thread to reply on — the words go wherever it lives' };
  }

  return no('the commit door for this verb is reachable — the ordinary lane prepares it');
}

/** THE NOTE — what the user is looking at, in the calm vocabulary. Deterministic, never a model's. */
export function pastePackNote(reason: PastePackReason): string {
  return reason === 'feature_off'
    ? 'Words ready — copy them wherever this gets sent. Nothing goes out from here.'
    : 'Words ready — copy them wherever this conversation lives. Nothing goes out from here.';
}

/** The pack as stored and as read back. */
export type PastePack = { title: string; body: string; note: string; reason: PastePackReason };

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Prepare (or refresh) ONE item's pack. Idempotent per item: a fresh pack is never re-generated, and
 * a ground move supersedes it exactly as it supersedes every other prepared artifact.
 * The three outcomes are DISTINCT and spoken as such — "already prepared" and "could not write" are
 * different truths, and conflating them is the failure-honesty class.
 */
export async function preparePastePack(
  admin: SupabaseClient, userId: string,
  args: {
    itemKind: 'inbox' | 'commitment'; itemId: string; title: string;
    counterparty: string | null; reason: PastePackReason;
    /** The item's own material — the pack's ground. */
    material?: string | null;
    /** THE ARTIFACT TRUTH: what is actually staged; the pack may claim nothing else. */
    artifactTruth?: string | null;
    /** true when the USER owes this (a reply/produce), false when they are chasing. */
    userOwes: boolean;
    freshHours?: number;
    /** W5c: THE ONE READER hides the prior pack (a false completion claim, a superseded ground) —
     *  a hidden pack is never "fresh", whatever its age. */
    supersede?: boolean;
    /** TRUE ADDRESSEES (W7.3): who the words greet — stamped on the pack so THE ONE READER can
     *  withdraw it if it greets the user or someone who is no longer the counterparty. */
    addressee?: import('@/lib/prepare/addressee').Addressee | null;
  },
): Promise<{ status: 'written' | 'fresh' | 'failed'; title?: string; by?: string | null }> {
  const poolKind = args.itemKind === 'commitment' ? 'commitment' : 'email';
  const freshMs = (args.freshHours ?? 24) * 3_600_000;
  const { data: prior } = await admin.from('item_deliverables').select('id, created_at, metadata')
    .eq('user_id', userId).eq('kind', poolKind).eq('entity_id', args.itemId).eq('task_id', PASTE_PACK_TASK)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  const { groundOf, groundMoved } = await import('@/lib/prepare/ground');
  const currentGround = await groundOf(admin, userId, { kind: args.itemKind, id: args.itemId });
  const priorMeta = (prior?.metadata ?? {}) as { prepared_from?: { emailId?: string | null; receivedAt?: string | null } | null };
  const movedPast = !!prior && groundMoved(priorMeta.prepared_from ?? null, currentGround);
  if (prior && !movedPast && !args.supersede && (Date.now() - Date.parse(String(prior.created_at))) < freshMs) return { status: 'fresh' };

  const { generateNudgeDraft, getDraftingAssistant } = await import('@/lib/inbox/draft-reply');
  const draft = (objection: string | null) => generateNudgeDraft(userId, {
    counterparty: args.counterparty,
    description: args.title,
    mirrorText: args.material ?? null,
    // THE OWED DIRECTION: the same drafter, told honestly who owes whom — a message about something
    // the USER owes must never read as a chase for something they are waiting on.
    direction: args.userOwes ? 'you' : 'them',
    instructions: [
      args.artifactTruth ?? '',
      // THE FACTS the words must respect (W5a): the obligation is OPEN and nothing is staged with
      // a pack — the drafter is told so, and the completion rule rides beside it.
      args.userOwes ? `FACTS: this obligation is STILL OPEN — nothing about it has been done, sent or attached yet. ${COMPLETION_HONESTY_RULE}` : '',
      'This message will be COPIED AND PASTED by the user into wherever this work actually lives ' +
      '(a portal, a chat app, a form). Write only the message itself — no email subject line, no ' +
      'greeting chrome beyond what the channel would carry, no signature block.',
      objection ? `REVIEWER'S OBJECTION — fix this: ${objection}` : '',
    ].filter(Boolean).join('\n'),
  }, admin).catch(() => '');
  let body = await draft(null);
  if (!body?.trim()) return { status: 'failed' };
  // ── THE COMPLETION FLOOR (W5a — the fabricated-deed class, found live on this exact lane): a
  // pack carries no attachment and speaks about an OPEN obligation, so words announcing the deed
  // done are false by construction. One regeneration with the objection; still false → REFUSE
  // (nothing is stored — an honest absence beats a lie in the user's own voice). ──
  const claim = claimsUndoneWork(body, { obligationOpen: args.userOwes, staged: false });
  if (claim) {
    body = await draft(completionObjection(claim));
    if (!body?.trim() || claimsUndoneWork(body, { obligationOpen: args.userOwes, staged: false })) {
      console.warn(`[paste-pack] refused: the words claimed an undone deed twice ("${claim.slice(0, 60)}") — item ${args.itemKind}:${args.itemId}`);
      return { status: 'failed' };
    }
  }

  const pa = await getDraftingAssistant(admin, userId);
  // The superseded pack FILES into the version chain (the reader skips `version_of` rows).
  if ((movedPast || args.supersede) && prior) {
    await admin.from('item_deliverables')
      .update({ metadata: { ...priorMeta, version_of: movedPast ? 'superseded:ground-move' : 'superseded:truth' } })
      .eq('id', prior.id).then(() => {}, () => {});
  }
  const title = `Words for — ${args.title}`.slice(0, 100);
  const { error } = await admin.from('item_deliverables').insert({
    user_id: userId, kind: poolKind, entity_id: args.itemId, task_id: PASTE_PACK_TASK, type: 'document',
    title, content: body.trim(), ref: null,
    metadata: {
      pastePack: true, pastePackReason: args.reason, note: pastePackNote(args.reason),
      prepared_from: currentGround, ...(pa ? { agentName: pa.name } : {}),
      ...(args.addressee !== undefined ? { addressee: args.addressee } : {}),
    },
  });
  if (error) return { status: 'failed' };
  // The deck's ✦ badge reads source_data (the C3 surfacing seam) — a pool-only preparation is
  // invisible on an inbox row without this stamp (the decision-brief lane's precedent).
  if (args.itemKind === 'inbox' && pa) {
    try {
      const { data: it } = await admin.from('inbox_items').select('source_data').eq('id', args.itemId).maybeSingle();
      const sd = (it?.source_data ?? {}) as Record<string, unknown>;
      await admin.from('inbox_items').update({ source_data: { ...sd, prepared_by: { worker: pa.name, at: new Date().toISOString() } } }).eq('id', args.itemId);
    } catch { /* the deep-dive still serves the pack via getPrepared */ }
  }
  return { status: 'written', title, by: pa?.name ?? null };
}
